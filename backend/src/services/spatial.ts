import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Point } from "geojson";
import { prisma, Prisma } from "../db.js";
import { insertFeaturesInBatches } from "./ingest.js";
import { logger } from "../utils/logger.js";

export type SpatialToolInput = {
  type: "aggregation" | "buffer" | "clustering" | "convex_hull" | "concave_hull" | "voronoi";
  targetGridType?: "hex" | "square";
  gridResolution?: number | string;
  aggregationField?: string;
  bufferRadius?: number;
  clusterRadius?: number;
  hullMaxEdge?: number;
  persist?: boolean;
  customName?: string;
};

type SourceFeatureRow = {
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown> | null;
  value: number | null;
  category: string | null;
};

type PointSource = {
  lat: number;
  lng: number;
  value: number | null;
  category: string | null;
  metadata: Record<string, unknown>;
};

export type SpatialToolResult =
  | { kind: "dataset"; dataset: { id: string; name: string; color: string; type: string; userId: string | null } }
  | { kind: "geojson"; geojson: FeatureCollection }
  | { kind: "empty" }
  | { kind: "error"; status: number; message: string };

function toPointSources(rows: SourceFeatureRow[]): PointSource[] {
  return rows
    .map((f) => {
      const props = f.properties && typeof f.properties === "object" ? f.properties : {};
      const isPoint = f.geometry?.type === "Point";
      const coords = isPoint && Array.isArray((f.geometry as GeoJSON.Point).coordinates)
        ? (f.geometry as GeoJSON.Point).coordinates
        : null;
      return {
        lat: coords ? coords[1] : undefined,
        lng: coords ? coords[0] : undefined,
        value: f.value,
        category: f.category,
        metadata: props as Record<string, unknown>,
      };
    })
    .filter((d): d is PointSource => typeof d.lat === "number" && typeof d.lng === "number");
}

export async function runSpatialTool(
  sourceDatasetId: string,
  sourceName: string,
  userId: string | undefined,
  input: SpatialToolInput
): Promise<SpatialToolResult> {
  const {
    type,
    targetGridType,
    gridResolution,
    aggregationField,
    bufferRadius,
    clusterRadius,
    hullMaxEdge,
    persist,
    customName,
  } = input;

  const featuresFromDb = await prisma.$queryRaw`
    SELECT ST_AsGeoJSON(geometry)::json as geometry, properties, value, category
    FROM "Feature"
    WHERE "datasetId" = ${sourceDatasetId}
  ` as SourceFeatureRow[];

  const sourceData = toPointSources(featuresFromDb);

  if (featuresFromDb.length === 0) {
    return { kind: "empty" };
  }

  if (sourceData.length === 0) {
    return { kind: "error", status: 400, message: "No valid point geometries found in source dataset" };
  }

  const pointFeatures = sourceData.map((d) =>
    turf.truncate(
      turf.cleanCoords(
        turf.point([d.lng, d.lat], { ...d.metadata, value: d.value })
      )
    )
  ) as Feature<Point>[];

  const pointFC = turf.featureCollection(pointFeatures);
  let resultGeoJson: FeatureCollection;

  if (type === "aggregation") {
    const resolution = parseFloat(String(gridResolution ?? 4));
    const isHex = targetGridType === "hex";
    const gridFn = isHex ? Prisma.raw("ST_HexagonGrid") : Prisma.raw("ST_SquareGrid");
    const spatialRes = isHex
      ? 0.5 / Math.pow(2, resolution - 2)
      : 1 / Math.pow(2, resolution - 2);
    const aggField = aggregationField || "";

    const gridResults = await prisma.$queryRaw`
      WITH grid AS (
        SELECT ${gridFn}(${spatialRes}, geometry) as geom, "value", "properties"
        FROM "Feature"
        WHERE "datasetId" = ${sourceDatasetId}
      )
      SELECT
        ST_AsGeoJSON(geom)::json as geometry,
        SUM(COALESCE(("properties"->>${aggField})::numeric, "value", 0)) as value,
        COUNT(*) as count
      FROM grid
      GROUP BY geom
    ` as Array<{ geometry: GeoJSON.Geometry; value: unknown; count: unknown }>;

    resultGeoJson = {
      type: "FeatureCollection",
      features: gridResults.map((cell) => ({
        type: "Feature" as const,
        geometry: cell.geometry,
        properties: {
          value: Number(cell.value),
          count: Number(cell.count),
          avg: Number(cell.count) > 0 ? Number(cell.value) / Number(cell.count) : 0,
        },
      })),
    };
  } else if (type === "buffer") {
    const buffered = pointFeatures
      .map((p) => {
        try {
          return turf.buffer(p, Math.max(0.001, bufferRadius || 5), { units: "kilometers" });
        } catch (error: unknown) {
          logger.warn({ err: error, p }, "Buffer failed for point");
          return null;
        }
      })
      .filter((f): f is NonNullable<typeof f> => f != null);

    if (buffered.length === 0) {
      return { kind: "error", status: 422, message: "Buffer operation failed for all points" };
    }
    resultGeoJson = turf.featureCollection(buffered);
  } else if (type === "clustering") {
    if (pointFeatures.length < 1) {
      return { kind: "error", status: 422, message: "At least 1 point required for clustering" };
    }
    resultGeoJson = turf.clustersDbscan(pointFC, Math.max(0.001, clusterRadius || 10), {
      units: "kilometers",
      minPoints: 1,
    });
  } else if (type === "convex_hull") {
    if (pointFeatures.length < 3) {
      return { kind: "error", status: 422, message: "At least 3 points required for convex hull" };
    }
    const hull = turf.convex(pointFC);
    if (!hull) {
      return {
        kind: "error",
        status: 422,
        message: "Convex hull could not be generated (points might be collinear)",
      };
    }
    resultGeoJson = turf.featureCollection([hull]);
  } else if (type === "concave_hull") {
    if (pointFeatures.length < 3) {
      return { kind: "error", status: 422, message: "At least 3 points required for concave hull" };
    }
    const maxEdge = Number.isFinite(Number(hullMaxEdge)) ? Math.max(0.001, Number(hullMaxEdge)) : 10;
    const hull = turf.concave(pointFC, { maxEdge, units: "kilometers" });
    if (!hull) {
      return {
        kind: "error",
        status: 422,
        message: "Concave hull could not be generated (try increasing max edge or check for sparse data)",
      };
    }
    resultGeoJson = turf.featureCollection([hull]);
  } else if (type === "voronoi") {
    if (pointFeatures.length < 2) {
      return { kind: "error", status: 422, message: "At least 2 points required for Voronoi tessellation" };
    }
    const bbox = turf.bbox(pointFC);
    const paddingX = Math.max((bbox[2] - bbox[0]) * 0.1, 0.1);
    const paddingY = Math.max((bbox[3] - bbox[1]) * 0.1, 0.1);
    const paddedBBox: [number, number, number, number] = [
      bbox[0] - paddingX,
      bbox[1] - paddingY,
      bbox[2] + paddingX,
      bbox[3] + paddingY,
    ];
    try {
      const voronoi = turf.voronoi(pointFC, { bbox: paddedBBox });
      if (!voronoi) throw new Error("Turf voronoi returned null");
      resultGeoJson = voronoi as FeatureCollection;
    } catch (error: unknown) {
      logger.error({ err: error }, "Voronoi failed");
      return {
        kind: "error",
        status: 422,
        message: "Voronoi tessellation failed (ensure points are not all identical)",
      };
    }
  } else {
    return { kind: "error", status: 400, message: "Invalid tool type" };
  }

  const isAreaResult = ["aggregation", "convex_hull", "concave_hull", "voronoi", "buffer"].includes(type);

  if (persist) {
    const name = customName || `${type.toUpperCase()}: ${sourceName}`;
    const newDataset = await prisma.dataset.create({
      data: {
        name,
        color: "#f97316",
        type: isAreaResult ? "grid" : "points",
        userId,
      },
    });

    const features = resultGeoJson.features;
    await insertFeaturesInBatches(
      newDataset.id,
      features.map((f) => ({
        geometry: f.geometry as object,
        properties: (f.properties as object) || {},
        value:
          f.properties && typeof f.properties === "object" && "value" in f.properties
            ? (f.properties.value as number | null)
            : null,
        category:
          f.properties && typeof f.properties === "object" && "category" in f.properties
            ? (f.properties.category as string | null)
            : null,
      }))
    );

    return { kind: "dataset", dataset: newDataset };
  }

  return { kind: "geojson", geojson: resultGeoJson };
}
