import React from 'react';
import { GlassCard } from '../components/GlassCard';
import { useAppContext } from '../context/AppContext';
import { HistoryRecord } from '../types';
import { HistoryThumbnail } from '../components/HistoryThumbnail';

export const HistoryView = () => {
  const { history } = useAppContext();

  // Simple stats
  const totalTimeSec = history.reduce((acc, curr) => acc + curr.durationSec, 0);
  const totalImages = history.reduce((acc, curr) => acc + curr.imageCount, 0);

  const formatTime = (sec: number) => {
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    return `${min}m`;
  };

  return (
    <div className="px-8 pt-10 pb-8 space-y-8 flex flex-col h-full">
      <header className="flex flex-col gap-1">
        <h1 className="text-4xl font-bold tracking-tight">练习记录</h1>
        <p className="text-stone-500 dark:text-white/50 text-sm font-medium">回顾您的速写历程</p>
      </header>

      <div className="grid grid-cols-2 gap-5">
        <GlassCard className="p-8 !rounded-2xl">
          <div className="text-xs uppercase tracking-widest text-stone-500 dark:text-white/40 font-bold mb-3">累计时间</div>
          <p className="text-5xl font-bold tracking-tight">{formatTime(totalTimeSec)}</p>
        </GlassCard>
        
        <GlassCard className="p-8 !rounded-2xl">
          <div className="text-xs uppercase tracking-widest text-stone-500 dark:text-white/40 font-bold mb-3">累计张数</div>
          <p className="text-5xl font-bold tracking-tight">{totalImages}</p>
        </GlassCard>
      </div>

      <div className="flex-1 pb-12">
        <div className="text-xs uppercase tracking-widest text-stone-500 dark:text-white/40 font-bold mb-5">最近记录</div>
        {history.length === 0 ? (
          <div className="text-center text-stone-500 dark:text-white/40 py-16 bg-white/50 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-2xl font-medium">
            暂无记录，去完成一次练习吧！
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {history.map(record => (
              <GlassCard key={record.id} className="p-5 flex flex-col gap-4 !rounded-2xl">
                <div className="flex justify-between items-center">
                  <p className="font-bold text-sm text-black dark:text-white">
                    {new Date(record.date).toLocaleDateString()} {new Date(record.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <div className="text-xs font-semibold text-stone-500">
                    {record.imageCount} 张 • {formatTime(record.durationSec)}
                  </div>
                </div>
                {(record.items?.length || record.images?.length) ? (
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    {(record.items || record.images.map(image => ({ image }))).map((item, i) => (
                      <HistoryThumbnail key={`${record.id}-${i}`} item={item} className="h-24 w-20" />
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-stone-500 bg-black/5 dark:bg-white/5 rounded-md p-4 text-center">
                    旧版记录（无图片数据）
                  </div>
                )}
              </GlassCard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
