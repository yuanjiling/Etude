import React from 'react';
import { motion } from 'motion/react';
import { X, Play } from 'lucide-react';
import type { ImageRecord, FocusRegion } from '../types';
import { FocusedPracticeImage } from './FocusedPracticeImage';

interface PracticeReviewProps {
  items: { image: ImageRecord; focusRegion?: FocusRegion }[];
  totalElapsedSec: number;
  onExit: () => void;
  onContinueDrawing: (image: ImageRecord, region?: FocusRegion) => void;
}

const formatTime = (sec: number) => {
  if (sec < 60) return `${sec}秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}分${s}秒`;
};

export const PracticeReview: React.FC<PracticeReviewProps> = ({ items, totalElapsedSec, onExit, onContinueDrawing }) => {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[100] bg-zinc-950 text-white flex flex-col p-6 rounded-2xl overflow-hidden"
    >
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight mb-1">练习回顾</h2>
          <p className="text-sm text-stone-400">
            本次完成 {items.length} 张练习，总计耗时 {formatTime(totalElapsedSec)}
          </p>
        </div>
        <button 
          onClick={onExit}
          className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors text-white"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {items.map((item, idx) => (
            <div 
              key={`${item.image.id}-${idx}`} 
              className="group relative aspect-[3/4] bg-zinc-900 rounded-xl overflow-hidden cursor-pointer"
              onClick={() => onContinueDrawing(item.image, item.focusRegion)}
            >
              {item.focusRegion
                ? <FocusedPracticeImage image={item.image} region={item.focusRegion} flipped={false} grayscale={false} quickFade />
                : <img
                    src={item.image.url}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 opacity-90 group-hover:opacity-100"
                    alt=""
                  />}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
};
