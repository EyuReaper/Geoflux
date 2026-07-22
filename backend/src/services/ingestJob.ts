import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { prisma } from "../db.js";
import { insertFeaturesInBatches } from "./ingest.js";
import type { FeatureIngestItem } from "./ingest.js";
import { logger } from "../utils/logger.js";

export type IngestJobStatus = "queued" | "processing" | "completed" | "failed";

export type IngestJob = {
  id: string;
  datasetId: string | null;
  datasetName: string;
  totalItems: number;
  processedItems: number;
  status: IngestJobStatus;
  error?: string;
};

const jobs = new Map<string, IngestJob>();
const emitters = new Map<string, EventEmitter>();

export function createJob(datasetName: string): { job: IngestJob; emitter: EventEmitter } {
  const id = randomUUID();
  const emitter = new EventEmitter();
  const job: IngestJob = {
    id,
    datasetId: null,
    datasetName,
    totalItems: 0,
    processedItems: 0,
    status: "queued",
  };
  jobs.set(id, job);
  emitters.set(id, emitter);
  return { job, emitter };
}

export function getJob(jobId: string): IngestJob | undefined {
  return jobs.get(jobId);
}

export async function processJob(
  jobId: string,
  userId: string | undefined,
  items: FeatureIngestItem[],
  name: string,
  color: string
): Promise<void> {
  const job = jobs.get(jobId);
  const emitter = emitters.get(jobId);
  if (!job || !emitter) return;

  job.status = "processing";
  job.totalItems = items.length;

  try {
    const dataset = await prisma.dataset.create({
      data: {
        name,
        color,
        type: "points",
        user: userId ? { connect: { id: userId } } : undefined,
      },
    });
    job.datasetId = dataset.id;

    const batchSize = 1000;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await insertFeaturesInBatches(dataset.id, batch);
      job.processedItems = Math.min(i + batchSize, items.length);
      emitter.emit("progress", { processed: job.processedItems, total: job.totalItems });
    }

    job.status = "completed";
    emitter.emit("complete", { datasetId: dataset.id });
  } catch (error: unknown) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Ingest failed";
    emitter.emit("error", { error: job.error });
    logger.error({ err: error, jobId }, "Async ingest job failed");
  } finally {
    setTimeout(() => {
      jobs.delete(jobId);
      emitters.delete(jobId);
    }, 5 * 60 * 1000);
  }
}
