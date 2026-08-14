import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Play, Plus } from 'lucide-react';

interface LunarClockSelectorProps {
  sets: any[];
  activeSetId: string | null;
  onSelectSet: (set: any) => void;
  onNewSet: () => void;
  onQuickStart: () => void;
}

export const LunarClockSelector: React.FC<LunarClockSelectorProps> = ({
  sets,
  activeSetId,
  onSelectSet,
  onNewSet,
  onQuickStart
}) => {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const activeSet = sets.find(s => s.id === activeSetId);
  const displayLabel = hoveredNode 
    ? sets.find(s => s.id === hoveredNode)?.name || (hoveredNode === 'quick' ? '随机练习' : '新建配置')
    : (activeSet ? activeSet.name : '自由设定');

  return (
    <div className="relative w-full flex flex-col items-center justify-center pt-8 pb-4 select-none">
      
      {/* The Sun / Minimalist Orb */}
      <div 
        className="absolute top-4 left-1/2 -translate-x-1/2 w-[160px] h-[160px] rounded-full bg-gradient-to-br from-amber-200/40 to-transparent dark:from-amber-500/10 dark:to-transparent blur-[32px] pointer-events-none"
      />
      
      {/* Central Title */}
      <div className="relative z-10 flex flex-col items-center text-center">
        <h1 className="text-3xl font-bold tracking-widest text-stone-800 dark:text-zinc-100">
          日绘
        </h1>
        <motion.div 
          key={displayLabel}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[10px] font-medium tracking-widest text-stone-500 dark:text-zinc-400 mt-1 h-3 uppercase"
        >
          {displayLabel}
        </motion.div>
      </div>

      {/* Minimalist Controls */}
      <div className="relative z-10 flex items-center gap-4 mt-6">
        <button 
          onClick={onQuickStart} 
          onMouseEnter={() => setHoveredNode('quick')}
          onMouseLeave={() => setHoveredNode(null)}
          className="p-1.5 text-stone-400 hover:text-stone-700 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors active:scale-90"
        >
          <Play size={13} fill="currentColor" />
        </button>
        
        <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-100/50 dark:bg-zinc-800/50 rounded-full border border-black/5 dark:border-white/5">
          {sets.map(set => {
            const isActive = activeSetId === set.id;
            return (
              <button
                key={set.id}
                onClick={() => onSelectSet(set)}
                onMouseEnter={() => setHoveredNode(set.id)}
                onMouseLeave={() => setHoveredNode(null)}
                className="relative flex items-center justify-center w-4 h-4 group"
              >
                <div className={`rounded-full transition-all duration-300 ${
                  isActive 
                    ? 'w-2 h-2 bg-stone-800 dark:bg-zinc-200 shadow-sm' 
                    : 'w-1.5 h-1.5 bg-stone-300 dark:bg-zinc-600 group-hover:bg-stone-400 dark:group-hover:bg-zinc-500'
                }`} />
              </button>
            );
          })}
        </div>

        <button 
          onClick={onNewSet} 
          onMouseEnter={() => setHoveredNode('new')}
          onMouseLeave={() => setHoveredNode(null)}
          className="p-1.5 text-stone-400 hover:text-stone-700 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors active:scale-90"
        >
          <Plus size={15} strokeWidth={2.5} />
        </button>
      </div>

    </div>
  );
};
