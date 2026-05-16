# GeoFlux Release Checklist

Date: 2026-05-16  
Candidate: `rc-2026-05-16` on branch `rc/2026-05-16-baseline`

## Gate Status

- Backend TypeScript build: PASS
- Frontend TypeScript/production build: PASS
- Frontend lint: PASS
- Frontend tests: PASS (2 files, 9 tests)
- Backend runtime startup: FAIL (Prisma provider mismatch at initialization)

## Performance Hardening (Small Pass)

- PASS: Map route lazy-loaded with `React.lazy`/`Suspense`
- PASS: Vite manual chunk strategy refined for `react-core`, `state-realtime`, `ui-utils`, `leaflet`, `maplibre`
- NOTE: `maplibre` chunk remains >500k minified (expected for map engine)

## Release Blockers

- Prisma runtime provider mismatch:
  - Error class: `PrismaClientInitializationError`
  - Symptom: adapter `@prisma/adapter-pg` incompatible with runtime provider `sqlite`
  - Impact: backend does not boot in runtime smoke check
  - Priority: P0 (release blocking)

## Pre-Release Completion Criteria

- Resolve Prisma provider mismatch and confirm backend boots.
- Verify `GET /health` responds with `200`.
- Re-run full gate:
  - `backend`: `npm run build`
  - `frontend`: `npm run lint`, `npm run test`, `npm run build`

## Decision

- Current release state: NO-GO until backend runtime blocker is fixed.
