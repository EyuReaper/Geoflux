import { prisma } from "../index.js";
import { logger } from "./logger.js";

/**
 * Background maintenance task to keep the database clean and healthy.
 */
export const startMaintenanceWorker = () => {
  // Run every 6 hours
  const INTERVAL = 6 * 60 * 60 * 1000;

  logger.info("Maintenance worker started");

  setInterval(async () => {
    try {
      logger.info("Running periodic maintenance...");

      // 1. Purge Empty Datasets (older than 24h)
      // These are likely failed uploads or abandoned sessions
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const emptyDatasets = await prisma.dataset.findMany({
        where: {
          createdAt: { lt: yesterday },
          features: { none: {} }
        },
        select: { id: true, name: true }
      });

      if (emptyDatasets.length > 0) {
        const ids = emptyDatasets.map((d: any) => d.id);
        await prisma.dataset.deleteMany({
          where: { id: { in: ids } }
        });
        logger.info({ count: emptyDatasets.length, names: emptyDatasets.map((d: any) => d.name) }, "Purged stale empty datasets");
      }

      // 2. Validate Spatial Integrity
      // Purge any features with invalid geometries that might have slipped through
      const invalidResult = await prisma.$executeRawUnsafe(`
        DELETE FROM "Feature" 
        WHERE NOT ST_IsValid(geometry)
      `);
      
      if (invalidResult > 0) {
        logger.warn({ count: invalidResult }, "Purged features with invalid geometries");
      }

      // 3. System Health Log
      const mem = process.memoryUsage();
      logger.info({
        rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
        uptime: `${Math.round(process.uptime())}s`
      }, "System health snapshot");

    } catch (err) {
      logger.error({ err }, "Maintenance worker error");
    }
  }, INTERVAL);
};
