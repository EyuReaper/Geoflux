import * as h3 from "h3-js";

export const getH3ResolutionForZoom = (zoom: number) => {
  // Map MapLibre zoom levels (0-22) to H3 resolutions (0-15)
  // This is a heuristic mapping, adjust as needed.
  if (zoom < 2) return 0;
  if (zoom < 4) return 1;
  if (zoom < 6) return 2;
  if (zoom < 8) return 3;
  if (zoom < 10) return 4;
  if (zoom < 12) return 5;
  if (zoom < 14) return 6;
  if (zoom < 16) return 7;
  if (zoom < 18) return 8;
  return 9; // Max H3 res for general display
};

export const getHexagonBoundary = (h3Index: string): [number, number][] => {
  return h3.cellToBoundary(h3Index, true); // GeoJson-like polygon
};

export const getHexagonCenter = (h3Index: string): [number, number] => {
  return h3.cellToLatLng(h3Index); // [lat, lng]
};
