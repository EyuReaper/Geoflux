import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Sidebar from './Sidebar'

// Mock the store
vi.mock('../store/useStore', () => ({
  useStore: vi.fn()
}))

import { useStore } from '../store/useStore'

describe('Sidebar Component', () => {
  it('renders "Datasets" header', () => {
    (useStore as any).mockReturnValue({
      isSidebarOpen: true,
      datasets: [],
      data: [],
      filters: { searchQuery: '' },
      fieldMapping: { lat: '', lng: '', value: '', category: '', timestamp: '' },
      availableFields: []
    })

    render(<Sidebar />)
    expect(screen.getByText(/Datasets/i)).toBeInTheDocument()
  })

  it('shows upload prompt when no datasets are present', () => {
    (useStore as any).mockReturnValue({
      isSidebarOpen: true,
      datasets: [],
      data: [],
      filters: { searchQuery: '' },
      fieldMapping: { lat: '', lng: '', value: '', category: '', timestamp: '' },
      availableFields: []
    })

    render(<Sidebar />)
    expect(screen.getByText(/Click to upload/i)).toBeInTheDocument()
  })

  it('is hidden when isSidebarOpen is false', () => {
     (useStore as any).mockReturnValue({
      isSidebarOpen: false,
      datasets: [],
      data: [],
      filters: { searchQuery: '' },
      fieldMapping: { lat: '', lng: '', value: '', category: '', timestamp: '' },
      availableFields: []
    })

    const { container } = render(<Sidebar />)
    // The sidebar uses CSS transform to hide, check for class
    const sidebar = container.querySelector('aside')
    expect(sidebar).toHaveClass('-translate-x-full')
  })
})
