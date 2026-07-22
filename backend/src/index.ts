import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { pinoHttp } from "pino-http";

import { redis } from "./utils/redis.js";
import { logger } from "./utils/logger.js";
import { errorHandler } from "./middleware/error.js";
import { requireJwtSecret, resolveAllowedOrigins } from "./utils/security.js";
import { startMaintenanceWorker } from "./utils/cleanup.js";
import { setupTileCacheInvalidation } from "./services/tileCache.js";
import { setupLiveSimulation } from "./services/simulation.js";

import healthRoutes from "./routes/health.js";
import docsRoutes from "./routes/docs.js";
import authRoutes from "./routes/auth.js";
import datasetRoutes from "./routes/datasets.js";
import tileRoutes from "./routes/tiles.js";
import spatialRoutes from "./routes/spatial.js";
import uploadRoutes from "./routes/upload.js";
import workspaceRoutes from "./routes/workspaces.js";

const app = express();
const httpServer = createServer(app);

let allowedOrigins: string[];
try {
  requireJwtSecret();
  allowedOrigins = resolveAllowedOrigins();
} catch (error: unknown) {
  logger.fatal({ err: error }, error instanceof Error ? error.message : "Security configuration failed");
  process.exit(1);
}

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const port = process.env.PORT || 4000;

setupTileCacheInvalidation();

app.use(pinoHttp({ logger }));
app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
/** Max JSON body bytes. 413 returned when exceeded. */
const MAX_JSON_BODY_BYTES = 50 * 1024 * 1024;

app.use(express.json({ limit: MAX_JSON_BODY_BYTES }));

/** Skip routes from the general limiter: health, docs, and tile endpoints
 *  (tiles have their own higher-permissive limiter). */
const GENERAL_LIMITER_SKIP_PATHS = /^\/(health|openapi\.json|api-docs)|^\/api\/v1\/datasets\/[^/]+\/tiles\//;

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  skip: (req) => GENERAL_LIMITER_SKIP_PATHS.test(req.path),
});
app.use(generalLimiter);

app.use(healthRoutes);
app.use(docsRoutes);

const apiV1 = express.Router();
apiV1.use(authRoutes);
apiV1.use("/datasets", datasetRoutes);
apiV1.use("/datasets/upload", uploadRoutes);
apiV1.use("/datasets/:id/tiles", tileRoutes);
apiV1.use("/datasets/:id", spatialRoutes);
apiV1.use("/workspaces", workspaceRoutes);
app.use("/api/v1", apiV1);

app.set("io", io);
setupLiveSimulation(io);

app.use(errorHandler);

if (process.env.NODE_ENV !== "test") {
  httpServer.listen(port, () => {
    logger.info(`Backend running at http://localhost:${port}`);
    startMaintenanceWorker();
  });
}

export { app, redis };
