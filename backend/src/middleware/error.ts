import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { z } from 'zod';

export interface ApiError extends Error {
  status?: number;
  details?: unknown;
}

export const errorHandler = (
  err: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  logger.error({
    err: {
      message: err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
      details: err.details,
    },
    req: {
      method: req.method,
      url: req.url,
      params: req.params,
      query: req.query,
    },
  }, message);

  // Zod validation errors are handled by validateRequest; this is a fallback
  if (err instanceof z.ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};
