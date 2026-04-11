import { describe, it, expect, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import Sidebar from './Sidebar'

// Mock the store
vi.mock('../store/useStore', () => ({
  useStore: vi.fn()
}))

import { useStore } from '../store/useStore'

describe('Sidebar Component', () => {
  const defaultState = {
    isSidebarOpen: true,
    datasets: [],
    data: [],
    filters: { searchQuery: '' },
    fieldMapping: { lat: '', lng: '', value: '', category: '', timestamp: '' },
    availableFields: [],
    fetchDatasets: vi.fn()
  }

  it('renders "Datasets" header', () => {
    (useStore as unknown as Mock).mockReturnValue(defaultState)

    render(<Sidebar />)
    expect(screen.getByText(/Datasets/i)).toBeInTheDocument()
  })

  it('shows upload prompt when no datasets are present', () => {
    (useStore as unknown as Mock).mockReturnValue(defaultState)

    render(<Sidebar />)
    expect(screen.getByText(/Click to upload/i)).toBeInTheDocument()
  })

  it('is hidden when isSidebarOpen is false', () => {
     (useStore as unknown as Mock).mockReturnValue({
      ...defaultState,
      isSidebarOpen: false,
    })

    const { container } = render(<Sidebar />)
    const sidebar = container.querySelector('aside')
    expect(sidebar).toHaveClass('-translate-x-full')
  })
})
