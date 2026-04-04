export type VisualizationMode = 'markers' | 'heatmap' | 'choropleth';

export type DataPoint = {
  id: string | number;
  lat: number;
  lng: number;
  value?: number;
  category?: string;
  timestamp?: string | number | Date;
  metadata?: Record<string, unknown>;
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
};

export type FieldMapping = {
  lat: string;
  lng: string;
  value: string;
  category: string;
  timestamp: string;
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
