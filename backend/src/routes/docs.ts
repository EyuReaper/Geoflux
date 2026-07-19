import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { getOpenApiDocumentation } from "../swagger.js";

const router = Router();

const openApiDocument = getOpenApiDocumentation();

router.get("/openapi.json", (_req, res) => {
  res.json(openApiDocument);
});

router.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

export default router;
