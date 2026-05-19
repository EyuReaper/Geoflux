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

// Tile Cache
const tileIndexCache = new Map<string, any>();

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
    const id = firstParam(req.params.id);
    const z = firstParam(req.params.z);
    const x = firstParam(req.params.x);
    const y = firstParam(req.params.y);
    const isAreaMode = req.query.mode === 'area';
    const gridType = req.query.gridType || 'square';
    const gridRes = parseFloat(req.query.res as string) || 0.05;
    const zInt = parseInt(z);
    const xInt = parseInt(x);
    const yInt = parseInt(y);

    const cacheKey = `${id}-${isAreaMode ? `grid-${gridType}-${gridRes}` : 'points'}`;
    let tileIndex = tileIndexCache.get(cacheKey);

    if (!tileIndex) {
      const dataset = await prisma.dataset.findUnique({ where: { id } });
      if (!dataset) return res.status(404).send("Dataset not found");

      const data = dataset.data as any[];
      let geojson: GeoJSON.FeatureCollection;

      if (dataset.type === 'grid') {
        // Dataset is already a grid, data contains GeoJSON features
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

      tileIndex = geojsonvt(geojson, {
        maxZoom: 14,
        tolerance: 3,
        extent: 4096,
        buffer: 64,
        debug: 0,
        indexMaxZoom: 4,
        indexMaxPoints: 100000
      });
      tileIndexCache.set(cacheKey, tileIndex);
    }

    const tile = tileIndex.getTile(zInt, xInt, yInt);
    if (!tile) {
      return res.status(204).send();
    }

    const buff = vtpbf.fromGeojsonVt({ "geoflux-layer": tile });
    res.setHeader("Content-Type", "application/x-protobuf");
    res.send(Buffer.from(buff));
  } catch (error) {
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
      const points = sourceData.map(d => turf.point([d.lng, d.lat], { ...d.metadata, value: d.value }));
      const buffered = points.map(p => turf.buffer(p, bufferRadius || 5, { units: 'kilometers' }));
      resultGeoJson = turf.featureCollection(buffered as any);
    } else if (type === 'clustering') {
      const points = turf.featureCollection(sourceData.map(d => turf.point([d.lng, d.lat], { ...d.metadata, value: d.value })));
      const clustered = turf.clustersDbscan(points, clusterRadius || 10, { units: 'kilometers', minPoints: 1 });
      resultGeoJson = clustered;
    } else {
      return res.status(400).json({ error: "Invalid tool type" });
    }

    if (persist) {
      const name = customName || `${type.toUpperCase()}: ${sourceDataset.name}`;
      const newDataset = await prisma.dataset.create({
        data: {
          name,
          color: "#f97316",
          type: type === 'aggregation' ? "grid" : "points",
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
    tileIndexCache.delete(id);
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
