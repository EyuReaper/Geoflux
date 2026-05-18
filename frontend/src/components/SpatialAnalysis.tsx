import { useState, useMemo } from 'react'
import { Hexagon, Square, Play, Trash2, Info, ChevronDown } from 'lucide-react'
import { useStore } from '../store/useStore'
import { cn } from '../lib/utils'

const SpatialAnalysis = () => {
  const { 
    datasets, 
    spatialAggregationConfig, 
    setSpatialAggregationConfig, 
    performSpatialAggregation, 
    clearSpatialAggregation,
    aggregatedDatasetId,
    isLoading
  } = useStore()

  const [isExpanded, setIsExpanded] = useState(true)

  const activeDataset = useMemo(() => {
    return datasets.find(d => d.id === spatialAggregationConfig.sourceDatasetId)
  }, [datasets, spatialAggregationConfig.sourceDatasetId])

  const numericFields = useMemo(() => {
    if (!activeDataset?.data || activeDataset.data.length === 0) {
      // If data is empty (MVT mode), we might not know numeric fields easily without a separate metadata fetch
      // For now, assume if stats exists, we might have some info, or just list all availableFields
      // Actually, useStore sets availableFields when setActiveDataset is called.
      // Let's assume we want to use availableFields from the store.
      return useStore.getState().availableFields
    }
    
    // Check first 10 rows to see what fields are numeric
    const sample = activeDataset.data.slice(0, 10)
    const fields = new Set<string>()
    sample.forEach(d => {
      Object.entries(d.metadata || {}).forEach(([k, v]) => {
        if (typeof v === 'number') fields.add(k)
      })
    })
    return Array.from(fields)
  }, [activeDataset])

  const handleRun = async () => {
    await performSpatialAggregation()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/40 flex items-center gap-2">
          <Hexagon size={14} className="text-orange-400" />
          Spatial Analytics
        </h2>
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1 text-white/20 hover:text-white transition-colors"
        >
          <ChevronDown size={14} className={cn("transition-transform", !isExpanded && "-rotate-90")} />
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
          {/* Source Dataset Selection */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase text-white/20 tracking-widest px-1">Source Dataset</label>
            <select 
              value={spatialAggregationConfig.sourceDatasetId || ''}
              onChange={(e) => setSpatialAggregationConfig({ sourceDatasetId: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50 appearance-none"
            >
              <option value="" disabled className="bg-[#1a1a1a]">Select Dataset</option>
              {datasets.filter(d => !d.id.startsWith('agg-')).map(d => (
                <option key={d.id} value={d.id} className="bg-[#1a1a1a]">{d.name}</option>
              ))}
            </select>
          </div>

          {/* Grid Configuration */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase text-white/20 tracking-widest px-1">Grid Type</label>
              <div className="flex p-1 bg-white/5 rounded-xl border border-white/10">
                <button 
                  onClick={() => setSpatialAggregationConfig({ targetGridType: 'hex' })}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold uppercase transition-all",
                    spatialAggregationConfig.targetGridType === 'hex' ? "bg-orange-500 text-black" : "text-white/40 hover:text-white"
                  )}
                >
                  <Hexagon size={12} />
                  Hex
                </button>
                <button 
                  onClick={() => setSpatialAggregationConfig({ targetGridType: 'square' })}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold uppercase transition-all",
                    spatialAggregationConfig.targetGridType === 'square' ? "bg-orange-500 text-black" : "text-white/40 hover:text-white"
                  )}
                >
                  <Square size={12} />
                  Square
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase text-white/20 tracking-widest px-1">Resolution</label>
              <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex items-center justify-between">
                <input 
                  type="number"
                  min={spatialAggregationConfig.targetGridType === 'hex' ? 1 : 0.001}
                  max={spatialAggregationConfig.targetGridType === 'hex' ? 10 : 2}
                  step={spatialAggregationConfig.targetGridType === 'hex' ? 1 : 0.05}
                  value={spatialAggregationConfig.gridResolution}
                  onChange={(e) => setSpatialAggregationConfig({ gridResolution: parseFloat(e.target.value) })}
                  className="bg-transparent w-full text-xs text-orange-400 font-mono focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Aggregation Field */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase text-white/20 tracking-widest px-1">Value Field (Optional)</label>
            <select 
              value={spatialAggregationConfig.aggregationField || ''}
              onChange={(e) => setSpatialAggregationConfig({ aggregationField: e.target.value || null })}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50 appearance-none"
            >
              <option value="" className="bg-[#1a1a1a]">Count Only</option>
              {numericFields.map(field => (
                <option key={field} value={field} className="bg-[#1a1a1a]">{field}</option>
              ))}
            </select>
            <p className="text-[9px] text-white/20 italic px-1 flex items-center gap-1">
              <Info size={10} />
              If empty, binning will count number of points.
            </p>
          </div>

          {/* Persistence Toggle */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between px-1">
              <label className="text-[10px] font-bold uppercase text-white/20 tracking-widest">Save Result Permanently</label>
              <button 
                onClick={() => setSpatialAggregationConfig({ persist: !spatialAggregationConfig.persist })}
                className={cn(
                  "w-8 h-4 rounded-full relative transition-colors",
                  spatialAggregationConfig.persist ? "bg-orange-500" : "bg-white/10"
                )}
              >
                <div className={cn(
                  "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
                  spatialAggregationConfig.persist ? "left-4.5" : "left-0.5"
                )} />
              </button>
            </div>

            {spatialAggregationConfig.persist && (
              <div className="space-y-2 animate-in slide-in-from-left-2">
                <label className="text-[10px] font-bold uppercase text-white/20 tracking-widest px-1">Result Name</label>
                <input 
                  type="text"
                  placeholder="Enter analysis name..."
                  value={spatialAggregationConfig.customName || ''}
                  onChange={(e) => setSpatialAggregationConfig({ customName: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button 
              onClick={handleRun}
              disabled={!spatialAggregationConfig.sourceDatasetId || isLoading}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                isLoading 
                  ? "bg-white/5 text-white/20 cursor-not-allowed" 
                  : "bg-orange-500 text-black hover:bg-orange-400 shadow-lg shadow-orange-500/20"
              )}
            >
              {isLoading ? (
                <div className="w-3 h-3 border-2 border-black/20 border-t-black rounded-full animate-spin" />
              ) : <Play size={14} fill="currentColor" />}
              {spatialAggregationConfig.persist ? 'Run & Save' : 'Run Analysis'}
            </button>
            
            {aggregatedDatasetId && (
              <button 
                onClick={clearSpatialAggregation}
                className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500/20 transition-all"
                title="Clear Results"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      )}
      
      {aggregatedDatasetId && (
        <div className="p-3 rounded-xl bg-orange-500/5 border border-orange-500/20 flex items-center justify-between animate-in zoom-in-95">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-orange-500" />
            <div className="text-[10px] font-bold text-white uppercase tracking-tight">Analysis Result Ready</div>
          </div>
          <span className="text-[9px] text-orange-400/60 font-mono">1 Dataset Added</span>
        </div>
      )}
    </div>
  )
}

export default SpatialAnalysis
