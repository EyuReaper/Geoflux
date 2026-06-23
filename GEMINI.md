# GeoFlux Project Overview

GeoFlux is a high-performance, real-time global data visualization and analysis platform. It enables users to ingest large datasets (CSV/JSON), map them to geographical coordinates, and explore patterns through various advanced visualization modes.

## Technologies
- **Frontend Framework:** React 19 (TypeScript)
- **Build Tool:** Vite 8
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
1. **Spatial Data Export:** Enable users to export query results, filtered sub-selections, and spatial analysis outputs (buffers, grids, clusters) in standard formats (GeoJSON, CSV, or Shapefile zip).
2. **Advanced Style Manager & Legend Customization:** Provide granular control over point colors, sizes, opacities, and scale legends per-layer instead of applying settings globally.
3. **Sliding-Window Temporal Analysis:** Update timeline animations from cumulative filters (`timestamp <= currentTime`) to sliding time ranges (e.g., `currentTime - windowDuration <= timestamp <= currentTime`) to track propagation and transient clusters.

## Implementation Guide for Next Steps

### 1. Spatial Data Export
* **Goal:** Allow users to download GeoFlux datasets directly from the UI.
* **Proposed Solution:**
  * **Backend:** Add a `GET /datasets/:id/export` route in [index.ts](file:///mnt/Altair/Eyus/work/Geoflux/backend/src/index.ts) that fetches features via Prisma, parses them, and returns them as formatted GeoJSON or CSV. For Shapefiles, integrate a library like `shp-write` or process it on the server.
  * **Frontend:** Add an export button/action in the dataset list or [Sidebar.tsx](file:///mnt/Altair/Eyus/work/Geoflux/frontend/src/components/Sidebar.tsx) / [Inspector.tsx](file:///mnt/Altair/Eyus/work/Geoflux/frontend/src/components/Inspector.tsx). Trigger requests or generate the GeoJSON/CSV download client-side in [useStore.ts](file:///mnt/Altair/Eyus/work/Geoflux/frontend/src/store/useStore.ts).

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


