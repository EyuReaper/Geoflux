
# GeoFlux Operational Runbook

This repository contains:
- `frontend/`: React + Vite + TypeScript UI
- `backend/`: Express + TypeScript API with Prisma/PostgreSQL (PostGIS)

## Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 14+ with PostGIS extension available
- Redis 6+ (for distributed caching)

## 1) Backend Setup

1. Install dependencies:
```bash
cd backend
npm install
```

2. Create `backend/.env`:
```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="replace-with-a-long-random-secret"
PORT=4000
```

3. Apply database migrations:
```bash
npx prisma migrate deploy
```

4. (Optional) Regenerate Prisma client:
```bash
npx prisma generate
```

5. Start backend in development mode:
```bash
npm run dev
```

Health check:
```bash
curl http://localhost:4000/health
```

## 2) Frontend Setup

1. Install dependencies:
```bash
cd frontend
npm install
```

2. Start frontend:
```bash
npm run dev
```

Default UI URL: `http://localhost:5173`

The frontend uses `VITE_API_URL` env var for the API base URL (defaults to `http://localhost:4000`).

## 3) Build and Test

Backend:
```bash
cd backend
npm run build
```

Frontend:
```bash
cd frontend
npm run test
npm run build
```

## 4) Production Start (Backend)

```bash
cd backend
npm run build
npm run start
```

## 5) Known Current Blockers

As of May 16, 2026:
- Build/test/lint gates are passing for backend and frontend.
- Runtime smoke check is passing (`backend` boots and `/health` returns `200`).

No active release blocker at this stage.

## 6) Suggested Release Gate

Ship only when all are green:
- `backend`: `npm run build`
- `frontend`: `npm run lint`, `npm run test`, and `npm run build`
- `backend`: runtime smoke (`npm run dev` boot + `/health` response)
- DB migrations applied successfully in target environment
