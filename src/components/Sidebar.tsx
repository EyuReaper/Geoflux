import React, { useRef, useMemo } from 'react'
import { Upload, X, CheckCircle2, Search, Filter } from 'lucide-react'
import Papa from 'papaparse'
import { useStore } from '../store/useStore'
import { cn } from '../lib/utils'
import type { DataPoint } from '../types'

const Sidebar = () => {
  const { isSidebarOpen, setData, setLoading, data, filters, setFilters } = useStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const categories = useMemo(() => {
    const cats = new Set<string>()
    data.forEach(d => { if (d.category) cats.add(d.category) })
    return Array.from(cats)
  }, [data])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    const reader = new FileReader()

    if (file.name.endsWith('.json')) {
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string)
          const rawData = Array.isArray(json) ? json : [json]
          setData(rawData.map((d: Record<string, unknown>, i: number) => ({
            id: i,
            lat: Number(d.lat || d.latitude || 0),
            lng: Number(d.lng || d.longitude || 0),
            value: Number(d.value || d.mag || d.count || 0),
            category: String(d.category || d.type || 'default'),
            metadata: d
          } as DataPoint)))
        } catch (err) {
          console.error("Failed to parse JSON", err)
        }
      }
      reader.readAsText(file)
    } else if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        complete: (results: Papa.ParseResult<Record<string, unknown>>) => {
          setData(results.data.map((d: Record<string, unknown>, i: number) => ({
            id: i,
            lat: Number(d.lat || d.latitude || 0),
            lng: Number(d.lng || d.longitude || 0),
            value: Number(d.value || d.mag || d.count || 0),
            category: String(d.category || d.type || 'default'),
            metadata: d
          } as DataPoint)))
        }
      })
    }
  }

  return (
    <aside 
      className={cn(
        "fixed left-0 top-16 bottom-0 w-80 bg-black/40 backdrop-blur-xl border-r border-white/10 z-[1000] transition-transform duration-300 ease-in-out",
        !isSidebarOpen && "-translate-x-full"
      )}
    >
      <div className="p-6 space-y-8 overflow-y-auto h-full pb-20">
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/40 flex items-center gap-2">
            <Upload size={14} />
            Datasets
          </h2>
          
          {data.length > 0 ? (
            <div className="bg-white/5 rounded-xl border border-white/10 p-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setData([])} className="p-1 hover:bg-white/10 rounded-md text-white/50 hover:text-white">
                  <X size={14} />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center text-cyan-400">
                  <CheckCircle2 size={20} />
                </div>
                <div>
                  <div className="text-sm font-medium text-white">Active Dataset</div>
                  <div className="text-xs text-white/40">{data.length} records mapped</div>
                </div>
              </div>
            </div>
          ) : (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-white/10 hover:border-cyan-500/50 rounded-2xl p-8 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all bg-white/[0.02] hover:bg-white/[0.04] group"
            >
              <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Upload size={24} className="text-white/40 group-hover:text-cyan-400" />
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-white/80">Click to upload</div>
                <div className="text-xs text-white/40 mt-1">JSON or CSV supported</div>
              </div>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
                accept=".json,.csv"
              />
            </div>
          )}
        </div>

        {data.length > 0 && (
          <>
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white/40 flex items-center gap-2">
                <Filter size={14} />
                Smart Filters
              </h2>

              {/* Search */}
              <div className="relative group">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-cyan-400 transition-colors" />
                <input 
                  type="text"
                  placeholder="Search metadata..."
                  value={filters.searchQuery}
                  onChange={(e) => setFilters({ searchQuery: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-9 pr-4 text-xs focus:outline-none focus:border-cyan-500/50 transition-all"
                />
              </div>

              {/* Value Range */}
              <div className="space-y-3 p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold uppercase text-white/40">Value Range</span>
                  <span className="text-[10px] font-mono text-cyan-400">{filters.minValue} - {filters.maxValue}</span>
                </div>
                <div className="space-y-1">
                  <input 
                    type="range"
                    min="0" max="100"
                    value={filters.minValue}
                    onChange={(e) => setFilters({ minValue: parseInt(e.target.value) })}
                    className="w-full accent-cyan-500"
                  />
                  <input 
                    type="range"
                    min="0" max="100"
                    value={filters.maxValue}
                    onChange={(e) => setFilters({ maxValue: parseInt(e.target.value) })}
                    className="w-full accent-cyan-500"
                  />
                </div>
              </div>

              {/* Categories */}
              {categories.length > 0 && (
                <div className="space-y-3">
                  <span className="text-[10px] font-bold uppercase text-white/40">Categories</span>
                  <div className="flex flex-wrap gap-2">
                    {categories.map(cat => (
                      <button
                        key={cat}
                        onClick={() => {
                          const newCats = filters.categories.includes(cat)
                            ? filters.categories.filter(c => c !== cat)
                            : [...filters.categories, cat]
                          setFilters({ categories: newCats })
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-[10px] font-bold border transition-all",
                          filters.categories.includes(cat)
                            ? "bg-cyan-500 border-cyan-500 text-black shadow-lg shadow-cyan-500/20"
                            : "bg-white/5 border-white/10 text-white/40 hover:text-white"
                        )}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white/40">Field Mapping</h2>
              <div className="space-y-3">
                {['Latitude', 'Longitude', 'Value', 'Category'].map((field) => (
                  <div key={field} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                    <span className="text-xs font-medium text-white/60">{field}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded uppercase font-bold tracking-tighter">Auto</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

export default Sidebar
