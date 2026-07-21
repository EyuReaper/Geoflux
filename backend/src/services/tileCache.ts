import { redis, pubsub, getTileKey, getInvalidationChannel, TILE_CACHE_TTL, CACHE_PREFIX } from "../utils/redis.js";
import { logger } from "../utils/logger.js";

const TILE_CACHE_TTL_MS = 5 * 60 * 1000;
const TILE_CACHE_MAX_ENTRIES = 128;

/** Distributed lock TTL for tile generation (seconds). */
const TILE_LOCK_TTL = 30;

/** In-flight tile generation promises — prevents cache stampede in-process. */
const inflight = new Map<string, Promise<Buffer | null>>();

type TileIndexRecord = {
  createdAt: number;
  lastAccessAt: number;
  datasetId: string;
};

/** In-memory index of datasets that have had tiles served (for local eviction bookkeeping). */
const tileIndexCache = new Map<string, TileIndexRecord>();

export function setupTileCacheInvalidation(): void {
  pubsub.subscribe(getInvalidationChannel(), (err: Error | null) => {
    if (err) logger.error({ err }, "Failed to subscribe to invalidation channel");
  });

  pubsub.on("message", (...args: unknown[]) => {
    const [channel, message] = args as [string, string];
    if (channel !== getInvalidationChannel()) return;
    try {
      const { type, datasetId } = JSON.parse(message) as { type?: string; datasetId?: string };
      if (type === "EVICT_DATASET" && datasetId) {
        for (const [key, record] of tileIndexCache.entries()) {
          if (record.datasetId === datasetId) {
            tileIndexCache.delete(key);
          }
        }
      }
    } catch (error: unknown) {
      logger.error({ err: error }, "Error processing invalidation message");
    }
  });
}

export function touchTileIndex(datasetId: string, cacheKey: string): void {
  const now = Date.now();
  tileIndexCache.set(cacheKey, {
    datasetId,
    createdAt: now,
    lastAccessAt: now,
  });
  pruneTileCache();
}

function pruneTileCache(): void {
  const now = Date.now();
  for (const [key, record] of tileIndexCache.entries()) {
    if (now - record.createdAt > TILE_CACHE_TTL_MS) {
      tileIndexCache.delete(key);
    }
  }

  if (tileIndexCache.size <= TILE_CACHE_MAX_ENTRIES) return;

  const entriesByAccessAsc = Array.from(tileIndexCache.entries()).sort(
    (a, b) => a[1].lastAccessAt - b[1].lastAccessAt
  );
  const overflow = tileIndexCache.size - TILE_CACHE_MAX_ENTRIES;

  for (let i = 0; i < overflow; i += 1) {
    const victim = entriesByAccessAsc[i];
    if (victim) tileIndexCache.delete(victim[0]);
  }
}

export async function evictDatasetTiles(datasetId: string): Promise<void> {
  for (const [key, record] of tileIndexCache.entries()) {
    if (record.datasetId === datasetId) tileIndexCache.delete(key);
  }

  await redis.publish(getInvalidationChannel(), JSON.stringify({ type: "EVICT_DATASET", datasetId }));

  let cursor = "0";
  const pattern = `${CACHE_PREFIX}${datasetId}:*`;
  try {
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch (error: unknown) {
    logger.error({ err: error }, "Error clearing Redis keys during eviction");
  }
}

export async function getCachedTile(redisKey: string): Promise<Buffer | null> {
  try {
    const cached = await redis.getBuffer(redisKey);
    return cached ?? null;
  } catch (error: unknown) {
    logger.warn({ err: error }, "Redis cache error");
    return null;
  }
}

export function cacheTile(redisKey: string, buffer: Buffer): void {
  redis.setex(redisKey, TILE_CACHE_TTL, buffer).catch((error: Error) => {
    logger.error({ err: error }, "Failed to cache tile to Redis");
  });
}

/**
 * Singleflight (in-process): deduplicates concurrent tile generation for the same key.
 */
export async function singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as T;

  const promise = fn().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise as Promise<Buffer | null>);
  return promise;
}

/**
 * Distributed tile generation lock using Redis SET NX.
 * Prevents multiple server instances from generating the same tile simultaneously.
 * Caller should check the cache again after acquiring the lock (double-check pattern).
 */
export async function acquireTileLock(
  key: string,
  ttlSeconds = TILE_LOCK_TTL
): Promise<boolean> {
  try {
    const lockKey = `${key}:lock`;
    const acquired = await redis.set(lockKey, "1", "EX", String(ttlSeconds), "NX");
    return acquired === "OK";
  } catch {
    return false;
  }
}

export { getTileKey, TILE_CACHE_TTL };
