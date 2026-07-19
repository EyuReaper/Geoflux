import { Router } from "express";
import { prisma } from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";
import {
  requireWorkspaceOwner,
  requireWorkspaceAccess,
} from "../middleware/ownership.js";
import {
  validateRequest,
  workspaceCreateSchema,
  workspaceShareSchema,
  uuidParamSchema,
} from "../utils/validation.js";

const router = Router();

router.get("/", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const workspaces = await prisma.workspace.findMany({
      where: { userId: req.user?.id },
      orderBy: { updatedAt: "desc" },
    });
    res.json(workspaces);
  } catch {
    res.status(500).json({ error: "Failed to fetch workspaces" });
  }
});

router.post(
  "/",
  authenticateToken,
  validateRequest(workspaceCreateSchema),
  async (req: AuthRequest, res) => {
    try {
      const { name, config } = req.body as { name: string; config: object };
      const workspace = await prisma.workspace.create({
        data: { name, config, userId: req.user!.id },
      });
      res.status(201).json(workspace);
    } catch {
      res.status(500).json({ error: "Failed to create workspace" });
    }
  }
);

router.get(
  "/:id",
  validateRequest(uuidParamSchema),
  requireWorkspaceAccess,
  async (req: AuthRequest, res) => {
    try {
      res.json(req.workspace);
    } catch {
      res.status(500).json({ error: "Failed to fetch workspace" });
    }
  }
);

router.patch(
  "/:id/share",
  authenticateToken,
  validateRequest(workspaceShareSchema),
  requireWorkspaceOwner,
  async (req: AuthRequest, res) => {
    try {
      const { isPublic } = req.body as { isPublic: boolean };
      const updated = await prisma.workspace.update({
        where: { id: req.workspace!.id },
        data: { isPublic: !!isPublic },
      });
      res.json(updated);
    } catch {
      res.status(500).json({ error: "Failed to update sharing" });
    }
  }
);

export default router;
