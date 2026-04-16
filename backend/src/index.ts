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
    });
    res.json(datasets);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch datasets" });
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
