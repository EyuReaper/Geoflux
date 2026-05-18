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

  it('renders "Data Source Control" header', () => {
    (useStore as unknown as Mock).mockReturnValue(defaultState)

    render(<Sidebar />)
    expect(screen.getByText(/Data Source Control/i)).toBeInTheDocument()
  })

  it('shows upload prompt when no datasets are present', () => {
    (useStore as unknown as Mock).mockReturnValue(defaultState)

    render(<Sidebar />)
    expect(screen.getByText(/Ingest New Dataset/i)).toBeInTheDocument()
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
