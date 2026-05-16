# GeoFlux Operational Runbook

This repository contains:
- `frontend/`: React + Vite + TypeScript UI
- `backend/`: Express + TypeScript API with Prisma/PostgreSQL (PostGIS)

## Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 14+ with PostGIS extension available

## 1) Backend Setup

1. Install dependencies:
```bash
cd backend
npm install
```

2. Create `backend/.env`:
```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public"
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

Note: frontend currently uses `http://localhost:4000` as API base URL in source code.

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
- Backend TypeScript build fails due to typing issues in `backend/src/index.ts`
- Frontend TypeScript build fails due to store/type drift (for example `loadDemoData` and `targetGridType`)

These should be fixed before release cut.

## 6) Suggested Release Gate

Ship only when all are green:
- `backend`: `npm run build`
- `frontend`: `npm run test` and `npm run build`
- DB migrations applied successfully in target environment
