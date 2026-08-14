import React from 'react';
import { motion } from 'motion/react';

export const ProgressSegmentedControl = ({
  presets,
  value,
  onChange,
  isLimited,
  onLimitedChange,
  defaultCustomValue,
}: {
  presets: number[];
  value: number | string;
  onChange: (val: number | string) => void;
  isLimited: boolean;
  onLimitedChange: (val: boolean) => void;
  defaultCustomValue: number;
}) => {
  const isCustom = isLimited && !presets.includes(Number(value));
  const activeIndex = isLimited 
    ? (isCustom ? presets.length : presets.indexOf(Number(value)))
    : -1;
  const totalSlots = presets.length + 1;
  const fillPercent = isLimited ? ((activeIndex + 1) / totalSlots) * 100 : 0;

  return (
    <div className="flex items-center w-full">
      <div className="relative flex-1 flex bg-stone-200/50 dark:bg-zinc-800/50 rounded-lg p-1 overflow-hidden">
        <motion.div 
          className="absolute left-1 top-1 bottom-1 bg-gradient-to-r from-transparent to-white dark:from-transparent dark:to-white/20 rounded-md pointer-events-none"
          initial={false}
          animate={{ 
            width: isLimited ? `calc(${fillPercent}% - 8px)` : '0%',
            opacity: isLimited ? 1 : 0
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
        
        {presets.map((preset, idx) => {
          const isFilled = isLimited && activeIndex >= idx;
          return (
            <button
              key={preset}
              onClick={() => { onChange(preset); onLimitedChange(true); }}
              className={`relative z-10 flex-1 py-1 text-[10px] font-bold text-center transition-colors duration-200 ${
                isFilled ? 'text-stone-900 dark:text-white' : 'text-stone-500 hover:text-stone-700 dark:hover:text-zinc-300'
              }`}
            >
              {preset}
            </button>
          );
        })}
        
        <div className="relative z-10 flex-[1.2] flex items-center justify-center min-w-0">
          {isCustom ? (
            <input 
              type="number" 
              value={value}
              onChange={e => onChange(e.target.value)}
              onBlur={() => { if (!Number.isFinite(Number(value)) || Number(value) <= 0) onChange(defaultCustomValue); }}
              autoFocus
              className="w-full bg-transparent text-center text-[10px] font-bold outline-none text-stone-900 dark:text-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
          ) : (
            <button 
              onClick={() => { onChange(defaultCustomValue); onLimitedChange(true); }}
              className={`w-full py-1 text-[10px] font-bold text-center transition-colors duration-200 ${
                isLimited && activeIndex === presets.length ? 'text-stone-900 dark:text-white' : 'text-stone-500 hover:text-stone-700 dark:hover:text-zinc-300'
              }`}
            >
              自定义
            </button>
          )}
        </div>
      </div>
      
      <button 
        onClick={() => onLimitedChange(!isLimited)}
        className={`ml-1.5 shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
          !isLimited 
            ? 'bg-white text-stone-900 dark:bg-white/20 dark:text-white' 
            : 'bg-stone-200/50 text-stone-500 dark:bg-zinc-800/50 hover:bg-stone-300 dark:hover:bg-zinc-700'
        }`}
      >
        不限
      </button>
    </div>
  );
};
