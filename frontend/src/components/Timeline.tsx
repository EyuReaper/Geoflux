import { useEffect } from 'react'
import { Play, Pause, FastForward, Rewind, Clock, RotateCw, ArrowRight, ArrowLeftRight } from 'lucide-react'
import { useStore } from '../store/useStore'

const Timeline = () => {
  const { data, timeline, setTimeline, togglePlayback, tickTimeline, stepTimeline } = useStore()

  useEffect(() => {
    let interval: number | undefined
    if (timeline.isPlaying) {
      interval = window.setInterval(() => {
        tickTimeline()
      }, 50) // Faster tick for smoother animation
    }
    return () => clearInterval(interval)
  }, [timeline.isPlaying, tickTimeline])

  if (data.length === 0 || timeline.startTime === timeline.endTime) return null

  const formatDate = (ms: number) => {
    return new Date(ms).toLocaleString(undefined, { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  const progress = ((timeline.currentTime - timeline.startTime) / (timeline.endTime - timeline.startTime)) * 100

  const LoopIcon = {
    'once': <ArrowRight size={16} />,
    'loop': <RotateCw size={16} />,
    'ping-pong': <ArrowLeftRight size={16} />
  }[timeline.loopMode]

  const nextLoopMode = () => {
    const modes: ('once' | 'loop' | 'ping-pong')[] = ['once', 'loop', 'ping-pong']
    const currentIndex = modes.indexOf(timeline.loopMode)
    setTimeline({ loopMode: modes[(currentIndex + 1) % modes.length] })
  }

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[1500] w-full max-w-3xl px-6">
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-[2rem] p-4 shadow-2xl shadow-black/50">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400 border border-cyan-500/20">
                <Clock size={18} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase text-white/40 tracking-widest">Temporal Analysis</div>
                <div className="text-sm font-mono font-bold text-white tracking-tighter">
                  {formatDate(timeline.currentTime)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={() => stepTimeline(-1)}
                className="p-2 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-colors"
                title="Step Backward"
              >
                <Rewind size={16} />
              </button>
              
              <button 
                onClick={togglePlayback}
                className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl"
              >
                {timeline.isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
              </button>

              <button 
                onClick={() => stepTimeline(1)}
                className="p-2 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-colors"
                title="Step Forward"
              >
                <FastForward size={16} />
              </button>
              
              <div className="h-4 w-px bg-white/10 mx-2" />
              
              <button 
                onClick={nextLoopMode}
                className={`p-2 rounded-lg border transition-all ${timeline.loopMode !== 'once' ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400' : 'bg-white/5 border-transparent text-white/40'}`}
                title={`Loop Mode: ${timeline.loopMode}`}
              >
                {LoopIcon}
              </button>

              <select 
                value={timeline.speed}
                onChange={(e) => setTimeline({ speed: parseFloat(e.target.value) })}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] font-bold text-white focus:outline-none focus:border-cyan-500/50 cursor-pointer"
              >
                <option value="0.5">0.5x</option>
                <option value="1">1x</option>
                <option value="2">2x</option>
                <option value="5">5x</option>
              </select>
            </div>
          </div>

          <div className="relative px-2 group">
            <input 
              type="range"
              min={timeline.startTime}
              max={timeline.endTime}
              value={timeline.currentTime}
              onChange={(e) => setTimeline({ currentTime: parseInt(e.target.value) })}
              className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500"
            />
            <div 
              className="absolute left-2 top-1/2 -translate-y-1/2 h-1.5 bg-cyan-500 rounded-full pointer-events-none transition-all duration-100"
              style={{ width: `calc(${progress}% - 8px)`, minWidth: '0px' }}
            />
          </div>

          <div className="flex justify-between px-2 text-[9px] font-bold text-white/20 uppercase tracking-tighter">
            <span>{formatDate(timeline.startTime)}</span>
            <span>{formatDate(timeline.endTime)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Timeline