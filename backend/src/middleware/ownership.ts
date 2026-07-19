import type { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";
import type { AuthRequest } from "./auth.js";
import { extractToken } from "./auth.js";
import { requireJwtSecret } from "../utils/security.js";

const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? "" : value ?? "";

/** Require the authenticated user to own the dataset at :id. */
export async function requireDatasetOwner(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = firstParam(req.params.id);
    if (!req.user?.id || !id) {
      res.status(404).json({ error: "Dataset not found" });
      return;
    }

    const dataset = await prisma.dataset.findUnique({ where: { id } });
    if (!dataset || dataset.userId !== req.user.id) {
      res.status(404).json({ error: "Dataset not found" });
      return;
    }

    req.dataset = dataset;
    next();
  } catch (error: unknown) {
    next(error);
  }
}

/** Require the authenticated user to own the workspace at :id. */
export async function requireWorkspaceOwner(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = firstParam(req.params.id);
    if (!req.user?.id || !id) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    const workspace = await prisma.workspace.findUnique({ where: { id } });
    if (!workspace || workspace.userId !== req.user.id) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    req.workspace = workspace;
    next();
  } catch (error: unknown) {
    next(error);
  }
}

/**
 * Allow access if workspace is public, or if the caller owns it (JWT required for private).
 * Used for GET /workspaces/:id.
 */
export async function requireWorkspaceAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = firstParam(req.params.id);
    if (!id) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    const workspace = await prisma.workspace.findUnique({ where: { id } });
    if (!workspace) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    if (workspace.isPublic) {
      req.workspace = workspace;
      next();
      return;
    }

    const token = extractToken(req);
    if (!token) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    try {
      const decoded = jwt.verify(token, requireJwtSecret()) as { id: string; email: string };
      if (workspace.userId !== decoded.id) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      req.user = decoded;
      req.workspace = workspace;
      next();
    } catch {
      res.status(403).json({ error: "Access denied" });
    }
  } catch (error: unknown) {
    next(error);
  }
}
