import { create } from 'zustand'
import type { VisualizationMode, DataPoint, MapState, MapStyle, FilterState } from '../types/index'

interface GeoFluxState {
  // Data
  data: DataPoint[]
  filteredData: DataPoint[]
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
  filters: FilterState
  
  // Actions
  setData: (data: DataPoint[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setMode: (mode: VisualizationMode) => void
  setMapState: (state: Partial<MapState>) => void
  updateMapStyle: (style: Partial<MapStyle>) => void
  setMapStyleType: (type: 'dark' | 'light') => void
  setFilters: (filters: Partial<FilterState>) => void
  toggleSidebar: () => void
  toggleRightPanel: () => void
  toggleLive: () => void
  loadDemoData: () => void
  updateDataPoints: () => void
}

export const useStore = create<GeoFluxState>((set, get) => ({
  data: [],
  filteredData: [],
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
    is3D: true,
  },
  mapStyleType: 'dark',
  
  filters: {
    minValue: 0,
    maxValue: 100,
    categories: [],
    searchQuery: '',
  },
  
  setData: (data) => {
    set({ data, isLoading: false })
    get().setFilters({}) // Trigger filtering
  },
  
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
  
  setFilters: (newFilters) => {
    const state = get()
    const filters = { ...state.filters, ...newFilters }
    
    const filteredData = state.data.filter(d => {
      const val = d.value || 0
      const matchesValue = val >= filters.minValue && val <= filters.maxValue
      const matchesCategory = filters.categories.length === 0 || (d.category && filters.categories.includes(d.category))
      const matchesSearch = !filters.searchQuery || 
        JSON.stringify(d.metadata || {}).toLowerCase().includes(filters.searchQuery.toLowerCase())
      
      return matchesValue && matchesCategory && matchesSearch
    })
    
    set({ filters, filteredData })
  },
  
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  toggleRightPanel: () => set((state) => ({ isRightPanelOpen: !state.isRightPanelOpen })),
  toggleLive: () => set((state) => ({ isLive: !state.isLive })),
  
  updateDataPoints: () => {
    const state = get()
    const newData = state.data.map(d => ({
      ...d,
      value: Math.max(0, Math.min(100, (d.value || 0) + (Math.random() - 0.5) * 10))
    }))
    set({ data: newData })
    state.setFilters({}) // Re-apply filters to new data
  },
  
  loadDemoData: () => {
    const demoPoints: DataPoint[] = Array.from({ length: 1000 }).map((_, i) => ({
      id: i,
      lat: (Math.random() - 0.5) * 140,
      lng: (Math.random() - 0.5) * 360,
      value: Math.random() * 100,
      category: ['A', 'B', 'C'][Math.floor(Math.random() * 3)],
      metadata: { city: 'Demo City ' + i }
    }))
    const { setData } = get()
    setData(demoPoints)
    set({ mode: 'markers' })
  }
}))
