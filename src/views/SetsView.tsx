import React, { useState } from 'react';
import { GlassCard } from '../components/GlassCard';
import { useAppContext } from '../context/AppContext';
import { Play, Plus, Edit2, Trash2 } from 'lucide-react';
import { PracticeSet } from '../types';
import { motion } from 'motion/react';
import { SetEditorModal } from '../components/SetEditorModal';

import { getSetDetailText, formatDurationLabel, compactVisualTagLabel } from '../utils/tagCatalog';

export const SetsView: React.FC<{ onStart: (config: any) => void }> = ({ onStart }) => {
  const { sets, saveSet, deleteSet, settings } = useAppContext();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSet, setEditingSet] = useState<PracticeSet | undefined>(undefined);

  const handleEdit = (set?: PracticeSet) => {
    setEditingSet(set);
    setIsModalOpen(true);
  };

  const handleDelete = (set: PracticeSet) => {
    if (window.confirm(`删除练习配置“${set.name}”？`)) deleteSet(set.id);
  };

  return (
    <>
      <div className="px-4 pt-4 pb-4 gap-3 h-full flex flex-col">
        <header className="flex items-center gap-3 shrink-0">
          <h1 className="text-xl font-bold tracking-tight">练习配置</h1>
          <button 
            onClick={() => handleEdit()}
            className="px-2 py-1 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-xs font-bold rounded-md flex items-center gap-1 transition-colors"
          >
            <Plus size={12} /> 新建
          </button>
        </header>

        {/* Sets List */}
        <motion.div 
          className="flex-1 overflow-y-auto flex flex-col gap-2.5 pr-1 scrollbar-hide"
          variants={{
            hidden: { opacity: 0 },
            show: {
              opacity: 1,
              transition: { staggerChildren: 0.05 }
            }
          }}
          initial="hidden"
          animate="show"
        >
          {sets.map(set => (
            <SetCard 
              key={set.id} 
              set={set} 
              onStart={() => onStart({ ...set.config, randomize: true, preparationSec: settings.preparationSec, transitionSec: settings.transitionSec })}
              onEdit={() => handleEdit(set)}
              onDelete={() => handleDelete(set)}
            />
          ))}

          {sets.length === 0 && (
            <button onClick={() => handleEdit()} className="mt-8 py-8 rounded-xl border border-dashed border-black/10 dark:border-white/10 text-[11px] font-medium text-stone-500 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
              还没有练习配置 · 点击新建
            </button>
          )}
        </motion.div>
      </div>

      <SetEditorModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={saveSet}
        initialSet={editingSet}
      />
    </>
  );
};

const SetCard: React.FC<{ set: PracticeSet; onStart: () => void; onEdit: () => void; onDelete: () => void }> = ({ set, onStart, onEdit, onDelete }) => {
  const detail = getSetDetailText(set.config);
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 15, scale: 0.98 },
        show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 400, damping: 30 } }
      }}
    >
      <GlassCard className="p-3 flex flex-col gap-2.5 group hover:border-black/20 dark:hover:border-white/30 transition-colors !rounded-lg">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold tracking-tight truncate">{set.name}</h3>
            <div className="mt-0.5 text-[9px] font-medium text-stone-500">
              {set.config.sessionType === 'single' ? '固定时长' : 'Class Mode'} · {detail}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onDelete}
              className="w-7 h-7 flex items-center justify-center text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
              aria-label={`删除${set.name}`}
            >
              <Trash2 size={12} />
            </button>
            <button 
              onClick={onEdit}
              className="w-7 h-7 flex items-center justify-center text-stone-500 hover:text-black dark:hover:text-white bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-colors"
              aria-label={`编辑${set.name}`}
            >
              <Edit2 size={12} />
            </button>
            <motion.button 
              onClick={onStart}
              className="w-8 h-8 bg-zinc-800 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 rounded-lg flex items-center justify-center"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              <Play size={12} fill="currentColor" className="ml-0.5" />
            </motion.button>
          </div>
        </div>
        {set.config.sessionType === 'progressive' ? (
          set.config.progressiveStages && set.config.progressiveStages.length > 0 && (
            <div className="flex flex-col gap-1 pt-1 border-t border-black/5 dark:border-white/5">
              {set.config.progressiveStages.map((stage, idx) => {
                const stageTags = stage.includeTags && stage.includeTags.length > 0
                  ? stage.includeTags
                  : (set.config.includeTags && set.config.includeTags.length > 0 ? set.config.includeTags : []);
                const durationText = formatDurationLabel(stage.durationSec);
                return (
                  <div key={stage.id || idx} className="flex items-center gap-1.5 overflow-hidden text-[9px]">
                    <span className="shrink-0 font-bold text-stone-400 dark:text-zinc-500 text-[8px]">
                      阶段 {idx + 1} ({durationText} · {stage.count}张):
                    </span>
                    {stageTags.length === 0 ? (
                      <span className="shrink-0 text-stone-400 dark:text-zinc-500 text-[8px]">全部图库</span>
                    ) : (
                      <>
                        {stageTags.slice(0, 5).map(tag => (
                          <span key={tag} className="shrink-0 px-1.5 py-0.5 bg-black/5 dark:bg-white/10 text-[8px] font-medium rounded-md">
                            {compactVisualTagLabel(tag)}
                          </span>
                        ))}
                        {stageTags.length > 5 && (
                          <span className="text-[8px] text-stone-500">+{stageTags.length - 5}</span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          set.config.includeTags && set.config.includeTags.length > 0 && (
            <div className="flex items-center gap-1 overflow-hidden pt-1 border-t border-black/5 dark:border-white/5">
              {set.config.includeTags.slice(0, 6).map(tag => (
                <span key={tag} className="shrink-0 px-1.5 py-0.5 bg-black/5 dark:bg-white/10 text-[9px] font-medium rounded-md">
                  {compactVisualTagLabel(tag)}
                </span>
              ))}
              {set.config.includeTags.length > 6 && (
                <span className="text-[9px] text-stone-500">+{set.config.includeTags.length - 6}</span>
              )}
            </div>
          )
        )}
      </GlassCard>
    </motion.div>
  );
};
