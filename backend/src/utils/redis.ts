import { Redis } from "ioredis";
import { logger } from "./logger.js";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const isTest = process.env.NODE_ENV === "test";

export const redis = isTest ? ({} as any) : new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 3) return null; // stop retrying after 3 attempts
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

export const pubsub = isTest ? ({} as any) : new Redis(REDIS_URL);

if (!isTest) {
  redis.on("error", (err) => logger.error({ err }, "Redis Error"));
  pubsub.on("error", (err) => logger.error({ err }, "Redis PubSub Error"));
}

export const CACHE_PREFIX = "geoflux:tile:";
export const TILE_CACHE_TTL = 3600; // 1 hour in seconds for Redis

export const getTileKey = (datasetId: string, cacheKey: string, z: number, x: number, y: number) => {
  return `${CACHE_PREFIX}${datasetId}:${cacheKey}:${z}:${x}:${y}`;
};

export const getInvalidationChannel = () => "geoflux:cache-invalidation";
