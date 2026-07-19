import type { StateCreator } from 'zustand'
import type { GeoFluxState } from '../../types/index'

export type TimelineSlice = Pick<GeoFluxState,
  'timeline' | 'setTimeline' | 'togglePlayback' | 'tickTimeline' | 'stepTimeline'
>

export const createTimelineSlice: StateCreator<GeoFluxState, [], [], TimelineSlice> = (set, get) => ({
  timeline: {
    currentTime: 0,
    startTime: 0,
    endTime: 100,
    isPlaying: false,
    speed: 1,
    loopMode: 'loop' as const,
    direction: 1 as const,
  },

  setTimeline: (newTimeline) => {
    set((state) => ({ timeline: { ...state.timeline, ...newTimeline } }))
    get().setFilters({})
  },

  togglePlayback: () =>
    set((state) => ({
      timeline: { ...state.timeline, isPlaying: !state.timeline.isPlaying },
    })),

  tickTimeline: () => {
    const { timeline } = get()
    if (!timeline.isPlaying) return

    const delta =
      (timeline.endTime - timeline.startTime) / 200 * timeline.speed * (timeline.direction || 1)
    let nextTime = timeline.currentTime + delta

    if (timeline.loopMode === 'loop') {
      if (nextTime > timeline.endTime) nextTime = timeline.startTime
      if (nextTime < timeline.startTime) nextTime = timeline.endTime
    } else if (timeline.loopMode === 'ping-pong') {
      if (nextTime > timeline.endTime) {
        nextTime = timeline.endTime
        get().setTimeline({ direction: -1 })
      } else if (nextTime < timeline.startTime) {
        nextTime = timeline.startTime
        get().setTimeline({ direction: 1 })
      }
    } else if (timeline.loopMode === 'once') {
      if (nextTime > timeline.endTime) {
        nextTime = timeline.endTime
        get().setTimeline({ isPlaying: false })
      }
      if (nextTime < timeline.startTime) {
        nextTime = timeline.startTime
        get().setTimeline({ isPlaying: false })
      }
    }

    get().setTimeline({ currentTime: nextTime })
  },

  stepTimeline: (steps: number) => {
    const { timeline } = get()
    const delta = (timeline.endTime - timeline.startTime) / 100 * steps
    let nextTime = timeline.currentTime + delta

    if (nextTime > timeline.endTime) nextTime = timeline.endTime
    if (nextTime < timeline.startTime) nextTime = timeline.startTime

    get().setTimeline({ currentTime: nextTime })
  },
})
