import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { Server } from "socket.io";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { authenticateToken } from "./middleware/auth.js";
import type { AuthRequest } from "./middleware/auth.js";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";
import * as h3 from "h3-js";
import * as turf from "@turf/turf";
import { pinoHttp } from "pino-http";
import { logger } from "./utils/logger.js";
import { errorHandler } from "./middleware/error.js";
import { redis, pubsub, getTileKey, getInvalidationChannel, TILE_CACHE_TTL, CACHE_PREFIX } from "./utils/redis.js";
import { startMaintenanceWorker } from "./utils/cleanup.js";
import { getOpenApiDocumentation } from "./swagger.js";
import swaggerUi from "swagger-ui-express";
import { 
  validateRequest, 
  registerSchema, 
  loginSchema, 
  datasetCreateSchema, 
  spatialToolSchema, 
  tileParamsSchema,
  workspaceCreateSchema,
  workspaceShareSchema,
  uuidParamSchema
} from "./utils/validation.js";

const require = createRequire(import.meta.url);
const { PrismaClient, Prisma } = require(`${process.cwd()}/prisma/generated/prisma`);

const app = express();
const httpServer = createServer(app);
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map(s => s.trim())
  : process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL]
    : ["http://localhost:5173"];

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

const port = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  logger.fatal("JWT_SECRET environment variable is required (min 16 characters)");
  process.exit(1);
}

// Initialize Prisma
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type TileIndexRecord = {
  tileIndex: ReturnType<typeof geojsonvt>;
  createdAt: number;
  lastAccessAt: number;
  datasetId: string;
};

const TILE_CACHE_TTL_MS = 5 * 60 * 1000;
const TILE_CACHE_MAX_ENTRIES = 128;
const TILE_ZOOM_MIN = 0;
const TILE_ZOOM_MAX = 22;

const tileIndexCache = new Map<string, TileIndexRecord>();
const tileBuildInFlight = new Map<string, Promise<ReturnType<typeof geojsonvt>>>();

// Setup Redis Subscription for Cache Invalidation
pubsub.subscribe(getInvalidationChannel(), (err: Error | null) => {
  if (err) logger.error({ err }, "Failed to subscribe to invalidation channel");
});

pubsub.on("message", (channel: string, message: string) => {
  if (channel === getInvalidationChannel()) {
    try {
      const { type, datasetId } = JSON.parse(message);
      if (type === "EVICT_DATASET") {
        for (const [key, record] of tileIndexCache.entries()) {
          if (record.datasetId === datasetId) {
            tileIndexCache.delete(key);
          }
        }
      }
    } catch (e) {
      logger.error({ err: e }, "Error processing invalidation message");
    }
  }
});

const toFiniteNumber = (value: unknown, fallback: number) => {
  const n = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const pruneTileCache = () => {
  const now = Date.now();
  for (const [key, record] of tileIndexCache.entries()) {
    if ((now - record.createdAt) > TILE_CACHE_TTL_MS) {
      tileIndexCache.delete(key);
    }
  }

  if (tileIndexCache.size <= TILE_CACHE_MAX_ENTRIES) return;

  const entriesByAccessAsc = Array.from(tileIndexCache.entries())
    .sort((a, b) => a[1].lastAccessAt - b[1].lastAccessAt);
  const overflow = tileIndexCache.size - TILE_CACHE_MAX_ENTRIES;

  for (let i = 0; i < overflow; i += 1) {
    const victim = entriesByAccessAsc[i];
    if (victim) tileIndexCache.delete(victim[0]);
  }
};

const evictDatasetTiles = async (datasetId: string) => {
  for (const [key, record] of tileIndexCache.entries()) {
    if (record.datasetId === datasetId) tileIndexCache.delete(key);
  }
  // Publish invalidation to other instances
  await redis.publish(getInvalidationChannel(), JSON.stringify({ type: "EVICT_DATASET", datasetId }));

  // Clear Redis keys for this dataset
  let cursor = "0";
  const pattern = `${CACHE_PREFIX}${datasetId}:*`;
  try {
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch (err) {
    logger.error({ err }, "Error clearing Redis keys during eviction");
  }
};

const firstParam = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

/** Require the authenticated user to own the dataset. Returns null if not found or forbidden. */
const findOwnedDataset = async <T extends object = { id: string; userId: string | null; type: string }>(
  id: string,
  userId: string | undefined,
  select?: T
) => {
  if (!userId) return null;
  const dataset = await prisma.dataset.findUnique({
    where: { id },
    select: select ?? { id: true, userId: true, type: true },
  });
  if (!dataset || (dataset as { userId?: string | null }).userId !== userId) {
    return null;
  }
  return dataset as T extends object ? T & { userId: string | null } : never;
};

/** Batch-insert features with bound parameters (no string-built SQL). */
const insertFeatureBatch = async (
  datasetId: string,
  items: Array<{
    geometry?: object;
    lat?: number;
    lng?: number;
    metadata?: object;
    properties?: object;
    value?: number | null;
    category?: string | null;
  }>
) => {
  if (items.length === 0) return;

  const rows = items.map((item) => {
    const id = crypto.randomUUID();
    const geometry = item.geometry || {
      type: "Point",
      coordinates: [item.lng, item.lat],
    };
    const props = item.metadata ?? item.properties ?? {};
    return Prisma.sql`(
      ${id},
      ${datasetId},
      ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326),
      ${JSON.stringify(props)}::jsonb,
      ${item.value ?? null},
      ${item.category ?? null}
    )`;
  });

  await prisma.$executeRaw`
    INSERT INTO "Feature" ("id", "datasetId", "geometry", "properties", "value", "category")
    VALUES ${Prisma.join(rows)}
  `;
};

// Logging Middleware
app.use(pinoHttp({ logger }));

// Security Middleware
app.use(helmet());
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json({ limit: "50mb" }));

// General Rate Limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." }
});

// Auth Rate Limiting (stricter)
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 login/register attempts per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later." }
});

// Tile Server Rate Limiting (generous for map browsing)
const tileLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // limit each IP to 1000 tile requests per minute
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);

app.get("/health", async (req, res) => {
  let dbStatus = "up";
  let redisStatus = "up";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    logger.error({ err }, "Health check: Database down");
    dbStatus = "down";
  }

  try {
    await redis.ping();
  } catch (err) {
    logger.error({ err }, "Health check: Redis down");
    redisStatus = "down";
  }

  const mem = process.memoryUsage();
  res.status(status === "ok" ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    },
    services: {
      database: dbStatus,
      redis: redisStatus,
    },
  });
});

// --- API DOCUMENTATION ---
const openApiDocument = getOpenApiDocumentation();
app.get("/openapi.json", (req, res) => {
  res.json(openApiDocument);
});
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

// --- AUTH ROUTES ---

// Register
app.post("/register", authLimiter, validateRequest(registerSchema), async (req, res) => {
  try {
    const { email, password, name } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name },
    });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "24h" });
    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(400).json({ error: "Email already exists" });
    }
    res.status(500).json({ error: "Failed to register user" });
  }
});

// Login
app.post("/login", authLimiter, validateRequest(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
});

// --- DATASET ROUTES (Protected) ---

app.get("/datasets", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const datasets = await prisma.dataset.findMany({
      where: { userId: req.user?.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, color: true, createdAt: true, updatedAt: true }
    });
    res.json(datasets);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch datasets" });
  }
});

app.get("/datasets/:id/stats", authenticateToken as any, validateRequest(uuidParamSchema), async (req: AuthRequest, res) => {
  const { id } = req.params as any;
  try {
    const dataset = await prisma.dataset.findUnique({
      where: { id },
    });

    if (!dataset || dataset.userId !== req.user?.id) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    const stats = await prisma.feature.aggregate({
      where: { datasetId: id },
      _min: { value: true },
      _max: { value: true },
      _count: true,
    });

    const categoryRows = await prisma.feature.findMany({
      where: { datasetId: id },
      distinct: ['category'],
      select: { category: true }
    });

    res.json({
      min: stats._min.value || 0,
      max: stats._max.value || 0,
      categories: categoryRows.map((r: any) => r.category).filter(Boolean),
      count: stats._count
    });
    } catch (error) {
    logger.error({ err: error, id }, "Stats error");
    res.status(500).json({ error: "Failed to fetch stats" });
    }
    });

    app.get("/datasets/:id", authenticateToken as any, validateRequest(uuidParamSchema), async (req: AuthRequest, res) => {
    try {
    const { id } = req.params as any;
    const dataset = await prisma.dataset.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        color: true,
        type: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    if (!dataset || dataset.userId !== req.user?.id) {
      return res.status(404).json({ error: "Dataset not found" });
    }
    res.json(dataset);
    } catch (error) {
    res.status(500).json({ error: "Failed to fetch dataset" });
    }
    });

    app.get("/datasets/:id/export", authenticateToken as any, validateRequest(uuidParamSchema), async (req: AuthRequest, res) => {
      const { id } = req.params as any;
      const { format = "geojson" } = req.query as any;

      try {
        const dataset = await prisma.dataset.findUnique({
          where: { id },
          select: { id: true, name: true, userId: true }
        });

        if (!dataset || dataset.userId !== req.user?.id) {
          return res.status(404).json({ error: "Dataset not found" });
        }

        const features: any[] = await prisma.$queryRaw`
          SELECT ST_AsGeoJSON(geometry)::json as geometry, properties, value, category
          FROM "Feature"
          WHERE "datasetId" = ${id}
        `;

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
              if (key === "category") return f.category ? `"${f.category.replace(/"/g, '""')}"` : "";
              const val = f.properties?.[key];
              if (val === undefined || val === null) return "";
              const valStr = typeof val === "object" ? JSON.stringify(val) : String(val);
              return `"${valStr.replace(/"/g, '""')}"`;
            });
            csvRows.push(row.join(","));
          }

          res.setHeader("Content-Type", "text/csv");
          res.setHeader("Content-Disposition", `attachment; filename="${dataset.name.replace(/[^a-zA-Z0-9]/g, "_")}.csv"`);
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
              ...(f.properties && typeof f.properties === "object" ? f.properties : {})
            }
          }))
        };

        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename="${dataset.name.replace(/[^a-zA-Z0-9]/g, "_")}.geojson"`);
        return res.json(geojson);
      } catch (error) {
        logger.error({ err: error, id }, "Dataset export error");
        res.status(500).json({ error: "Failed to export dataset" });
      }
    });



    // MVT Tile Route — requires JWT (header or ?token=) and dataset ownership
    app.get(
      "/datasets/:id/tiles/:z/:x/:y.pbf",
      tileLimiter,
      authenticateToken as any,
      validateRequest(tileParamsSchema),
      async (req: AuthRequest, res) => {
    try {
    const { id, z, x, y } = req.params as any;
    const { min, max, cats, search, mode } = req.query as any;
    const zNum = Number(z);
    const xNum = Number(x);
    const yNum = Number(y);

    const dataset = await findOwnedDataset(id, req.user?.id, { id: true, userId: true, type: true });
    if (!dataset) {
      return res.status(404).send("Dataset not found");
    }

    const isAreaMode = mode === 'area';

    const cacheKey = `${id}-${isAreaMode ? 'area' : 'points'}-f:${min}-${max}-${cats.join('.')}-${search}-${req.query.gridType}-${req.query.res}`;
    const redisKey = getTileKey(id, cacheKey, z, x, y);

    try {
      const cachedPbf = await redis.getBuffer(redisKey);
      if (cachedPbf) {
        res.setHeader("Content-Type", "application/x-protobuf");
        res.setHeader("Cache-Control", "private, max-age=60");
        res.setHeader("X-Cache", "HIT-REDIS");
        return res.send(cachedPbf);
      }
    } catch (err) {
      logger.warn({ err }, "Redis cache error");
    }

    // Optional filter fragments (bound parameters only)
    const filterFragments: ReturnType<typeof Prisma.sql>[] = [];
    if (Array.isArray(cats) && cats.length > 0) {
      filterFragments.push(Prisma.sql`AND "category" IN (${Prisma.join(cats)})`);
    }
    if (search) {
      filterFragments.push(Prisma.sql`AND "properties"::text ILIKE ${`%${search}%`}`);
    }
    const extraFilters = filterFragments.length > 0
      ? Prisma.join(filterFragments, " ")
      : Prisma.empty;

    let result: any[];

    if (isAreaMode) {
      const gridType = req.query.gridType || 'hex';
      const resolution = Number(req.query.res) || (0.1 / Math.pow(2, zNum - 2));
      // Only allow fixed PostGIS grid functions (never interpolate user strings)
      const gridFn = gridType === 'hex'
        ? Prisma.raw("ST_HexagonGrid")
        : Prisma.raw("ST_SquareGrid");

      result = await prisma.$queryRaw`
        WITH grid AS (
          SELECT
            ${gridFn}(${resolution}, geometry) as geom,
            "value", "properties"
          FROM "Feature"
          WHERE "datasetId" = ${id}
            AND geometry && ST_TileEnvelope(${zNum}, ${xNum}, ${yNum})
            AND ("value" IS NULL OR ("value" >= ${min} AND "value" <= ${max}))
            ${extraFilters}
        ),
        mvt_geom AS (
          SELECT
            ST_AsMVTGeom(geom, ST_TileEnvelope(${zNum}, ${xNum}, ${yNum}), 4096, 64, true) AS geom,
            jsonb_build_object('value', SUM("value"), 'count', COUNT(*)) as props
          FROM grid
          GROUP BY geom
        )
        SELECT ST_AsMVT(mvt_geom.*, 'geoflux-layer') AS mvt FROM mvt_geom
      `;
    } else {
      result = await prisma.$queryRaw`
        WITH mvt_geom AS (
          SELECT
            ST_AsMVTGeom(geometry, ST_TileEnvelope(${zNum}, ${xNum}, ${yNum}), 4096, 64, true) AS geom,
            CASE
              WHEN properties = '{}'::jsonb THEN jsonb_build_object('value', "value", 'category', "category")
              ELSE jsonb_build_object('value', "value", 'category', "category") || properties
            END as props
          FROM "Feature"
          WHERE "datasetId" = ${id}
            AND geometry && ST_TileEnvelope(${zNum}, ${xNum}, ${yNum})
            AND ("value" IS NULL OR ("value" >= ${min} AND "value" <= ${max}))
            ${extraFilters}
        )
        SELECT ST_AsMVT(mvt_geom.*, 'geoflux-layer') AS mvt FROM mvt_geom
      `;
    }

    const buffer = result[0]?.mvt;

    if (!buffer || buffer.length === 0) {
      return res.status(204).send();
    }

    // Cache to Redis
    redis.setex(redisKey, TILE_CACHE_TTL, buffer).catch((err: Error) => logger.error({ err }, "Failed to cache tile to Redis"));

    res.setHeader("Content-Type", "application/x-protobuf");
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(buffer);
    } catch (error) {
    logger.error({ err: error }, "Tile generation error");
    res.status(500).send("Error generating tile");
    }
    });



app.post("/datasets", authenticateToken as any, validateRequest(datasetCreateSchema), async (req: AuthRequest, res) => {
  try {
    const { name, color, data, type } = req.body;
    
    // Create the dataset record first
    const dataset = await prisma.dataset.create({
      data: {
        name,
        color: color || "#06b6d4",
        type: type || "points",
        user: req.user?.id ? { connect: { id: req.user.id } } : undefined,
      },
    });

    // Ingest features into the Feature table (parameterized batches)
    if (Array.isArray(data) && data.length > 0) {
      const BATCH_SIZE = 1000;
      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        await insertFeatureBatch(dataset.id, data.slice(i, i + BATCH_SIZE));
      }
    }

    res.status(201).json(dataset);
  } catch (error) {
    logger.error({ err: error }, "Dataset creation error");
    res.status(500).json({ error: "Failed to create dataset" });
  }
});


// --- SPATIAL TOOL ROUTE (Protected) ---
app.post("/datasets/:id/spatial-tool", authenticateToken as any, validateRequest(spatialToolSchema), async (req: AuthRequest, res) => {
  try {
    const { id: sourceDatasetId } = req.params as any;
    const { 
      type, 
      targetGridType, 
      gridResolution, 
      aggregationField, 
      bufferRadius, 
      clusterRadius, 
      hullMaxEdge,
      persist, 
      customName 
    } = req.body;

    const sourceDataset = await prisma.dataset.findUnique({ where: { id: sourceDatasetId } });
    if (!sourceDataset || sourceDataset.userId !== req.user?.id) {
      return res.status(404).json({ error: "Source dataset not found or access denied" });
    }

    // Fetch features from DB (parameterized)
    const featuresFromDb = await prisma.$queryRaw`
      SELECT ST_AsGeoJSON(geometry)::json as geometry, properties, value, category
      FROM "Feature"
      WHERE "datasetId" = ${sourceDatasetId}
    `;

    const sourceData = (featuresFromDb as any[]).map(f => ({
      ...f.properties,
      geometry: f.geometry,
      value: f.value,
      category: f.category,
      lat: f.geometry.type === 'Point' ? f.geometry.coordinates[1] : undefined,
      lng: f.geometry.type === 'Point' ? f.geometry.coordinates[0] : undefined,
      metadata: f.properties
    }));

    if (sourceData.length === 0) {
      return res.status(200).json({ features: [] });
    }

    let resultGeoJson: GeoJSON.FeatureCollection;

    const pointFeatures = sourceData
      .filter((d: any) => typeof d.lat === "number" && typeof d.lng === "number")
      .map((d: any) => turf.truncate(turf.cleanCoords(turf.point([d.lng, d.lat], { ...d.metadata, value: d.value }))));

    if (pointFeatures.length === 0) {
      return res.status(400).json({ error: "No valid point geometries found in source dataset" });
    }

    const pointFC = turf.featureCollection(pointFeatures) as any;

    if (type === 'aggregation') {
      // High-performance PostGIS Aggregation (parameterized; grid fn is a fixed identifier)
      const resolution = parseFloat(gridResolution as string);
      const isHex = targetGridType === 'hex';
      const gridFn = isHex ? Prisma.raw("ST_HexagonGrid") : Prisma.raw("ST_SquareGrid");
      // resolution for ST_HexagonGrid is in degrees if the CRS is 4326.
      // gridResolution 4 -> approx 0.1 degrees
      const spatialRes = isHex ? (0.5 / Math.pow(2, resolution - 2)) : (1 / Math.pow(2, resolution - 2));
      const aggField = aggregationField || "";

      const gridResults = await prisma.$queryRaw`
        WITH grid AS (
          SELECT ${gridFn}(${spatialRes}, geometry) as geom, "value", "properties"
          FROM "Feature"
          WHERE "datasetId" = ${sourceDatasetId}
        )
        SELECT
          ST_AsGeoJSON(geom)::json as geometry,
          SUM(COALESCE(("properties"->>${aggField})::numeric, "value", 0)) as value,
          COUNT(*) as count
        FROM grid
        GROUP BY geom
      `;

      resultGeoJson = {
        type: "FeatureCollection",
        features: (gridResults as any[]).map(cell => ({
          type: "Feature",
          geometry: cell.geometry,
          properties: { 
            value: Number(cell.value), 
            count: Number(cell.count), 
            avg: Number(cell.count) > 0 ? Number(cell.value) / Number(cell.count) : 0 
          }
        }))
      };
    } else if (type === 'buffer') {
      const buffered = pointFeatures.map(p => {
        try {
          return turf.buffer(p, Math.max(0.001, bufferRadius || 5), { units: 'kilometers' });
        } catch (e) {
          logger.warn({ err: e, p }, "Buffer failed for point");
          return null;
        }
      }).filter(Boolean);
      
      if (buffered.length === 0) return res.status(422).json({ error: "Buffer operation failed for all points" });
      resultGeoJson = turf.featureCollection(buffered as any);
    } else if (type === 'clustering') {
      if (pointFeatures.length < 1) return res.status(422).json({ error: "At least 1 point required for clustering" });
      const clustered = turf.clustersDbscan(pointFC, Math.max(0.001, clusterRadius || 10), { units: 'kilometers', minPoints: 1 });
      resultGeoJson = clustered;
    } else if (type === "convex_hull") {
      if (pointFeatures.length < 3) return res.status(422).json({ error: "At least 3 points required for convex hull" });
      const hull = turf.convex(pointFC);
      if (!hull) return res.status(422).json({ error: "Convex hull could not be generated (points might be collinear)" });
      resultGeoJson = turf.featureCollection([hull]);
    } else if (type === "concave_hull") {
      if (pointFeatures.length < 3) return res.status(422).json({ error: "At least 3 points required for concave hull" });
      const maxEdge = Number.isFinite(Number(hullMaxEdge)) ? Math.max(0.001, Number(hullMaxEdge)) : 10;
      const hull = turf.concave(pointFC, { maxEdge, units: "kilometers" });
      if (!hull) return res.status(422).json({ error: "Concave hull could not be generated (try increasing max edge or check for sparse data)" });
      resultGeoJson = turf.featureCollection([hull]);
    } else if (type === "voronoi") {
      if (pointFeatures.length < 2) return res.status(422).json({ error: "At least 2 points required for Voronoi tessellation" });
      const bbox = turf.bbox(pointFC);
      const paddingX = Math.max((bbox[2] - bbox[0]) * 0.1, 0.1);
      const paddingY = Math.max((bbox[3] - bbox[1]) * 0.1, 0.1);
      const paddedBBox: [number, number, number, number] = [bbox[0] - paddingX, bbox[1] - paddingY, bbox[2] + paddingX, bbox[3] + paddingY];
      try {
        const voronoi = turf.voronoi(pointFC, { bbox: paddedBBox });
        if (!voronoi) throw new Error("Turf voronoi returned null");
        resultGeoJson = voronoi as GeoJSON.FeatureCollection;
      } catch (e) {
        logger.error({ err: e }, "Voronoi failed");
        return res.status(422).json({ error: "Voronoi tessellation failed (ensure points are not all identical)" });
      }
    } else {
      return res.status(400).json({ error: "Invalid tool type" });
    }

    const isAreaResult = ["aggregation", "convex_hull", "concave_hull", "voronoi", "buffer"].includes(type);

    if (persist) {
      const name = customName || `${type.toUpperCase()}: ${sourceDataset.name}`;
      const newDataset = await prisma.dataset.create({
        data: {
          name,
          color: "#f97316",
          type: isAreaResult ? "grid" : "points",
          userId: req.user?.id,
        }
      });

      // Persist features (parameterized batches)
      const features = resultGeoJson.features;
      const BATCH_SIZE = 1000;
      for (let i = 0; i < features.length; i += BATCH_SIZE) {
        const batch = features.slice(i, i + BATCH_SIZE).map((f: any) => ({
          geometry: f.geometry,
          properties: f.properties || {},
          value: f.properties?.value ?? null,
          category: f.properties?.category ?? null,
        }));
        await insertFeatureBatch(newDataset.id, batch);
      }

      return res.status(201).json(newDataset);
    }

    res.json(resultGeoJson);

  } catch (error) {
    logger.error({ err: error }, "Spatial tool error");
    res.status(500).json({ error: "Failed to perform spatial operation" });
  }
});

app.post("/datasets/:id/spatial-aggregate", authenticateToken as any, async (req: AuthRequest, res) => {
  // Legacy support - redirect to spatial-tool
  req.body.type = 'aggregation';
  const sourceDatasetId = firstParam(req.params.id);
  res.redirect(307, `/datasets/${sourceDatasetId}/spatial-tool`);
});

app.delete("/datasets/:id", authenticateToken as any, validateRequest(uuidParamSchema), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params as any;
    const dataset = await prisma.dataset.findUnique({ where: { id } });
    
    if (!dataset || dataset.userId !== req.user?.id) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    await prisma.dataset.delete({ where: { id } });
    await evictDatasetTiles(id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete dataset" });
  }
});

// --- WORKSPACE ROUTES (Protected) ---

app.get("/workspaces", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const workspaces = await prisma.workspace.findMany({
      where: { userId: req.user?.id },
      orderBy: { updatedAt: "desc" },
    });
    res.json(workspaces);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch workspaces" });
  }
});

app.post("/workspaces", authenticateToken as any, validateRequest(workspaceCreateSchema), async (req: AuthRequest, res) => {
  try {
    const { name, config } = req.body;
    const workspace = await prisma.workspace.create({
      data: { name, config, userId: req.user!.id },
    });
    res.status(201).json(workspace);
  } catch (error) {
    res.status(500).json({ error: "Failed to create workspace" });
  }
});

app.get("/workspaces/:id", validateRequest(uuidParamSchema), async (req, res) => {
  try {
    const { id } = req.params as any;
    const workspace = await prisma.workspace.findUnique({
      where: { id },
    });

    if (!workspace) return res.status(404).json({ error: "Workspace not found" });

    if (!workspace.isPublic) {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(403).json({ error: "Access denied" });
      
      const token = authHeader.split(" ")[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        if (workspace.userId !== decoded.id) {
          return res.status(403).json({ error: "Access denied" });
        }
      } catch (err) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    res.json(workspace);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch workspace" });
  }
});

app.patch("/workspaces/:id/share", authenticateToken as any, validateRequest(workspaceShareSchema), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params as any;
    const { isPublic } = req.body;
    
    const workspace = await prisma.workspace.findUnique({ where: { id } });
    if (!workspace || workspace.userId !== req.user?.id) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    const updated = await prisma.workspace.update({
      where: { id },
      data: { isPublic: !!isPublic }
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Failed to update sharing" });
  }
});

// --- REAL-TIME SIMULATION ---

let simulationInterval: NodeJS.Timeout | null = null;

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Client connected");

  socket.on("start-live", () => {
    if (!simulationInterval) {
      logger.info("Starting live simulation");
      simulationInterval = setInterval(() => {
        const point = {
          id: Math.random().toString(36).substr(2, 9),
          lat: (Math.random() * 180) - 90,
          lng: (Math.random() * 360) - 180,
          value: Math.floor(Math.random() * 100),
          category: ["Security", "Network", "Auth", "DB"][Math.floor(Math.random() * 4)],
          timestamp: Date.now()
        };
        io.emit("live-data", point);
      }, 1000);
    }
  });

  socket.on("stop-live", () => {
    logger.info("Stopping live simulation");
    if (simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
  });

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Client disconnected");
    if (io.engine.clientsCount === 0 && simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
  });
});

app.use(errorHandler);

if (process.env.NODE_ENV !== "test") {
  httpServer.listen(port, () => {
    logger.info(`Backend running at http://localhost:${port}`);
    startMaintenanceWorker();
  });
}

export { app, prisma, redis };

