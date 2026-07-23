import type { StateCreator } from 'zustand'
import type { GeoFluxState } from '../../types/index'
import {
  apiFetchWorkspaces,
  apiFetchWorkspace,
  apiCreateWorkspace,
  apiToggleWorkspaceSharing,
} from '../../lib/api.ts'

export type WorkspaceSlice = Pick<GeoFluxState,
  'workspaces' | 'fetchWorkspaces' | 'loadWorkspace' | 'saveWorkspace' | 'toggleWorkspaceSharing'
>

export const createWorkspaceSlice: StateCreator<GeoFluxState, [], [], WorkspaceSlice> = (set, get) => ({
  workspaces: [],

  fetchWorkspaces: async () => {
    const { token } = get().auth
    if (!token) return
    try {
      const workspaces = await apiFetchWorkspaces(token)
      set({ workspaces })
    } catch {
      set({ error: 'Failed to fetch workspaces' })
    }
  },

  loadWorkspace: async (id) => {
    const { token } = get().auth
    set({ isLoading: true, error: null })
    try {
      const workspace = await apiFetchWorkspace(id, token)
      const config = workspace.config as Record<string, unknown>

      if (config.mapState) set({ mapState: { ...get().mapState, ...(config.mapState as Record<string, unknown>) } })
      if (config.mapStyle) set({ mapStyle: { ...get().mapStyle, ...(config.mapStyle as Record<string, unknown>) } })
      if (config.activeModes) set({ activeModes: config.activeModes as GeoFluxState['activeModes'] })
      if (config.mapStyleType) set({ mapStyleType: config.mapStyleType as 'dark' | 'light' })
      if (config.filters) set({ filters: { ...get().filters, ...(config.filters as Record<string, unknown>) } })
      if (config.timeline) set({ timeline: { ...get().timeline, ...(config.timeline as Record<string, unknown>) } })
      if (config.regionFocus) set({ regionFocus: config.regionFocus as GeoFluxState['regionFocus'] })

      if (config.activeDatasetId) {
        const dsId = config.activeDatasetId as string
        const exists = get().datasets.some((d) => d.id === dsId)
        if (exists) {
          get().setActiveDataset(dsId)
        }
      }

      const storedDatasetIds = config.datasetIds as string[] | undefined
      if (storedDatasetIds) {
        const missing = storedDatasetIds.filter((dsId) => !get().datasets.some((d) => d.id === dsId))
        if (missing.length > 0) {
          console.warn('Workspace references deleted datasets:', missing)
        }
      }

      set({ isLoading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load workspace', isLoading: false })
    }
  },

  saveWorkspace: async (name) => {
    const { token } = get().auth
    if (!token) return

    const config = {
      mapState: get().mapState,
      mapStyle: get().mapStyle,
      activeModes: get().activeModes,
      activeDatasetId: get().activeDatasetId,
      mapStyleType: get().mapStyleType,
      filters: get().filters,
      timeline: get().timeline,
      regionFocus: get().regionFocus,
      datasetIds: get().datasets.map((d) => d.id),
    }

    try {
      await apiCreateWorkspace({ name, config }, token)
      get().fetchWorkspaces()
    } catch {
      set({ error: 'Failed to save workspace' })
    }
  },

  toggleWorkspaceSharing: async (id, isPublic) => {
    const { token } = get().auth
    if (!token) return

    try {
      await apiToggleWorkspaceSharing(id, isPublic, token)
      get().fetchWorkspaces()
    } catch {
      set({ error: 'Failed to update workspace sharing' })
    }
  },
})
