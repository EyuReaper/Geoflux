import { Router } from "express";
import { prisma } from "../db.js";
import { redis } from "../utils/redis.js";
import { logger } from "../utils/logger.js";

const router = Router();

router.get("/health", async (_req, res) => {
  let dbStatus = "up";
  let redisStatus = "up";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error: unknown) {
    logger.error({ err: error }, "Health check: Database down");
    dbStatus = "down";
  }

  try {
    await redis.ping();
  } catch (error: unknown) {
    logger.error({ err: error }, "Health check: Redis down");
    redisStatus = "down";
  }

  const status = dbStatus === "up" && redisStatus === "up" ? "ok" : "degraded";
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

export default router;
