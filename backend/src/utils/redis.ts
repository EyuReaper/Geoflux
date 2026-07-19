import { Redis } from "ioredis";
import { logger } from "./logger.js";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const isTest = process.env.NODE_ENV === "test";

/** Minimal surface used by the app — real Redis in prod, stub in tests. */
type RedisLike = {
  ping: () => Promise<string>;
  get: (key: string) => Promise<string | null>;
  getBuffer: (key: string) => Promise<Buffer | null>;
  setex: (key: string, seconds: number, value: string | Buffer) => Promise<string>;
  del: (...keys: string[]) => Promise<number>;
  quit: () => Promise<string>;
  publish: (channel: string, message: string) => Promise<number>;
  scan: (
    cursor: string,
    matchKeyword: string,
    pattern: string,
    countKeyword: string,
    count: number
  ) => Promise<[string, string[]]>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  subscribe: (channel: string, callback?: (err: Error | null) => void) => void;
};

const testRedis: RedisLike = {
  ping: async () => "PONG",
  get: async () => null,
  getBuffer: async () => null,
  setex: async () => "OK",
  del: async () => 0,
  quit: async () => "OK",
  publish: async () => 1,
  scan: async () => ["0", []],
  on: () => undefined,
  subscribe: (_channel, callback) => {
    callback?.(null);
  },
};

export const redis: RedisLike = isTest
  ? testRedis
  : (new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 50, 2000);
      },
    }) as unknown as RedisLike);

export const pubsub: RedisLike = isTest
  ? { ...testRedis }
  : (new Redis(REDIS_URL) as unknown as RedisLike);

if (!isTest) {
  redis.on("error", (err: unknown) => logger.error({ err }, "Redis Error"));
  pubsub.on("error", (err: unknown) => logger.error({ err }, "Redis PubSub Error"));
}

export const CACHE_PREFIX = "geoflux:tile:";
export const TILE_CACHE_TTL = 3600; // 1 hour in seconds for Redis

export const getTileKey = (
  datasetId: string,
  cacheKey: string,
  z: number,
  x: number,
  y: number
) => {
  return `${CACHE_PREFIX}${datasetId}:${cacheKey}:${z}:${x}:${y}`;
};

export const getInvalidationChannel = () => "geoflux:cache-invalidation";
