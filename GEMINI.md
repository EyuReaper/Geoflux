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

## Next Steps
1. **Data Persistence:** Implement API endpoints (`POST /datasets`, `GET /datasets`) to move from in-memory to database storage.
2. **Backend/Frontend Handshake:** Replace the `loadDemoData` mock in the frontend with real API calls to the backend.
3. **Real-time Engine:** Implement WebSockets (Socket.io) to replace the frontend "simulation" with real-time server-side data feeds.
4. **Tiled Visualization:** Develop a vector tile server (MVT) on the backend to support datasets with millions of points.
5. **Authentication:** Add secure user management to allow users to save and share their visualization workspaces.

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
