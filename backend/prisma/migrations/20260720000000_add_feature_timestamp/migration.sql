-- AlterTable
ALTER TABLE "Feature" ADD COLUMN "timestamp" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Feature_datasetId_timestamp_idx" ON "Feature"("datasetId", "timestamp");
