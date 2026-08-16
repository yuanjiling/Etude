import React from 'react';
import { motion } from 'motion/react';

export const StartupSplash: React.FC = () => (
  <motion.div
    initial={false}
    exit={{ opacity: 0, filter: 'blur(6px)' }}
    transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    className="fixed inset-0 z-[200] flex items-center justify-center bg-stone-100 text-stone-500 dark:bg-zinc-950 dark:text-zinc-400"
  >
    <div className="flex -translate-y-2 flex-col items-center gap-3">
      <span className="text-[11px] font-semibold tracking-[0.22em]">画谱</span>
      <div className="h-px w-10 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        <div className="startup-progress h-full w-1/2 rounded-full bg-stone-500/55 dark:bg-zinc-300/60" />
      </div>
    </div>
  </motion.div>
);
