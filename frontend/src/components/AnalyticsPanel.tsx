import { useMemo } from 'react'
import { BarChart3, TrendingUp, Activity, PieChart, FileJson, FileSpreadsheet, Camera } from 'lucide-react'
import { useStore } from '../store/useStore'

const AnalyticsPanel = () => {
  const { viewportFilteredData, isRightPanelOpen, activeDatasetId, datasets } = useStore()

  const activeDataset = useMemo(() => {
    return datasets.find(d => d.id === activeDatasetId)
  }, [datasets, activeDatasetId])

  const analysisType = useMemo(() => {
    if (!activeDataset) return null
    if (activeDataset.id.startsWith('agg-') || activeDataset.type === 'grid') {
      const name = activeDataset.name.toUpperCase()
      if (name.includes('BUFFER')) return 'buffer'
      if (name.includes('CLUSTER')) return 'clustering'
      if (name.includes('AGGREGATION') || activeDataset.type === 'grid') return 'aggregation'
    }
    return null
  }, [activeDataset])

  const stats = useMemo(() => {
    const points = viewportFilteredData
    if (points.length === 0) return null

    let min = Infinity
    let max = -Infinity
    let total = 0
    const catMap: Record<string, number> = {}
    const histogram: Record<number, number> = {}
    const bucketSize = 10

    // Tool-specific counters
    const clusters = new Map<string, { count: number, totalValue: number }>()
    let outlierCount = 0

    points.forEach(p => {
      const v = p.value || 0
      if (v < min) min = v
      if (v > max) max = v
      total += v
      
      const cat = p.category || 'Other'
      catMap[cat] = (catMap[cat] || 0) + 1

      const bucket = Math.floor(v / bucketSize) * bucketSize
      histogram[bucket] = (histogram[bucket] || 0) + 1

      // Advanced Clustering Stats
      if (analysisType === 'clustering') {
        const clusterId = String(p.metadata?.dbscan || p.metadata?.cluster)
        if (clusterId === 'noise' || clusterId === 'undefined') {
          outlierCount++
        } else {
          const existing = clusters.get(clusterId) || { count: 0, totalValue: 0 }
          existing.count++
          existing.totalValue += v
          clusters.set(clusterId, existing)
        }
      }
    })

    // Rank the top features
    const topInsights = Array.from(clusters.entries())
      .map(([id, data]) => ({ id, ...data, avg: data.totalValue / data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)

    return {
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
      avg: total / points.length,
      count: points.length,
      total,
      categoryBreakdown: catMap,
      histogram,
      // Tool-specific stats
      clusterCount: clusters.size,
      outlierCount,
      topInsights
    }
  }, [viewportFilteredData, analysisType])

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
        <div className="flex flex-col gap-1">
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 flex items-center gap-2">
            <BarChart3 size={12} className="text-cyan-500" />
            Intelligence Hub
          </h2>
          <div className="text-[9px] text-white/20 font-medium uppercase tracking-widest">Real-time viewport analytics</div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={exportCSV}
            title="Export CSV"
            className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <FileSpreadsheet size={14} />
          </button>
          <button 
            onClick={exportJSON}
            title="Export JSON"
            className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <FileJson size={14} />
          </button>
        </div>
      </div>

      {stats ? (
        <div className="space-y-6">
          {/* Spatial Analysis Header */}
          {analysisType && (
            <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 animate-in zoom-in-95">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                <div className="text-[10px] font-black text-orange-400 uppercase tracking-widest">
                  Analyzing {analysisType} Result
                </div>
              </div>
            </div>
          )}

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
              <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Visibility</div>
              <div className="text-2xl font-black text-white">{stats.count.toLocaleString()}</div>
              <div className="text-[9px] text-white/30">{analysisType === 'aggregation' ? 'Total Cells' : 'Active features'}</div>
            </div>
            {analysisType === 'clustering' ? (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
                <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Clusters</div>
                <div className="text-2xl font-black text-orange-400">{stats.clusterCount}</div>
                <div className="text-[9px] text-white/30">{stats.outlierCount} noise points</div>
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
                <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Mean Value</div>
                <div className="text-2xl font-black text-cyan-400">{stats.avg.toFixed(1)}</div>
                <div className="text-[9px] text-white/30">Intensity score</div>
              </div>
            )}
          </div>

          {/* Spatial Discoveries (Rankings) */}
          {(analysisType === 'clustering' || analysisType === 'aggregation') && stats.topInsights.length > 0 && (
            <div className="space-y-4 animate-in slide-in-from-right-2">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 px-1">
                {analysisType === 'clustering' ? 'Top Clusters' : 'Top Hotspots'}
              </h3>
              <div className="space-y-2">
                {stats.topInsights.map((insight, i) => (
                  <div key={insight.id} className="p-3 rounded-xl bg-orange-500/5 border border-orange-500/10 flex items-center justify-between group hover:bg-orange-500/10 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-lg bg-orange-500/20 flex items-center justify-center text-[10px] font-black text-orange-400">
                        #{i + 1}
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-white uppercase tracking-tight">
                          {analysisType === 'clustering' ? `Cluster ID: ${insight.id}` : `Grid Cell ${i+1}`}
                        </div>
                        <div className="text-[9px] text-white/40 font-mono">
                          {insight.count} {analysisType === 'clustering' ? 'Significant points' : 'Observations'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-black text-orange-400">
                        {analysisType === 'clustering' 
                          ? `${(insight.count / stats.count * 100).toFixed(1)}%` 
                          : insight.totalValue.toFixed(1)}
                      </div>
                      <div className="text-[8px] text-white/20 uppercase font-bold">
                        {analysisType === 'clustering' ? 'Concentration' : 'Intensity'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
