import type { StateCreator } from 'zustand'
import type { GeoFluxState } from '../../types/index'
import { io, type Socket } from 'socket.io-client'
import { API_URL } from '../../lib/api.ts'

let socket: Socket | null = null

export type UiSlice = Pick<GeoFluxState,
  'isSidebarOpen' | 'isRightPanelOpen' | 'isInspectorOpen' | 'isLive' | 'selectedEntity' |
  'toggleSidebar' | 'toggleRightPanel' | 'toggleLive' |
  'setSelectedEntity' | 'closeInspector' | 'getShareableUrl' | 'applySnapshot' | 'updateDataPoints'
>

export const createUiSlice: StateCreator<GeoFluxState, [], [], UiSlice> = (set, get) => ({
  isSidebarOpen: true,
  isRightPanelOpen: true,
  isInspectorOpen: false,
  isLive: false,
  selectedEntity: null,

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  toggleRightPanel: () => set((state) => ({ isRightPanelOpen: !state.isRightPanelOpen })),

  toggleLive: () => {
    const { isLive } = get()
    if (!isLive) {
      if (!socket) {
        socket = io(API_URL)
        socket.on('live-data', (point) => {
          set((state) => {
            const newData = [...state.data, point].slice(-5000)
            return { data: newData }
          })
          get().setFilters({})
        })
      }
      socket.emit('start-live')
    } else {
      socket?.emit('stop-live')
    }
    set({ isLive: !isLive })
  },

  setSelectedEntity: (selectedEntity) => {
    set({ selectedEntity, isInspectorOpen: !!selectedEntity })
  },

  closeInspector: () => {
    set({ isInspectorOpen: false, selectedEntity: null })
  },

  updateDataPoints: () => {
    const state = get()
    const newData = state.data.map((d) => ({
      ...d,
      value: Math.max(0, Math.min(100, (d.value || 0) + (Math.random() - 0.5) * 10)),
    }))
    set({ data: newData })
    state.setFilters({})
  },

  getShareableUrl: () => {
    const state = get()
    const snapshot = {
      ms: state.mapState,
      st: state.mapStyleType,
      am: state.activeModes,
      ad: state.activeDatasetId,
      fi: state.filters,
      tl: state.timeline,
      sl: state.mapStyle,
      rf: state.regionFocus,
    }
    const encoded = btoa(JSON.stringify(snapshot))
    const url = new URL(window.location.href)
    url.searchParams.set('s', encoded)
    return url.toString()
  },

  applySnapshot: (encoded: string) => {
    try {
      const snapshot = JSON.parse(atob(encoded))
      if (snapshot.ms) set({ mapState: { ...get().mapState, ...snapshot.ms } })
      if (snapshot.st) set({ mapStyleType: snapshot.st })
      if (snapshot.am) set({ activeModes: snapshot.am })
      if (snapshot.ad) get().setActiveDataset(snapshot.ad)
      if (snapshot.fi) set({ filters: { ...get().filters, ...snapshot.fi } })
      if (snapshot.tl) set({ timeline: { ...get().timeline, ...snapshot.tl } })
      if (snapshot.sl) set({ mapStyle: { ...get().mapStyle, ...snapshot.sl } })
      if (snapshot.rf) set({ regionFocus: snapshot.rf })
    } catch (e) {
      console.error('Failed to apply snapshot', e)
    }
  },
})
