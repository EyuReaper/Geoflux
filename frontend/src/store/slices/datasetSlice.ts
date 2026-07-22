import type { StateCreator } from 'zustand'
import type { GeoFluxState, Dataset, DataPoint, FieldMapping } from '../../types/index'
import {
  apiFetchDatasets,
  apiFetchDatasetStats,
  apiFetchDataset,
  apiCreateDataset,
  apiDeleteDataset,
  apiExportDataset,
  apiUploadFile,
} from '../../lib/api.ts'
import {
  LOCAL_DATASET_PREFIX,
  defaultMapping,
  isLocalDatasetId,
  buildMappedData,
  buildDatasetStats,
  runValueTransformation,
} from './helpers.ts'
import Papa from 'papaparse'

type DatasetSummary = Pick<Dataset, 'id' | 'name' | 'color'>

export type DatasetSlice = Pick<GeoFluxState,
  'datasets' | 'activeDatasetId' | 'transformations' | 'data' | 'filteredData' |
  'viewportFilteredData' | 'rawData' | 'availableFields' | 'fieldMapping' |
  'isLoading' | 'error' | 'comparisonDatasetIds' |
  'fetchDatasets' | 'addDataset' | 'removeDataset' | 'toggleDatasetVisibility' |
  'setActiveDataset' | 'setViewportFilteredData' | 'exportDataset' |
  'addTransformation' | 'removeTransformation' | 'toggleTransformation' |
  'setData' | 'setRawData' | 'setFieldMapping' | 'setLoading' | 'setError' |
  'applyMapping' | 'updateGlobalData' | 'toggleComparisonDataset'
>

export const createDatasetSlice: StateCreator<GeoFluxState, [], [], DatasetSlice> = (set, get) => ({
  datasets: [],
  activeDatasetId: null,
  transformations: [],
  data: [],
  filteredData: [],
  viewportFilteredData: [],
  rawData: [],
  availableFields: [],
  fieldMapping: defaultMapping,
  isLoading: false,
  error: null,
  comparisonDatasetIds: [],

  fetchDatasets: async () => {
    const { token } = get().auth
    if (!token) return

    set({ isLoading: true, error: null })
    try {
      const data = await apiFetchDatasets(token)

      const datasets = await Promise.all(
        data.map(async (d: DatasetSummary) => {
          const stats = await apiFetchDatasetStats(d.id, token)
          return {
            id: d.id,
            name: d.name,
            color: d.color,
            isVisible: true,
            data: [],
            stats,
          }
        }),
      )

      const localDatasets = get().datasets.filter((d) => isLocalDatasetId(d.id))
      set({ datasets: [...localDatasets, ...datasets], isLoading: false })
      get().updateGlobalData()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch datasets', isLoading: false })
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
        stats: buildDatasetStats(mappedData),
      }

      set((state) => ({
        datasets: [...state.datasets, localDataset],
        activeDatasetId: localDataset.id,
        isLoading: false,
        error: null,
      }))
      get().updateGlobalData()
      return
    }

    try {
      set({ isLoading: true })
      const savedDataset = await apiCreateDataset({ name, color, data: mappedData }, token)
      const stats = await apiFetchDatasetStats(savedDataset.id, token)

      const newDataset: Dataset = {
        id: savedDataset.id,
        name: savedDataset.name,
        color: savedDataset.color,
        isVisible: true,
        data: [],
        stats,
      }

      set((state) => ({
        datasets: [...state.datasets, newDataset],
        activeDatasetId: savedDataset.id,
        isLoading: false,
      }))
      get().updateGlobalData()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save dataset', isLoading: false })
    }
  },

  removeDataset: async (id) => {
    const dataset = get().datasets.find((d) => d.id === id)
    const { token } = get().auth
    if (!token || (dataset && isLocalDatasetId(dataset.id))) {
      set((state) => {
        const datasets = state.datasets.filter((d) => d.id !== id)
        const activeDatasetId =
          state.activeDatasetId === id ? (datasets[0]?.id ?? null) : state.activeDatasetId
        return { datasets, activeDatasetId }
      })
      get().updateGlobalData()
      return
    }

    try {
      set({ isLoading: true })
      await apiDeleteDataset(id, token)

      set((state) => {
        const datasets = state.datasets.filter((d) => d.id !== id)
        const activeDatasetId =
          state.activeDatasetId === id ? (datasets.length > 0 ? datasets[0].id : null) : state.activeDatasetId
        return { datasets, activeDatasetId, isLoading: false }
      })
      get().updateGlobalData()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete dataset', isLoading: false })
    }
  },

  toggleDatasetVisibility: (id) => {
    set((state) => ({
      datasets: state.datasets.map((d) => (d.id === id ? { ...d, isVisible: !d.isVisible } : d)),
    }))
    get().updateGlobalData()
  },

  setActiveDataset: async (id) => {
    const { token } = get().auth

    if (!id) {
      set({ activeDatasetId: null, rawData: [], availableFields: [] })
      return
    }

    const existingDataset = get().datasets.find((d) => d.id === id)

    if (existingDataset) {
      if (isLocalDatasetId(existingDataset.id)) {
        set({
          activeDatasetId: id,
          rawData: existingDataset.data.map((d) => d.metadata as Record<string, unknown>),
          availableFields:
            existingDataset.data.length > 0 ? Object.keys(existingDataset.data[0].metadata || {}) : [],
        })
      } else if (token) {
        set({ isLoading: true, error: null })
        try {
          const fullDataset = await apiFetchDataset(id, token)
          const datasetData = (fullDataset.data || []) as Record<string, unknown>[]

          set((state) => ({
            datasets: state.datasets.map((d) =>
              d.id === fullDataset.id ? { ...d, data: datasetData as unknown as DataPoint[], type: fullDataset.type as Dataset['type'] } : d,
            ),
          }))

          const isGrid = fullDataset.type === 'grid'
          const rawData = isGrid
            ? datasetData.map((f) => f.properties as Record<string, unknown>)
            : datasetData.map((d) => d.metadata as Record<string, unknown>)
          set({
            activeDatasetId: id,
            rawData,
            availableFields: rawData.length > 0 ? Object.keys(rawData[0] || {}) : [],
            isLoading: false,
          })
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Failed to fetch dataset', isLoading: false })
        }
      }
    } else {
      set({ activeDatasetId: null, rawData: [], availableFields: [] })
    }
  },

  exportDataset: async (id, format) => {
    const { token } = get().auth
    const dataset = get().datasets.find((d) => d.id === id)
    if (!dataset) return

    set({ isLoading: true, error: null })
    try {
      if (id.startsWith(LOCAL_DATASET_PREFIX)) {
        const localData = dataset.data
        if (format === 'geojson') {
          const geojson = {
            type: 'FeatureCollection',
            features: localData.map((d) => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
              properties: { value: d.value, category: d.category, ...d.metadata },
            })),
          }
          const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${dataset.name.replace(/[^a-zA-Z0-9]/g, '_')}.geojson`
          a.click()
          URL.revokeObjectURL(url)
        } else if (format === 'csv') {
          const csvData = localData.map((d) => ({
            id: d.id,
            lat: d.lat,
            lng: d.lng,
            value: d.value,
            category: d.category,
            ...(typeof d.metadata === 'object' ? d.metadata : {}),
          }))
          const csv = Papa.unparse(csvData)
          const blob = new Blob([csv], { type: 'text/csv' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${dataset.name.replace(/[^a-zA-Z0-9]/g, '_')}.csv`
          a.click()
          URL.revokeObjectURL(url)
        }
      } else if (token) {
        const blob = await apiExportDataset(id, format, token)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${dataset.name.replace(/[^a-zA-Z0-9]/g, '_')}_export.${format}`
        a.click()
        URL.revokeObjectURL(url)
      }
      set({ isLoading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to export dataset', isLoading: false })
    }
  },

  addTransformation: (name, expression) => {
    const id = Math.random().toString(36).substring(7)
    set((state) => ({
      transformations: [
        ...state.transformations,
        { id, name, expression, targetField: 'value', active: true },
      ],
    }))
    get().applyMapping()
  },

  removeTransformation: (id) => {
    set((state) => ({
      transformations: state.transformations.filter((t) => t.id !== id),
    }))
    get().applyMapping()
  },

  toggleTransformation: (id) => {
    set((state) => ({
      transformations: state.transformations.map((t) =>
        t.id === id ? { ...t, active: !t.active } : t,
      ),
    }))
    get().applyMapping()
  },

  setData: (data) => {
    const times = data
      .map((d) => (typeof d.timestamp === 'number' ? d.timestamp : new Date(d.timestamp || 0).getTime()))
      .filter((t) => t > 0)

    if (times.length > 0) {
      const min = Math.min(...times)
      const max = Math.max(...times)
      set({
        data,
        isLoading: false,
        timeline: { ...get().timeline, startTime: min, endTime: max, currentTime: max },
      })
    } else {
      set({ data, isLoading: false, timeline: { ...get().timeline, startTime: 0, endTime: 0, currentTime: 0 } })
    }
    get().setFilters({})
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
        lat: fields.find((f) => /lat|latitude/i.test(f)) || fields[0] || '',
        lng: fields.find((f) => /lng|long|longitude/i.test(f)) || fields[1] || '',
        value: fields.find((f) => /val|count|intensity|mag|amount/i.test(f)) || '',
        category: fields.find((f) => /cat|type|class|group/i.test(f)) || '',
        timestamp: fields.find((f) => /time|date|recorded/i.test(f)) || '',
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
      transformations
        .filter((t) => t.active)
        .forEach((t) => {
          value = runValueTransformation(value, d, t.expression)
        })
      return {
        id: `temp-${i}`,
        datasetId: 'temp',
        lat: Number(d[fieldMapping.lat] || 0),
        lng: Number(d[fieldMapping.lng] || 0),
        value,
        category: fieldMapping.category ? String(d[fieldMapping.category]) : 'default',
        timestamp: fieldMapping.timestamp ? (d[fieldMapping.timestamp] as DataPoint['timestamp']) : undefined,
        metadata: d,
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
    const visibleDatasets = datasets.filter((d) => d.isVisible)
    const allData = visibleDatasets.flatMap((ds) => ds.data)
    get().setData(allData)
  },

  setViewportFilteredData: (viewportFilteredData) => {
    set({ viewportFilteredData })
  },

  toggleComparisonDataset: (id) => {
    set((state) => {
      const isComparing = state.comparisonDatasetIds.includes(id)
      const comparisonDatasetIds = isComparing
        ? state.comparisonDatasetIds.filter((cid) => cid !== id)
        : [...state.comparisonDatasetIds, id]
      return { comparisonDatasetIds }
    })
  },

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
})
