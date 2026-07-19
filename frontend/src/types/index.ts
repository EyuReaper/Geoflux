export type User = {
  id: string;
  email: string;
  name?: string;
};

export type AuthState = {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
};

export type Workspace = {
  id: string;
  name: string;
  config: Record<string, unknown>;
  isPublic: boolean;
  updatedAt: string;
};

export type VisualizationMode = 'markers' | 'heatmap' | 'choropleth' | 'area';

export type DataPoint = {
  id: string | number;
  datasetId: string;
  lat: number;
  lng: number;
  value?: number;
  category?: string;
  timestamp?: string | number | Date;
  metadata?: Record<string, unknown>;
};

export type Transformation = {
  id: string;
  name: string;
  expression: string; // e.g., "value * 1.5"
  targetField: string;
  active: boolean;
};

export type Dataset = {
  id: string;
  name: string;
  color: string;
  type?: 'points' | 'grid';
  isVisible: boolean;
  data: DataPoint[];
  // Metadata for stats when data is empty (MVT mode)
  stats?: {
    count: number;
    categories: string[];
    min: number;
    max: number;
  };
  aggregatedGeoJson?: GeoJSON.FeatureCollection; // For displaying spatial aggregations
};

export type SpatialToolType = 'aggregation' | 'buffer' | 'clustering' | 'convex_hull' | 'concave_hull' | 'voronoi';

export type SpatialToolConfig = {
  type?: SpatialToolType;
  sourceDatasetId: string | null;
  // Aggregation specific
  targetGridType: 'square' | 'hex';
  gridResolution: number;
  aggregationField: string | null;
  // Buffer specific
  bufferRadius?: number; // in km
  // Clustering specific
  clusterRadius?: number; // in km
  // Concave hull specific
  hullMaxEdge?: number; // in km
  
  isEnabled: boolean;
  persist?: boolean;
  customName?: string;
};

export type FilterState = {
  minValue: number;
  maxValue: number;
  categories: string[];
  searchQuery: string;
};

export type TimelineState = {
  currentTime: number;
  startTime: number;
  endTime: number;
  isPlaying: boolean;
  speed: number;
  loopMode: 'loop' | 'once' | 'ping-pong';
  direction: 1 | -1;
};

export type FieldMapping = {
  lat: string;
  lng: string;
  value: string;
  category: string;
  timestamp: string;
};

export type InspectorEntity = {
  type: 'point' | 'cell';
  data: DataPoint | Record<string, unknown>;
};

export type MapState = {
  lat: number;
  lng: number;
  zoom: number;
  pitch: number;
  bearing: number;
  bounds?: {
    sw: [number, number]; // [lng, lat]
    ne: [number, number];
  };
};

export type RegionFocus = {
  label: string;
  bounds: {
    sw: [number, number]; // [lng, lat]
    ne: [number, number];
  };
};

export type DataStats = {
  min: number;
  max: number;
  avg: number;
  count: number;
  total: number;
  categoryBreakdown: Record<string, number>;
};

export type MapStyle = {
  pointColor: string;
  pointSize: number;
  opacity: number;
  heatmapIntensity: number;
  heatmapRadius: number;
  colorScale: string[];
  is3D: boolean;
  extrusionScale: number;
  gridType: 'square' | 'hex';
  gridResolution: number;
};

export interface GeoFluxState {
  auth: AuthState
  datasets: Dataset[]
  activeDatasetId: string | null
  transformations: Transformation[]
  data: DataPoint[]
  filteredData: DataPoint[]
  viewportFilteredData: DataPoint[]
  rawData: Record<string, unknown>[]
  availableFields: string[]
  fieldMapping: FieldMapping
  isLoading: boolean
  error: string | null
  workspaces: Workspace[]
  comparisonDatasetIds: string[]
  activeModes: VisualizationMode[]
  isSidebarOpen: boolean
  isRightPanelOpen: boolean
  isInspectorOpen: boolean
  isLive: boolean
  selectedEntity: InspectorEntity | null
  mapState: MapState
  mapStyle: MapStyle
  mapStyleType: 'dark' | 'light'
  filters: FilterState
  timeline: TimelineState
  regionFocus: RegionFocus | null
  isRegionLoading: boolean
  regionError: string | null
  spatialAggregationConfig: SpatialToolConfig
  aggregatedDatasetId: string | null

  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name?: string) => Promise<void>
  logout: () => void
  fetchDatasets: () => Promise<void>
  addDataset: (name: string, rawData: Record<string, unknown>[]) => void
  removeDataset: (id: string) => void
  toggleDatasetVisibility: (id: string) => void
  setActiveDataset: (id: string | null) => void
  setViewportFilteredData: (data: DataPoint[]) => void
  exportDataset: (id: string, format: 'geojson' | 'csv' | 'shp') => Promise<void>
  addTransformation: (name: string, expression: string) => void
  removeTransformation: (id: string) => void
  toggleTransformation: (id: string) => void
  setData: (data: DataPoint[]) => void
  setRawData: (rawData: Record<string, unknown>[]) => void
  setFieldMapping: (mapping: Partial<FieldMapping>) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  applyMapping: () => void
  updateGlobalData: () => void
  toggleComparisonDataset: (id: string) => void
  fetchWorkspaces: () => Promise<void>
  loadWorkspace: (id: string) => Promise<void>
  saveWorkspace: (name: string) => Promise<void>
  toggleWorkspaceSharing: (id: string, isPublic: boolean) => Promise<void>
  setMapState: (state: Partial<MapState>) => void
  updateMapStyle: (style: Partial<MapStyle>) => void
  setMapStyleType: (type: 'dark' | 'light') => void
  setFilters: (filters: Partial<FilterState>) => void
  focusRegion: (query: string) => Promise<void>
  clearRegionFocus: () => void
  toggleMode: (mode: VisualizationMode) => void
  setTimeline: (timeline: Partial<TimelineState>) => void
  togglePlayback: () => void
  tickTimeline: () => void
  stepTimeline: (steps: number) => void
  setSpatialAggregationConfig: (config: Partial<SpatialToolConfig>) => void
  performSpatialAggregation: () => Promise<void>
  clearSpatialAggregation: () => void
  toggleSidebar: () => void
  toggleRightPanel: () => void
  toggleLive: () => void
  setSelectedEntity: (entity: InspectorEntity | null) => void
  closeInspector: () => void
  getShareableUrl: () => string
  applySnapshot: (encoded: string) => void
  updateDataPoints: () => void
  reset: () => void
}
