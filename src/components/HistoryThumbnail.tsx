import React from 'react';
import type { HistoryItem } from '../types';
import { FocusedPracticeImage } from './FocusedPracticeImage';

export const HistoryThumbnail: React.FC<{
  item: HistoryItem;
  className: string;
}> = ({ item, className }) => (
  <div className={`relative shrink-0 overflow-hidden rounded-md bg-zinc-900 border border-black/5 dark:border-white/10 ${className}`}>
    {item.focusRegion
      ? <FocusedPracticeImage image={item.image} region={item.focusRegion} flipped={false} grayscale={false} />
      : <img src={item.image.url} className="w-full h-full object-cover" alt="practice record" />}
    {item.focusRegion?.tag && (
      <div className="absolute left-1 bottom-1 px-1.5 py-0.5 rounded bg-black/55 text-[8px] font-bold text-white backdrop-blur-sm">
        {item.focusRegion.tag}
      </div>
    )}
  </div>
);
