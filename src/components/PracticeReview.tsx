import React, { useEffect, memo, useState } from 'react';
import { motion } from 'motion/react';
import { X, Play } from 'lucide-react';
import type { ImageRecord, FocusRegion } from '../types';
import { FocusedPracticeImage } from './FocusedPracticeImage';
import { useNearViewport } from '../hooks/useNearViewport';
import { setPracticeLocked, isTauriEnvironment } from '../utils/tauriWindow';
import { requestThumbnail } from '../services/thumbnailScheduler';

const INITIAL_REVIEW_ITEMS = 30;
const REVIEW_ITEM_BATCH = 30;
const IMMEDIATE_REVIEW_ITEMS = 10;

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

const ReviewImageCard = memo<{
  item: { image: ImageRecord; focusRegion?: FocusRegion };
  preferImmediateSource: boolean;
  onContinue: () => void;
}>(({ item, preferImmediateSource, onContinue }) => {
  const { ref, isNear } = useNearViewport<HTMLDivElement>('500px 0px');
  const [generatedThumbnail, setGeneratedThumbnail] = useState<string>();
  const displaySrc = item.image.thumbnailUrl
    || (preferImmediateSource ? item.image.url : generatedThumbnail)
    || (!item.image.sourcePath ? item.image.url : undefined);

  useEffect(() => {
    if (preferImmediateSource || !isNear || item.image.thumbnailUrl || generatedThumbnail || !item.image.sourcePath) return;
    let disposed = false;
    const request = requestThumbnail(item.image.sourcePath, 0);
    request.promise
      .then(url => {
        if (!disposed) setGeneratedThumbnail(url);
      })
      .catch(error => {
        if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) {
          setGeneratedThumbnail(item.image.url);
        }
      });
    return () => {
      disposed = true;
      request.cancel();
    };
  }, [generatedThumbnail, isNear, item.image.sourcePath, item.image.thumbnailUrl, item.image.url, preferImmediateSource]);

  return (
    <div
      ref={ref}
      className="group/rcard relative aspect-[3/4] bg-zinc-900 rounded-xl overflow-hidden cursor-pointer border border-white/5 hover:border-white/20 transition-all hover:scale-[1.02] active:scale-95"
      onClick={onContinue}
    >
      {isNear && displaySrc && (item.focusRegion ? (
        <FocusedPracticeImage 
          image={item.image} 
          region={item.focusRegion} 
          src={displaySrc}
          flipped={false} 
          grayscale={false} 
          quickFade
          loading={preferImmediateSource ? 'eager' : 'lazy'}
        />
      ) : (
        <img
          src={displaySrc}
          loading={preferImmediateSource ? 'eager' : 'lazy'}
          decoding="async"
          className="w-full h-full object-cover transition-transform duration-300 group-hover/rcard:scale-105 opacity-90 group-hover/rcard:opacity-100"
          alt=""
        />
      ))}
      <div className="absolute inset-0 bg-black/0 group-hover/rcard:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover/rcard:opacity-100">
        <div className="w-8 h-8 rounded-full bg-white/90 text-black flex items-center justify-center shadow-lg">
          <Play size={14} className="fill-current translate-x-0.5" />
        </div>
      </div>
    </div>
  );
});

ReviewImageCard.displayName = 'ReviewImageCard';

export const PracticeReview: React.FC<PracticeReviewProps> = ({ items, totalElapsedSec, onExit, onContinueDrawing }) => {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(INITIAL_REVIEW_ITEMS, items.length));
  const { ref: loadMoreRef, isNear: isLoadMoreNear } = useNearViewport<HTMLDivElement>('600px 0px');

  useEffect(() => {
    setVisibleCount(Math.min(INITIAL_REVIEW_ITEMS, items.length));
  }, [items]);

  useEffect(() => {
    if (!isLoadMoreNear) return;
    setVisibleCount(current => Math.min(items.length, current + REVIEW_ITEM_BATCH));
  }, [isLoadMoreNear, items.length]);

  // 进入回顾界面时，双重确保强制解除点击穿透锁定
  useEffect(() => {
    if (isTauriEnvironment()) {
      setPracticeLocked(false).catch(console.warn);
    }
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[100] bg-zinc-950 text-white flex flex-col p-6 rounded-2xl overflow-hidden select-none pointer-events-auto"
    >
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h2 className="text-xl font-bold tracking-tight mb-0.5">练习回顾</h2>
          <p className="text-xs text-stone-400">
            本次完成 {items.length} 张练习，总计耗时 {formatTime(totalElapsedSec)}
          </p>
        </div>
        <button 
          type="button"
          onClick={onExit}
          className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center transition-all text-white cursor-pointer"
          title="退出回顾"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 pb-4">
          {items.slice(0, visibleCount).map((item, idx) => (
            <ReviewImageCard 
              key={`${item.image.id}-${idx}`}
              item={item}
              preferImmediateSource={idx < IMMEDIATE_REVIEW_ITEMS}
              onContinue={() => onContinueDrawing(item.image, item.focusRegion)}
            />
          ))}
        </div>
        {visibleCount < items.length && <div ref={loadMoreRef} className="h-1" aria-hidden="true" />}
      </div>
    </motion.div>
  );
};
