import { useState } from 'react'
import { Plus, Trash2, ToggleLeft, ToggleRight, FlaskConical, AlertCircle } from 'lucide-react'
import { useStore } from '../store/useStore'

const Transformations = () => {
  const { transformations, addTransformation, removeTransformation, toggleTransformation } = useStore()
  const [name, setName] = useState('')
  const [expression, setExpression] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  const handleAdd = () => {
    if (name && expression) {
      addTransformation(name, expression)
      setName('')
      setExpression('')
      setIsAdding(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/40 flex items-center gap-2">
          <FlaskConical size={14} />
          Transformations
        </h2>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-all border border-cyan-500/20"
        >
          <Plus size={14} />
        </button>
      </div>

      {isAdding && (
        <div className="p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20 space-y-3 animate-in fade-in slide-in-from-top-2">
          <input 
            type="text"
            placeholder="Transformation Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-lg py-2 px-3 text-xs focus:outline-none focus:border-cyan-500/50"
          />
          <div className="space-y-1">
            <input 
              type="text"
              placeholder="Expression (e.g. value * 100)"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg py-2 px-3 text-xs font-mono focus:outline-none focus:border-cyan-500/50"
            />
            <p className="text-[9px] text-white/20 italic px-1">
              Variables: <span className="text-cyan-400/60">value</span>, <span className="text-cyan-400/60">row</span>
            </p>
          </div>
          <button 
            onClick={handleAdd}
            disabled={!name || !expression}
            className="w-full py-2 bg-cyan-500 text-black text-xs font-bold rounded-lg hover:bg-cyan-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create Field
          </button>
        </div>
      )}

      <div className="space-y-2">
        {transformations.map(t => (
          <div key={t.id} className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between group">
            <div className="overflow-hidden">
              <div className="text-xs font-bold text-white flex items-center gap-2">
                {t.name}
                {!t.active && <span className="text-[8px] bg-white/10 px-1 rounded uppercase">Inactive</span>}
              </div>
              <div className="text-[10px] text-cyan-400/60 font-mono truncate">{t.expression}</div>
            </div>
            
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={() => toggleTransformation(t.id)}
                className="p-1.5 hover:bg-white/10 rounded-md text-white/40 hover:text-white"
              >
                {t.active ? <ToggleRight size={16} className="text-cyan-400" /> : <ToggleLeft size={16} />}
              </button>
              <button 
                onClick={() => removeTransformation(t.id)}
                className="p-1.5 hover:bg-red-500/10 rounded-md text-white/40 hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        
        {transformations.length === 0 && !isAdding && (
          <div className="py-8 text-center space-y-2 opacity-20">
            <FlaskConical size={24} className="mx-auto" />
            <p className="text-[10px] font-medium uppercase tracking-widest">No Virtual Fields</p>
          </div>
        )}
      </div>

      {transformations.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/10">
          <AlertCircle size={14} className="text-yellow-500 flex-shrink-0 mt-0.5" />
          <p className="text-[9px] text-yellow-500/60 leading-tight">
            Transformations are applied in sequence and modify the calculated 'value' used for all visualizations.
          </p>
        </div>
      )}
    </div>
  )
}

export default Transformations
