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

export type MapState = {
  lat: number;
  lng: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

export type MapStyle = {
  pointColor: string;
  pointSize: number;
  opacity: number;
  heatmapIntensity: number;
  heatmapRadius: number;
  colorScale: string[];
  is3D: boolean;
};
