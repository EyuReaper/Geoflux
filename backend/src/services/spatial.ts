import type { FeatureCollection } from "geojson";
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

export type SpatialToolResult =
  | { kind: "dataset"; dataset: { id: string; name: string; color: string; type: string; userId: string | null } }
  | { kind: "geojson"; geojson: FeatureCollection }
  | { kind: "empty" }
  | { kind: "error"; status: number; message: string };

/** Check if a dataset has any features (fast count query). */
async function datasetHasFeatures(datasetId: string): Promise<boolean> {
  const result = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM "Feature" WHERE "datasetId" = ${datasetId}
  `;
  return result[0].count > 0n;
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

  if (!(await datasetHasFeatures(sourceDatasetId))) {
    return { kind: "empty" };
  }

  let resultGeoJson: FeatureCollection;

  if (type === "aggregation") {
    // Already pure PostGIS — skip loading features into Node
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
    // Push to PostGIS: ST_Buffer(geography, radius_km * 1000)
    const radiusKm = Math.max(0.001, bufferRadius || 5);
    const radiusM = radiusKm * 1000;

    const rows = await prisma.$queryRaw`
      SELECT
        ST_AsGeoJSON(ST_Buffer(geography, ${radiusM}))::json as geometry,
        "value", "category", "properties"
      FROM "Feature"
      WHERE "datasetId" = ${sourceDatasetId}
        AND ST_GeometryType(geometry) = 'ST_Point'
    ` as Array<{ geometry: GeoJSON.Geometry; value: number | null; category: string | null; properties: Record<string, unknown> | null }>;

    if (rows.length === 0) {
      return { kind: "error", status: 422, message: "Buffer operation failed: no point geometries found" };
    }

    resultGeoJson = {
      type: "FeatureCollection",
      features: rows.map((r) => ({
        type: "Feature" as const,
        geometry: r.geometry,
        properties: {
          value: r.value,
          category: r.category,
          ...(r.properties || {}),
        },
      })),
    };
  } else if (type === "clustering") {
    // Push to PostGIS: ST_ClusterDBSCAN
    const eps = Math.max(0.001, clusterRadius || 10);
    const epsDeg = eps / 111.32; // rough km → degrees at equator

    const rows = await prisma.$queryRaw`
      SELECT
        ST_AsGeoJSON(geometry)::json as geometry,
        "value", "category", "properties",
        ST_ClusterDBSCAN(geometry, ${epsDeg}, 1) OVER () as cluster_id
      FROM "Feature"
      WHERE "datasetId" = ${sourceDatasetId}
        AND ST_GeometryType(geometry) = 'ST_Point'
    ` as Array<{ geometry: GeoJSON.Geometry; value: number | null; category: string | null; properties: Record<string, unknown> | null; cluster_id: number | null }>;

    if (rows.length === 0) {
      return { kind: "error", status: 422, message: "At least 1 point required for clustering" };
    }

    resultGeoJson = {
      type: "FeatureCollection",
      features: rows.map((r) => ({
        type: "Feature" as const,
        geometry: r.geometry,
        properties: {
          value: r.value,
          category: r.category,
          cluster: r.cluster_id,
          ...(r.properties || {}),
        },
      })),
    };
  } else if (type === "convex_hull") {
    // Push to PostGIS: ST_ConvexHull(ST_Collect(geometry))
    const rows = await prisma.$queryRaw`
      SELECT ST_AsGeoJSON(ST_ConvexHull(ST_Collect(geometry)))::json as geometry
      FROM "Feature"
      WHERE "datasetId" = ${sourceDatasetId}
    ` as Array<{ geometry: GeoJSON.Geometry | null }>;

    const geom = rows[0]?.geometry;
    if (!geom) {
      return { kind: "error", status: 422, message: "Convex hull could not be generated (points might be collinear)" };
    }

    resultGeoJson = {
      type: "FeatureCollection",
      features: [{ type: "Feature" as const, geometry: geom, properties: {} }],
    };
  } else if (type === "concave_hull") {
    // PostGIS ST_ConcaveHull (no need to load features into Node memory)
    const maxEdge = Number.isFinite(Number(hullMaxEdge)) ? Math.max(0.001, Number(hullMaxEdge)) : 10;
    const targetPercent = Math.min(0.99, maxEdge / 100);

    const rows = await prisma.$queryRaw`
      SELECT ST_AsGeoJSON(
        ST_ConcaveHull(ST_Collect(geometry), ${targetPercent}, true)
      )::json as geometry
      FROM "Feature"
      WHERE "datasetId" = ${sourceDatasetId}
    ` as Array<{ geometry: GeoJSON.Geometry | null }>;

    const geom = rows[0]?.geometry;
    if (!geom) {
      return {
        kind: "error",
        status: 422,
        message: "Concave hull could not be generated (try increasing max edge or check for sparse data)",
      };
    }

    resultGeoJson = {
      type: "FeatureCollection",
      features: [{ type: "Feature" as const, geometry: geom, properties: {} }],
    };
  } else if (type === "voronoi") {
    // Push to PostGIS: ST_VoronoiPolygons(ST_Collect(geometry))
    const rows = await prisma.$queryRaw`
      SELECT ST_AsGeoJSON(
        (ST_VoronoiPolygons(ST_Collect(geometry))).geometry
      )::json as geometry
      FROM "Feature"
      WHERE "datasetId" = ${sourceDatasetId}
        AND ST_GeometryType(geometry) = 'ST_Point'
    ` as Array<{ geometry: GeoJSON.Geometry | null }>;

    if (!rows[0]?.geometry) {
      return {
        kind: "error",
        status: 422,
        message: "Voronoi tessellation failed (ensure points are not all identical)",
      };
    }

    // ST_VoronoiPolygons returns a GeometryCollection — extract the polygons
    const geom = rows[0].geometry;
    if (geom.type === "GeometryCollection") {
      const polygons = (geom as GeoJSON.GeometryCollection).geometries.filter(
        (g) => g.type === "Polygon" || g.type === "MultiPolygon"
      );
      resultGeoJson = {
        type: "FeatureCollection",
        features: polygons.map((g) => ({ type: "Feature" as const, geometry: g, properties: {} })),
      };
    } else {
      resultGeoJson = {
        type: "FeatureCollection",
        features: [{ type: "Feature" as const, geometry: geom, properties: {} }],
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
