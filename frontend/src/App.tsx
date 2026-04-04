import Map from './components/Map'
import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import RightPanel from './components/RightPanel'
import Timeline from './components/Timeline'
import Inspector from './components/Inspector'
import { useStore } from './store/useStore'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { cn } from './lib/utils'

function App() {
  const { isSidebarOpen, toggleSidebar, isRightPanelOpen, toggleRightPanel, data, loadDemoData } = useStore()

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

        <Sidebar />
        
        <div className="flex-1 relative bg-black">
          <Map />
          
          {data.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-[500] pointer-events-none">
              <div className="bg-black/40 backdrop-blur-md border border-white/10 p-12 rounded-[2.5rem] text-center space-y-4 animate-in fade-in zoom-in duration-700">
                <div className="w-20 h-20 bg-cyan-500/10 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-cyan-500/20">
                  <div className="w-10 h-10 bg-cyan-500 rounded-2xl animate-pulse shadow-[0_0_30px_rgba(6,182,212,0.5)]" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight text-white/90">Welcome to GeoFlux</h2>
                <p className="text-white/40 max-w-xs mx-auto leading-relaxed">
                  Upload a dataset or load demo data to start exploring global patterns in real-time.
                </p>
                <div className="pt-4 flex gap-3 justify-center pointer-events-auto">
                   <button 
                    onClick={() => loadDemoData()}
                    className="px-6 py-2.5 rounded-full bg-white text-black font-bold text-sm hover:bg-white/90 transition-all shadow-xl"
                  >
                    Load Demo
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <RightPanel />
        <Inspector />
        <Timeline />
      </main>
    </div>
  )
}

export default App
