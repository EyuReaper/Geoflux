import { useState } from 'react'
import { Upload, Share2, Activity, LogIn, LogOut, Save, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useStore } from '../store/useStore'
import { AuthModal } from './AuthModal'
import { useReducedMotion } from '../hooks/useReducedMotion'

const Navbar = () => {
  const { isSidebarOpen, toggleSidebar, auth, logout, saveWorkspace } = useStore()
  const [showAuth, setShowAuth] = useState(false)
  const reducedMotion = useReducedMotion()

  const handleSave = () => {
    const name = prompt('Enter workspace name:', `Workspace ${new Date().toLocaleDateString()}`)
    if (name) saveWorkspace(name)
  }

  const handleShare = async () => {
    const shareUrl = useStore.getState().getShareableUrl()
    await navigator.clipboard.writeText(shareUrl)
    alert('Instant view snapshot copied to clipboard!')
  }

  return (
    <>
      <nav className="h-16 border-b border-white/10 bg-black/50 backdrop-blur-md px-6 flex items-center justify-between fixed top-0 left-0 right-0 z-[2000]" aria-label="Main navigation">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSidebar}
            className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors"
            aria-label={isSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            aria-expanded={isSidebarOpen}
            aria-controls="dataset-sidebar"
          >
            {isSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
          <div className="w-8 h-8 bg-cyan-500 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Activity className="text-black" size={20} />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">GeoFlux</span>
          <div className="h-4 w-px bg-white/20 mx-2" />
          <span className="text-sm text-white/50 font-medium">Global Visualization Platform</span>
        </div>

        <div className="flex items-center gap-3">
          {auth.isAuthenticated ? (
            <>
              <button 
                onClick={handleSave}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 text-sm font-medium transition-all text-white/80"
              >
                <Save size={16} />
                Save Workspace
              </button>
              <button 
                onClick={() => logout()}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 text-sm font-medium transition-all text-white/80"
              >
                <LogOut size={16} />
                Logout
              </button>
            </>
          ) : (
            <button 
              onClick={() => setShowAuth(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 text-sm font-medium transition-all text-white/80"
            >
              <LogIn size={16} />
              Login
            </button>
          )}

          <div className="h-6 w-px bg-white/10 mx-1" role="separator" />

          <button 
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 text-sm font-medium transition-all text-white/80"
          >
            <Share2 size={16} />
            Share Map
          </button>
          <button 
            onClick={() => {
              if (!isSidebarOpen) toggleSidebar();
            }}
            className={`flex items-center gap-2 px-6 py-2 rounded-full bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-bold transition-all shadow-lg shadow-cyan-500/20 ${reducedMotion ? 'transition-none' : ''}`}
            aria-label="Upload dataset"
          >
            <Upload size={16} />
            Upload Dataset
          </button>
        </div>
      </nav>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  )
}

export default Navbar
