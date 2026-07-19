import { create } from 'zustand'
import type { GeoFluxState } from '../types/index'
import { createAuthSlice, type AuthSlice } from './slices/authSlice.ts'
import { createDatasetSlice, type DatasetSlice } from './slices/datasetSlice.ts'
import { createWorkspaceSlice, type WorkspaceSlice } from './slices/workspaceSlice.ts'
import { createMapSlice, type MapSlice } from './slices/mapSlice.ts'
import { createTimelineSlice, type TimelineSlice } from './slices/timelineSlice.ts'
import { createSpatialSlice, type SpatialSlice } from './slices/spatialSlice.ts'
import { createUiSlice, type UiSlice } from './slices/uiSlice.ts'

export type { AuthSlice, DatasetSlice, WorkspaceSlice, MapSlice, TimelineSlice, SpatialSlice, UiSlice }

export { LOCAL_DATASET_PREFIX, isLocalDatasetId } from './slices/helpers.ts'
export { API_URL } from '../lib/api.ts'

export type GeoFluxStore = AuthSlice & DatasetSlice & WorkspaceSlice & MapSlice & TimelineSlice & SpatialSlice & UiSlice

const initialState = {
  auth: { user: null, token: null, isAuthenticated: false },
  datasets: [],
  activeDatasetId: null,
  transformations: [],
  data: [],
  filteredData: [],
  viewportFilteredData: [],
  rawData: [],
  availableFields: [],
  fieldMapping: { lat: '', lng: '', value: '', category: '', timestamp: '' },
  isLoading: false,
  error: null,
  workspaces: [],
  comparisonDatasetIds: [],
  activeModes: ['markers'],
  isSidebarOpen: true,
  isRightPanelOpen: true,
  isInspectorOpen: false,
  isLive: false,
  selectedEntity: null,
  mapState: { lat: 20, lng: 0, zoom: 2, pitch: 0, bearing: 0 },
  mapStyle: {
    pointColor: '#06b6d4',
    pointSize: 5,
    opacity: 0.8,
    heatmapIntensity: 1,
    heatmapRadius: 30,
    colorScale: ['#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'],
    is3D: true,
    extrusionScale: 50,
    gridType: 'hex' as const,
    gridResolution: 4,
  },
  mapStyleType: 'dark' as const,
  filters: { minValue: 0, maxValue: 100, categories: [] as string[], searchQuery: '' },
  timeline: {
    currentTime: 0,
    startTime: 0,
    endTime: 100,
    isPlaying: false,
    speed: 1,
    loopMode: 'loop' as const,
    direction: 1 as const,
  },
  regionFocus: null,
  isRegionLoading: false,
  regionError: null,
  spatialAggregationConfig: {
    type: 'aggregation' as const,
    sourceDatasetId: null,
    targetGridType: 'hex' as const,
    gridResolution: 4,
    aggregationField: null,
    bufferRadius: 5,
    clusterRadius: 10,
    hullMaxEdge: 10,
    isEnabled: false,
    persist: false,
    customName: '',
  },
  aggregatedDatasetId: null,
} satisfies Partial<GeoFluxState>

export const useStore = create<GeoFluxState>()((set, get) => ({
  ...initialState,
  ...createAuthSlice(set as never, get as never),
  ...createDatasetSlice(set as never, get as never),
  ...createWorkspaceSlice(set as never, get as never),
  ...createMapSlice(set as never, get as never),
  ...createTimelineSlice(set as never, get as never),
  ...createSpatialSlice(set as never, get as never),
  ...createUiSlice(set as never, get as never),

  reset: () => {
    localStorage.removeItem('geoflux_token')
    set({
      ...initialState,
      auth: { user: null, token: null, isAuthenticated: false },
    })
  },
}))
