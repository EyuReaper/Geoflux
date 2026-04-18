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
  config: Record<string, any>;
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
  isVisible: boolean;
  data: DataPoint[];
  // Metadata for stats when data is empty (MVT mode)
  stats?: {
    count: number;
    categories: string[];
    min: number;
    max: number;
  };
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
  gridType: 'square' | 'hex';
  gridResolution: number;
};
