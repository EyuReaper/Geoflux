import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import {
  registerSchema,
  loginSchema,
  datasetCreateSchema,
  spatialToolSchema,
  tileParamsSchema,
  workspaceCreateSchema,
  workspaceShareSchema,
  uuidParamSchema,
} from "./utils/validation.js";

const registry = new OpenAPIRegistry();

// --- Auth Schemas ---
const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

// --- Register Schemas ---
registry.register("Register", registerSchema.shape.body);
registry.register("Login", loginSchema.shape.body);
registry.register("DatasetCreate", datasetCreateSchema.shape.body);
registry.register("SpatialTool", spatialToolSchema.shape.body);
registry.register("WorkspaceCreate", workspaceCreateSchema.shape.body);
registry.register("WorkspaceShare", workspaceShareSchema.shape.body);

// --- Health ---
registry.registerPath({
  method: "get",
  path: "/health",
  summary: "Health check",
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              status: { type: "string" },
              timestamp: { type: "string" },
            },
          },
        },
      },
    },
  },
});

// --- Auth Routes ---
registry.registerPath({
  method: "post",
  path: "/register",
  summary: "Register a new user",
  request: {
    body: {
      content: {
        "application/json": {
          schema: registerSchema.shape.body,
        },
      },
    },
  },
  responses: {
    201: {
      description: "User registered successfully",
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/login",
  summary: "Login",
  request: {
    body: {
      content: {
        "application/json": {
          schema: loginSchema.shape.body,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Login successful",
    },
  },
});

// --- Dataset Routes ---
registry.registerPath({
  method: "get",
  path: "/datasets",
  summary: "Get all datasets for the authenticated user",
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: {
      description: "List of datasets",
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/datasets",
  summary: "Create a new dataset",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: datasetCreateSchema.shape.body,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Dataset created successfully",
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/datasets/{id}",
  summary: "Get a specific dataset",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: uuidParamSchema.shape.params,
  },
  responses: {
    200: { description: "Dataset details" },
    404: { description: "Dataset not found" },
  },
});

registry.registerPath({
  method: "get",
  path: "/datasets/{id}/stats",
  summary: "Get statistics for a dataset",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: uuidParamSchema.shape.params,
  },
  responses: {
    200: { description: "Dataset statistics" },
  },
});

registry.registerPath({
  method: "delete",
  path: "/datasets/{id}",
  summary: "Delete a dataset",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: uuidParamSchema.shape.params,
  },
  responses: {
    204: { description: "Dataset deleted" },
  },
});

registry.registerPath({
  method: "post",
  path: "/datasets/{id}/spatial-tool",
  summary: "Perform spatial operations on a dataset",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: uuidParamSchema.shape.params,
    body: {
      content: {
        "application/json": {
          schema: spatialToolSchema.shape.body,
        },
      },
    },
  },
  responses: {
    200: { description: "Spatial operation result" },
    201: { description: "Result persisted as a new dataset" },
  },
});

registry.registerPath({
  method: "get",
  path: "/datasets/{id}/tiles/{z}/{x}/{y}.pbf",
  summary: "Get vector tiles for a dataset",
  description:
    "Requires JWT via Authorization: Bearer <token> (preferred) or ?token= query param. Dataset must be owned by the authenticated user.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: tileParamsSchema.shape.params,
    query: tileParamsSchema.shape.query,
  },
  responses: {
    200: {
      description: "Vector tile (PBF)",
      content: {
        "application/x-protobuf": {
          schema: {
            type: "string",
            format: "binary",
          },
        },
      },
    },
    401: { description: "Missing or invalid token" },
    404: { description: "Dataset not found or access denied" },
  },
});

// --- Workspace Routes ---
registry.registerPath({
  method: "get",
  path: "/workspaces",
  summary: "Get all workspaces for the authenticated user",
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: { description: "List of workspaces" },
  },
});

registry.registerPath({
  method: "post",
  path: "/workspaces",
  summary: "Create a new workspace",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: workspaceCreateSchema.shape.body,
        },
      },
    },
  },
  responses: {
    201: { description: "Workspace created" },
  },
});

registry.registerPath({
  method: "get",
  path: "/workspaces/{id}",
  summary: "Get a specific workspace",
  request: {
    params: uuidParamSchema.shape.params,
  },
  responses: {
    200: { description: "Workspace details" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/workspaces/{id}/share",
  summary: "Update workspace sharing settings",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: uuidParamSchema.shape.params,
    body: {
      content: {
        "application/json": {
          schema: workspaceShareSchema.shape.body,
        },
      },
    },
  },
  responses: {
    200: { description: "Sharing settings updated" },
  },
});

export const getOpenApiDocumentation = () => {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      version: "1.0.0",
      title: "GeoFlux API",
      description: "API documentation for the GeoFlux backend",
    },
    servers: [{ url: "/" }],
  });
};
