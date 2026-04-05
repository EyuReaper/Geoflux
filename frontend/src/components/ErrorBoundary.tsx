import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo)
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-[2.5rem] p-12 text-center space-y-6 backdrop-blur-xl">
            <div className="w-20 h-20 bg-red-500/10 rounded-3xl flex items-center justify-center mx-auto border border-red-500/20">
              <AlertTriangle className="text-red-500" size={40} />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-white">Engine Interrupted</h1>
              <p className="text-white/40 text-sm leading-relaxed">
                A critical error occurred in the visualization engine. This is usually caused by malformed data or GPU context loss.
              </p>
            </div>

            <div className="p-4 bg-black/40 rounded-2xl border border-white/5 text-left">
              <p className="text-[10px] font-mono text-red-400/80 break-all leading-tight">
                {this.state.error?.message || 'Unknown visualization error'}
              </p>
            </div>

            <button
              onClick={this.handleReset}
              className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-white text-black font-bold hover:bg-white/90 transition-all shadow-xl shadow-white/5"
            >
              <RefreshCcw size={18} />
              Restart Engine
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
