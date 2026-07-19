import crypto from "node:crypto";
import { prisma, Prisma } from "../db.js";

export type FeatureIngestItem = {
  geometry?: object;
  lat?: number;
  lng?: number;
  metadata?: object;
  properties?: object;
  value?: number | null;
  category?: string | null;
};

/** Batch-insert features with bound parameters (no string-built SQL). */
export async function insertFeatureBatch(
  datasetId: string,
  items: FeatureIngestItem[]
): Promise<void> {
  if (items.length === 0) return;

  const rows = items.map((item) => {
    const id = crypto.randomUUID();
    const geometry = item.geometry || {
      type: "Point",
      coordinates: [item.lng, item.lat],
    };
    const props = item.metadata ?? item.properties ?? {};
    return Prisma.sql`(
      ${id},
      ${datasetId},
      ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326),
      ${JSON.stringify(props)}::jsonb,
      ${item.value ?? null},
      ${item.category ?? null}
    )`;
  });

  await prisma.$executeRaw`
    INSERT INTO "Feature" ("id", "datasetId", "geometry", "properties", "value", "category")
    VALUES ${Prisma.join(rows)}
  `;
}

export async function insertFeaturesInBatches(
  datasetId: string,
  items: FeatureIngestItem[],
  batchSize = 1000
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await insertFeatureBatch(datasetId, items.slice(i, i + batchSize));
  }
}
