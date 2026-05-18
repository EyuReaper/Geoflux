import React, { useRef, useMemo } from "react";
import {
  Upload,
  X,
  Search,
  Filter,
  Settings2,
  Download,
  FileJson,
  FileSpreadsheet,
  Eye,
  EyeOff,
  Plus,
  Layers,
} from "lucide-react";
import Papa from "papaparse";
import { useStore } from "../store/useStore";
import { cn } from "../lib/utils";
import type { FieldMapping } from "../types";
import Transformations from "./Transformations";

const MappingRow = ({
  label,
  field,
  value,
  availableFields,
  setFieldMapping,
}: {
  label: string;
  field: keyof FieldMapping;
  value: string;
  availableFields: string[];
  setFieldMapping: (mapping: Partial<FieldMapping>) => void;
}) => (
  <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-white/5 border border-white/5">
    <span className="text-[10px] font-bold uppercase text-white/40 tracking-wider">
      {label}
    </span>
    <select
      value={value}
      onChange={(e) => setFieldMapping({ [field]: e.target.value })}
      className="bg-transparent text-xs text-cyan-400 font-medium outline-none cursor-pointer hover:text-cyan-300 transition-colors"
    >
      <option value="" className="bg-black text-white">
        None (Default)
      </option>
      {availableFields.map((f) => (
        <option key={f} value={f} className="bg-black text-white">
          {f}
        </option>
      ))}
    </select>
  </div>
);

const Sidebar = () => {
  const {
    isSidebarOpen,
    data,
    filteredData,
    filters,
    setFilters,
    availableFields,
    fieldMapping,
    setFieldMapping,
    datasets,
    activeDatasetId,
    addDataset,
    removeDataset,
    toggleDatasetVisibility,
    setActiveDataset,
  } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    // If we have global data (small datasets), use it
    if (data.length > 0) {
      data.forEach((d) => {
        if (d.category) cats.add(d.category);
      });
    } else {
      // Otherwise use stats from visible datasets (MVT mode)
      datasets
        .filter((ds) => ds.isVisible)
        .forEach((ds) => {
          ds.stats?.categories.forEach((c) => cats.add(c));
        });
    }
    return Array.from(cats);
  }, [data, datasets]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    const fileName = file.name.split(".")[0];

    if (file.name.endsWith(".json")) {
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          const rawData = Array.isArray(json) ? json : [json];
          addDataset(fileName, rawData);
        } catch (err) {
          console.error("Failed to parse JSON", err);
        }
      };
      reader.readAsText(file);
    } else if (file.name.endsWith(".csv")) {
      Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        complete: (results: Papa.ParseResult<Record<string, unknown>>) => {
          addDataset(fileName, results.data);
        },
      });
    }
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(filteredData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `geoflux_export_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    // Flatten metadata for CSV export
    const csvData = filteredData.map((d) => ({
      id: d.id,
      lat: d.lat,
      lng: d.lng,
      value: d.value,
      category: d.category,
      timestamp: d.timestamp,
      ...(typeof d.metadata === "object" ? d.metadata : {}),
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `geoflux_export_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-16 bottom-0 w-80 bg-[#0a0a0a]/80 backdrop-blur-2xl border-r border-white/5 z-[1000] transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]",
        !isSidebarOpen && "-translate-x-full",
      )}
    >
      <div className="p-6 space-y-8 overflow-y-auto h-full pb-20 scrollbar-hide">
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 flex items-center gap-2">
                <Layers size={12} className="text-cyan-500" />
                Data Source Control
              </h2>
              <div className="text-[9px] text-white/20 font-medium uppercase tracking-widest">
                Managing {datasets.length} active layers
              </div>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="group p-2 rounded-xl bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500 hover:text-black transition-all duration-300 border border-cyan-500/20 hover:border-cyan-500 shadow-lg shadow-cyan-500/0 hover:shadow-cyan-500/20"
            >
              <Plus
                size={14}
                className="group-hover:rotate-90 transition-transform duration-300"
              />
            </button>
          </div>

          <div className="space-y-2.5">
            {datasets.map((ds) => {
              const isLocal = ds.id.startsWith("local-");
              const isAggregated = !!ds.aggregatedGeoJson;
              const isTiled = !isLocal && !isAggregated && ds.data.length === 0;

              return (
                <div
                  key={ds.id}
                  className={cn(
                    "group relative p-3.5 rounded-2xl border transition-all duration-300 cursor-pointer overflow-hidden",
                    activeDatasetId === ds.id
                      ? "bg-white/10 border-white/10 shadow-2xl shadow-black"
                      : "bg-white/[0.03] border-white/[0.03] hover:bg-white/[0.06] hover:border-white/10",
                  )}
                  onClick={() => setActiveDataset(ds.id)}
                >
                  {/* Mode Indicator Line */}
                  <div
                    className={cn(
                      "absolute left-0 top-0 bottom-0 w-1 transition-all duration-300",
                      activeDatasetId === ds.id
                        ? "opacity-100"
                        : "opacity-30 group-hover:opacity-60",
                    )}
                    style={{ backgroundColor: ds.color }}
                  />

                  <div className="flex items-center justify-between gap-3 relative z-10">
                    <div className="flex flex-col gap-1 overflow-hidden">
                      <div className="flex items-center gap-2">
                        <div className="text-xs font-bold text-white/90 truncate group-hover:text-white transition-colors">
                          {ds.name}
                        </div>

                        {/* Status Badges */}
                        {isAggregated ? (
                          <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 font-black uppercase tracking-tighter">
                            Aggregated
                          </span>
                        ) : isLocal ? (
                          <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-black uppercase tracking-tighter">
                            Local
                          </span>
                        ) : isTiled ? (
                          <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-black uppercase tracking-tighter">
                            Tiled
                          </span>
                        ) : (
                          <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 font-black uppercase tracking-tighter">
                            Remote
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[10px] font-mono text-white/30 uppercase tracking-tight">
                        <span>
                          {ds.data.length > 0
                            ? ds.data.length.toLocaleString()
                            : (ds.stats?.count || 0).toLocaleString()}{" "}
                          POINTS
                        </span>
                        <span className="w-1 h-1 rounded-full bg-white/10" />
                        <span>
                          {isTiled ? "MVT-OPTIMIZED" : "GEOJSON-CORE"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDatasetVisibility(ds.id);
                        }}
                        className={cn(
                          "p-2 rounded-xl transition-all",
                          ds.isVisible
                            ? "bg-white/10 text-cyan-400"
                            : "bg-white/5 text-white/20 hover:text-white",
                        )}
                      >
                        {ds.isVisible ? (
                          <Eye size={14} />
                        ) : (
                          <EyeOff size={14} />
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeDataset(ds.id);
                        }}
                        className="p-2 bg-red-500/0 hover:bg-red-500/10 rounded-xl text-white/20 hover:text-red-400 transition-all"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {datasets.length === 0 && (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/5 hover:border-cyan-500/30 rounded-3xl p-10 flex flex-col items-center justify-center gap-5 cursor-pointer transition-all duration-500 bg-white/[0.01] hover:bg-white/[0.03] group relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 border border-white/5 group-hover:border-cyan-500/20">
                  <Upload
                    size={24}
                    className="text-white/20 group-hover:text-cyan-400 transition-colors"
                  />
                </div>
                <div className="text-center relative z-10">
                  <div className="text-sm font-bold text-white/60 group-hover:text-white transition-colors">
                    Ingest New Dataset
                  </div>
                  <div className="text-[10px] text-white/20 mt-1.5 font-medium uppercase tracking-[0.1em]">
                    CSV, JSON, or GeoJSON supported
                  </div>
                </div>
              </div>
            )}

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
              accept=".json,.csv"
              multiple
            />
          </div>
        </div>

        {datasets.length > 0 && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="space-y-4">
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 flex items-center gap-2">
                <Settings2 size={12} className="text-cyan-500" />
                Field Mapping
              </h2>
              <div className="space-y-2">
                <MappingRow
                  label="Latitude"
                  field="lat"
                  value={fieldMapping.lat}
                  availableFields={availableFields}
                  setFieldMapping={setFieldMapping}
                />
                <MappingRow
                  label="Longitude"
                  field="lng"
                  value={fieldMapping.lng}
                  availableFields={availableFields}
                  setFieldMapping={setFieldMapping}
                />
                <MappingRow
                  label="Value (Intensity)"
                  field="value"
                  value={fieldMapping.value}
                  availableFields={availableFields}
                  setFieldMapping={setFieldMapping}
                />
                <MappingRow
                  label="Category"
                  field="category"
                  value={fieldMapping.category}
                  availableFields={availableFields}
                  setFieldMapping={setFieldMapping}
                />
                <MappingRow
                  label="Timestamp"
                  field="timestamp"
                  value={fieldMapping.timestamp}
                  availableFields={availableFields}
                  setFieldMapping={setFieldMapping}
                />
              </div>
            </div>

            <Transformations />

            <div className="space-y-4">
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 flex items-center gap-2">
                <Filter size={12} className="text-cyan-500" />
                Smart Filters
              </h2>

              <div className="relative group">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-cyan-400 transition-colors"
                />
                <input
                  type="text"
                  placeholder="Search metadata..."
                  value={filters.searchQuery}
                  onChange={(e) => setFilters({ searchQuery: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-9 pr-4 text-xs focus:outline-none focus:border-cyan-500/50 transition-all placeholder:text-white/10"
                />
              </div>

              <div className="space-y-4 p-4 rounded-2xl bg-white/[0.03] border border-white/5 shadow-inner">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
                    Value Range
                  </span>
                  <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                    {filters.minValue} — {filters.maxValue}
                  </span>
                </div>
                <div className="space-y-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={filters.minValue}
                    onChange={(e) =>
                      setFilters({ minValue: parseInt(e.target.value) })
                    }
                    className="w-full accent-cyan-500 h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer"
                  />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={filters.maxValue}
                    onChange={(e) =>
                      setFilters({ maxValue: parseInt(e.target.value) })
                    }
                    className="w-full accent-cyan-500 h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer"
                  />
                </div>
              </div>

              {categories.length > 0 && (
                <div className="space-y-3">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
                    Categories
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => {
                          const newCats = filters.categories.includes(cat)
                            ? filters.categories.filter((c) => c !== cat)
                            : [...filters.categories, cat];
                          setFilters({ categories: newCats });
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-[10px] font-black border transition-all duration-300 uppercase tracking-tight",
                          filters.categories.includes(cat)
                            ? "bg-cyan-500 border-cyan-500 text-black shadow-lg shadow-cyan-500/20"
                            : "bg-white/5 border-white/5 text-white/30 hover:text-white hover:border-white/20 hover:bg-white/10",
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
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 flex items-center gap-2">
                <Download size={12} className="text-cyan-500" />
                Export Engine
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={exportJSON}
                  className="flex items-center justify-center gap-2 p-3.5 rounded-2xl bg-white/[0.03] border border-white/5 text-white/40 hover:text-white hover:bg-white/10 hover:border-white/10 transition-all duration-300 text-[10px] font-black uppercase tracking-widest group"
                >
                  <FileJson
                    size={16}
                    className="text-cyan-500/50 group-hover:text-cyan-400 transition-colors"
                  />
                  JSON
                </button>
                <button
                  onClick={exportCSV}
                  className="flex items-center justify-center gap-2 p-3.5 rounded-2xl bg-white/[0.03] border border-white/5 text-white/40 hover:text-white hover:bg-white/10 hover:border-white/10 transition-all duration-300 text-[10px] font-black uppercase tracking-widest group"
                >
                  <FileSpreadsheet
                    size={16}
                    className="text-cyan-500/50 group-hover:text-cyan-400 transition-colors"
                  />
                  CSV
                </button>
              </div>
              <p className="text-[9px] text-white/10 text-center font-bold uppercase tracking-[0.2em]">
                Ready to extract {filteredData.length} records
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
