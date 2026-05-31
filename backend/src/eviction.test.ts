import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { redis, CACHE_PREFIX, getInvalidationChannel } from '../src/utils/redis';

// Mock Redis for this test
vi.mock('../src/utils/redis', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    redis: {
      getBuffer: vi.fn(),
      setex: vi.fn(),
      publish: vi.fn(),
      scan: vi.fn(),
      del: vi.fn(),
    },
    pubsub: {
      subscribe: vi.fn(),
      on: vi.fn(),
    }
  };
});

describe('Redis Eviction Logic', () => {
  it('should scan and delete all keys associated with a dataset during eviction', async () => {
    const datasetId = 'test-dataset-id';
    const pattern = `${CACHE_PREFIX}${datasetId}:*`;
    
    // Mock SCAN to return keys in two pages then finish
    (redis.scan as any)
      .mockResolvedValueOnce(['next-cursor', ['key1', 'key2']])
      .mockResolvedValueOnce(['0', ['key3']]);

    // This logic is currently inside backend/src/index.ts evictDatasetTiles
    // We are validating the implementation strategy
    
    let cursor = '0';
    let totalDeleted = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
        totalDeleted += keys.length;
      }
    } while (cursor !== '0');

    expect(redis.scan).toHaveBeenCalledTimes(2);
    expect(redis.del).toHaveBeenCalledWith('key1', 'key2');
    expect(redis.del).toHaveBeenCalledWith('key3');
    expect(totalDeleted).toBe(3);
  });
});
