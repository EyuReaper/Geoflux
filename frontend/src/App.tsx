import { Suspense, lazy, useEffect, useState } from 'react'
import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import RightPanel from './components/RightPanel'
import Timeline from './components/Timeline'
import Inspector from './components/Inspector'
import { useStore } from './store/useStore'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { cn } from './lib/utils'

const Map = lazy(() => import('./components/Map'))

type TourStep = {
  title: string
  description: string
  target: string
  selector: string
  ensureOpen?: 'sidebar' | 'rightPanel'
}

const TOUR_STEPS: TourStep[] = [
  {
    title: '1) Upload or choose data',
    description: 'Start in the left sidebar to upload a dataset or pick an existing one.',
    target: 'Left sidebar',
    selector: '[data-tour="sidebar"]',
    ensureOpen: 'sidebar'
  },
  {
    title: '2) Explore the map',
    description: 'Pan and zoom the center map to inspect spatial patterns and hot spots.',
    target: 'Map canvas',
    selector: '[data-tour="map"]'
  },
  {
    title: '3) Analyze and transform',
    description: 'Use the right panel for analytics and transformations on selected data.',
    target: 'Right panel',
    selector: '[data-tour="right-panel"]',
    ensureOpen: 'rightPanel'
  },
  {
    title: '4) Inspect timeline',
    description: 'Use Timeline and Inspector to drill into live events and history.',
    target: 'Timeline + Inspector',
    selector: '[data-tour="timeline"]'
  }
] as const

function App() {
  const { isSidebarOpen, toggleSidebar, isRightPanelOpen, toggleRightPanel, data, fetchDatasets, loadWorkspace } = useStore()
  const [isWelcomeDismissed, setIsWelcomeDismissed] = useState(false)
  const [isTourOpen, setIsTourOpen] = useState(false)
  const [tourStepIndex, setTourStepIndex] = useState(0)
  const [tourTargetRect, setTourTargetRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const workspaceId = params.get('workspace')
    if (workspaceId) {
      loadWorkspace(workspaceId)
    }
    fetchDatasets()
  }, [fetchDatasets, loadWorkspace])

  useEffect(() => {
    setIsWelcomeDismissed(window.localStorage.getItem('geoflux:welcome:dismissed') === 'true')
  }, [])

  const dismissWelcome = () => {
    window.localStorage.setItem('geoflux:welcome:dismissed', 'true')
    setIsWelcomeDismissed(true)
  }

  const startTour = () => {
    setTourStepIndex(0)
    setIsTourOpen(true)
  }

  const closeTour = () => {
    setIsTourOpen(false)
    setTourStepIndex(0)
  }

  const isLastTourStep = tourStepIndex === TOUR_STEPS.length - 1
  const activeTourStep = TOUR_STEPS[tourStepIndex]

  useEffect(() => {
    if (!isTourOpen) {
      return
    }
    if (activeTourStep.ensureOpen === 'sidebar' && !isSidebarOpen) {
      toggleSidebar()
    }
    if (activeTourStep.ensureOpen === 'rightPanel' && !isRightPanelOpen) {
      toggleRightPanel()
    }
  }, [activeTourStep.ensureOpen, isRightPanelOpen, isSidebarOpen, isTourOpen, toggleRightPanel, toggleSidebar])

  useEffect(() => {
    if (!isTourOpen) {
      setTourTargetRect(null)
      return
    }

    const updateTargetRect = () => {
      const targetEl = document.querySelector(activeTourStep.selector)
      setTourTargetRect(targetEl ? targetEl.getBoundingClientRect() : null)
    }

    const timer = window.setTimeout(updateTargetRect, 240)
    updateTargetRect()
    window.addEventListener('resize', updateTargetRect)
    window.addEventListener('scroll', updateTargetRect, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', updateTargetRect)
      window.removeEventListener('scroll', updateTargetRect, true)
    }
  }, [activeTourStep.selector, isTourOpen])

  const focusTourTarget = () => {
    const targetEl = document.querySelector(activeTourStep.selector) as HTMLElement | null
    if (!targetEl) {
      return
    }
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    targetEl.animate(
      [
        { boxShadow: '0 0 0 0 rgba(34,211,238,0.0)' },
        { boxShadow: '0 0 0 6px rgba(34,211,238,0.45)' },
        { boxShadow: '0 0 0 0 rgba(34,211,238,0.0)' }
      ],
      { duration: 900, easing: 'ease-out' }
    )
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0a0a0a] text-white font-sans selection:bg-cyan-500/30 flex flex-col">
      <Navbar />
      
      <main className="relative h-full w-full pt-16 flex">
        {/* Toggle Sidebar Buttons */}
        <button 
          onClick={toggleSidebar}
          className={cn(
            "fixed z-[2000] left-4 top-[5rem] p-2 rounded-lg bg-black/40 backdrop-blur-md border border-white/10 text-white/50 hover:text-white transition-all hover:bg-white/5",
            isSidebarOpen && "left-[21rem]"
          )}
        >
          {isSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>

        <button 
          onClick={toggleRightPanel}
          className={cn(
            "fixed z-[2000] right-4 top-[5rem] p-2 rounded-lg bg-black/40 backdrop-blur-md border border-white/10 text-white/50 hover:text-white transition-all hover:bg-white/5",
            isRightPanelOpen && "right-[21rem]"
          )}
        >
          {isRightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </button>

        <div data-tour="sidebar">
          <Sidebar />
        </div>
        
        <div className="flex-1 relative bg-black" data-tour="map">
          <Suspense fallback={<div className="absolute inset-0 bg-black" />}>
            <Map />
          </Suspense>
          
          {data.length === 0 && !isWelcomeDismissed && (
            <div className="absolute inset-0 flex items-center justify-center z-[500]">
              <div className="bg-black/40 backdrop-blur-md border border-white/10 p-12 rounded-[2.5rem] text-center space-y-4 animate-in fade-in zoom-in duration-700 pointer-events-auto">
                <div className="w-20 h-20 bg-cyan-500/10 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-cyan-500/20">
                  <div className="w-10 h-10 bg-cyan-500 rounded-2xl animate-pulse shadow-[0_0_30px_rgba(6,182,212,0.5)]" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight text-white/90">Welcome to GeoFlux</h2>
                <p className="text-white/40 max-w-xs mx-auto leading-relaxed">
                  Upload a dataset to start exploring global patterns in real-time.
                </p>
                <div className="pt-2 flex items-center justify-center gap-3">
                  <button
                    onClick={startTour}
                    className="px-4 py-2 rounded-xl border border-cyan-400/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-colors"
                  >
                    Quick tour
                  </button>
                  <button
                    onClick={dismissWelcome}
                    className="px-4 py-2 rounded-xl border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}

          {isTourOpen && (
            <div className="absolute inset-0 z-[700] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
              {tourTargetRect && (
                <>
                  <div
                    className="absolute rounded-2xl border-2 border-cyan-300/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] pointer-events-none transition-all duration-200"
                    style={{
                      left: `${tourTargetRect.left - 8}px`,
                      top: `${tourTargetRect.top - 8}px`,
                      width: `${tourTargetRect.width + 16}px`,
                      height: `${tourTargetRect.height + 16}px`
                    }}
                  />
                  <div
                    className="absolute pointer-events-none rounded-full bg-cyan-300 w-3 h-3 animate-ping"
                    style={{
                      left: `${tourTargetRect.left + Math.min(26, tourTargetRect.width / 2)}px`,
                      top: `${tourTargetRect.top + 12}px`
                    }}
                  />
                </>
              )}
              <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#0d1117] p-6 space-y-4 relative">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-2xl font-bold text-white/95">GeoFlux quick tour</h3>
                  <span className="text-xs text-cyan-200/90 border border-cyan-300/30 bg-cyan-500/10 rounded-full px-2 py-1">
                    {tourStepIndex + 1}/{TOUR_STEPS.length}
                  </span>
                </div>
                <div className="space-y-2">
                  <h4 className="text-lg font-semibold text-white/90">{activeTourStep.title}</h4>
                  <p className="text-white/70 text-sm leading-relaxed">{activeTourStep.description}</p>
                  <p className="text-xs uppercase tracking-wide text-cyan-200/80">Target: {activeTourStep.target}</p>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-cyan-400 transition-all duration-300"
                    style={{ width: `${((tourStepIndex + 1) / TOUR_STEPS.length) * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 pt-2">
                  <button
                    onClick={closeTour}
                    className="px-4 py-2 rounded-xl border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition-colors"
                  >
                    Skip
                  </button>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={focusTourTarget}
                      className="px-4 py-2 rounded-xl border border-amber-300/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 transition-colors"
                    >
                      Focus target
                    </button>
                    <button
                      onClick={() => setTourStepIndex((prev) => Math.max(0, prev - 1))}
                      disabled={tourStepIndex === 0}
                      className="px-4 py-2 rounded-xl border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Back
                    </button>
                    {isLastTourStep ? (
                      <button
                        onClick={() => {
                          dismissWelcome()
                          closeTour()
                        }}
                        className="px-4 py-2 rounded-xl border border-cyan-400/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-colors"
                      >
                        Finish tour
                      </button>
                    ) : (
                      <button
                        onClick={() => setTourStepIndex((prev) => Math.min(TOUR_STEPS.length - 1, prev + 1))}
                        className="px-4 py-2 rounded-xl border border-cyan-400/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-colors"
                      >
                        Next
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div data-tour="right-panel">
          <RightPanel />
        </div>
        <Inspector />
        <div data-tour="timeline">
          <Timeline />
        </div>
      </main>
    </div>
  )
}

export default App
