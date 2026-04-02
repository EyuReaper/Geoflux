import { create } from 'zustand'
import type { VisualizationMode, DataPoint, MapState, MapStyle, FilterState, TimelineState, FieldMapping } from '../types/index'

interface GeoFluxState {
  // Data
  data: DataPoint[]
  filteredData: DataPoint[]
  viewportFilteredData: DataPoint[]
  rawData: Record<string, unknown>[]
  availableFields: string[]
  fieldMapping: FieldMapping
  isLoading: boolean
  error: string | null
  
  // UI State
  activeModes: VisualizationMode[]
  isSidebarOpen: boolean
  isRightPanelOpen: boolean
  isLive: boolean
  
  // Map Config
  mapState: MapState
  mapStyle: MapStyle
  mapStyleType: 'dark' | 'light'
  filters: FilterState
  timeline: TimelineState
  
  // Actions
  setData: (data: DataPoint[]) => void
  setRawData: (rawData: Record<string, unknown>[]) => void
  setFieldMapping: (mapping: Partial<FieldMapping>) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  toggleMode: (mode: VisualizationMode) => void
  setMapState: (state: Partial<MapState>) => void
  updateMapStyle: (style: Partial<MapStyle>) => void
  setMapStyleType: (type: 'dark' | 'light') => void
  setFilters: (filters: Partial<FilterState>) => void
  setTimeline: (timeline: Partial<TimelineState>) => void
  toggleSidebar: () => void
  toggleRightPanel: () => void
  toggleLive: () => void
  togglePlayback: () => void
  loadDemoData: () => void
  updateDataPoints: () => void
  tickTimeline: () => void
  applyMapping: () => void
}

const defaultMapping: FieldMapping = {
  lat: '',
  lng: '',
  value: '',
  category: '',
  timestamp: ''
}

export const useStore = create<GeoFluxState>((set, get) => ({
  data: [],
  filteredData: [],
  viewportFilteredData: [],
  rawData: [],
  availableFields: [],
  fieldMapping: defaultMapping,
  isLoading: false,
  error: null,
  activeModes: ['markers'],
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

  timeline: {
    currentTime: 0,
    startTime: 0,
    endTime: 100,
    isPlaying: false,
    speed: 1,
  },
  
  setRawData: (rawData) => {
    if (rawData.length === 0) {
      set({ rawData: [], availableFields: [], fieldMapping: defaultMapping })
      return
    }
    
    const fields = Object.keys(rawData[0])
    
    // Auto-detect fields only if current mapping is empty or default
    const currentMapping = get().fieldMapping
    const isDefault = currentMapping.lat === '' && currentMapping.lng === ''
    
    if (isDefault) {
      const mapping: FieldMapping = {
        lat: fields.find(f => /lat|latitude/i.test(f)) || fields[0] || '',
        lng: fields.find(f => /lng|long|longitude/i.test(f)) || fields[1] || '',
        value: fields.find(f => /val|count|intensity|mag|amount/i.test(f)) || '',
        category: fields.find(f => /cat|type|class|group/i.test(f)) || '',
        timestamp: fields.find(f => /time|date|recorded/i.test(f)) || ''
      }
      set({ fieldMapping: mapping })
    }
    
    set({ rawData, availableFields: fields })
    get().applyMapping()
  },

  setFieldMapping: (newMapping) => {
    set((state) => ({ fieldMapping: { ...state.fieldMapping, ...newMapping } }))
    get().applyMapping()
  },

  applyMapping: () => {
    const { rawData, fieldMapping } = get()
    if (rawData.length === 0) return

    const mappedData: DataPoint[] = rawData.map((d, i) => ({
      id: i,
      lat: Number(d[fieldMapping.lat] || 0),
      lng: Number(d[fieldMapping.lng] || 0),
      value: fieldMapping.value ? Number(d[fieldMapping.value] || 0) : 1,
      category: fieldMapping.category ? String(d[fieldMapping.category]) : 'default',
      timestamp: fieldMapping.timestamp ? d[fieldMapping.timestamp] : undefined,
      metadata: d
    }))

    get().setData(mappedData)
  },

  setData: (data) => {
    const times = data.map(d => typeof d.timestamp === 'number' ? d.timestamp : new Date(d.timestamp || 0).getTime()).filter(t => t > 0)
    
    if (times.length > 0) {
      const min = Math.min(...times)
      const max = Math.max(...times)
      set({ 
        data, 
        isLoading: false,
        timeline: { ...get().timeline, startTime: min, endTime: max, currentTime: max }
      })
    } else {
      set({ data, isLoading: false, timeline: { ...get().timeline, startTime: 0, endTime: 0, currentTime: 0 } })
    }
    
    // Initial filter will populate filteredData and viewportFilteredData
    get().setFilters({}) 
  },
  
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  toggleMode: (mode) => set((state) => ({
    activeModes: state.activeModes.includes(mode)
      ? state.activeModes.filter(m => m !== mode)
      : [...state.activeModes, mode]
  })),
  setMapState: (state) => {
    set((prev) => ({ 
      mapState: { ...prev.mapState, ...state } 
    }))
    
    // Filter by bounds if they changed or exist
    const { mapState, filteredData } = get()
    if (!mapState.bounds) {
      set({ viewportFilteredData: filteredData })
      return
    }

    const { sw, ne } = mapState.bounds
    const viewportFilteredData = filteredData.filter(d => 
      d.lng >= sw[0] && d.lng <= ne[0] && d.lat >= sw[1] && d.lat <= ne[1]
    )
    set({ viewportFilteredData })
  },
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
      
      let matchesTime = true
      if (state.timeline.startTime !== state.timeline.endTime) {
        const dTime = typeof d.timestamp === 'number' ? d.timestamp : new Date(d.timestamp || 0).getTime()
        if (dTime > 0) {
          matchesTime = dTime <= state.timeline.currentTime
        }
      }
      
      return matchesValue && matchesCategory && matchesSearch && matchesTime
    })
    
    // Also apply viewport bounds if they exist
    let viewportFilteredData = filteredData
    if (state.mapState.bounds) {
      const { sw, ne } = state.mapState.bounds
      viewportFilteredData = filteredData.filter(d => 
        d.lng >= sw[0] && d.lng <= ne[0] && d.lat >= sw[1] && d.lat <= ne[1]
      )
    }
    
    set({ filters, filteredData, viewportFilteredData })
  },

  setTimeline: (newTimeline) => {
    set((state) => ({ timeline: { ...state.timeline, ...newTimeline } }))
    get().setFilters({})
  },

  togglePlayback: () => set((state) => ({ 
    timeline: { ...state.timeline, isPlaying: !state.timeline.isPlaying } 
  })),

  tickTimeline: () => {
    const { timeline, setTimeline } = get()
    if (!timeline.isPlaying) return

    let nextTime = timeline.currentTime + (timeline.endTime - timeline.startTime) / 100 * timeline.speed
    if (nextTime > timeline.endTime) nextTime = timeline.startTime
    
    setTimeline({ currentTime: nextTime })
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
    state.setFilters({})
  },
  
  loadDemoData: () => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const demoPoints: Record<string, unknown>[] = Array.from({ length: 1000 }).map((_, i) => ({
      lat: (Math.random() - 0.5) * 140,
      lng: (Math.random() - 0.5) * 360,
      intensity: Math.random() * 100,
      group: ['A', 'B', 'C'][Math.floor(Math.random() * 3)],
      recorded_at: now - (Math.random() * 7 * day),
      city: 'Demo City ' + i
    }))
    
    set({ fieldMapping: {
      lat: 'lat',
      lng: 'lng',
      value: 'intensity',
      category: 'group',
      timestamp: 'recorded_at'
    }})
    get().setRawData(demoPoints)
    set({ activeModes: ['markers'] })
  }
}))
