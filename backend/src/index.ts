import "dotenv/config";
import express from "express";
import cors from "cors";
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

const evictDatasetTiles = (datasetId: string) => {
  for (const [key, record] of tileIndexCache.entries()) {
    if (record.datasetId === datasetId) tileIndexCache.delete(key);
  }
};

const firstParam = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// --- AUTH ROUTES ---

// Register
app.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

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
app.post("/login", async (req, res) => {
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

app.get("/datasets/:id/stats", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const id = firstParam(req.params.id);
    const dataset = await prisma.dataset.findUnique({
      where: { id },
    });
    
    if (!dataset || dataset.userId !== req.user?.id) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    const data = dataset.data as any[];
    if (!data || data.length === 0) {
      return res.json({ min: 0, max: 0, categories: [], count: 0 });
    }

    let min = Infinity;
    let max = -Infinity;
    const categories = new Set<string>();

    data.forEach(d => {
      const v = d.value || 0;
      if (v < min) min = v;
      if (v > max) max = v;
      if (d.category) categories.add(d.category);
    });

    res.json({
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
      categories: Array.from(categories),
      count: data.length
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

app.get("/datasets/:id", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const id = firstParam(req.params.id);
    const dataset = await prisma.dataset.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        color: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
        data: true,
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
app.get("/datasets/:id/tiles/:z/:x/:y.pbf", async (req, res) => {
  try {
    pruneTileCache();

    const id = firstParam(req.params.id);
    const z = Number.parseInt(firstParam(req.params.z), 10);
    const x = Number.parseInt(firstParam(req.params.x), 10);
    const y = Number.parseInt(firstParam(req.params.y), 10);

    if (![z, x, y].every(Number.isInteger)) {
      return res.status(400).json({ error: "Invalid tile coordinates" });
    }

    if (z < TILE_ZOOM_MIN || z > TILE_ZOOM_MAX || x < 0 || y < 0 || x >= (2 ** z) || y >= (2 ** z)) {
      return res.status(400).json({ error: "Tile coordinates out of range" });
    }

    const isAreaMode = req.query.mode === 'area';
    const gridType = req.query.gridType === "hex" ? "hex" : "square";
    const gridRes = clamp(toFiniteNumber(req.query.res, 0.05), 0.001, 5);
    const min = toFiniteNumber(req.query.min, 0);
    const maxRaw = toFiniteNumber(req.query.max, Number.POSITIVE_INFINITY);
    const max = maxRaw >= min ? maxRaw : min;
    const cats = (req.query.cats as string || '').split(',').filter(Boolean);
    const search = (req.query.search as string || '').toLowerCase();

    const cacheKey = `${id}-${isAreaMode ? `grid-${gridType}-${gridRes}` : 'points'}-f:${min}-${max}-${cats.join('.')}-${search}`;
    const cached = tileIndexCache.get(cacheKey);
    let tileIndex = cached ? cached.tileIndex : undefined;

    if (!tileIndex) {
      let buildPromise = tileBuildInFlight.get(cacheKey);
      if (!buildPromise) {
        buildPromise = (async () => {
          const dataset = await prisma.dataset.findUnique({ where: { id } });
          if (!dataset) throw Object.assign(new Error("Dataset not found"), { statusCode: 404 });

          let data = dataset.data as any[];

          // Apply filters server-side
          data = data.filter(d => {
            const val = d.value || 0;
            const matchesValue = val >= min && val <= max;
            const matchesCategory = cats.length === 0 || (d.category && cats.includes(d.category));
            const matchesSearch = !search ||
              JSON.stringify(d.metadata || {}).toLowerCase().includes(search);
            return matchesValue && matchesCategory && matchesSearch;
          });

          let geojson: GeoJSON.FeatureCollection;

          if (dataset.type === 'grid') {
            geojson = {
              type: "FeatureCollection",
              features: data.map((f: any) => ({
                type: "Feature",
                geometry: f.geometry,
                properties: f.properties
              }))
            };
          } else if (isAreaMode) {
            const grid = new Map<string, { value: number; count: number; lat: number; lng: number; coords: [number, number][] }>();

            if (gridType === 'hex') {
              const h3Resolution = Math.min(10, Math.max(3, Math.round(gridRes) + 2));

              data.forEach((d: any) => {
                const h3Index = h3.latLngToCell(d.lat, d.lng, h3Resolution);
                const existing = grid.get(h3Index) || { value: 0, count: 0, h3Index, lat: 0, lng: 0, coords: [] as [number, number][] };

                if (existing.count === 0) {
                  const [lat, lng] = h3.cellToLatLng(h3Index);
                  existing.lat = lat;
                  existing.lng = lng;
                  existing.coords = h3.cellToBoundary(h3Index, true);
                }

                existing.value += (d.value || 0);
                existing.count += 1;
                grid.set(h3Index, existing);
              });

              geojson = {
                type: "FeatureCollection",
                features: Array.from(grid.values()).map(cell => ({
                  type: "Feature",
                  geometry: { type: "Polygon", coordinates: [cell.coords] },
                  properties: { value: cell.value, count: cell.count, avg: cell.value / cell.count }
                }))
              };
            } else {
              const resolution = gridRes;
              data.forEach((d: any) => {
                const latBin = Math.floor(d.lat / resolution) * resolution;
                const lngBin = Math.floor(d.lng / resolution) * resolution;
                const key = `${latBin},${lngBin}`;

                const existing = grid.get(key) || { value: 0, count: 0, lat: latBin, lng: lngBin, coords: [] as [number, number][] };
                existing.value += (d.value || 0);
                existing.count += 1;
                grid.set(key, existing);
              });

              geojson = {
                type: "FeatureCollection",
                features: Array.from(grid.values()).map(cell => ({
                  type: "Feature",
                  geometry: {
                    type: "Polygon",
                    coordinates: [[
                      [cell.lng, cell.lat],
                      [cell.lng + resolution, cell.lat],
                      [cell.lng + resolution, cell.lat + resolution],
                      [cell.lng, cell.lat + resolution],
                      [cell.lng, cell.lat]
                    ]]
                  },
                  properties: {
                    value: cell.value,
                    count: cell.count,
                    avg: cell.value / cell.count
                  }
                }))
              };
            }
          } else {
            geojson = {
              type: "FeatureCollection",
              features: data.map((d: any) => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [d.lng, d.lat] },
                properties: {
                  value: d.value,
                  category: d.category,
                  timestamp: typeof d.timestamp === 'number' ? d.timestamp : new Date(d.timestamp || 0).getTime(),
                  ...d.metadata
                }
              }))
            };
          }

          return geojsonvt(geojson, {
            maxZoom: 14,
            tolerance: 3,
            extent: 4096,
            buffer: 64,
            debug: 0,
            indexMaxZoom: 4,
            indexMaxPoints: 100000
          });
        })();
        tileBuildInFlight.set(cacheKey, buildPromise);
      }

      try {
        tileIndex = await buildPromise;
      } finally {
        tileBuildInFlight.delete(cacheKey);
      }

      tileIndexCache.set(cacheKey, {
        tileIndex,
        datasetId: id,
        createdAt: Date.now(),
        lastAccessAt: Date.now()
      });
    } else if (cached) {
      cached.lastAccessAt = Date.now();
    }

    const tile = tileIndex.getTile(z, x, y);
    if (!tile) {
      return res.status(204).send();
    }

    const buff = vtpbf.fromGeojsonVt({ "geoflux-layer": tile });
    res.setHeader("Content-Type", "application/x-protobuf");
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.send(Buffer.from(buff));
  } catch (error: any) {
    if (error?.statusCode === 404) return res.status(404).send("Dataset not found");
    console.error("Tile generation error:", error);
    res.status(500).send("Error generating tile");
  }
});


app.post("/datasets", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const { name, color, data, type } = req.body;
    const dataset = await prisma.dataset.create({
      data: {
        name,
        color: color || "#06b6d4",
        type: type || "points",
        data: data as any,
        userId: req.user?.id,
      },
    });
    res.status(201).json(dataset);
  } catch (error) {
    res.status(500).json({ error: "Failed to create dataset" });
  }
});


// --- SPATIAL TOOL ROUTE (Protected) ---
app.post("/datasets/:id/spatial-tool", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const sourceDatasetId = firstParam(req.params.id);
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

    if (!sourceDatasetId || !type) {
      return res.status(400).json({ error: "Missing required parameters: sourceDatasetId, type" });
    }

    const sourceDataset = await prisma.dataset.findUnique({ where: { id: sourceDatasetId } });
    if (!sourceDataset || sourceDataset.userId !== req.user?.id) {
      return res.status(404).json({ error: "Source dataset not found or access denied" });
    }

    const sourceData = sourceDataset.data as any[];
    if (!sourceData || sourceData.length === 0) {
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
          data: resultGeoJson.features as any,
          userId: req.user?.id,
        }
      });
      return res.status(201).json(newDataset);
    }

    res.json(resultGeoJson);

  } catch (error) {
    console.error("Spatial tool error:", error);
    res.status(500).json({ error: "Failed to perform spatial operation" });
  }
});

app.post("/datasets/:id/spatial-aggregate", authenticateToken as any, async (req: AuthRequest, res) => {
  // Legacy support - redirect to spatial-tool
  req.body.type = 'aggregation';
  const sourceDatasetId = firstParam(req.params.id);
  res.redirect(307, `/datasets/${sourceDatasetId}/spatial-tool`);
});

app.delete("/datasets/:id", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const id = firstParam(req.params.id);
    const dataset = await prisma.dataset.findUnique({ where: { id } });
    
    if (!dataset || dataset.userId !== req.user?.id) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    await prisma.dataset.delete({ where: { id } });
    evictDatasetTiles(id);
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

app.post("/workspaces", authenticateToken as any, async (req: AuthRequest, res) => {
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

app.get("/workspaces/:id", async (req, res) => {
  try {
    const id = firstParam(req.params.id);
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

app.patch("/workspaces/:id/share", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const id = firstParam(req.params.id);
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
  console.log("Client connected:", socket.id);

  socket.on("start-live", () => {
    if (!simulationInterval) {
      console.log("Starting live simulation");
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
    console.log("Stopping live simulation");
    if (simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
    if (io.engine.clientsCount === 0 && simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
  });
});

httpServer.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
