import { useState } from 'react'
import { Upload, Share2, Play, Activity, LogIn, LogOut, Save } from 'lucide-react'
import { useStore } from '../store/useStore'
import { AuthModal } from './AuthModal'

const Navbar = () => {
  const { loadDemoData, isSidebarOpen, toggleSidebar, auth, logout, saveWorkspace, workspaces, toggleWorkspaceSharing } = useStore()
  const [showAuth, setShowAuth] = useState(false)

  const handleSave = () => {
    const name = prompt('Enter workspace name:', `Workspace ${new Date().toLocaleDateString()}`)
    if (name) saveWorkspace(name)
  }

  const handleShare = async () => {
    if (!auth.isAuthenticated) {
      alert('Please login to share workspaces')
      setShowAuth(true)
      return
    }

    if (workspaces.length === 0) {
      alert('Please save your workspace first')
      handleSave()
      return
    }

    // Share the most recently updated workspace for simplicity
    const latest = workspaces[0]
    if (!latest.isPublic) {
      if (confirm(`Make "${latest.name}" public to share?`)) {
        await toggleWorkspaceSharing(latest.id, true)
      } else {
        return
      }
    }

    const shareUrl = `${window.location.origin}${window.location.pathname}?workspace=${latest.id}`
    await navigator.clipboard.writeText(shareUrl)
    alert('Shareable link copied to clipboard!')
  }

  return (
    <>
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

          <div className="h-6 w-px bg-white/10 mx-1" />

          <button 
            onClick={() => loadDemoData()}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 text-sm font-medium transition-all text-white/80"
          >
            <Play size={16} />
            Demo Data
          </button>
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
            className="flex items-center gap-2 px-6 py-2 rounded-full bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-bold transition-all shadow-lg shadow-cyan-500/20"
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
