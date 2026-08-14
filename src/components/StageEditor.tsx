import React from 'react';
import { StageConfig } from '../types';
import { Plus, X, Tag, GripVertical } from 'lucide-react';
import { Reorder, useDragControls } from 'motion/react';

const StageItem: React.FC<{
  stage: StageConfig;
  idx: number;
  isActive: boolean;
  onSelectStage?: (idx: number | null) => void;
  updateStage: (idx: number, field: keyof StageConfig, val: any) => void;
  removeStage: (idx: number, e: React.MouseEvent) => void;
}> = ({ stage, idx, isActive, onSelectStage, updateStage, removeStage }) => {
  const dragControls = useDragControls();
  const allTags = [...(stage.includeTags || []), ...(stage.excludeTags || [])];

  return (
    <Reorder.Item
      value={stage.id}
      dragListener={false}
      dragControls={dragControls}
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onClick={() => onSelectStage && onSelectStage(isActive ? null : idx)}
      className={`
        flex flex-col gap-1.5 p-2 pl-8 rounded-lg relative group cursor-pointer
        transition-all duration-300
        ${isActive 
          ? 'bg-white dark:bg-zinc-700 z-10' 
          : 'hover:bg-black/5 dark:hover:bg-white/10'
        }
      `}
    >
      {/* Drag Handle */}
      <div 
        className="absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center text-stone-300 dark:text-zinc-600 hover:text-stone-500 hover:bg-black/5 dark:hover:bg-white/5 rounded-l-lg cursor-grab active:cursor-grabbing transition-colors"
        onPointerDown={(e) => dragControls.start(e)}
        style={{ touchAction: 'none' }}
      >
        <GripVertical size={12} />
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-1.5">
          <span className={`text-[11px] font-bold w-11 ${isActive ? 'text-black dark:text-white' : 'text-stone-500'}`}>阶段 {idx + 1}</span>
          <input 
            type="number"
            step="0.5"
            min="0.5"
            value={stage.durationSec / 60} 
            onChange={e => updateStage(idx, 'durationSec', Math.max(0.5, Number(e.target.value)) * 60)}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            className={`w-10 bg-transparent text-center text-[11px] font-bold focus:outline-none transition-colors rounded-md py-0.5 ${
              isActive ? 'hover:bg-black/5 dark:hover:bg-white/10 focus:bg-black/5 dark:focus:bg-white/10' : 'hover:bg-black/10 dark:hover:bg-white/20'
            }`}
          />
          <span className="text-[10px] text-stone-500">分钟/张</span>
        </div>
        <div className="flex items-center gap-1 pr-5">
          <input 
            type="number" 
            min="1"
            value={stage.count} 
            onChange={e => updateStage(idx, 'count', Math.max(1, Number(e.target.value)))}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            className={`w-8 bg-transparent text-center text-[11px] font-bold focus:outline-none transition-colors rounded-md py-0.5 ${
              isActive ? 'hover:bg-black/5 dark:hover:bg-white/10 focus:bg-black/5 dark:focus:bg-white/10' : 'hover:bg-black/10 dark:hover:bg-white/20'
            }`}
          />
          <span className="text-[10px] text-stone-500">张</span>
        </div>
      </div>
      
      <div className="flex items-start gap-1.5 pl-[38px] pr-7 min-h-4">
        <Tag size={10} className={`mt-0.5 ${isActive ? 'text-stone-700 dark:text-zinc-300' : 'text-stone-400'}`} />
        <div className="flex flex-wrap gap-1">
          {allTags.length > 0 ? (
            <>
              {(stage.includeTags || []).map(t => (
                <span key={t} className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium ${
                   isActive ? 'bg-black/5 dark:bg-white/10 text-stone-600 dark:text-zinc-300' : 'bg-black/10 dark:bg-white/20 text-stone-500'
                }`}>
                  {t}
                </span>
              ))}
              {(stage.excludeTags || []).map(t => (
                <span key={t} className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium ${
                   isActive ? 'bg-red-50 dark:bg-red-500/10 text-red-500' : 'bg-red-50/50 dark:bg-red-900/10 text-red-400'
                }`}>
                  NOT {t}
                </span>
              ))}
            </>
          ) : (
            <span className="text-[9px] text-stone-400 font-medium">默认内容</span>
          )}
        </div>
      </div>

      <button 
        onClick={(e) => removeStage(idx, e)}
        onPointerDown={e => e.stopPropagation()}
        className={`
          absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-md transition-colors
          ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
          text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10
        `}
      >
        <X size={12} />
      </button>
    </Reorder.Item>
  );
};

export const StageEditor: React.FC<{
  stages: StageConfig[];
  onChange: (stages: StageConfig[]) => void;
  activeStageIdx?: number | null;
  onSelectStage?: (idx: number | null) => void;
}> = ({ stages, onChange, activeStageIdx = null, onSelectStage }) => {
  const addStage = () => {
    onChange([...stages, {
      id: Math.random().toString(36).substr(2, 9),
      durationSec: 300,
      count: 5,
      includeTags: [],
      excludeTags: [],
    }]);
  };

  const removeStage = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStages = [...stages];
    newStages.splice(idx, 1);
    onChange(newStages);
    if (activeStageIdx === idx && onSelectStage) {
      onSelectStage(null);
    } else if (activeStageIdx !== null && activeStageIdx > idx && onSelectStage) {
      onSelectStage(activeStageIdx - 1);
    }
  };

  const updateStage = (idx: number, field: keyof StageConfig, val: any) => {
    const newStages = [...stages];
    newStages[idx] = { ...newStages[idx], [field]: val };
    onChange(newStages);
  };

  // Ensure all stages have an ID for Reorder
  const stagesWithIds = React.useMemo(() => {
    return stages.map(s => {
      if (s.id) return s;
      return { ...s, id: Math.random().toString(36).substr(2, 9) };
    });
  }, [stages]);

  const stageIds = stagesWithIds.map(s => s.id as string);

  const handleReorder = (newIds: string[]) => {
    const newStages = newIds.map(id => stagesWithIds.find(s => s.id === id)!);
    
    // If we reorder, activeStageIdx index changes, we need to map the old active item to new index
    if (activeStageIdx !== null && onSelectStage) {
      const activeId = stagesWithIds[activeStageIdx].id;
      const newActiveIdx = newStages.findIndex(s => s.id === activeId);
      onSelectStage(newActiveIdx >= 0 ? newActiveIdx : null);
    }
    onChange(newStages);
  };

  return (
    <div className="space-y-2">
      <Reorder.Group axis="y" values={stageIds} onReorder={handleReorder} className="space-y-2">
        {stagesWithIds.map((stage, idx) => (
          <StageItem
            key={stage.id}
            stage={stage}
            idx={idx}
            isActive={activeStageIdx === idx}
            onSelectStage={onSelectStage}
            updateStage={updateStage}
            removeStage={removeStage}
          />
        ))}
      </Reorder.Group>
      
      <button 
        onClick={addStage}
        className="w-full py-2 flex items-center justify-center gap-1 text-[11px] font-bold text-stone-400 hover:text-stone-700 dark:text-zinc-500 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-all active:scale-95"
      >
        <Plus size={13} strokeWidth={2.5} />
        添加阶段
      </button>
    </div>
  );
};
