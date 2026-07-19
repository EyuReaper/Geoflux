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
      if (config.activeDatasetId) get().setActiveDataset(config.activeDatasetId as string)

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
