import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../prisma/generated/prisma/client";
import { authenticateToken, AuthRequest } from "./middleware/auth.js";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

// Initialize Prisma
const rawUrl = process.env.DATABASE_URL || "file:./prisma/dev.db";
const dbPath = path.resolve(__dirname, "..", rawUrl.replace("file:", ""));
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

// Tile Cache
const tileIndexCache = new Map<string, any>();

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

app.get("/datasets/:id", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const dataset = await prisma.dataset.findUnique({
      where: { id },
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
    const { id, z, x, y } = req.params;
    const zInt = parseInt(z);
    const xInt = parseInt(x);
    const yInt = parseInt(y);

    let tileIndex = tileIndexCache.get(id);

    if (!tileIndex) {
      const dataset = await prisma.dataset.findUnique({ where: { id } });
      if (!dataset) return res.status(404).send("Dataset not found");

      const data = dataset.data as any[];
      const geojson: GeoJSON.FeatureCollection = {
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

      tileIndex = geojsonvt(geojson, {
        maxZoom: 14,
        tolerance: 3,
        extent: 4096,
        buffer: 64,
        debug: 0,
        indexMaxZoom: 4,
        indexMaxPoints: 100000
      });
      tileIndexCache.set(id, tileIndex);
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
    const { name, color, data } = req.body;
    const dataset = await prisma.dataset.create({
      data: {
        name,
        color: color || "#06b6d4",
        data: data as any,
        userId: req.user?.id,
      },
    });
    // Invalidate cache if updating existing? (Prisma create doesn't need it, but update would)
    res.status(201).json(dataset);
  } catch (error) {
    res.status(500).json({ error: "Failed to create dataset" });
  }
});

app.delete("/datasets/:id", authenticateToken as any, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const dataset = await prisma.dataset.findUnique({ where: { id } });
    
    if (!dataset || dataset.userId !== req.user?.id) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    await prisma.dataset.delete({ where: { id } });
    tileIndexCache.delete(id); // Clear cache on delete
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

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
