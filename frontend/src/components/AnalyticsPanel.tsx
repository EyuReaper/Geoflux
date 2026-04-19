import { useMemo } from 'react'
import { BarChart3, TrendingUp, Activity, PieChart, Download, FileJson, FileSpreadsheet, Camera } from 'lucide-react'
import { useStore } from '../store/useStore'
import { cn } from '../lib/utils'

const AnalyticsPanel = () => {
  const { viewportFilteredData, activeDatasetId, datasets, isRightPanelOpen } = useStore()

  const activeDataset = useMemo(() => 
    datasets.find(d => d.id === activeDatasetId), 
    [datasets, activeDatasetId]
  )

  const stats = useMemo(() => {
    const points = viewportFilteredData
    if (points.length === 0) return null

    let min = Infinity
    let max = -Infinity
    let total = 0
    const catMap: Record<string, number> = {}
    const histogram: Record<number, number> = {}
    const bucketSize = 10

    points.forEach(p => {
      const v = p.value || 0
      if (v < min) min = v
      if (v > max) max = v
      total += v
      
      const cat = p.category || 'Other'
      catMap[cat] = (catMap[cat] || 0) + 1

      const bucket = Math.floor(v / bucketSize) * bucketSize
      histogram[bucket] = (histogram[bucket] || 0) + 1
    })

    return {
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
      avg: total / points.length,
      count: points.length,
      total,
      categoryBreakdown: catMap,
      histogram
    }
  }, [viewportFilteredData])

  const exportCSV = () => {
    if (viewportFilteredData.length === 0) return
    const headers = Object.keys(viewportFilteredData[0].metadata || {}).join(',')
    const rows = viewportFilteredData.map(p => 
      Object.values(p.metadata || {}).map(v => `"${v}"`).join(',')
    ).join('\n')
    const csvContent = `data:text/csv;charset=utf-8,${headers}\n${rows}`
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `geoflux_export_${Date.now()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const exportJSON = () => {
    if (viewportFilteredData.length === 0) return
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(viewportFilteredData.map(p => p.metadata)))
    const downloadAnchorNode = document.createElement('a')
    downloadAnchorNode.setAttribute("href", dataStr)
    downloadAnchorNode.setAttribute("download", `geoflux_export_${Date.now()}.json`)
    document.body.appendChild(downloadAnchorNode)
    downloadAnchorNode.click()
    downloadAnchorNode.remove()
  }

  if (!isRightPanelOpen) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/40 flex items-center gap-2">
          <BarChart3 size={14} className="text-cyan-400" />
          Analytics Dashboard
        </h2>
        <div className="flex gap-2">
          <button 
            onClick={exportCSV}
            title="Export CSV"
            className="p-1.5 rounded-md bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <FileSpreadsheet size={14} />
          </button>
          <button 
            onClick={exportJSON}
            title="Export JSON"
            className="p-1.5 rounded-md bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <FileJson size={14} />
          </button>
        </div>
      </div>

      {stats ? (
        <div className="space-y-6">
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
              <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Visibility</div>
              <div className="text-2xl font-black text-white">{stats.count.toLocaleString()}</div>
              <div className="text-[9px] text-white/30">Active features</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
              <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Mean Value</div>
              <div className="text-2xl font-black text-cyan-400">{stats.avg.toFixed(1)}</div>
              <div className="text-[9px] text-white/30">Intensity score</div>
            </div>
          </div>

          {/* Value Distribution Histogram */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] font-bold text-white/40 uppercase tracking-tight">
                <TrendingUp size={12} /> Distribution
              </div>
              <div className="text-[9px] font-mono text-white/20">Range: {stats.min.toFixed(0)}-{stats.max.toFixed(0)}</div>
            </div>
            <div className="h-24 flex items-end gap-1 px-1">
              {Array.from({ length: 10 }).map((_, i) => {
                const bucket = i * 10
                const count = stats.histogram[bucket] || 0
                const height = Math.max(4, (count / stats.count) * 100)
                return (
                  <div 
                    key={i} 
                    className="flex-1 bg-cyan-500/20 rounded-t-sm hover:bg-cyan-500 transition-all group relative"
                    style={{ height: `${height}%` }}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-white text-black text-[8px] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                      {count} items
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-between text-[8px] font-mono text-white/20 px-1">
              <span>0</span>
              <span>50</span>
              <span>100</span>
            </div>
          </div>

          {/* Categorical Breakdown */}
          {Object.keys(stats.categoryBreakdown).length > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
              <div className="flex items-center gap-2 text-[10px] font-bold text-white/40 uppercase tracking-tight">
                <PieChart size={12} /> Composition
              </div>
              <div className="space-y-3">
                {Object.entries(stats.categoryBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([cat, count]) => (
                    <div key={cat} className="space-y-1.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-white/70 font-bold">{cat}</span>
                        <span className="text-white/30 tabular-nums">{Math.round((count / stats.count) * 100)}%</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-cyan-500/40 to-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.3)]" 
                          style={{ width: `${(count / stats.count) * 100}%` }} 
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center bg-white/5 border border-dashed border-white/10 rounded-2xl">
          <Activity size={32} className="text-white/10 mb-4" />
          <p className="text-xs text-white/30 leading-relaxed font-medium">
            Zoom in or adjust filters to generate real-time analytics for the current viewport.
          </p>
        </div>
      )}

      {/* Export Section */}
      <div className="pt-4 border-t border-white/5">
        <button 
          onClick={() => window.print()}
          className="w-full flex items-center justify-center gap-3 py-3 rounded-xl bg-white text-black text-[10px] font-black uppercase tracking-[0.1em] hover:bg-cyan-400 transition-all shadow-xl shadow-white/5"
        >
          <Camera size={14} />
          Generate Report
        </button>
      </div>
    </div>
  )
}

export default AnalyticsPanel
