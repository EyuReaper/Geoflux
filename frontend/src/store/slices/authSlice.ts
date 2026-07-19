import type { StateCreator } from 'zustand'
import type { GeoFluxState } from '../../types/index'
import { apiLogin, apiRegister } from '../../lib/api.ts'
import { isLocalDatasetId } from './helpers.ts'

export type AuthSlice = Pick<GeoFluxState,
  'auth' | 'login' | 'register' | 'logout'
>

export const createAuthSlice: StateCreator<GeoFluxState, [], [], AuthSlice> = (set, get) => ({
  auth: {
    user: null,
    token: localStorage.getItem('geoflux_token'),
    isAuthenticated: !!localStorage.getItem('geoflux_token'),
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const { token, user } = await apiLogin(email, password)
      localStorage.setItem('geoflux_token', token)
      set({ auth: { token, user, isAuthenticated: true }, isLoading: false })
      await Promise.all([get().fetchDatasets(), get().fetchWorkspaces()])
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Login failed', isLoading: false })
    }
  },

  register: async (email, password, name) => {
    set({ isLoading: true, error: null })
    try {
      const { token, user } = await apiRegister(email, password, name)
      localStorage.setItem('geoflux_token', token)
      set({ auth: { token, user, isAuthenticated: true }, isLoading: false })
      get().fetchDatasets()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Registration failed', isLoading: false })
    }
  },

  logout: () => {
    localStorage.removeItem('geoflux_token')
    const localDatasets = get().datasets.filter((d) => isLocalDatasetId(d.id))
    set({
      auth: { token: null, user: null, isAuthenticated: false },
      datasets: localDatasets,
      workspaces: [],
      activeDatasetId: localDatasets.some((d) => d.id === get().activeDatasetId)
        ? get().activeDatasetId
        : (localDatasets[0]?.id ?? null),
    })
    get().updateGlobalData()
  },
})
