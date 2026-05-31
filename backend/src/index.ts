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
const { PrismaClient } = require(`${process.cwd()}/prisma/generated/prisma`);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const port = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

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
pubsub.subscribe(getInvalidationChannel(), (err) => {
  if (err) logger.error({ err }, "Failed to subscribe to invalidation channel");
});

pubsub.on("message", (channel, message) => {
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

// Logging Middleware
app.use(pinoHttp({ logger }));

// Security Middleware
app.use(helmet());
app.use(cors());
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

  const status = dbStatus === "up" && redisStatus === "up" ? "ok" : "error";
  res.status(status === "ok" ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
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

    // MVT Tile Route
    app.get("/datasets/:id/tiles/:z/:x/:y.pbf", tileLimiter, validateRequest(tileParamsSchema), async (req, res) => {
    try {
    const { id, z, x, y } = req.params as any;
    const { min, max, cats, search, mode } = req.query as any;

    const isAreaMode = mode === 'area';

    const cacheKey = `${id}-${isAreaMode ? 'area' : 'points'}-f:${min}-${max}-${cats.join('.')}-${search}`;
    const redisKey = getTileKey(id, cacheKey, z, x, y);

    try {
      const cachedPbf = await redis.getBuffer(redisKey);
      if (cachedPbf) {
        res.setHeader("Content-Type", "application/x-protobuf");
        res.setHeader("Cache-Control", "public, max-age=60");
        res.setHeader("X-Cache", "HIT-REDIS");
        return res.send(cachedPbf);
      }
    } catch (err) {
      logger.warn({ err }, "Redis cache error");
    }

    const dataset = await prisma.dataset.findUnique({ where: { id }, select: { type: true } });
    if (!dataset) return res.status(404).send("Dataset not found");

    // Build the SQL query for MVT
    // Note: ST_TileEnvelope(z, x, y) generates the bounding box for the tile
    let query = `
      WITH mvt_geom AS (
        SELECT
          ST_AsMVTGeom(geometry, ST_TileEnvelope($1, $2, $3), 4096, 64, true) AS geom,
          properties || jsonb_build_object('value', "value", 'category', "category") as props
        FROM "Feature"
        WHERE "datasetId" = $4
          AND geometry && ST_TileEnvelope($1, $2, $3)
          AND ("value" IS NULL OR ("value" >= $5 AND "value" <= $6))
    `;

    const params: any[] = [z, x, y, id, min, max];
    let paramIdx = 7;

    if (cats.length > 0) {
      query += ` AND "category" = ANY($${paramIdx++})`;
      params.push(cats);
    }

    if (search) {
      query += ` AND "properties"::text ILIKE $${paramIdx++}`;
      params.push(`%${search}%`);
    }

    query += `
      )
      SELECT ST_AsMVT(mvt_geom.*, 'geoflux-layer') AS mvt FROM mvt_geom;
    `;

    const result = await prisma.$queryRawUnsafe(query, ...params);
    const buffer = (result as any)[0]?.mvt;

    if (!buffer || buffer.length === 0) {
      return res.status(204).send();
    }

    // Cache to Redis
    redis.setex(redisKey, TILE_CACHE_TTL, buffer).catch((err) => logger.error({ err }, "Failed to cache tile to Redis"));

    res.setHeader("Content-Type", "application/x-protobuf");
    res.setHeader("Cache-Control", "public, max-age=60");
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

    // Ingest features into the Feature table
    if (Array.isArray(data) && data.length > 0) {
      // Process in batches for performance
      const BATCH_SIZE = 500;
      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const batch = data.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (item: any) => {
          const id = crypto.randomUUID();
          const geometry = item.geometry || {
            type: "Point",
            coordinates: [item.lng, item.lat]
          };
          
          // Use executeRaw for geometry insertion
          await prisma.$executeRawUnsafe(
            `INSERT INTO "Feature" ("id", "datasetId", "geometry", "properties", "value", "category") 
             VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4, $5, $6)`,
            id,
            dataset.id,
            JSON.stringify(geometry),
            JSON.stringify(item.metadata || {}),
            item.value || null,
            item.category || null
          );
        }));
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

    // Fetch features from DB
    const featuresFromDb = await prisma.$queryRawUnsafe(`
      SELECT ST_AsGeoJSON(geometry)::json as geometry, properties, value, category 
      FROM "Feature" 
      WHERE "datasetId" = $1
    `, sourceDatasetId);

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
      .map((d: any) => turf.point([d.lng, d.lat], { ...d.metadata, value: d.value }));

    if (type === 'aggregation') {
      const grid = new Map<string, { value: number; count: number; lat: number; lng: number; coords: [number, number][] }>();

      if (targetGridType === 'hex') {
        const h3Resolution = Math.min(10, Math.max(3, Math.round(gridResolution) + 2)); 

        sourceData.forEach((d: any) => {
          if (typeof d.lat !== 'number' || typeof d.lng !== 'number') return;
          const h3Index = h3.latLngToCell(d.lat, d.lng, h3Resolution);
          const existing = grid.get(h3Index) || { value: 0, count: 0, h3Index, lat: 0, lng: 0, coords: [] };
          
          if (existing.count === 0) {
            const [lat, lng] = h3.cellToLatLng(h3Index);
            existing.lat = lat;
            existing.lng = lng;
            existing.coords = h3.cellToBoundary(h3Index, true);
          }
          
          const pointValue = typeof aggregationField === 'string' && d.metadata && typeof d.metadata[aggregationField] === 'number'
                             ? d.metadata[aggregationField]
                             : (d.value || 0);
          existing.value += pointValue;
          existing.count += 1;
          grid.set(h3Index, existing);
        });
      } else {
        const resolution = parseFloat(gridResolution as string);
        sourceData.forEach((d: any) => {
          if (typeof d.lat !== 'number' || typeof d.lng !== 'number') return;
          const latBin = Math.floor(d.lat / resolution) * resolution;
          const lngBin = Math.floor(d.lng / resolution) * resolution;
          const key = `${latBin},${lngBin}`;
          
          const existing = grid.get(key) || { value: 0, count: 0, lat: latBin, lng: lngBin, coords: [] };
          if (existing.count === 0) {
            existing.coords = [
              [lngBin, latBin],
              [lngBin + resolution, latBin],
              [lngBin + resolution, latBin + resolution],
              [lngBin, latBin + resolution],
              [lngBin, latBin]
            ];
          }
          
          const pointValue = typeof aggregationField === 'string' && d.metadata && typeof d.metadata[aggregationField] === 'number'
                             ? d.metadata[aggregationField]
                             : (d.value || 0);
          existing.value += pointValue;
          existing.count += 1;
          grid.set(key, existing);
        });
      }

      resultGeoJson = {
        type: "FeatureCollection",
        features: Array.from(grid.values()).map(cell => ({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [cell.coords] },
          properties: { 
            value: cell.value, 
            count: cell.count, 
            avg: cell.value / cell.count 
          }
        })) as any
      };
    } else if (type === 'buffer') {
      const points = pointFeatures;
      const buffered = points.map(p => turf.buffer(p, bufferRadius || 5, { units: 'kilometers' }));
      resultGeoJson = turf.featureCollection(buffered as any);
    } else if (type === 'clustering') {
      const points = turf.featureCollection(pointFeatures);
      const clustered = turf.clustersDbscan(points, clusterRadius || 10, { units: 'kilometers', minPoints: 1 });
      resultGeoJson = clustered;
    } else if (type === "convex_hull") {
      const points = turf.featureCollection(pointFeatures);
      const hull = turf.convex(points);
      if (!hull) return res.status(422).json({ error: "Convex hull could not be generated (need at least 3 non-collinear points)" });
      resultGeoJson = turf.featureCollection([hull]);
    } else if (type === "concave_hull") {
      const points = turf.featureCollection(pointFeatures);
      const maxEdge = Number.isFinite(Number(hullMaxEdge)) ? Number(hullMaxEdge) : 10;
      const hull = turf.concave(points, { maxEdge, units: "kilometers" });
      if (!hull) return res.status(422).json({ error: "Concave hull could not be generated (try increasing max edge)" });
      resultGeoJson = turf.featureCollection([hull]);
    } else if (type === "voronoi") {
      const points = turf.featureCollection(pointFeatures);
      const bbox = turf.bbox(points);
      const paddingX = Math.max((bbox[2] - bbox[0]) * 0.1, 0.1);
      const paddingY = Math.max((bbox[3] - bbox[1]) * 0.1, 0.1);
      const paddedBBox: [number, number, number, number] = [bbox[0] - paddingX, bbox[1] - paddingY, bbox[2] + paddingX, bbox[3] + paddingY];
      const voronoi = turf.voronoi(points, { bbox: paddedBBox });
      if (!voronoi) return res.status(422).json({ error: "Voronoi tessellation failed" });
      resultGeoJson = voronoi as GeoJSON.FeatureCollection;
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

      // Persist features
      const features = resultGeoJson.features;
      const BATCH_SIZE = 500;
      for (let i = 0; i < features.length; i += BATCH_SIZE) {
        const batch = features.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (f: any) => {
          const id = crypto.randomUUID();
          await prisma.$executeRawUnsafe(
            `INSERT INTO "Feature" ("id", "datasetId", "geometry", "properties", "value", "category") 
             VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4, $5, $6)`,
            id,
            newDataset.id,
            JSON.stringify(f.geometry),
            JSON.stringify(f.properties || {}),
            f.properties?.value || null,
            f.properties?.category || null
          );
        }));
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
  });
}

export { app, prisma, redis };

