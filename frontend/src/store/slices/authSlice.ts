import type { StateCreator } from 'zustand'
import type { GeoFluxState } from '../../types/index'
import { apiLogin, apiRegister, apiRefreshToken, apiLogoutAll } from '../../lib/api.ts'
import { isLocalDatasetId } from './helpers.ts'

const REFRESH_THRESHOLD_MS = 60 * 1000

export type AuthSlice = Pick<GeoFluxState,
  'auth' | 'login' | 'register' | 'logout' | 'refreshAuth' | 'logoutAll'
>

function getStoredRefreshToken(): string | null {
  return localStorage.getItem('geoflux_refresh_token')
}

function storeTokens(token: string, refreshToken: string) {
  localStorage.setItem('geoflux_token', token)
  localStorage.setItem('geoflux_refresh_token', refreshToken)
}

function clearTokens() {
  localStorage.removeItem('geoflux_token')
  localStorage.removeItem('geoflux_refresh_token')
}

export const createAuthSlice: StateCreator<GeoFluxState, [], [], AuthSlice> = (set, get) => ({
  auth: {
    user: null,
    token: localStorage.getItem('geoflux_token'),
    isAuthenticated: !!localStorage.getItem('geoflux_token'),
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const { token, refreshToken, user } = await apiLogin(email, password)
      storeTokens(token, refreshToken)
      set({ auth: { token, user, isAuthenticated: true }, isLoading: false })
      await Promise.all([get().fetchDatasets(), get().fetchWorkspaces()])
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Login failed', isLoading: false })
    }
  },

  register: async (email, password, name) => {
    set({ isLoading: true, error: null })
    try {
      const { token, refreshToken, user } = await apiRegister(email, password, name)
      storeTokens(token, refreshToken)
      set({ auth: { token, user, isAuthenticated: true }, isLoading: false })
      get().fetchDatasets()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Registration failed', isLoading: false })
    }
  },

  refreshAuth: async () => {
    const refreshToken = getStoredRefreshToken()
    if (!refreshToken) {
      clearTokens()
      set({ auth: { token: null, user: null, isAuthenticated: false } })
      return
    }
    try {
      const { token, refreshToken: newRefresh, user } = await apiRefreshToken(refreshToken)
      storeTokens(token, newRefresh)
      set({ auth: { token, user, isAuthenticated: true } })
    } catch {
      clearTokens()
      set({ auth: { token: null, user: null, isAuthenticated: false } })
    }
  },

  logout: () => {
    clearTokens()
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

  logoutAll: async () => {
    const token = get().auth.token
    if (token) {
      try {
        await apiLogoutAll(token)
      } catch {
        // continue with local logout even if server request fails
      }
    }
    get().logout()
  },
})
