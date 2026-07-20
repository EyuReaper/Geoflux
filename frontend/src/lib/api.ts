import type { AuthState, Dataset, Workspace, SpatialToolConfig } from '../types/index'

/**
 * API origin (no path). Empty string = same-origin (production behind nginx).
 * Defaults to local backend for dev when VITE_API_URL is unset.
 */
export const API_URL =
  import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== ''
    ? String(import.meta.env.VITE_API_URL).replace(/\/$/, '')
    : import.meta.env.VITE_API_URL === ''
      ? ''
      : 'http://localhost:4000'

/** Versioned REST base path */
export const API_V1 = `${API_URL}/api/v1`

const DEFAULT_RETRIES = 2
const RETRY_BASE_MS = 300

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function getAuthHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object' && 'error' in body) {
      const err = (body as { error: unknown }).error
      if (typeof err === 'string') return err
    }
  } catch {
    // ignore non-JSON error bodies
  }
  return `Request failed (${res.status})`
}

type RequestOptions = RequestInit & {
  token?: string | null
  retries?: number
  /** Skip /api/v1 prefix (e.g. absolute external URLs are not used here) */
  rawPath?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, retries = DEFAULT_RETRIES, rawPath, ...init } = options
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    ...getAuthHeaders(token ?? null),
  }

  const url = rawPath ? path : `${API_V1}${path.startsWith('/') ? path : `/${path}`}`
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers })

      if (!res.ok) {
        if (attempt < retries && isRetryableStatus(res.status)) {
          await sleep(RETRY_BASE_MS * 2 ** attempt)
          continue
        }
        throw new ApiError(res.status, await parseErrorMessage(res))
      }

      if (res.status === 204) return undefined as T
      return (await res.json()) as T
    } catch (err) {
      lastError = err
      if (err instanceof ApiError) throw err
      // Network / abort — retry
      if (attempt < retries) {
        await sleep(RETRY_BASE_MS * 2 ** attempt)
        continue
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed')
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export type AuthResponse = { token: string; user: AuthState['user'] }

export async function apiRegister(email: string, password: string, name?: string): Promise<AuthResponse> {
  return request<AuthResponse>('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
    retries: 0,
  })
}

export async function apiLogin(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    retries: 0,
  })
}

// ── Datasets ──────────────────────────────────────────────────────────────────

type DatasetSummary = Pick<Dataset, 'id' | 'name' | 'color'>

export async function apiFetchDatasets(token: string): Promise<DatasetSummary[]> {
  return request<DatasetSummary[]>('/datasets', { token })
}

type DatasetStats = { min: number; max: number; categories: string[]; count: number }

export async function apiFetchDatasetStats(id: string, token: string): Promise<DatasetStats | undefined> {
  try {
    return await request<DatasetStats>(`/datasets/${id}/stats`, { token, retries: 1 })
  } catch {
    return undefined
  }
}

export type ServerDataset = {
  id: string
  name: string
  color: string
  type?: string
  data?: unknown[]
}

export async function apiFetchDataset(id: string, token: string): Promise<ServerDataset> {
  return request<ServerDataset>(`/datasets/${id}`, { token })
}

export async function apiCreateDataset(
  data: { name: string; color: string; data?: unknown[] },
  token: string,
): Promise<ServerDataset> {
  return request<ServerDataset>('/datasets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    token,
    retries: 0,
  })
}

export async function apiDeleteDataset(id: string, token: string): Promise<void> {
  await request<void>(`/datasets/${id}`, { method: 'DELETE', token, retries: 0 })
}

export async function apiExportDataset(
  id: string,
  format: 'geojson' | 'csv',
  token: string,
): Promise<Blob> {
  const res = await fetch(`${API_V1}/datasets/${id}/export?format=${format}`, {
    headers: getAuthHeaders(token),
  })
  if (!res.ok) throw new ApiError(res.status, await parseErrorMessage(res))
  return res.blob()
}

/** Build authenticated MVT tile URL template for MapLibre. */
export function apiTileUrlTemplate(
  datasetId: string,
  query: Record<string, string>,
): string {
  const params = new URLSearchParams(query)
  return `${API_V1}/datasets/${datasetId}/tiles/{z}/{x}/{y}.pbf?${params.toString()}`
}

// ── Workspaces ────────────────────────────────────────────────────────────────

export async function apiFetchWorkspaces(token: string): Promise<Workspace[]> {
  return request<Workspace[]>('/workspaces', { token })
}

export async function apiFetchWorkspace(id: string, token?: string | null): Promise<Workspace> {
  return request<Workspace>(`/workspaces/${id}`, { token })
}

export async function apiCreateWorkspace(
  data: { name: string; config: Record<string, unknown> },
  token: string,
): Promise<Workspace> {
  return request<Workspace>('/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    token,
    retries: 0,
  })
}

export async function apiToggleWorkspaceSharing(
  id: string,
  isPublic: boolean,
  token: string,
): Promise<void> {
  await request<void>(`/workspaces/${id}/share`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPublic }),
    token,
    retries: 0,
  })
}

// ── Spatial ───────────────────────────────────────────────────────────────────

export type SpatialResult = Dataset | { features: unknown[] }

export async function apiPerformSpatialTool(
  datasetId: string,
  config: SpatialToolConfig,
  token: string,
): Promise<SpatialResult> {
  const toolType = config.type || 'aggregation'
  return request<SpatialResult>(`/datasets/${datasetId}/spatial-tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...config,
      type: toolType,
      bufferRadius: config.bufferRadius ?? 5,
      clusterRadius: config.clusterRadius ?? 10,
      hullMaxEdge: config.hullMaxEdge ?? 10,
    }),
    token,
    retries: 0,
  })
}
