import { Router } from "express";
import multer from "multer";
import { authenticateToken } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";
import { insertFeaturesInBatches } from "../services/ingest.js";
import type { FeatureIngestItem } from "../services/ingest.js";
import { createJob, processJob } from "../services/ingestJob.js";
import { prisma } from "../db.js";
import { logger } from "../utils/logger.js";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      "text/csv",
      "application/json",
      "application/geo+json",
      "application/octet-stream",
    ];
    if (allowedMimes.includes(file.mimetype) || /\.(csv|json|geojson)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Accepted: CSV, JSON, GeoJSON`));
    }
  },
});

const router = Router();

function parseCsvBuffer(buffer: Buffer): FeatureIngestItem[] {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const latKey = headers.find((h) => /lat|latitude/i.test(h)) ?? "lat";
  const lngKey = headers.find((h) => /lng|long|longitude/i.test(h)) ?? "lng";
  const valKey = headers.find((h) => /val|count|intensity|mag|amount/i.test(h));
  const catKey = headers.find((h) => /cat|type|class|group/i.test(h));
  const tsKey = headers.find((h) => /time|date|timestamp|recorded/i.test(h));

  const items: FeatureIngestItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });

    const lat = parseFloat(row[latKey]);
    const lng = parseFloat(row[lngKey]);
    if (isNaN(lat) || isNaN(lng)) continue;

    const item: FeatureIngestItem = { lat, lng };
    if (valKey) item.value = parseFloat(row[valKey]) || null;
    if (catKey) item.category = row[catKey] || null;
    if (tsKey) item.timestamp = row[tsKey] || null;

    const metadata: Record<string, unknown> = {};
    headers.forEach((h) => {
      if (h !== latKey && h !== lngKey && h !== valKey && h !== catKey && h !== tsKey) {
        const num = parseFloat(row[h]);
        metadata[h] = isNaN(num) ? row[h] : num;
      }
    });
    if (Object.keys(metadata).length > 0) item.properties = metadata;

    items.push(item);
  }
  return items;
}

function parseJsonBuffer(buffer: Buffer): FeatureIngestItem[] {
  const data = JSON.parse(buffer.toString("utf-8"));

  if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
    return data.features.map((f: { geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }) => {
      const coords = f.geometry?.coordinates ?? [];
      const props = f.properties ?? {};
      return {
        lng: coords[0],
        lat: coords[1],
        value: typeof props.value === "number" ? props.value : undefined,
        category: typeof props.category === "string" ? props.category : undefined,
        timestamp: props.timestamp ? String(props.timestamp) : undefined,
        properties: props,
      };
    });
  }

  if (Array.isArray(data)) {
    return data.map((item: Record<string, unknown>) => {
      const lat = parseFloat(String(item.lat ?? item.Latitude ?? item.latitude ?? 0));
      const lng = parseFloat(String(item.lng ?? item.Long ?? item.Longitude ?? item.longitude ?? 0));
      return {
        lat,
        lng,
        value: typeof item.value === "number" ? item.value : undefined,
        category: typeof item.category === "string" ? item.category : undefined,
        timestamp: item.timestamp ? String(item.timestamp) : undefined,
        properties: item,
      };
    });
  }

  throw new Error("Unrecognized JSON format. Expected FeatureCollection or array of objects.");
}

router.post(
  "/",
  authenticateToken,
  (req: AuthRequest, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: `File exceeds maximum size of ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB` });
        }
        return res.status(400).json({ error: err.message });
      }
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req: AuthRequest, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file provided. Send a file field named 'file'." });
      }

      const name = (req.body.name as string) || file.originalname.replace(/\.[^.]+$/, "");
      const color = (req.body.color as string) || "#06b6d4";
      const isAsync = req.body.async === "true" || req.body.async === true;

      let items: FeatureIngestItem[];
      if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
        items = parseCsvBuffer(file.buffer);
      } else {
        items = parseJsonBuffer(file.buffer);
      }

      if (items.length === 0) {
        return res.status(422).json({ error: "No valid features found in the uploaded file." });
      }

      if (isAsync && items.length > 10_000) {
        const { job, emitter } = createJob(name);
        processJob(job.id, req.user?.id, items, name, color);

        const io = req.app.get("io");
        if (io) {
          emitter.on("progress", ({ processed, total }) => {
            io.emit(`ingest:progress:${job.id}`, { jobId: job.id, processed, total });
          });
          emitter.on("complete", ({ datasetId }) => {
            io.emit(`ingest:complete:${job.id}`, { jobId: job.id, datasetId });
          });
          emitter.on("error", ({ error }) => {
            io.emit(`ingest:error:${job.id}`, { jobId: job.id, error });
          });
        }

        return res.status(202).json({ jobId: job.id, message: "Ingest started. Listen on Socket.io for progress." });
      }

      const dataset = await prisma.dataset.create({
        data: {
          name,
          color,
          type: "points",
          user: req.user?.id ? { connect: { id: req.user.id } } : undefined,
        },
      });

      await insertFeaturesInBatches(dataset.id, items);

      res.status(201).json(dataset);
    } catch (error: unknown) {
      logger.error({ err: error }, "File upload error");
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to process upload" });
    }
  }
);

export default router;
