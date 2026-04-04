import { X, Info, Database, MapPin, Calendar, Layers } from 'lucide-react'
import { useStore } from '../store/useStore'
import { cn } from '../lib/utils'
import type { DataPoint } from '../types'

const Inspector = () => {
  const { isInspectorOpen, selectedEntity, closeInspector } = useStore()

  if (!selectedEntity) return null

  const { type, data } = selectedEntity
  const metadata = type === 'point' ? (data as DataPoint).metadata : (data as Record<string, unknown>)
  
  // Type safe access to shared properties using casting
  const shared = data as Record<string, unknown>
  const value = shared.value as number | undefined
  const category = shared.category as string | undefined
  const lat = shared.lat as number | undefined
  const lng = shared.lng as number | undefined
  const h3Index = shared.h3Index as string | undefined
  const timestamp = shared.timestamp as string | number | Date | undefined

  const formatDate = (val: unknown) => {
    if (!val) return 'N/A'
    try {
      return new Date(val as string | number | Date).toLocaleString()
    } catch {
      return String(val)
    }
  }

  return (
    <aside 
      className={cn(
        "fixed right-0 top-16 bottom-0 w-96 bg-[#0a0a0a]/95 backdrop-blur-2xl border-l border-white/10 z-[2000] transition-transform duration-500 ease-out shadow-[-20px_0_50px_rgba(0,0,0,0.5)]",
        !isInspectorOpen ? "translate-x-full" : "translate-x-0"
      )}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 border border-cyan-500/20">
              {type === 'point' ? <MapPin size={20} /> : <Layers size={20} />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                {type === 'point' ? 'Data Point' : 'Grid Cell'}
              </h2>
              <p className="text-[10px] text-white/40 font-medium uppercase tracking-tight">Inspector</p>
            </div>
          </div>
          <button 
            onClick={closeInspector}
            className="p-2 hover:bg-white/10 rounded-full text-white/40 hover:text-white transition-all"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          {/* Core Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-1">
              <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Value</span>
              <div className="text-2xl font-bold text-cyan-400 tabular-nums">
                {typeof value === 'number' ? value.toFixed(2) : 'N/A'}
              </div>
            </div>
            <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-1">
              <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Category</span>
              <div className="text-sm font-bold text-white truncate">
                {category || 'Default'}
              </div>
            </div>
          </div>

          {/* Location/Identity */}
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] flex items-center gap-2">
              <Info size={12} /> Spatial Context
            </h3>
            <div className="space-y-2">
              {type === 'point' ? (
                <>
                  <div className="flex justify-between items-center p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <span className="text-xs text-white/40">Latitude</span>
                    <span className="text-xs font-mono text-white/80">{lat?.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <span className="text-xs text-white/40">Longitude</span>
                    <span className="text-xs font-mono text-white/80">{lng?.toFixed(6)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between items-center p-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <span className="text-xs text-white/40">H3 Index</span>
                  <span className="text-xs font-mono text-cyan-400">{h3Index || 'N/A'}</span>
                </div>
              )}
              {timestamp && (
                <div className="flex justify-between items-center p-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="flex items-center gap-2 text-xs text-white/40">
                    <Calendar size={12} /> Timestamp
                  </div>
                  <span className="text-xs font-mono text-white/80">{formatDate(timestamp)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Full Metadata */}
          {metadata && Object.keys(metadata).length > 0 && (
            <div className="space-y-4">
              <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] flex items-center gap-2">
                <Database size={12} /> Raw Metadata
              </h3>
              <div className="bg-white/5 rounded-2xl border border-white/5 overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <tbody>
                    {Object.entries(metadata).map(([key, val], i) => (
                      <tr key={key} className={cn(
                        "border-b border-white/5 last:border-0",
                        i % 2 === 0 ? "bg-white/[0.01]" : "bg-transparent"
                      )}>
                        <td className="p-3 text-[10px] font-bold text-white/20 uppercase tracking-tighter w-1/3 align-top">{key}</td>
                        <td className="p-3 text-xs text-white/70 font-mono break-all">
                          {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 bg-white/[0.01]">
          <p className="text-[9px] text-white/20 text-center uppercase tracking-widest leading-relaxed">
            GeoFlux Intelligence Engine<br/>
            Real-time Geospatial Inspection Active
          </p>
        </div>
      </div>
    </aside>
  )
}

export default Inspector
