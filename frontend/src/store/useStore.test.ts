import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useStore } from './useStore'

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

    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockSavedDataset
    })
    
    await useStore.getState().addDataset('Test Dataset', rawData)
    
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/datasets'), expect.objectContaining({
      method: 'POST'
    }))
    
    const state = useStore.getState()
    expect(state.datasets.length).toBe(1)
    expect(state.datasets[0].id).toBe('backend-id')
    expect(state.activeDatasetId).toBe('backend-id')
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
})
