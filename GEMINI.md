# GeoFlux Project Overview

GeoFlux is a high-performance, real-time global data visualization and analysis platform. It enables users to ingest large datasets (CSV/JSON), map them to geographical coordinates, and explore patterns through various advanced visualization modes.

## Technologies
- **Frontend Framework:** React 19 (TypeScript)
- **Build Tool:** Vite 7.x
- **Styling:** Tailwind CSS v4 (with `@tailwindcss/postcss`)
- **Map Engine:** MapLibre GL
- **State Management:** Zustand 5
- **Data Parsing:** PapaParse
- **Icons:** Lucide React

## Technologies - Backend
- **Runtime:** Node.js (TypeScript)
- **Framework:** Express
- **ORM:** Prisma
- **Database:** PostgreSQL (PostGIS recommended for spatial analysis)
- **Cache:** Redis (for distributed tile caching and consistency)
- **Validation:** Zod

## Architecture
The application follows a modular architecture:
- `frontend/src/`: React frontend.
- `backend/src/`: Express server logic.
- `backend/prisma/`: Database schema and migrations.

### Core Features
1. **Visualization Modes:**
   - **Markers:** High-performance circle markers.
   - **Heatmap:** Density-based visualization.
   - **Area (Grid):** Aggregated grid-based visualization with support for **3D Extrusion**.
2. **Smart Filtering:** Reactive filtering by metadata search, value ranges, and categorical toggles.
3. **Temporal Analysis:** Integrated Timeline and Playback system for animating data over time.
4. **Data Ingestion:** Intelligent CSV/JSON upload with **Advanced Field Mapping** for custom schemas.
5. **Real-time Simulation:** "Live Stream" mode for simulating dynamic data updates.

## Building and Running

### Prerequisites
- Node.js (Latest LTS recommended)
- PostgreSQL (Running instance for backend)
- npm or yarn

### Frontend Development
```bash
cd frontend
npm install
npm run dev
```

### Backend Development
```bash
cd backend
npm install
# Update .env with your DATABASE_URL
npx prisma migrate dev
npm run dev
```


## Development Conventions

### State Management
- Use the Zustand store (`useStore`) for global application state.
- Prefer accessing actions directly from the hook rather than using `useStore.getState()` within components to ensure reactive updates.

### Map Implementation
- The `Map.tsx` component manages the MapLibre instance.
- Layer updates are handled via `useCallback` and `useEffect` to ensure efficiency.
- Always check for the existence of sources (`mapInstance.getSource`) before adding layers.
- Data updates should use `GeoJSONSource.setData` for performance.

### Styling
- Use Tailwind CSS v4 utility classes.
- Follow the established dark-mode aesthetic (primary background: `#0a0a0a`).
- Use the `cn` utility (`src/lib/utils.ts`) for conditional class merging.

### Types
- Maintain strict type safety.
- Define new data structures in `src/types/index.ts`.
- Avoid using `any`; prefer `unknown` or specific interfaces for metadata.

## Next Steps
2. **Advanced Style Manager & Legend Customization:** Provide granular control over point colors, sizes, opacities, and scale legends per-layer instead of applying settings globally.
3. **Sliding-Window Temporal Analysis:** Update timeline animations from cumulative filters (`timestamp <= currentTime`) to sliding time ranges (e.g., `currentTime - windowDuration <= timestamp <= currentTime`) to track propagation and transient clusters.

## Implementation Guide for Next Steps


### 2. Advanced Style Manager & Legend Customization
* **Goal:** Enable discrete layer styling (e.g., coloring datasets differently based on categorization).
* **Proposed Solution:**
  * **Frontend Store:** Update `Dataset` type in [index.ts (types)](file:///mnt/Altair/Eyus/work/Geoflux/frontend/src/types/index.ts) to hold a dedicated `style` object. Update the state store in [useStore.ts](file:///mnt/Altair/Eyus/work/Geoflux/frontend/src/store/useStore.ts) with actions like `updateDatasetStyle(id, style)`.
  * **Frontend UI:** Add a dataset style customizer interface within [RightPanel.tsx](file:///mnt/Altair/Eyus/work/Geoflux/frontend/src/components/RightPanel.tsx) or a popup modal, utilizing dynamic color pickers.
  * **Map Engine:** Update the layer instantiation logic in [Map.tsx](file:///mnt/Altair/Eyus/work/Geoflux/frontend/src/components/Map.tsx) to map individual layer parameters to the specific dataset style stored in Zustand instead of the global `mapStyle` settings.

### 3. Sliding-Window Temporal Analysis
* **Goal:** Animate historical intervals rather than cumulative data.
* **Proposed Solution:**
  * **Frontend Store:** Add `windowDuration` and `timeWindowEnabled` properties to `TimelineState` inside [index.ts (types)](file:///mnt/Altair/Eyus/work/Geoflux/frontend/src/types/index.ts). Modify the filter logic in `setFilters` inside [useStore.ts](file:///mnt/Altair/Eyus/work/Geoflux/frontend/src/store/useStore.ts#L792-L827) to apply the range when temporal filtering is active.
  * **Map Engine:** Update layer filters inside [Map.tsx](file:///mnt/Altair/Eyus/work/Geoflux/frontend/src/components/Map.tsx#L223-L228) so MapLibre GL evaluates both lower and upper temporal bounds dynamically.
  * **Frontend UI:** Integrate a window slider/toggle controls in [Timeline.tsx](file:///mnt/Altair/Eyus/work/Geoflux/frontend/src/components/Timeline.tsx) to adjust the temporal window size dynamically.

---

## Improvement Points (Grok review — 2026-07-15)

Review based on current codebase: Express monolith (`backend/src/index.ts` ~944 LOC), Zustand store (`frontend/src/store/useStore.ts` ~1137 LOC), PostGIS MVT tiles, Redis cache, Docker/CI, and existing Next Steps (style manager, sliding-window timeline).





### P3 — Product & UX (beyond existing Next Steps) ✅

21. **Keep planned work** — per-dataset style/legend manager; sliding-window temporal analysis—both remain high value.

22. **Workspace as source of truth** ✅  
    Workspace save/load expanded: now captures filters, timeline, mapStyleType, regionFocus, datasetIds. Snapshot (deep-link) expanded with mapStyle, timeline, regionFocus. Conflict detection added when datasets are deleted.

23. **Auth UX & session lifecycle** ✅  
    Added refresh token rotation (15m access + 7d refresh), logout-all (token versioning), password reset (email with 1h expiry), email verification, change password, /me endpoint. Frontend stores refresh token and supports auto-refresh.

24. **Observability** ✅  
    Added request IDs (X-Request-Id) end-to-end, structured error codes (AppError + ErrorCodes enum), Prometheus metrics (HTTP latency/throughput, tile latency, tile cache hit ratio, DB query duration, ingest duration) at GET /metrics, and structured error handler with request ID propagation.

25. **Accessibility & map chrome** ✅  
    Added keyboard controls to timeline (arrow keys step, space plays/pauses), useFocusTrap hook for modals (AuthModal), useReducedMotion hook, ARIA labels on all panels/sidebar/map/navbar/timeline, reduced-motion CSS reset (@media prefers-reduced-motion: reduce), role and aria-* attributes throughout.

### Suggested priority order (practical)

| Phase | Items | Outcome |
|-------|-------|---------|
| Hotfix | ~~1–4, 7~~ | Bootable, securable deploy |
| Hardening | ~~5–6, 11, 26~~ | Safer eval surface, consistent authz, CI confidence |
| Structure | ~~8–10, 12–14~~ ✅ | Faster feature work without regressions |
| Scale | ~~15–20~~ ✅ | Real datasets without OOM/429s |
| Product | 21–25, 27–30 | Differentiated UX + operational maturity |

### Design principles to adopt going forward

- **One rendering path for hosted data** (MVT + filters server-side); client GeoJSON only for ephemeral local preview.  
- **Fail closed on secrets and ownership** (no silent fallbacks, no public private tiles).  
- **Bound every user-influenced SQL fragment**; never concatenate untrusted strings into SQL.  
- **Keep hot paths (tiles, ingest) measurable** before optimizing further.  
- **Thin routes, fat typed services**; UI state sliced by domain.

*Reviewer note: Strengths worth preserving—PostGIS GIST + ST_AsMVT, Redis tile cache + pub/sub eviction, Zod validation, rate limits, helmet, health with dependency probes, workspace sharing concept, and solid map UX foundations. Improvements above aim to turn a strong prototype into a production multi-tenant spatial platform.*
