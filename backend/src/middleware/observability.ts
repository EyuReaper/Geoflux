import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import promClient from 'prom-client';
import crypto from 'node:crypto';

// ── Prometheus Metrics ────────────────────────────────────────────────────────

const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'geoflux_' });

const httpRequestDuration = new promClient.Histogram({
  name: 'geoflux_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const httpRequestsTotal = new promClient.Counter({
  name: 'geoflux_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
});

const tileLatency = new promClient.Histogram({
  name: 'geoflux_tile_latency_seconds',
  help: 'MVT tile generation latency in seconds',
  labelNames: ['cache_hit'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

const tileCacheHitRatio = new promClient.Counter({
  name: 'geoflux_tile_cache_hits_total',
  help: 'Total number of tile cache hits/misses',
  labelNames: ['result'],
});

const dbQueryDuration = new promClient.Histogram({
  name: 'geoflux_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
});

const ingestDuration = new promClient.Histogram({
  name: 'geoflux_ingest_duration_seconds',
  help: 'Data ingestion duration in seconds',
  labelNames: ['status'],
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
});

// ── Request ID Middleware ─────────────────────────────────────────────────────

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  (req as Request & { requestId: string }).requestId = requestId;
  next();
}

// ── HTTP Metrics Middleware ───────────────────────────────────────────────────

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const path = req.route?.path || req.path;
    httpRequestDuration.observe({ method: req.method, path, status: res.statusCode }, duration);
    httpRequestsTotal.inc({ method: req.method, path, status: res.statusCode });
  });
  next();
}

// ── Structured Error Codes ───────────────────────────────────────────────────

export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATASET_NOT_FOUND: 'DATASET_NOT_FOUND',
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  INGEST_FAILED: 'INGEST_FAILED',
  SPATIAL_FAILED: 'SPATIAL_FAILED',
  CACHE_ERROR: 'CACHE_ERROR',
  DEPENDENCY_DOWN: 'DEPENDENCY_DOWN',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ── Structured Error Handler ──────────────────────────────────────────────────

export function structuredErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestId = (req as Request & { requestId?: string }).requestId;

  if (err instanceof AppError) {
    logger.warn({
      requestId,
      code: err.code,
      status: err.status,
      message: err.message,
      details: err.details,
      req: { method: req.method, url: req.url },
    }, err.message);

    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      requestId,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  logger.error({
    requestId,
    err: {
      message: err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    },
    req: { method: req.method, url: req.url },
  }, 'Unhandled error');

  res.status(500).json({
    error: 'Internal Server Error',
    code: ErrorCodes.INTERNAL_ERROR,
    requestId,
  });
}

// ── Metrics endpoint ──────────────────────────────────────────────────────────

export async function metricsHandler(_req: Request, res: Response) {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
}

// ── Exported metric helpers ───────────────────────────────────────────────────

export { tileLatency, tileCacheHitRatio, dbQueryDuration, ingestDuration, httpRequestDuration, httpRequestsTotal };
