# GeoFlux Developer Guide

GeoFlux is a high-performance, real-time spatial data visualization and analysis platform. This guide provides a deep dive into the architecture, file structure, and workflows for developers.

---

## 1. System Architecture

GeoFlux follows a decoupled **Frontend-Backend-Cache-Database** architecture:

- **Frontend:** React 19 + Vite 7.x + Zustand 5 + MapLibre GL.
- **Backend:** Node.js (Express) + Prisma ORM.
- **Database:** PostgreSQL with **PostGIS** extension for spatial queries.
- **Cache:** Redis for MVT tile caching and cross-instance invalidation.

### Data Flow (MVT)
1. Frontend requests a tile: `/datasets/:id/tiles/:z/:x/:y.pbf`.
2. Backend checks **Redis** for a cached buffer.
3. On miss, Backend executes `ST_AsMVT` in **PostgreSQL** using GIST indices.
4. Resulting Protocol Buffer (PBF) is cached in Redis and sent to the Frontend.

---

## 2. Directory Walkthrough

### Backend (`/backend`)
- `src/index.ts`: The entry point. Handles routing, Auth middleware, and Socket.io setup.
- `src/utils/redis.ts`: Redis client configuration and cache key management.
- `src/utils/cleanup.ts`: Background maintenance worker (purges stale data).
- `src/utils/validation.ts`: Zod schemas for strict API request validation.
- `prisma/schema.prisma`: The source of truth for the database schema, including PostGIS geometry types.
- `scripts/smoke-runtime.mjs`: A lightweight health check for CI/CD.
- `scripts/load-test.js`: k6 script for stress-testing the tile server (root `scripts/`).

### Frontend (`/frontend`)
- `src/store/useStore.ts`: Global state management (Zustand). Handles data fetching, UI state, and map configurations.
- `src/components/Map.tsx`: Core MapLibre component. Manages layers, sources, and real-time GeoJSON updates.
- `src/components/Sidebar.tsx`: Data ingestion (CSV/JSON) and field mapping UI.
- `src/components/Transformations.tsx`: Logic for user-defined JS expressions to transform data values on the fly.
- `src/components/SpatialAnalysis.tsx`: UI for triggering Buffers, Hulls, and Aggregations.
- `src/lib/utils.ts`: Utility for Tailwind class merging (`cn`).

---

## 3. Core Use Cases & Examples

### Use Case 1: High-Volume Point Visualization
**Scenario:** Visualizing 1 million GPS pings.
- **How it works:** Data is uploaded via `POST /datasets`. The backend converts coordinates into PostGIS geometries (using parameterized batch inserts or PostgreSQL COPY for large loads). The frontend uses the `MVT` source in MapLibre for seamless 60fps panning.

### Rendering Paths
GeoFlux supports two rendering paths to balance simplicity and scale:

| Path | When Used | Data Source | Filter Location | Scale |
|------|-----------|-------------|-----------------|-------|
| **Client GeoJSON** | Unauthenticated uploads, in-memory spatial tool results | Frontend `ds.data[]` | MapLibre `setFilter` | Small (<10k points) |
| **Server MVT** | Authenticated API datasets | PostGIS via `ST_AsMVT` | SQL `WHERE` clauses | Large (millions) |

Filter state (value range, categories, search, timeline) is shared between both paths to prevent visual divergence. The tile URL includes all active filters as query parameters so the server applies them in SQL.

### Use Case 2: Spatial Aggregation (H3/Grid)
**Scenario:** Summarizing crime data into hexagonal heatmaps.
- **How it works:** Users select "Aggregation" in the Spatial Analysis panel. The backend uses the `h3-js` library (for hex) or square-binning logic to count points per cell and generates a new Polygon dataset.

### Use Case 3: Real-time Live Stream
**Scenario:** Monitoring moving vehicles in real-time.
- **How it works:** Enable "Live Mode". The backend emits `live-data` events via Socket.io. The `Map.tsx` component updates the GeoJSON source in-memory for zero-latency movement.

---

## 4. Testing Functionality

### API Testing (Manual)
You can use `curl` or Postman to verify the backend:

```bash
# Register a user
curl -X POST http://localhost:4000/register \
     -H "Content-Type: application/json" \
     -d '{"email":"dev@geoflux.com", "password":"password123", "name":"Dev User"}'

# Perform a Buffer Analysis
curl -X POST http://localhost:4000/datasets/:id/spatial-tool \
     -H "Authorization: Bearer <token>" \
     -d '{"type":"buffer", "bufferRadius": 5, "persist": true}'
```

### Automated Testing
```bash
# Backend unit/integration tests
cd backend && npm run test

# Frontend component tests
cd frontend && npm run test

# Load Testing (Requires k6)
k6 run scripts/load-test.js
```

---

## 5. Deployment Checklist

1. **Database:** Ensure PostGIS is enabled (`CREATE EXTENSION postgis;`).
2. **Environment:** Set `DATABASE_URL`, `REDIS_URL`, and `JWT_SECRET`.
3. **Build:** Run `npm run build` in both directories.
4. **Proxy:** Use the provided `nginx.conf` for SSL and asset delivery.
5. **Migrations:** Run `npx prisma migrate deploy` in the production environment.

---

## 6. Maintenance
The system is self-healing. The `startMaintenanceWorker` in `backend/src/utils/cleanup.ts` will:
- Purge datasets with no features older than 24 hours.
- Fix/delete invalid geometries using `ST_IsValid`.
- Log system memory snapshots for observability.
