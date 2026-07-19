import { Router } from "express";
import { prisma } from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";
import { requireDatasetOwner } from "../middleware/ownership.js";
import { insertFeaturesInBatches } from "../services/ingest.js";
import { evictDatasetTiles } from "../services/tileCache.js";
import {
  validateRequest,
  datasetCreateSchema,
  uuidParamSchema,
} from "../utils/validation.js";
import { logger } from "../utils/logger.js";

const router = Router();

type ExportFeatureRow = {
  geometry: { coordinates?: number[] } | null;
  properties: Record<string, unknown> | null;
  value: number | null;
  category: string | null;
};

router.get("/", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const datasets = await prisma.dataset.findMany({
      where: { userId: req.user?.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, color: true, createdAt: true, updatedAt: true },
    });
    res.json(datasets);
  } catch {
    res.status(500).json({ error: "Failed to fetch datasets" });
  }
});

router.get(
  "/:id/stats",
  authenticateToken,
  validateRequest(uuidParamSchema),
  requireDatasetOwner,
  async (req: AuthRequest, res) => {
    const id = req.dataset!.id;
    try {
      const stats = await prisma.feature.aggregate({
        where: { datasetId: id },
        _min: { value: true },
        _max: { value: true },
        _count: true,
      });

      const categoryRows = await prisma.feature.findMany({
        where: { datasetId: id },
        distinct: ["category"],
        select: { category: true },
      });

      res.json({
        min: stats._min.value || 0,
        max: stats._max.value || 0,
        categories: categoryRows.map((r: { category: string | null }) => r.category).filter(Boolean),
        count: stats._count,
      });
    } catch (error: unknown) {
      logger.error({ err: error, id }, "Stats error");
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  }
);

router.get(
  "/:id",
  authenticateToken,
  validateRequest(uuidParamSchema),
  requireDatasetOwner,
  async (req: AuthRequest, res) => {
    try {
      const dataset = req.dataset!;
      res.json({
        id: dataset.id,
        name: dataset.name,
        color: dataset.color,
        type: dataset.type,
        userId: dataset.userId,
        createdAt: dataset.createdAt,
        updatedAt: dataset.updatedAt,
      });
    } catch {
      res.status(500).json({ error: "Failed to fetch dataset" });
    }
  }
);

router.get(
  "/:id/export",
  authenticateToken,
  validateRequest(uuidParamSchema),
  requireDatasetOwner,
  async (req: AuthRequest, res) => {
    const id = req.dataset!.id;
    const dataset = req.dataset!;
    const format =
      typeof req.query.format === "string" ? req.query.format : "geojson";

    try {
      const features = (await prisma.$queryRaw`
        SELECT ST_AsGeoJSON(geometry)::json as geometry, properties, value, category
        FROM "Feature"
        WHERE "datasetId" = ${id}
      `) as ExportFeatureRow[];

      if (format === "csv") {
        const allKeys = new Set<string>();
        features.forEach((f) => {
          if (f.properties && typeof f.properties === "object") {
            Object.keys(f.properties).forEach((k) => allKeys.add(k));
          }
        });
        const headerKeys = ["lat", "lng", "value", "category", ...Array.from(allKeys)];

        const csvRows = [headerKeys.join(",")];
        for (const f of features) {
          const coords = f.geometry?.coordinates || [0, 0];
          const row = headerKeys.map((key) => {
            if (key === "lat") return coords[1] ?? "";
            if (key === "lng") return coords[0] ?? "";
            if (key === "value") return f.value ?? "";
            if (key === "category")
              return f.category ? `"${f.category.replace(/"/g, '""')}"` : "";
            const val = f.properties?.[key];
            if (val === undefined || val === null) return "";
            const valStr = typeof val === "object" ? JSON.stringify(val) : String(val);
            return `"${valStr.replace(/"/g, '""')}"`;
          });
          csvRows.push(row.join(","));
        }

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${dataset.name.replace(/[^a-zA-Z0-9]/g, "_")}.csv"`
        );
        return res.send(csvRows.join("\n"));
      }

      const geojson = {
        type: "FeatureCollection",
        features: features.map((f) => ({
          type: "Feature",
          geometry: f.geometry,
          properties: {
            value: f.value,
            category: f.category,
            ...(f.properties && typeof f.properties === "object" ? f.properties : {}),
          },
        })),
      };

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${dataset.name.replace(/[^a-zA-Z0-9]/g, "_")}.geojson"`
      );
      return res.json(geojson);
    } catch (error: unknown) {
      logger.error({ err: error, id }, "Dataset export error");
      res.status(500).json({ error: "Failed to export dataset" });
    }
  }
);

router.post(
  "/",
  authenticateToken,
  validateRequest(datasetCreateSchema),
  async (req: AuthRequest, res) => {
    try {
      const { name, color, data, type } = req.body as {
        name: string;
        color?: string;
        type?: string;
        data?: Array<{
          lat: number;
          lng: number;
          value?: number;
          category?: string;
          metadata?: object;
          geometry?: object;
        }>;
      };

      const dataset = await prisma.dataset.create({
        data: {
          name,
          color: color || "#06b6d4",
          type: type || "points",
          user: req.user?.id ? { connect: { id: req.user.id } } : undefined,
        },
      });

      if (Array.isArray(data) && data.length > 0) {
        await insertFeaturesInBatches(dataset.id, data);
      }

      res.status(201).json(dataset);
    } catch (error: unknown) {
      logger.error({ err: error }, "Dataset creation error");
      res.status(500).json({ error: "Failed to create dataset" });
    }
  }
);

router.delete(
  "/:id",
  authenticateToken,
  validateRequest(uuidParamSchema),
  requireDatasetOwner,
  async (req: AuthRequest, res) => {
    try {
      const id = req.dataset!.id;
      await prisma.dataset.delete({ where: { id } });
      await evictDatasetTiles(id);
      res.status(204).send();
    } catch {
      res.status(500).json({ error: "Failed to delete dataset" });
    }
  }
);

export default router;
