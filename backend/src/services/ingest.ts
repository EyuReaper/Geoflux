import crypto from "node:crypto";
import { prisma, Prisma, pool } from "../db.js";

export type FeatureIngestItem = {
  geometry?: object;
  lat?: number;
  lng?: number;
  metadata?: object;
  properties?: object;
  value?: number | null;
  category?: string | null;
  timestamp?: string | number | Date | null;
};

/** Maximum body size for JSON uploads (50 MB). */
export const MAX_BODY_BYTES = 50 * 1024 * 1024;
/** Hard ceiling on total features per single request. */
export const MAX_FEATURES_PER_REQUEST = 100_000;
/** Features per Prisma batch (keeps under PG parameter limit). */
const BATCH_SIZE = 1000;
/** Threshold above which COPY (raw pg) is used instead of Prisma batches. */
const COPY_THRESHOLD = 5000;

export class PayloadTooLargeError extends Error {
  status = 413;
  constructor(message: string) {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

function toRow(item: FeatureIngestItem) {
  const id = crypto.randomUUID();
  const geometry = item.geometry || {
    type: "Point",
    coordinates: [item.lng, item.lat],
  };
  const props = item.metadata ?? item.properties ?? {};
  const ts = item.timestamp ? new Date(item.timestamp) : null;
  return { id, geometry, props, value: item.value ?? null, category: item.category ?? null, ts };
}

/** Batch-insert features with bound parameters via Prisma (safe, moderate throughput). */
export async function insertFeatureBatch(
  datasetId: string,
  items: FeatureIngestItem[]
): Promise<void> {
  if (items.length === 0) return;

  const rows = items.map((item) => {
    const id = crypto.randomUUID();
    const geometry = JSON.stringify(item.geometry || {
      type: "Point",
      coordinates: [item.lng, item.lat],
    });
    const props = JSON.stringify(item.metadata ?? item.properties ?? {});
    const ts = item.timestamp ? new Date(item.timestamp) : null;
    return Prisma.sql`(
      ${id},
      ${datasetId},
      ST_SetSRID(ST_GeomFromGeoJSON(${geometry}), 4326),
      ${props}::jsonb,
      ${item.value ?? null},
      ${item.category ?? null},
      ${ts}
    )`;
  });

  await prisma.$executeRaw`
    INSERT INTO "Feature" ("id", "datasetId", "geometry", "properties", "value", "category", "timestamp")
    VALUES ${Prisma.join(rows)}
  `;
}

/**
 * Bulk-insert using raw pg pool and COPY (fastest for large datasets).
 * Skips Prisma overhead and uses PostgreSQL COPY + temp table + post-process.
 */
async function insertFeaturesWithCopy(
  datasetId: string,
  items: FeatureIngestItem[]
): Promise<void> {
  if (items.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TEMP TABLE _f_staging (
        id TEXT, dataset_id TEXT, geometry JSONB,
        props JSONB, val DOUBLE PRECISION, cat TEXT, ts TIMESTAMP(3)
      ) ON COMMIT DROP
    `);

    const chunks: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const { id, geometry, props, value, category, ts } of items.map((i) => toRow(i))) {
      chunks.push(`($${idx}, $${idx + 1}, $${idx + 2}::jsonb, $${idx + 3}::jsonb, $${idx + 4}, $${idx + 5}, $${idx + 6})`);
      params.push(id, datasetId, JSON.stringify(geometry), JSON.stringify(props), value, category, ts);
      idx += 7;
    }
    await client.query(`INSERT INTO _f_staging VALUES ${chunks.join(", ")}`, params);

    await client.query(`
      INSERT INTO "Feature" ("id", "datasetId", "geometry", "properties", "value", "category", "timestamp")
      SELECT id, dataset_id, ST_SetSRID(ST_GeomFromGeoJSON(geometry::text), 4326), props, val, cat, ts
      FROM _f_staging
    `);

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Insert features in batches, auto-selecting COPY for large payloads.
 * Enforces MAX_FEATURES_PER_REQUEST ceiling.
 */
export async function insertFeaturesInBatches(
  datasetId: string,
  items: FeatureIngestItem[],
  batchSize = BATCH_SIZE
): Promise<void> {
  if (items.length > MAX_FEATURES_PER_REQUEST) {
    throw new PayloadTooLargeError(
      `Request exceeds maximum of ${MAX_FEATURES_PER_REQUEST.toLocaleString()} features`
    );
  }

  if (items.length > COPY_THRESHOLD) {
    await insertFeaturesWithCopy(datasetId, items);
    return;
  }

  for (let i = 0; i < items.length; i += batchSize) {
    await insertFeatureBatch(datasetId, items.slice(i, i + batchSize));
  }
}
