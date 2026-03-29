import { useEffect } from 'react'
import { Layers, MousePointer2, Flame, Map as MapIcon, Sliders, Palette, Radio, Sun, Moon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore } from '../store/useStore'
import { cn } from '../lib/utils'
import type { VisualizationMode } from '../types'

const RightPanel = () => {
  const { 
    isRightPanelOpen, mode, setMode, mapStyle, 
    updateMapStyle, data, isLive, toggleLive, 
    updateDataPoints, mapStyleType, setMapStyleType 
  } = useStore()

  useEffect(() => {
    let interval: number | undefined
    if (isLive && data.length > 0) {
      interval = window.setInterval(() => {
        updateDataPoints()
      }, 2000)
    }
    return () => clearInterval(interval)
  }, [isLive, data.length, updateDataPoints])

  const modes: { id: VisualizationMode; label: string; icon: LucideIcon }[] = [
    { id: 'markers', label: 'Markers', icon: MousePointer2 },
    { id: 'heatmap', label: 'Heatmap', icon: Flame },
    { id: 'choropleth', label: 'Area', icon: MapIcon },
  ]

  return (
    <aside 
      className={cn(
        "fixed right-0 top-16 bottom-0 w-80 bg-black/40 backdrop-blur-xl border-l border-white/10 z-[1000] transition-transform duration-300 ease-in-out",
        !isRightPanelOpen && "translate-x-full"
      )}
    >
      <div className="p-6 space-y-8 overflow-y-auto h-full">
        {data.length > 0 && (
          <div className="space-y-4">
             <h2 className="text-sm font-semibold uppercase tracking-wider text-white/40 flex items-center gap-2">
              <Radio size={14} className={cn(isLive && "text-red-500 animate-pulse")} />
              Live Stream
            </h2>
            <button 
              onClick={toggleLive}
              className={cn(
                "w-full flex items-center justify-between p-4 rounded-2xl border transition-all",
                isLive 
                  ? "bg-red-500/10 border-red-500/20 text-red-500" 
                  : "bg-white/5 border-white/10 text-white/40 hover:text-white"
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  isLive ? "bg-red-500 animate-pulse" : "bg-white/20"
                )} />
                <span className="text-sm font-bold uppercase tracking-tight">
                  {isLive ? 'Simulation Active' : 'Start Simulation'}
                </span>
              </div>
              <div className={cn(
                "w-10 h-5 rounded-full relative transition-colors",
                isLive ? "bg-red-500" : "bg-white/10"
              )}>
                <div className={cn(
                  "absolute top-1 w-3 h-3 rounded-full bg-white transition-all",
                  isLive ? "left-6" : "left-1"
                )} />
              </div>
            </button>
          </div>
        )}

        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/40 flex items-center gap-2">
            <Sun size={14} />
            Map Theme
          </h2>
          <div className="flex p-1 bg-white/5 rounded-xl border border-white/10">
            <button 
              onClick={() => setMapStyleType('dark')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold uppercase transition-all",
                mapStyleType === 'dark' ? "bg-white/10 text-white" : "text-white/40 hover:text-white"
              )}
            >
              <Moon size={14} />
              Dark
            </button>
            <button 
              onClick={() => setMapStyleType('light')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold uppercase transition-all",
                mapStyleType === 'light' ? "bg-white/10 text-white" : "text-white/40 hover:text-white"
              )}
            >
              <Sun size={14} />
              Light
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/40 flex items-center gap-2">
            <Layers size={14} />
            Visualization Mode
          </h2>
          <div className="grid grid-cols-3 gap-2 p-1 bg-white/5 rounded-xl border border-white/10">
            {modes.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  "flex flex-col items-center gap-1.5 py-3 rounded-lg transition-all",
                  mode === m.id 
                    ? "bg-cyan-500 text-black shadow-lg shadow-cyan-500/20" 
                    : "text-white/40 hover:text-white hover:bg-white/5"
                )}
              >
                <m.icon size={18} />
                <span className="text-[10px] font-bold uppercase tracking-tight">{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/40 flex items-center gap-2">
            <Sliders size={14} />
            Style Settings
          </h2>
          
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex justify-between">
                <label className="text-xs font-medium text-white/60">Opacity</label>
                <span className="text-xs text-cyan-400 font-mono">{Math.round(mapStyle.opacity * 100)}%</span>
              </div>
              <input 
                type="range" 
                min="0" max="1" step="0.1" 
                value={mapStyle.opacity}
                onChange={(e) => updateMapStyle({ opacity: parseFloat(e.target.value) })}
                className="w-full accent-cyan-500"
              />
            </div>

            {mode === 'markers' && (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <label className="text-xs font-medium text-white/60">Marker Size</label>
                  <span className="text-xs text-cyan-400 font-mono">{mapStyle.pointSize}px</span>
                </div>
                <input 
                  type="range" 
                  min="1" max="20" step="1" 
                  value={mapStyle.pointSize}
                  onChange={(e) => updateMapStyle({ pointSize: parseInt(e.target.value) })}
                  className="w-full accent-cyan-500"
                />
              </div>
            )}

            {mode === 'heatmap' && (
              <>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <label className="text-xs font-medium text-white/60">Heat Radius</label>
                    <span className="text-xs text-cyan-400 font-mono">{mapStyle.heatmapRadius}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="10" max="100" step="5" 
                    value={mapStyle.heatmapRadius}
                    onChange={(e) => updateMapStyle({ heatmapRadius: parseInt(e.target.value) })}
                    className="w-full accent-cyan-500"
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <label className="text-xs font-medium text-white/60">Intensity</label>
                    <span className="text-xs text-cyan-400 font-mono">{mapStyle.heatmapIntensity}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" max="10" step="0.5" 
                    value={mapStyle.heatmapIntensity}
                    onChange={(e) => updateMapStyle({ heatmapIntensity: parseFloat(e.target.value) })}
                    className="w-full accent-cyan-500"
                  />
                </div>
              </>
            )}

            <div className="pt-4 border-t border-white/5 space-y-4">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/20 flex items-center gap-2">
                <Palette size={12} />
                Color Palette
              </h3>
              <div className="flex gap-2">
                {['#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316'].map(color => (
                  <button 
                    key={color}
                    onClick={() => updateMapStyle({ pointColor: color })}
                    className={cn(
                      "w-8 h-8 rounded-full border-2 transition-transform hover:scale-110",
                      mapStyle.pointColor === color ? "border-white shadow-lg" : "border-transparent"
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {data.length > 0 && (
          <div className="bg-cyan-500/5 rounded-2xl border border-cyan-500/10 p-4">
            <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-tighter mb-2">Live Statistics</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] text-white/40 uppercase font-bold">Total Points</div>
                <div className="text-lg font-bold text-white tracking-tighter">{data.length.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/40 uppercase font-bold">Density</div>
                <div className="text-lg font-bold text-white tracking-tighter">High</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

export default RightPanel
