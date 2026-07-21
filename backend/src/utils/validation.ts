import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import type { Request, Response, NextFunction } from "express";

extendZodWithOpenApi(z);

/** GeoJSON position: [lng, lat] or [lng, lat, alt] */
const positionSchema = z.union([
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number()]),
]);

/** Recursive coordinate arrays for LineString / Polygon / Multi* */
const coordinatesSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([positionSchema, z.array(coordinatesSchema)])
);

const geoJsonGeometrySchema = z.object({
  type: z.enum([
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
  ]),
  coordinates: coordinatesSchema.optional(),
  geometries: z.array(z.unknown()).optional(),
});

/** JSON-serializable property values (no functions / undefined). */
const jsonPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([jsonPrimitive, z.array(jsonValue), z.record(z.string(), jsonValue)])
);

export const validateRequest = (schema: z.ZodType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = (await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      })) as { body?: unknown; query?: unknown; params?: unknown };

      if ("body" in validated) {
        Object.defineProperty(req, "body", { value: validated.body, configurable: true });
      }
      if ("query" in validated) {
        Object.defineProperty(req, "query", { value: validated.query, configurable: true });
      }
      if ("params" in validated) {
        Object.defineProperty(req, "params", { value: validated.params, configurable: true });
      }

      next();
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation failed",
          details: error.issues.map((e) => ({
            path: e.path.join("."),
            message: e.message,
          })),
        });
      }
      next(error);
    }
  };
};

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string(),
  }),
});

/** Maximum features per request — prevents OOM on ingest. */
export const MAX_FEATURES_PER_REQUEST = 100_000;

export const datasetCreateSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    color: z
      .string()
      .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
      .optional(),
    type: z.enum(["points", "grid"]).optional(),
    data: z
      .array(
        z.object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          value: z.number().optional(),
          category: z.string().optional(),
          timestamp: z.union([z.string(), z.number()]).optional(),
          metadata: z.record(z.string(), jsonValue).optional(),
          geometry: geoJsonGeometrySchema.optional(),
        })
      )
      .max(MAX_FEATURES_PER_REQUEST, `Maximum ${MAX_FEATURES_PER_REQUEST.toLocaleString()} features per request`)
      .optional(),
  }),
});

export const spatialToolSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    type: z.enum([
      "aggregation",
      "buffer",
      "clustering",
      "convex_hull",
      "concave_hull",
      "voronoi",
    ]),
    targetGridType: z.enum(["hex", "square"]).optional(),
    gridResolution: z.union([z.number(), z.string()]).optional(),
    aggregationField: z.string().optional(),
    bufferRadius: z.number().optional(),
    clusterRadius: z.number().optional(),
    hullMaxEdge: z.number().optional(),
    persist: z.boolean().optional(),
    customName: z.string().optional(),
  }),
});

export const tileParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
    z: z
      .string()
      .regex(/^\d+$/)
      .transform((v) => parseInt(v, 10)),
    x: z
      .string()
      .regex(/^\d+$/)
      .transform((v) => parseInt(v, 10)),
    y: z
      .string()
      .regex(/^\d+$/)
      .transform((v) => parseInt(v, 10)),
  }),
  query: z.object({
    min: z
      .string()
      .optional()
      .transform((v) => (v ? parseFloat(v) : 0)),
    max: z
      .string()
      .optional()
      .transform((v) => (v ? parseFloat(v) : Infinity)),
    cats: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(",").filter(Boolean) : [])),
    search: z
      .string()
      .optional()
      .transform((v) => (v ? v.toLowerCase() : "")),
    mode: z.string().optional(),
    gridType: z.enum(["hex", "square"]).optional(),
    res: z
      .string()
      .optional()
      .transform((v) => (v ? parseFloat(v) : undefined)),
    /** Temporal filter (ms epoch) — pairs with Feature.timestamp column. */
    time: z
      .string()
      .optional()
      .transform((v) => (v ? parseFloat(v) : undefined)),
  }),
});

export const workspaceCreateSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    config: z.record(z.string(), jsonValue),
  }),
});

export const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const workspaceShareSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    isPublic: z.boolean(),
  }),
});
