import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";
import { requireDatasetOwner } from "../middleware/ownership.js";
import { runSpatialTool } from "../services/spatial.js";
import type { SpatialToolInput } from "../services/spatial.js";
import { validateRequest, spatialToolSchema } from "../utils/validation.js";
import { logger } from "../utils/logger.js";

const router = Router({ mergeParams: true });

const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? "" : value ?? "";

router.post(
  "/spatial-tool",
  authenticateToken,
  validateRequest(spatialToolSchema),
  requireDatasetOwner,
  async (req: AuthRequest, res) => {
    try {
      const sourceDataset = req.dataset!;
      const body = req.body as SpatialToolInput;

      const result = await runSpatialTool(
        sourceDataset.id,
        sourceDataset.name,
        req.user?.id,
        body
      );

      if (result.kind === "empty") {
        return res.status(200).json({ features: [] });
      }
      if (result.kind === "error") {
        return res.status(result.status).json({ error: result.message });
      }
      if (result.kind === "dataset") {
        return res.status(201).json(result.dataset);
      }
      return res.json(result.geojson);
    } catch (error: unknown) {
      logger.error({ err: error }, "Spatial tool error");
      res.status(500).json({ error: "Failed to perform spatial operation" });
    }
  }
);

/** Legacy support — redirect to spatial-tool */
router.post("/spatial-aggregate", authenticateToken, async (req: AuthRequest, res) => {
  req.body = { ...(req.body as object), type: "aggregation" };
  const sourceDatasetId = firstParam(req.params.id);
  res.redirect(307, `/api/v1/datasets/${sourceDatasetId}/spatial-tool`);
});

export default router;
