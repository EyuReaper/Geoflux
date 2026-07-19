import type { StateCreator } from 'zustand'
import type { GeoFluxState } from '../../types/index'

type NominatimResult = {
  display_name?: string
  boundingbox?: [string, string, string, string]
}

export type MapSlice = Pick<GeoFluxState,
  'mapState' | 'mapStyle' | 'mapStyleType' | 'filters' | 'regionFocus' |
  'isRegionLoading' | 'regionError' | 'activeModes' |
  'setMapState' | 'updateMapStyle' | 'setMapStyleType' | 'setFilters' |
  'focusRegion' | 'clearRegionFocus' | 'toggleMode'
>

export const createMapSlice: StateCreator<GeoFluxState, [], [], MapSlice> = (set, get) => ({
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
    categories: [],
    searchQuery: '',
  },
  regionFocus: null,
  isRegionLoading: false,
  regionError: null,
  activeModes: ['markers'],

  setMapState: (partial) => {
    set((prev) => ({
      mapState: { ...prev.mapState, ...partial },
    }))

    const { mapState, filteredData, data } = get()
    if (data.length > 0) {
      if (!mapState.bounds) {
        set({ viewportFilteredData: filteredData })
        return
      }

      const { sw, ne } = mapState.bounds
      const viewportFilteredData = filteredData.filter(
        (d) => d.lng >= sw[0] && d.lng <= ne[0] && d.lat >= sw[1] && d.lat <= ne[1],
      )
      set({ viewportFilteredData })
    }
  },

  updateMapStyle: (style) =>
    set((prev) => ({
      mapStyle: { ...prev.mapStyle, ...style },
    })),

  setMapStyleType: (mapStyleType) => set({ mapStyleType }),

  setFilters: (newFilters) => {
    const state = get()
    const filters = { ...state.filters, ...newFilters }

    if (state.data.length > 0) {
      const filteredData = state.data.filter((d) => {
        const val = d.value || 0
        const matchesValue = val >= filters.minValue && val <= filters.maxValue
        const matchesCategory =
          filters.categories.length === 0 || (d.category && filters.categories.includes(d.category))
        const matchesSearch =
          !filters.searchQuery ||
          JSON.stringify(d.metadata || {}).toLowerCase().includes(filters.searchQuery.toLowerCase())

        let matchesTime = true
        if (state.timeline.startTime !== state.timeline.endTime) {
          const dTime =
            typeof d.timestamp === 'number' ? d.timestamp : new Date(d.timestamp || 0).getTime()
          if (dTime > 0) {
            matchesTime = dTime <= state.timeline.currentTime
          }
        }

        return matchesValue && matchesCategory && matchesSearch && matchesTime
      })

      let viewportFilteredData = filteredData
      if (state.mapState.bounds) {
        const { sw, ne } = state.mapState.bounds
        viewportFilteredData = filteredData.filter(
          (d) => d.lng >= sw[0] && d.lng <= ne[0] && d.lat >= sw[1] && d.lat <= ne[1],
        )
      }

      set({ filters, filteredData, viewportFilteredData })
    } else {
      set({ filters })
    }
  },

  focusRegion: async (query) => {
    const regionQuery = query.trim()
    if (!regionQuery) {
      set({ regionError: 'Enter a region name before focusing the map.' })
      return
    }

    set({ isRegionLoading: true, regionError: null })

    try {
      const params = new URLSearchParams({
        format: 'json',
        limit: '1',
        polygon_geojson: '0',
        q: regionQuery,
      })
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`)
      if (!response.ok) throw new Error('Region lookup failed')

      const results = (await response.json()) as NominatimResult[]
      const match = results[0]
      if (!match?.boundingbox) throw new Error('No matching region found')

      const [south, north, west, east] = match.boundingbox.map(Number)
      if (![south, north, west, east].every(Number.isFinite)) {
        throw new Error('Region bounds were invalid')
      }

      set({
        regionFocus: {
          label: match.display_name || regionQuery,
          bounds: {
            sw: [west, south],
            ne: [east, north],
          },
        },
        isRegionLoading: false,
        regionError: null,
      })
    } catch (err) {
      set({
        isRegionLoading: false,
        regionError: err instanceof Error ? err.message : 'Region lookup failed',
      })
    }
  },

  clearRegionFocus: () => {
    set({ regionFocus: null, regionError: null })
  },

  toggleMode: (mode) =>
    set((state) => ({
      activeModes: state.activeModes.includes(mode)
        ? state.activeModes.filter((m) => m !== mode)
        : [...state.activeModes, mode],
    })),
})
