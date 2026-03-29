import { Upload, Share2, Play, Activity } from 'lucide-react'
import { useStore } from '../store/useStore'

const Navbar = () => {
  const { loadDemoData, isSidebarOpen, toggleSidebar } = useStore()
  return (
    <nav className="h-16 border-b border-white/10 bg-black/50 backdrop-blur-md px-6 flex items-center justify-between fixed top-0 left-0 right-0 z-[2000]">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-cyan-500 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/20">
          <Activity className="text-black" size={20} />
        </div>
        <span className="text-xl font-bold tracking-tight text-white">GeoFlux</span>
        <div className="h-4 w-px bg-white/20 mx-2" />
        <span className="text-sm text-white/50 font-medium">Global Visualization Platform</span>
      </div>

      <div className="flex items-center gap-3">
        <button 
          onClick={() => loadDemoData()}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 text-sm font-medium transition-all text-white/80"
        >
          <Play size={16} />
          Demo Data
        </button>
        <button className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 text-sm font-medium transition-all text-white/80">
          <Share2 size={16} />
          Share Map
        </button>
        <button 
          onClick={() => {
            if (!isSidebarOpen) toggleSidebar();
          }}
          className="flex items-center gap-2 px-6 py-2 rounded-full bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-bold transition-all shadow-lg shadow-cyan-500/20"
        >
          <Upload size={16} />
          Upload Dataset
        </button>
      </div>
    </nav>
  )
}

export default Navbar
