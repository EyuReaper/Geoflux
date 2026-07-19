import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { prisma, Prisma } from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";
import { requireDatasetOwner } from "../middleware/ownership.js";
import {
  getCachedTile,
  cacheTile,
  getTileKey,
  touchTileIndex,
} from "../services/tileCache.js";
import { validateRequest, tileParamsSchema } from "../utils/validation.js";
import { logger } from "../utils/logger.js";

const router = Router({ mergeParams: true });

const tileLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

type MvtRow = { mvt?: Buffer | null };

router.get(
  "/:z/:x/:y.pbf",
  tileLimiter,
  authenticateToken,
  validateRequest(tileParamsSchema),
  requireDatasetOwner,
  async (req: AuthRequest, res) => {
    try {
      const id = req.dataset!.id;
      const z = Number(req.params.z);
      const x = Number(req.params.x);
      const y = Number(req.params.y);

      const min = typeof req.query.min === "number" ? req.query.min : Number(req.query.min) || 0;
      const max =
        typeof req.query.max === "number"
          ? req.query.max
          : Number(req.query.max) || Infinity;
      const cats = Array.isArray(req.query.cats)
        ? (req.query.cats as string[])
        : typeof req.query.cats === "string"
          ? req.query.cats.split(",").filter(Boolean)
          : [];
      const search =
        typeof req.query.search === "string" ? req.query.search.toLowerCase() : "";
      const mode = typeof req.query.mode === "string" ? req.query.mode : undefined;
      const isAreaMode = mode === "area";

      const cacheKey = `${id}-${isAreaMode ? "area" : "points"}-f:${min}-${max}-${cats.join(".")}-${search}-${req.query.gridType}-${req.query.res}`;
      const redisKey = getTileKey(id, cacheKey, z, x, y);

      const cachedPbf = await getCachedTile(redisKey);
      if (cachedPbf) {
        res.setHeader("Content-Type", "application/x-protobuf");
        res.setHeader("Cache-Control", "private, max-age=60");
        res.setHeader("X-Cache", "HIT-REDIS");
        return res.send(cachedPbf);
      }

      const filterFragments: unknown[] = [];
      if (cats.length > 0) {
        filterFragments.push(Prisma.sql`AND "category" IN (${Prisma.join(cats)})`);
      }
      if (search) {
        filterFragments.push(Prisma.sql`AND "properties"::text ILIKE ${`%${search}%`}`);
      }
      const extraFilters =
        filterFragments.length > 0 ? Prisma.join(filterFragments, " ") : Prisma.empty;

      let result: MvtRow[];

      if (isAreaMode) {
        const gridType = req.query.gridType || "hex";
        const resolution =
          typeof req.query.res === "number"
            ? req.query.res
            : Number(req.query.res) || 0.1 / Math.pow(2, z - 2);
        const gridFn =
          gridType === "hex" ? Prisma.raw("ST_HexagonGrid") : Prisma.raw("ST_SquareGrid");

        result = (await prisma.$queryRaw`
          WITH grid AS (
            SELECT
              ${gridFn}(${resolution}, geometry) as geom,
              "value", "properties"
            FROM "Feature"
            WHERE "datasetId" = ${id}
              AND geometry && ST_TileEnvelope(${z}, ${x}, ${y})
              AND ("value" IS NULL OR ("value" >= ${min} AND "value" <= ${max}))
              ${extraFilters}
          ),
          mvt_geom AS (
            SELECT
              ST_AsMVTGeom(geom, ST_TileEnvelope(${z}, ${x}, ${y}), 4096, 64, true) AS geom,
              jsonb_build_object('value', SUM("value"), 'count', COUNT(*)) as props
            FROM grid
            GROUP BY geom
          )
          SELECT ST_AsMVT(mvt_geom.*, 'geoflux-layer') AS mvt FROM mvt_geom
        `) as MvtRow[];
      } else {
        result = (await prisma.$queryRaw`
          WITH mvt_geom AS (
            SELECT
              ST_AsMVTGeom(geometry, ST_TileEnvelope(${z}, ${x}, ${y}), 4096, 64, true) AS geom,
              CASE
                WHEN properties = '{}'::jsonb THEN jsonb_build_object('value', "value", 'category', "category")
                ELSE jsonb_build_object('value', "value", 'category', "category") || properties
              END as props
            FROM "Feature"
            WHERE "datasetId" = ${id}
              AND geometry && ST_TileEnvelope(${z}, ${x}, ${y})
              AND ("value" IS NULL OR ("value" >= ${min} AND "value" <= ${max}))
              ${extraFilters}
          )
          SELECT ST_AsMVT(mvt_geom.*, 'geoflux-layer') AS mvt FROM mvt_geom
        `) as MvtRow[];
      }

      const buffer = result[0]?.mvt;

      if (!buffer || buffer.length === 0) {
        return res.status(204).send();
      }

      touchTileIndex(id, cacheKey);
      cacheTile(redisKey, buffer);

      res.setHeader("Content-Type", "application/x-protobuf");
      res.setHeader("Cache-Control", "private, max-age=60");
      res.send(buffer);
    } catch (error: unknown) {
      logger.error({ err: error }, "Tile generation error");
      res.status(500).send("Error generating tile");
    }
  }
);

export default router;
