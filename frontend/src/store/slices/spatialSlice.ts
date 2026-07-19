import type { StateCreator } from 'zustand'
import type { GeoFluxState, Dataset } from '../../types/index'
import { apiPerformSpatialTool } from '../../lib/api.ts'

export type SpatialSlice = Pick<GeoFluxState,
  'spatialAggregationConfig' | 'aggregatedDatasetId' |
  'setSpatialAggregationConfig' | 'performSpatialAggregation' | 'clearSpatialAggregation'
>

export const createSpatialSlice: StateCreator<GeoFluxState, [], [], SpatialSlice> = (set, get) => ({
  spatialAggregationConfig: {
    type: 'aggregation' as const,
    sourceDatasetId: null,
    targetGridType: 'hex' as const,
    gridResolution: 4,
    aggregationField: null,
    bufferRadius: 5,
    clusterRadius: 10,
    hullMaxEdge: 10,
    isEnabled: false,
    persist: false,
    customName: '',
  },
  aggregatedDatasetId: null,

  setSpatialAggregationConfig: (config) => {
    set((state) => ({
      spatialAggregationConfig: { ...state.spatialAggregationConfig, ...config },
    }))
  },

  performSpatialAggregation: async () => {
    const { spatialAggregationConfig, auth } = get()
    if (!spatialAggregationConfig.sourceDatasetId || !auth.token) return

    set({ isLoading: true, error: null })
    try {
      const result = await apiPerformSpatialTool(
        spatialAggregationConfig.sourceDatasetId,
        spatialAggregationConfig,
        auth.token,
      )

      if (spatialAggregationConfig.persist) {
        const newDataset: Dataset = {
          ...(result as Dataset),
          isVisible: true,
          data: [],
        }
        set((state) => ({
          datasets: [...state.datasets, newDataset],
          activeDatasetId: newDataset.id,
          isLoading: false,
          aggregatedDatasetId: newDataset.id,
        }))
      } else {
        const toolType = spatialAggregationConfig.type || 'aggregation'
        const sourceDataset = get().datasets.find(
          (d) => d.id === spatialAggregationConfig.sourceDatasetId,
        )
        const newDataset: Dataset = {
          id: `agg-${Date.now()}`,
          name: `${toolType.toUpperCase()}: ${sourceDataset?.name || 'Dataset'}`,
          color: '#f97316',
          type: ['aggregation', 'convex_hull', 'concave_hull', 'voronoi', 'buffer'].includes(toolType)
            ? 'grid'
            : 'points',
          isVisible: true,
          data: [],
          aggregatedGeoJson: result as GeoJSON.FeatureCollection,
        }
        set((state) => ({
          datasets: [...state.datasets, newDataset],
          activeDatasetId: newDataset.id,
          isLoading: false,
          aggregatedDatasetId: newDataset.id,
        }))
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Spatial operation failed', isLoading: false })
    }
  },

  clearSpatialAggregation: () => {
    set((state) => ({
      aggregatedDatasetId: null,
      datasets: state.datasets.filter((d) => !d.id.startsWith('agg-')),
    }))
  },
})
