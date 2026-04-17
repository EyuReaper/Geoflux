import { create } from 'zustand'
import type { VisualizationMode, DataPoint, MapState, MapStyle, FilterState, TimelineState, FieldMapping, InspectorEntity, Dataset, Transformation, AuthState, Workspace } from '../types/index'

interface GeoFluxState {
  // Auth
  auth: AuthState
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name?: string) => Promise<void>
  logout: () => void

  // Data
  datasets: Dataset[]
  workspaces: Workspace[]
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
  
  // UI State
  activeModes: VisualizationMode[]
  isSidebarOpen: boolean
  isRightPanelOpen: boolean
  isInspectorOpen: boolean
  isLive: boolean
  
  // Map Config
  mapState: MapState
  mapStyle: MapStyle
  mapStyleType: 'dark' | 'light'
  filters: FilterState
  timeline: TimelineState
  
  // Selection
  selectedEntity: InspectorEntity | null
  // Actions
  fetchDatasets: () => Promise<void>
  fetchWorkspaces: () => Promise<void>
  saveWorkspace: (name: string) => Promise<void>
  addDataset: (name: string, rawData: Record<string, unknown>[]) => void
  removeDataset: (id: string) => void
  toggleDatasetVisibility: (id: string) => void
  setActiveDataset: (id: string | null) => void
  setViewportFilteredData: (data: DataPoint[]) => void

  addTransformation: (name: string, expression: string) => void
  // ...

  removeTransformation: (id: string) => void
  toggleTransformation: (id: string) => void
  
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
  updateGlobalData: () => void
  
  // Inspector Actions
  setSelectedEntity: (entity: InspectorEntity | null) => void
  closeInspector: () => void
  reset: () => void
}

const defaultMapping: FieldMapping = {
  lat: '',
  lng: '',
  value: '',
  category: '',
  timestamp: ''
}

const initialState = {
  auth: {
    user: null,
    token: localStorage.getItem('geoflux_token'),
    isAuthenticated: !!localStorage.getItem('geoflux_token')
  },
  datasets: [] as Dataset[],
  workspaces: [] as Workspace[],
  activeDatasetId: null as string | null,
  transformations: [] as Transformation[],
  data: [] as DataPoint[],
  filteredData: [] as DataPoint[],
  viewportFilteredData: [] as DataPoint[],
  rawData: [] as Record<string, unknown>[],
  availableFields: [] as string[],
  fieldMapping: defaultMapping,
  isLoading: false,
  error: null as string | null,
  activeModes: ['markers'] as VisualizationMode[],
  isSidebarOpen: true,
  isRightPanelOpen: true,
  isInspectorOpen: false,
  isLive: false,
  selectedEntity: null as InspectorEntity | null,
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
    gridType: 'hex' as const,
    gridResolution: 4,
  },
  mapStyleType: 'dark' as const,
  filters: {
    minValue: 0,
    maxValue: 100,
    categories: [] as string[],
    searchQuery: '',
  },
  timeline: {
    currentTime: 0,
    startTime: 0,
    endTime: 100,
    isPlaying: false,
    speed: 1,
  },
}

export const API_URL = 'http://localhost:4000'

export const useStore = create<GeoFluxState>((set, get) => ({
  ...initialState,

  reset: () => {
    localStorage.removeItem('geoflux_token')
    set(initialState)
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const response = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      if (!response.ok) throw new Error('Invalid credentials')
      const { token, user } = await response.json()
      localStorage.setItem('geoflux_token', token)
      set({ auth: { token, user, isAuthenticated: true }, isLoading: false })
      get().fetchDatasets()
      get().fetchWorkspaces()
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  register: async (email, password, name) => {
    set({ isLoading: true, error: null })
    try {
      const response = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name })
      })
      if (!response.ok) throw new Error('Registration failed')
      const { token, user } = await response.json()
      localStorage.setItem('geoflux_token', token)
      set({ auth: { token, user, isAuthenticated: true }, isLoading: false })
      get().fetchDatasets()
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  logout: () => {
    localStorage.removeItem('geoflux_token')
    set({ auth: { token: null, user: null, isAuthenticated: false }, datasets: [], workspaces: [] })
  },

  setViewportFilteredData: (viewportFilteredData) => {
    set({ viewportFilteredData })
  },

  fetchDatasets: async () => {
    const { token } = get().auth
    if (!token) return

    set({ isLoading: true, error: null })
    try {
      const response = await fetch(`${API_URL}/datasets`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) {
        if (response.status === 403) get().logout()
        throw new Error('Failed to fetch datasets')
      }
      const data = await response.json()
      
      const datasets = await Promise.all(data.map(async (d: any) => {
        // Fetch stats for each dataset
        try {
          const statsRes = await fetch(`${API_URL}/datasets/${d.id}/stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
          })
          const stats = statsRes.ok ? await statsRes.json() : undefined
          return {
            id: d.id,
            name: d.name,
            color: d.color,
            isVisible: true,
            data: [],
            stats
          }
        } catch (e) {
          return {
            id: d.id,
            name: d.name,
            color: d.color,
            isVisible: true,
            data: []
          }
        }
      }))
      
      set({ datasets, isLoading: false })
      get().updateGlobalData()
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  fetchWorkspaces: async () => {
    const { token } = get().auth
    if (!token) return
    try {
      const response = await fetch(`${API_URL}/workspaces`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const workspaces = await response.json()
        set({ workspaces })
      }
    } catch (err) {}
  },

  saveWorkspace: async (name) => {
    const { token } = get().auth
    if (!token) return
    
    const config = {
      mapState: get().mapState,
      mapStyle: get().mapStyle,
      activeModes: get().activeModes,
      activeDatasetId: get().activeDatasetId
    }

    try {
      const response = await fetch(`${API_URL}/workspaces`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, config })
      })
      if (response.ok) {
        get().fetchWorkspaces()
      }
    } catch (err) {}
  },

  addDataset: async (name, rawData) => {
    const { token } = get().auth
    if (!token) return

    get().setRawData(rawData)
    const { fieldMapping, transformations } = get()
    
    const mappedData: DataPoint[] = rawData.map((d, i) => {
      let value = fieldMapping.value ? Number(d[fieldMapping.value] || 0) : 1
      transformations.filter(t => t.active).forEach(t => {
        try {
          const fn = new Function('value', 'row', `return ${t.expression}`)
          const result = fn(value, d)
          if (typeof result === 'number' && !isNaN(result)) value = result
        } catch (e) {}
      })
      return {
        id: `temp-${i}`,
        datasetId: 'temp',
        lat: Number(d[fieldMapping.lat] || 0),
        lng: Number(d[fieldMapping.lng] || 0),
        value,
        category: fieldMapping.category ? String(d[fieldMapping.category]) : 'default',
        timestamp: fieldMapping.timestamp ? (d[fieldMapping.timestamp] as any) : undefined,
        metadata: d
      }
    })

    const color = ['#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316'][get().datasets.length % 5]

    try {
      set({ isLoading: true })
      const response = await fetch(`${API_URL}/datasets`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, color, data: mappedData })
      })
      
      if (!response.ok) throw new Error('Failed to save dataset')
      const savedDataset = await response.json()
      
      // Fetch stats for the new dataset
      let stats;
      try {
        const statsRes = await fetch(`${API_URL}/datasets/${savedDataset.id}/stats`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        if (statsRes.ok) stats = await statsRes.json()
      } catch (e) {}

      const newDataset: Dataset = {
        id: savedDataset.id,
        name: savedDataset.name,
        color: savedDataset.color,
        isVisible: true,
        data: [], // Data is served via MVT
        stats
      }

      set((state) => ({ 
        datasets: [...state.datasets, newDataset],
        activeDatasetId: savedDataset.id,
        isLoading: false
      }))
      
      get().updateGlobalData()
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  removeDataset: async (id) => {
    const { token } = get().auth
    if (!token) return

    try {
      set({ isLoading: true })
      const response = await fetch(`${API_URL}/datasets/${id}`, { 
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) throw new Error('Failed to delete dataset')
      
      set((state) => {
        const datasets = state.datasets.filter(d => d.id !== id)
        const activeDatasetId = state.activeDatasetId === id 
          ? (datasets.length > 0 ? datasets[0].id : null) 
          : state.activeDatasetId
        
        return { datasets, activeDatasetId, isLoading: false }
      })
      get().updateGlobalData()
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  toggleDatasetVisibility: (id) => {
    set((state) => ({
      datasets: state.datasets.map(d => d.id === id ? { ...d, isVisible: !d.isVisible } : d)
    }))
    get().updateGlobalData()
  },

  setActiveDataset: (id) => {
    const dataset = get().datasets.find(d => d.id === id)
    if (dataset) {
      set({ 
        activeDatasetId: id,
        rawData: dataset.data.map(d => d.metadata as Record<string, unknown>),
        availableFields: dataset.data.length > 0 ? Object.keys(dataset.data[0].metadata || {}) : []
      })
    } else {
      set({ activeDatasetId: null, rawData: [], availableFields: [] })
    }
  },

  addTransformation: (name, expression) => {
    const id = Math.random().toString(36).substring(7)
    set((state) => ({
      transformations: [...state.transformations, { id, name, expression, targetField: 'value', active: true }]
    }))
    get().applyMapping()
  },

  removeTransformation: (id) => {
    set((state) => ({
      transformations: state.transformations.filter(t => t.id !== id)
    }))
    get().applyMapping()
  },

  toggleTransformation: (id) => {
    set((state) => ({
      transformations: state.transformations.map(t => t.id === id ? { ...t, active: !t.active } : t)
    }))
    get().applyMapping()
  },

  updateGlobalData: () => {
    const allData = get().datasets
      .filter(d => d.isVisible)
      .flatMap(d => d.data)
    
    set({ data: allData })
    get().setFilters({})
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
    
    // Only filter by bounds if we have in-memory data
    const { mapState, filteredData, data } = get()
    if (data.length > 0) {
      if (!mapState.bounds) {
        set({ viewportFilteredData: filteredData })
        return
      }

      const { sw, ne } = mapState.bounds
      const viewportFilteredData = filteredData.filter(d => 
        d.lng >= sw[0] && d.lng <= ne[0] && d.lat >= sw[1] && d.lat <= ne[1]
      )
      set({ viewportFilteredData })
    }
  },
  updateMapStyle: (style) => set((prev) => ({ 
    mapStyle: { ...prev.mapStyle, ...style } 
  })),
  setMapStyleType: (mapStyleType) => set({ mapStyleType }),
  
  setFilters: (newFilters) => {
    const state = get()
    const filters = { ...state.filters, ...newFilters }
    
    // Only filter if we have in-memory data
    if (state.data.length > 0) {
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
      
      let viewportFilteredData = filteredData
      if (state.mapState.bounds) {
        const { sw, ne } = state.mapState.bounds
        viewportFilteredData = filteredData.filter(d => 
          d.lng >= sw[0] && d.lng <= ne[0] && d.lat >= sw[1] && d.lat <= ne[1]
        )
      }
      
      set({ filters, filteredData, viewportFilteredData })
    } else {
      set({ filters })
    }
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
  toggleLive: () => {
    const { isLive } = get()
    if (!isLive) {
      if (!socket) {
        socket = io(API_URL)
        socket.on('live-data', (point: DataPoint) => {
          set((state) => {
            const newData = [...state.data, point].slice(-5000) // Keep last 5000 points
            return { data: newData }
          })
          get().setFilters({})
        })
      }
      socket.emit('start-live')
    } else {
      socket?.emit('stop-live')
    }
    set({ isLive: !isLive })
  },
  
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
    
    get().addDataset('Global Simulation', demoPoints)
    set({ activeModes: ['markers'] })
  },
  
  setSelectedEntity: (entity) => set({ selectedEntity: entity, isInspectorOpen: !!entity }),
  closeInspector: () => set({ isInspectorOpen: false, selectedEntity: null }),

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

  applyMapping: () => {
    const { rawData, fieldMapping, transformations } = get()
    if (rawData.length === 0) return
    
    const mappedData: DataPoint[] = rawData.map((d, i) => {
      let value = fieldMapping.value ? Number(d[fieldMapping.value] || 0) : 1
      transformations.filter(t => t.active).forEach(t => {
        try {
          const fn = new Function('value', 'row', `return ${t.expression}`)
          const result = fn(value, d)
          if (typeof result === 'number' && !isNaN(result)) value = result
        } catch (e) {}
      })
      return {
        id: `temp-${i}`,
        datasetId: 'temp',
        lat: Number(d[fieldMapping.lat] || 0),
        lng: Number(d[fieldMapping.lng] || 0),
        value,
        category: fieldMapping.category ? String(d[fieldMapping.category]) : 'default',
        timestamp: fieldMapping.timestamp ? (d[fieldMapping.timestamp] as any) : undefined,
        metadata: d
      }
    })
    
    get().setData(mappedData)
  },

  setFieldMapping: (newMapping) => {
    set((state) => ({ fieldMapping: { ...state.fieldMapping, ...newMapping } }))
    get().applyMapping()
  }
}))
