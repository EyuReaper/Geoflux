import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { requireJwtSecret } from '../utils/security.js';

// Lazy resolve — no fallback secrets. Startup validation lives in index.ts.
let cachedSecret: string | undefined;
function getJwtSecret(): string {
  if (!cachedSecret) {
    cachedSecret = requireJwtSecret();
  }
  return cachedSecret;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
  /** Populated by requireDatasetOwner */
  dataset?: {
    id: string;
    name: string;
    color: string;
    type: string;
    userId: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  /** Populated by requireWorkspaceOwner / requireWorkspaceAccess */
  workspace?: {
    id: string;
    name: string;
    config: unknown;
    isPublic: boolean;
    userId: string;
    createdAt: Date;
    updatedAt: Date;
  };
}

/**
 * Extract JWT from Authorization: Bearer <token> or ?token= query param.
 * Query param is supported for map tile clients that cannot set headers.
 */
export function extractToken(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && /^Bearer$/i.test(parts[0]) && parts[1]) {
      return parts[1];
    }
  }

  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && queryToken.length > 0) {
    return queryToken;
  }

  return null;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { id: string; email: string };
    req.user = decoded;
    next();
  } catch (error: unknown) {
    // Missing/weak JWT_SECRET surfaces as a startup/config error, not a 403.
    if (error instanceof Error && error.message.includes('JWT_SECRET')) {
      throw error;
    }
    res.status(403).json({ error: 'Invalid or expired token.' });
  }
};
