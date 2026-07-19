import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useStore } from './useStore.ts'

// Mock dependencies that might be used by effects or store logic
vi.mock('maplibre-gl', () => ({
  default: {
    Map: vi.fn(),
    Popup: vi.fn(),
  }
}))

vi.mock('h3-js', () => ({
  latLngToCell: vi.fn(),
  cellToBoundary: vi.fn(),
}))

// Mock fetch
global.fetch = vi.fn()

describe('GeoFlux Store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.getState().reset()
  })

  it('should initialize with default values', () => {
    const state = useStore.getState()
    expect(state.datasets).toEqual([])
    expect(state.data).toEqual([])
    expect(state.isLoading).toBe(false)
    expect(state.activeModes).toContain('markers')
    expect(state.isSidebarOpen).toBe(true)
  })

  it('should add a dataset correctly via API', async () => {
    useStore.setState({
      auth: {
        token: 'test-token',
        user: { id: 'user-1', email: 'test@example.com' },
        isAuthenticated: true
      }
    })

    const rawData = [
      { lat: 10, lng: 20, val: 50, cat: 'A' },
      { lat: 15, lng: 25, val: 75, cat: 'B' }
    ]
    
    const mockSavedDataset = {
      id: 'backend-id',
      name: 'Test Dataset',
      color: '#06b6d4',
      data: []
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockSavedDataset
    } as Response)
    
    await useStore.getState().addDataset('Test Dataset', rawData)
    
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/datasets'), expect.objectContaining({
      method: 'POST'
    }))
    
    const state = useStore.getState()
    expect(state.datasets.length).toBe(1)
    expect(state.datasets[0].id).toBe('backend-id')
    expect(state.activeDatasetId).toBe('backend-id')
  })

  it('should add a local dataset without authentication', async () => {
    const rawData = [
      { lat: 10, lng: 20, val: 50, cat: 'A' },
      { lat: 15, lng: 25, val: 75, cat: 'B' }
    ]

    useStore.setState({
      fieldMapping: {
        lat: 'lat',
        lng: 'lng',
        value: 'val',
        category: 'cat',
        timestamp: ''
      }
    })

    await useStore.getState().addDataset('Local Dataset', rawData)

    expect(fetch).not.toHaveBeenCalled()

    const state = useStore.getState()
    expect(state.datasets).toHaveLength(1)
    expect(state.datasets[0].id.startsWith('local-')).toBe(true)
    expect(state.datasets[0].data).toHaveLength(2)
    expect(state.data).toHaveLength(2)
    expect(state.activeDatasetId).toBe(state.datasets[0].id)
  })

  it('should remove a local dataset without calling the API', async () => {
    const rawData = [
      { lat: 10, lng: 20, val: 50, cat: 'A' }
    ]

    useStore.setState({
      fieldMapping: {
        lat: 'lat',
        lng: 'lng',
        value: 'val',
        category: 'cat',
        timestamp: ''
      }
    })

    await useStore.getState().addDataset('Local Dataset', rawData)
    const localId = useStore.getState().datasets[0].id

    await useStore.getState().removeDataset(localId)

    expect(fetch).not.toHaveBeenCalled()
    expect(useStore.getState().datasets).toHaveLength(0)
    expect(useStore.getState().data).toHaveLength(0)
  })

  it('should toggle visualization modes', () => {
    const { toggleMode } = useStore.getState()
    
    // Default is ['markers']
    toggleMode('heatmap')
    expect(useStore.getState().activeModes).toContain('markers')
    expect(useStore.getState().activeModes).toContain('heatmap')
    
    toggleMode('markers')
    expect(useStore.getState().activeModes).not.toContain('markers')
    expect(useStore.getState().activeModes).toContain('heatmap')
  })

  it('should toggle sidebar and right panel', () => {
    const { toggleSidebar, toggleRightPanel } = useStore.getState()
    
    const initialSidebar = useStore.getState().isSidebarOpen
    toggleSidebar()
    expect(useStore.getState().isSidebarOpen).toBe(!initialSidebar)
    
    const initialRightPanel = useStore.getState().isRightPanelOpen
    toggleRightPanel()
    expect(useStore.getState().isRightPanelOpen).toBe(!initialRightPanel)
  })

  it('should handle persistent spatial aggregation', async () => {
    useStore.setState({
      auth: {
        token: 'test-token',
        user: { id: 'user-1', email: 'test@example.com' },
        isAuthenticated: true
      },
      spatialAggregationConfig: {
        sourceDatasetId: 'source-1',
        targetGridType: 'hex',
        gridResolution: 4,
        aggregationField: 'val',
        isEnabled: true,
        persist: true,
        customName: 'Saved Hex Grid'
      },
      datasets: [{ id: 'source-1', name: 'Source', color: '#000', isVisible: true, data: [] }]
    })

    const mockSavedAggregation = {
      id: 'agg-saved-id',
      name: 'Saved Hex Grid',
      color: '#f97316',
      type: 'grid',
      data: []
    }

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockSavedAggregation
    } as Response)

    await useStore.getState().performSpatialAggregation()

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/spatial-tool'), expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"customName":"Saved Hex Grid"')
    }))

    const state = useStore.getState()
    expect(state.datasets).toHaveLength(2)
    expect(state.datasets.find(d => d.id === 'agg-saved-id')).toBeDefined()
    expect(state.activeDatasetId).toBe('agg-saved-id')
  })

  it('should focus the map on a geocoded region', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [{
        display_name: 'Addis Ababa, Ethiopia',
        boundingbox: ['8.84', '9.13', '38.65', '38.90']
      }]
    } as Response)

    await useStore.getState().focusRegion('Addis Ababa')

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('nominatim.openstreetmap.org/search'))
    expect(useStore.getState().regionFocus).toEqual({
      label: 'Addis Ababa, Ethiopia',
      bounds: {
        sw: [38.65, 8.84],
        ne: [38.90, 9.13],
      }
    })
    expect(useStore.getState().isRegionLoading).toBe(false)
    expect(useStore.getState().regionError).toBeNull()
  })
})
