import { create } from 'zustand'
import { io, type Socket } from 'socket.io-client'
import type { VisualizationMode, DataPoint, MapState, MapStyle, FilterState, TimelineState, FieldMapping, InspectorEntity, Dataset, Transformation, AuthState, Workspace, SpatialAggregationConfig } from '../types/index'

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

  // Spatial Aggregation
  spatialAggregationConfig: SpatialAggregationConfig
  aggregatedDatasetId: string | null

  // Selection
  selectedEntity: InspectorEntity | null
  // Actions
  fetchDatasets: () => Promise<void>
  fetchWorkspaces: () => Promise<void>
  loadWorkspace: (id: string) => Promise<void>
  saveWorkspace: (name: string) => Promise<void>
  toggleWorkspaceSharing: (id: string, isPublic: boolean) => Promise<void>
  addDataset: (name: string, rawData: Record<string, unknown>[]) => void
  removeDataset: (id: string) => void
  toggleDatasetVisibility: (id: string) => void
  setActiveDataset: (id: string | null) => void
  setViewportFilteredData: (data: DataPoint[]) => void

  addTransformation: (name: string, expression: string) => void
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
  updateDataPoints: () => void
  tickTimeline: () => void
  stepTimeline: (steps: number) => void
  applyMapping: () => void
  updateGlobalData: () => void

  setSpatialAggregationConfig: (config: Partial<SpatialAggregationConfig>) => void
  performSpatialAggregation: () => Promise<void>
  clearSpatialAggregation: () => void

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
    extrusionScale: 50,
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
    loopMode: 'loop' as const,
    direction: 1 as const,
  },
  spatialAggregationConfig: {
    sourceDatasetId: null,
    targetGridType: 'hex' as const,
    gridResolution: 4,
    aggregationField: null,
    isEnabled: false,
  },
  aggregatedDatasetId: null,
}

export const API_URL = 'http://localhost:4000'

let socket: Socket | null = null

type DatasetSummary = Pick<Dataset, 'id' | 'name' | 'color'>;
const LOCAL_DATASET_PREFIX = 'local-'

const toTimestampValue = (value: unknown) => value as DataPoint['timestamp']
const isLocalDatasetId = (id: string) => id.startsWith(LOCAL_DATASET_PREFIX)

const buildMappedData = (
  rawData: Record<string, unknown>[],
  fieldMapping: FieldMapping,
  transformations: Transformation[],
  datasetId: string
) => rawData.map((d, i) => {
  let value = fieldMapping.value ? Number(d[fieldMapping.value] || 0) : 1
  transformations.filter(t => t.active).forEach(t => {
    value = runValueTransformation(value, d, t.expression)
  })
  return {
    id: `${datasetId}-${i}`,
    datasetId,
    lat: Number(d[fieldMapping.lat] || 0),
    lng: Number(d[fieldMapping.lng] || 0),
    value,
    category: fieldMapping.category ? String(d[fieldMapping.category]) : 'default',
    timestamp: fieldMapping.timestamp ? toTimestampValue(d[fieldMapping.timestamp]) : undefined,
    metadata: d
  }
})

const buildDatasetStats = (data: DataPoint[]) => {
  const categories = new Set<string>()
  let min = Infinity
  let max = -Infinity

  data.forEach((point) => {
    const value = point.value || 0
    min = Math.min(min, value)
    max = Math.max(max, value)
    if (point.category) categories.add(point.category)
  })

  return {
    count: data.length,
    categories: Array.from(categories),
    min: min === Infinity ? 0 : min,
    max: max === -Infinity ? 0 : max
  }
}

const runValueTransformation = (
  value: number,
  row: Record<string, unknown>,
  expression: string
) => {
  try {
    const fn = new Function('value', 'row', `return ${expression}`)
    const result = fn(value, row) as unknown
    return typeof result === 'number' && !Number.isNaN(result) ? result : value
  } catch {
    return value
  }
}

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

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Invalid credentials');

      const { token, user } = data;
      localStorage.setItem('geoflux_token', token);
      set({ auth: { token, user, isAuthenticated: true }, isLoading: false });
      
      await Promise.all([get().fetchDatasets(), get().fetchWorkspaces()]);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Login failed', isLoading: false });
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
    const localDatasets = get().datasets.filter((dataset) => isLocalDatasetId(dataset.id))
    set({
      auth: { token: null, user: null, isAuthenticated: false },
      datasets: localDatasets,
      workspaces: [],
      activeDatasetId: localDatasets.some((dataset) => dataset.id === get().activeDatasetId)
        ? get().activeDatasetId
        : (localDatasets[0]?.id ?? null)
    })
    get().updateGlobalData()
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
      const data = await response.json() as DatasetSummary[]

      const datasets = await Promise.all(data.map(async (d) => {
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
        } catch {
          return {
            id: d.id,
            name: d.name,
            color: d.color,
            isVisible: true,
            data: []
          }
        }
      }))

      const localDatasets = get().datasets.filter((dataset) => isLocalDatasetId(dataset.id))
      set({ datasets: [...localDatasets, ...datasets], isLoading: false })
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
    } catch {
      set({ error: 'Failed to fetch workspaces' })
    }
  },

  loadWorkspace: async (id) => {
    const { token } = get().auth
    set({ isLoading: true, error: null })
    try {
      const response = await fetch(`${API_URL}/workspaces/${id}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      if (!response.ok) throw new Error('Workspace not found or access denied')
      const workspace = await response.json()

      const config = workspace.config
      if (config.mapState) set({ mapState: { ...get().mapState, ...config.mapState } })
      if (config.mapStyle) set({ mapStyle: { ...get().mapStyle, ...config.mapStyle } })
      if (config.activeModes) set({ activeModes: config.activeModes })
      if (config.activeDatasetId) get().setActiveDataset(config.activeDatasetId)

      set({ isLoading: false })
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
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
    } catch {
      set({ error: 'Failed to save workspace' })
    }
  },

  toggleWorkspaceSharing: async (id, isPublic) => {
    const { token } = get().auth
    if (!token) return

    try {
      const response = await fetch(`${API_URL}/workspaces/${id}/share`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ isPublic })
      })
      if (response.ok) {
        get().fetchWorkspaces()
      }
    } catch {
      set({ error: 'Failed to update workspace sharing' })
    }
  },

  addDataset: async (name, rawData) => {
    const { token } = get().auth

    get().setRawData(rawData)
    const { fieldMapping, transformations } = get()
    const color = ['#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316'][get().datasets.length % 5]
    const datasetId = token
      ? `remote-${Date.now()}`
      : `${LOCAL_DATASET_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const mappedData = buildMappedData(rawData, fieldMapping, transformations, datasetId)

    if (!token) {
      const localDataset: Dataset = {
        id: datasetId,
        name,
        color,
        isVisible: true,
        data: mappedData,
        stats: buildDatasetStats(mappedData)
      }

      set((state) => ({
        datasets: [...state.datasets, localDataset],
        activeDatasetId: localDataset.id,
        isLoading: false,
        error: null
      }))
      get().updateGlobalData()
      return
    }

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

      let stats;
      try {
        const statsRes = await fetch(`${API_URL}/datasets/${savedDataset.id}/stats`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        if (statsRes.ok) stats = await statsRes.json()
      } catch {
        stats = undefined
      }

      const newDataset: Dataset = {
        id: savedDataset.id,
        name: savedDataset.name,
        color: savedDataset.color,
        isVisible: true,
        data: [], 
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
    const dataset = get().datasets.find((entry) => entry.id === id)
    const { token } = get().auth
    if (!token || (dataset && isLocalDatasetId(dataset.id))) {
      set((state) => {
        const datasets = state.datasets.filter((entry) => entry.id !== id)
        const activeDatasetId = state.activeDatasetId === id
          ? (datasets[0]?.id ?? null)
          : state.activeDatasetId

        return { datasets, activeDatasetId }
      })
      get().updateGlobalData()
      return
    }

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

  setActiveDataset: async (id) => {
    const { token } = get().auth
    const existingDataset = get().datasets.find(d => d.id === id)

    if (existingDataset) {
      if (isLocalDatasetId(existingDataset.id)) {
        set({
          activeDatasetId: id,
          rawData: existingDataset.data.map(d => d.metadata as Record<string, unknown>),
          availableFields: existingDataset.data.length > 0 ? Object.keys(existingDataset.data[0].metadata || {}) : []
        })
      } else if (token) {
        set({ isLoading: true, error: null })
        try {
          const response = await fetch(`${API_URL}/datasets/${id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          })
          if (!response.ok) {
            if (response.status === 403) get().logout()
            throw new Error('Failed to fetch full dataset data')
          }
          const fullDataset = await response.json()

          set((state) => ({
            datasets: state.datasets.map(d => d.id === fullDataset.id ? { ...d, data: fullDataset.data, type: fullDataset.type } : d)
          }))

          const isGrid = fullDataset.type === 'grid'
          const rawData = isGrid 
            ? fullDataset.data.map((f: any) => f.properties)
            : fullDataset.data.map((d: any) => d.metadata as Record<string, unknown>)

          set({
            activeDatasetId: id,
            rawData,
            availableFields: rawData.length > 0 ? Object.keys(rawData[0] || {}) : [],
            isLoading: false
          })
        } catch (err) {
          set({ error: (err as Error).message, isLoading: false })
        }
      }
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

  setSpatialAggregationConfig: (config) => {
    set((state) => ({
      spatialAggregationConfig: { ...state.spatialAggregationConfig, ...config }
    }))
  },

  performSpatialAggregation: async () => {
    const { spatialAggregationConfig, auth } = get()
    if (!spatialAggregationConfig.sourceDatasetId || !auth.token) return

    set({ isLoading: true, error: null })
    try {
      const response = await fetch(`${API_URL}/datasets/${spatialAggregationConfig.sourceDatasetId}/spatial-aggregate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`
        },
        body: JSON.stringify({
          targetGridType: spatialAggregationConfig.targetGridType,
          gridResolution: spatialAggregationConfig.gridResolution,
          aggregationField: spatialAggregationConfig.aggregationField,
          persist: spatialAggregationConfig.persist,
          name: spatialAggregationConfig.customName
        })
      })

      if (!response.ok) throw new Error('Failed to perform spatial aggregation')
      
      const result = await response.json()

      if (spatialAggregationConfig.persist) {
        // Result is a full Dataset object from the server
        const newDataset: Dataset = {
          ...result,
          isVisible: true,
          data: [] // Grid data is served via tiles
        }

        set((state) => ({
          datasets: [...state.datasets, newDataset],
          activeDatasetId: newDataset.id,
          isLoading: false,
          aggregatedDatasetId: newDataset.id
        }))
      } else {
        // Result is GeoJSON for transient display
        const sourceDataset = get().datasets.find(d => d.id === spatialAggregationConfig.sourceDatasetId)
        const newDataset: Dataset = {
          id: `agg-${Date.now()}`,
          name: `Aggregated: ${sourceDataset?.name || 'Dataset'}`,
          color: '#f97316',
          type: 'grid',
          isVisible: true,
          data: [],
          aggregatedGeoJson: result
        }

        set((state) => ({
          datasets: [...state.datasets, newDataset],
          activeDatasetId: newDataset.id,
          isLoading: false,
          aggregatedDatasetId: newDataset.id
        }))
      }
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  clearSpatialAggregation: () => {
    set((state) => ({
      aggregatedDatasetId: null,
      datasets: state.datasets.filter(d => !d.id.startsWith('agg-'))
    }))
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

    const delta = (timeline.endTime - timeline.startTime) / 200 * timeline.speed * (timeline.direction || 1)
    let nextTime = timeline.currentTime + delta

    if (timeline.loopMode === 'loop') {
      if (nextTime > timeline.endTime) nextTime = timeline.startTime
      if (nextTime < timeline.startTime) nextTime = timeline.endTime
    } else if (timeline.loopMode === 'ping-pong') {
      if (nextTime > timeline.endTime) {
        nextTime = timeline.endTime
        setTimeline({ direction: -1 })
      } else if (nextTime < timeline.startTime) {
        nextTime = timeline.startTime
        setTimeline({ direction: 1 })
      }
    } else if (timeline.loopMode === 'once') {
      if (nextTime > timeline.endTime) {
        nextTime = timeline.endTime
        setTimeline({ isPlaying: false })
      }
      if (nextTime < timeline.startTime) {
        nextTime = timeline.startTime
        setTimeline({ isPlaying: false })
      }
    }

    setTimeline({ currentTime: nextTime })
  },

  stepTimeline: (steps: number) => {
    const { timeline, setTimeline } = get()
    const delta = (timeline.endTime - timeline.startTime) / 100 * steps
    let nextTime = timeline.currentTime + delta

    if (nextTime > timeline.endTime) nextTime = timeline.endTime
    if (nextTime < timeline.startTime) nextTime = timeline.startTime

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
            const newData = [...state.data, point].slice(-5000)
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

  setRawData: (rawData) => {
    if (rawData.length === 0) {
      set({ rawData: [], availableFields: [], fieldMapping: defaultMapping })
      return
    }

    const fields = Object.keys(rawData[0])

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
        value = runValueTransformation(value, d, t.expression)
      })
      return {
        id: `temp-${i}`,
        datasetId: 'temp',
        lat: Number(d[fieldMapping.lat] || 0),
        lng: Number(d[fieldMapping.lng] || 0),
        value,
        category: fieldMapping.category ? String(d[fieldMapping.category]) : 'default',
        timestamp: fieldMapping.timestamp ? toTimestampValue(d[fieldMapping.timestamp]) : undefined,
        metadata: d
      }
    })

    get().setData(mappedData)
  },

  setFieldMapping: (newMapping) => {
    set((state) => ({ fieldMapping: { ...state.fieldMapping, ...newMapping } }))
    get().applyMapping()
  },

  updateGlobalData: () => {
    const { datasets } = get()
    const visibleDatasets = datasets.filter(d => d.isVisible)
    
    // Aggregate data from all visible datasets
    // Note: Only works for datasets that have 'data' loaded (local or small remote)
    const allData = visibleDatasets.flatMap(ds => ds.data)
    
    get().setData(allData)
  },

  setSelectedEntity: (selectedEntity) => {
    set({ selectedEntity, isInspectorOpen: !!selectedEntity })
  },

  closeInspector: () => {
    set({ isInspectorOpen: false, selectedEntity: null })
  }
}))
