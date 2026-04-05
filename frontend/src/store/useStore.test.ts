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

describe('GeoFlux Store', () => {
  beforeEach(() => {
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

  it('should add a dataset correctly', () => {
    const rawData = [
      { lat: 10, lng: 20, val: 50, cat: 'A' },
      { lat: 15, lng: 25, val: 75, cat: 'B' }
    ]
    
    useStore.getState().addDataset('Test Dataset', rawData)
    
    const state = useStore.getState()
    expect(state.datasets.length).toBe(1)
    expect(state.datasets[0].name).toBe('Test Dataset')
    expect(state.activeDatasetId).toBe(state.datasets[0].id)
    expect(state.rawData).toEqual(rawData)
    expect(state.availableFields).toEqual(['lat', 'lng', 'val', 'cat'])
  })

  it('should apply field mapping correctly', () => {
    const rawData = [
      { latitude: 10, longitude: 20, score: 50, group: 'A' }
    ]
    
    const { addDataset, setFieldMapping } = useStore.getState()
    
    addDataset('Mapping Test', rawData)
    
    // Auto-detection should work for these names
    setFieldMapping({
      lat: 'latitude',
      lng: 'longitude',
      value: 'score',
      category: 'group'
    })
    
    const state = useStore.getState()
    const point = state.data[0]
    expect(point.lat).toBe(10)
    expect(point.lng).toBe(20)
    expect(point.value).toBe(50)
    expect(point.category).toBe('A')
  })

  it('should handle transformations', () => {
    const rawData = [
      { lat: 0, lng: 0, value: 10 }
    ]
    
    const { addDataset, setFieldMapping, addTransformation } = useStore.getState()
    
    addDataset('Transform Test', rawData)
    setFieldMapping({ lat: 'lat', lng: 'lng', value: 'value' })
    
    // Add transformation: double the value
    addTransformation('Double It', 'value * 2')
    
    const state = useStore.getState()
    expect(state.data[0].value).toBe(20)
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
