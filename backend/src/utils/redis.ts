import { Redis } from "ioredis";
import { logger } from "./logger.js";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

export const pubsub = new Redis(REDIS_URL);

redis.on("error", (err) => logger.error({ err }, "Redis Error"));
pubsub.on("error", (err) => logger.error({ err }, "Redis PubSub Error"));

export const CACHE_PREFIX = "geoflux:tile:";
export const TILE_CACHE_TTL = 3600; // 1 hour in seconds for Redis

export const getTileKey = (datasetId: string, cacheKey: string, z: number, x: number, y: number) => {
  return `${CACHE_PREFIX}${datasetId}:${cacheKey}:${z}:${x}:${y}`;
};

export const getInvalidationChannel = () => "geoflux:cache-invalidation";
