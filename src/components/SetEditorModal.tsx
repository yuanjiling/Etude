import React, { useState, useEffect } from 'react';
import { PracticeSet, SessionType, StageConfig } from '../types';
import { X, Check, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StageEditor } from './StageEditor';
import { ProgressSegmentedControl } from './ProgressSegmentedControl';
import { COMPACT_VISUAL_TAG_LABELS, TAG_CATEGORIES } from '../utils/tagCatalog';

const COMPACT_TAG_LABELS: Record<string, string> = {
  身体裁切: '裁切',
  头肩肖像: '肖像',
  部分着装: '部分',
  完整着装: '完整',
  纯侧面: '侧面',
  头部面部: '头面',
  骨盆臀部: '骨盆',
  ...COMPACT_VISUAL_TAG_LABELS,
};

const TIME_PRESETS = [0.5, 1, 2, 5, 10];
const COUNT_PRESETS = [10, 20, 30, 50, 100];

export const SetEditorModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSave: (set: PracticeSet) => void;
  initialSet?: PracticeSet;
}> = ({ isOpen, onClose, onSave, initialSet }) => {
  const [name, setName] = useState('');
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [sessionType, setSessionType] = useState<SessionType>('single');
  const [singleTimeMin, setSingleTimeMin] = useState<number | string>(1);
  const [imageCount, setImageCount] = useState<number | string>(20);
  const [isTimeLimited, setIsTimeLimited] = useState<boolean>(true);
  const [isCountLimited, setIsCountLimited] = useState<boolean>(true);
  const [progressiveStages, setProgressiveStages] = useState<StageConfig[]>([]);
  const [activeStageIdx, setActiveStageIdx] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialSet) {
        setName(initialSet.name);
        setIncludeTags(initialSet.config.includeTags);
        setExcludeTags(initialSet.config.excludeTags || []);
        setSessionType(initialSet.config.sessionType);
        setSingleTimeMin(initialSet.config.singleTimeSec ? initialSet.config.singleTimeSec / 60 : 1);
        setImageCount(initialSet.config.imageCount || 20);
        setIsTimeLimited(!!initialSet.config.singleTimeSec);
        setIsCountLimited(!!initialSet.config.imageCount);
        setProgressiveStages(initialSet.config.progressiveStages || []);
      } else {
        setName('');
        setIncludeTags([]);
        setExcludeTags([]);
        setSessionType('single');
        setSingleTimeMin(1);
        setImageCount(20);
        setIsTimeLimited(true);
        setIsCountLimited(true);
        setProgressiveStages([
          { id: '1', durationSec: 300, count: 5, includeTags: [], excludeTags: [] },
          { id: '2', durationSec: 600, count: 5, includeTags: [], excludeTags: [] }
        ]);
      }
    }
  }, [isOpen, initialSet]);

  const toggleTag = (tag: string, mode: 'include' | 'exclude') => {
    if (sessionType === 'progressive' && activeStageIdx !== null) {
      const stages = [...progressiveStages];
      const stage = { ...stages[activeStageIdx] };
      const stageInc = stage.includeTags || [];
      const stageExc = stage.excludeTags || [];
      if (mode === 'include') {
        if (stageInc.includes(tag)) stage.includeTags = stageInc.filter(item => item !== tag);
        else {
          stage.includeTags = [...stageInc, tag];
          stage.excludeTags = stageExc.filter(item => item !== tag);
        }
      } else if (stageExc.includes(tag)) {
        stage.excludeTags = stageExc.filter(item => item !== tag);
      } else {
        stage.excludeTags = [...stageExc, tag];
        stage.includeTags = stageInc.filter(item => item !== tag);
      }
      stages[activeStageIdx] = stage;
      setProgressiveStages(stages);
      return;
    }

    if (mode === 'include') {
      setIncludeTags(current => current.includes(tag)
        ? current.filter(item => item !== tag)
        : [...current, tag]);
      setExcludeTags(current => current.filter(item => item !== tag));
    } else {
      setExcludeTags(current => current.includes(tag)
        ? current.filter(item => item !== tag)
        : [...current, tag]);
      setIncludeTags(current => current.filter(item => item !== tag));
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      id: initialSet?.id || `s_${Date.now()}`,
      name: name.trim(),
      config: {
        includeTags,
        excludeTags,
        sessionType,
        singleTimeSec: sessionType === 'single' ? (isTimeLimited ? Math.floor(Number(singleTimeMin) * 60) : 0) : undefined,
        imageCount: sessionType === 'single' ? (isCountLimited ? Number(imageCount) : 999) : undefined,
        progressiveStages: sessionType === 'progressive' ? progressiveStages : undefined,
      }
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-3">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-stone-900/40 dark:bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="w-[520px] max-h-[92%] overflow-y-auto bg-stone-50 dark:bg-zinc-900 rounded-xl border border-black/10 dark:border-white/10 flex flex-col relative z-10 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          >
            <div className="sticky top-0 bg-stone-50/90 dark:bg-zinc-900/90 backdrop-blur-md px-4 py-3 flex justify-between items-center border-b border-black/5 dark:border-white/5 z-20">
              <h2 className="text-lg font-bold">{initialSet ? '编辑练习配置' : '新建练习配置'}</h2>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center bg-black/5 dark:bg-white/10 rounded-full hover:bg-black/10 dark:hover:bg-white/20 transition-colors">
                <X size={16} />
              </button>
            </div>
            
            <div className="p-4 flex flex-col gap-4">
              {/* Name */}
              <div className="order-1 flex items-center gap-3">
                <label className="text-[11px] font-bold text-stone-500 uppercase tracking-widest shrink-0">名称</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)}
                  placeholder="例如：每日头像热身"
                  className="flex-1 bg-white dark:bg-zinc-800 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-black dark:focus:border-white transition-colors"
                />
              </div>

              {/* Tags */}
              <div className="order-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-stone-500">{sessionType === 'progressive' && activeStageIdx !== null ? `阶段 ${activeStageIdx + 1} · 练习内容` : '练习内容'}</label>
                  <span className="text-[9px] text-stone-500/70">右键排除</span>
                </div>
                <div className="flex flex-col gap-2 bg-white dark:bg-zinc-800 border border-black/5 dark:border-white/5 p-3 rounded-lg">
                  {TAG_CATEGORIES.filter(category => category.name !== '练习').map(category => (
                    <div key={category.name} className="flex gap-1.5 items-start">
                      <div className="w-7 shrink-0 pt-1 text-[10px] leading-none font-bold text-stone-500">{category.name}</div>
                      <div className="flex flex-wrap gap-1 flex-1">
                        {category.tags.map(tag => {
                          let isInc = false;
                          let isExc = false;
                          if (sessionType === 'progressive' && activeStageIdx !== null) {
                            const stage = progressiveStages[activeStageIdx];
                            isInc = (stage.includeTags || []).includes(tag);
                            isExc = (stage.excludeTags || []).includes(tag);
                          } else {
                            isInc = includeTags.includes(tag);
                            isExc = excludeTags.includes(tag);
                          }
                          return (
                            <button
                              key={tag}
                              onClick={event => toggleTag(tag, event.altKey || event.metaKey ? 'exclude' : 'include')}
                              onMouseDown={event => { if (event.button === 2) event.stopPropagation(); }}
                              onContextMenu={event => {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleTag(tag, 'exclude');
                              }}
                              className={`
                                px-1.5 py-1 rounded-md text-[10px] leading-none font-medium transition-colors border
                                ${isInc ? 'bg-stone-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900 border-transparent ' :
                                  isExc ? 'bg-red-50 text-red-500 dark:bg-red-950/30 border-red-200 dark:border-red-900/50' :
                                  'bg-stone-200/50 dark:bg-zinc-800/50 text-stone-500 dark:text-white/60 border-transparent hover:bg-black/5 dark:hover:bg-white/10'}
                              `}
                            >
                              {COMPACT_TAG_LABELS[tag] || tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mode */}
              <div className="order-2 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="shrink-0 text-[10px] text-stone-500 font-bold">模式</div>
                  <div className="relative flex flex-1 p-1 bg-stone-200/50 dark:bg-zinc-800/50 rounded-lg">
                    <motion.div
                      className="absolute inset-y-1 w-[calc(50%-6px)] bg-white dark:bg-zinc-700 rounded-md border border-black/5 dark:border-white/10"
                      initial={false}
                      animate={{ left: sessionType === 'single' ? '4px' : 'calc(50% + 2px)' }}
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                    <button
                      onClick={() => { setSessionType('single'); setActiveStageIdx(null); }}
                      className={`relative z-10 flex-1 py-1.5 text-[11px] font-bold ${sessionType === 'single' ? 'text-black dark:text-white' : 'text-stone-500'}`}
                    >
                      固定时长
                    </button>
                    <button
                      onClick={() => setSessionType('progressive')}
                      className={`relative z-10 flex-1 py-1.5 text-[11px] font-bold ${sessionType === 'progressive' ? 'text-black dark:text-white' : 'text-stone-500'}`}
                    >
                      Class Mode
                    </button>
                  </div>
                </div>

                {sessionType === 'single' ? (
                  <motion.div
                    key="single"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="space-y-1.5"
                  >
                    <div className="grid grid-cols-[52px_1fr] items-center gap-2">
                      <div className="text-[10px] font-bold text-stone-500">单张时长</div>
                      <ProgressSegmentedControl
                        presets={TIME_PRESETS}
                        value={singleTimeMin}
                        onChange={setSingleTimeMin}
                        isLimited={isTimeLimited}
                        onLimitedChange={setIsTimeLimited}
                        defaultCustomValue={15}
                      />
                    </div>
                    <div className="grid grid-cols-[52px_1fr] items-center gap-2">
                      <div className="text-[10px] font-bold text-stone-500">图片数量</div>
                      <ProgressSegmentedControl
                        presets={COUNT_PRESETS}
                        value={imageCount}
                        onChange={setImageCount}
                        isLimited={isCountLimited}
                        onLimitedChange={setIsCountLimited}
                        defaultCustomValue={40}
                      />
                    </div>
                  </motion.div>
                ) : (
                  <div className="bg-white dark:bg-zinc-800 border border-black/5 dark:border-white/5 rounded-lg p-2">
                    <StageEditor stages={progressiveStages} onChange={setProgressiveStages} activeStageIdx={activeStageIdx} onSelectStage={setActiveStageIdx} />
                  </div>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 bg-stone-50/90 dark:bg-zinc-900/90 backdrop-blur-md px-4 py-3 border-t border-black/5 dark:border-white/5 z-20">
              <button 
                onClick={handleSave}
                disabled={!name.trim()}
                className="w-full py-2.5 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
              >
                <Check size={18} />
                保存练习配置
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
