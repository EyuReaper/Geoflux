import { create } from 'zustand'
import type { VisualizationMode, DataPoint, MapState, MapStyle } from '../types/index'

interface GeoFluxState {
  // Data
  data: DataPoint[]
  isLoading: boolean
  error: string | null
  
  // UI State
  mode: VisualizationMode
  isSidebarOpen: boolean
  isRightPanelOpen: boolean
  isLive: boolean
  
  // Map Config
  mapState: MapState
  mapStyle: MapStyle
  mapStyleType: 'dark' | 'light'
  
  // Actions
  setData: (data: DataPoint[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setMode: (mode: VisualizationMode) => void
  setMapState: (state: Partial<MapState>) => void
  updateMapStyle: (style: Partial<MapStyle>) => void
  setMapStyleType: (type: 'dark' | 'light') => void
  toggleSidebar: () => void
  toggleRightPanel: () => void
  toggleLive: () => void
  loadDemoData: () => void
  updateDataPoints: () => void
}

export const useStore = create<GeoFluxState>((set) => ({
  data: [],
  isLoading: false,
  error: null,
  mode: 'markers',
  isSidebarOpen: true,
  isRightPanelOpen: true,
  isLive: false,
  
  mapState: {
    lat: 20,
    lng: 0,
    zoom: 2,
    pitch: 0,
    bearing: 0,
  },
  
  mapStyle: {
    pointColor: '#06b6d4', 
    pointSize: 5,
    opacity: 0.8,
    heatmapIntensity: 1,
    heatmapRadius: 30,
    colorScale: ['#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'],
  },
  mapStyleType: 'dark',
  
  setData: (data) => set({ data, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  setMode: (mode) => set({ mode }),
  setMapState: (state) => set((prev) => ({ 
    mapState: { ...prev.mapState, ...state } 
  })),
  updateMapStyle: (style) => set((prev) => ({ 
    mapStyle: { ...prev.mapStyle, ...style } 
  })),
  setMapStyleType: (mapStyleType) => set({ mapStyleType }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  toggleRightPanel: () => set((state) => ({ isRightPanelOpen: !state.isRightPanelOpen })),
  toggleLive: () => set((state) => ({ isLive: !state.isLive })),
  
  updateDataPoints: () => set((state) => ({
    data: state.data.map(d => ({
      ...d,
      value: Math.max(0, Math.min(100, (d.value || 0) + (Math.random() - 0.5) * 10))
    }))
  })),
  
  loadDemoData: () => {
    const demoPoints: DataPoint[] = Array.from({ length: 1000 }).map((_, i) => ({
      id: i,
      lat: (Math.random() - 0.5) * 140,
      lng: (Math.random() - 0.5) * 360,
      value: Math.random() * 100,
      category: ['A', 'B', 'C'][Math.floor(Math.random() * 3)],
      metadata: { city: 'Demo City ' + i }
    }))
    set({ data: demoPoints, mode: 'markers' })
  }
}))
