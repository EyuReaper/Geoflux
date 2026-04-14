import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../prisma/generated/prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 4000;

// Initialize Prisma with better-sqlite3 adapter for Prisma 7
// Resolve relative to backend/ root
const rawUrl = process.env.DATABASE_URL || "file:./prisma/dev.db";
const dbPath = path.resolve(__dirname, "..", rawUrl.replace("file:", ""));
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Get all datasets
app.get("/datasets", async (req, res) => {
  try {
    const datasets = await prisma.dataset.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(datasets);
  } catch (error: any) {
    console.error("Error fetching datasets:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch datasets", details: error.message });
  }
});

// Create a new dataset
app.post("/datasets", async (req, res) => {
  try {
    const { name, color, data } = req.body;

    if (!name || !data) {
      return res.status(400).json({ error: "Name and data are required" });
    }

    const dataset = await prisma.dataset.create({
      data: {
        name,
        color: color || "#06b6d4",
        data: data as any, // Storing as JSON
      },
    });

    res.status(201).json(dataset);
  } catch (error) {
    console.error("Error creating dataset:", error);
    res.status(500).json({ error: "Failed to create dataset" });
  }
});

// Delete a dataset
app.delete("/datasets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.dataset.delete({
      where: { id },
    });
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting dataset:", error);
    res.status(500).json({ error: "Failed to delete dataset" });
  }
});

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
