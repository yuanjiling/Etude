import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

export type ConfirmModalProps = {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  type = 'danger',
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md select-none"
          onClick={onCancel}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 8 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="w-full max-w-[360px] overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 shadow-2xl p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div
                className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${
                  type === 'danger'
                    ? 'bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400'
                    : 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400'
                }`}
              >
                {type === 'danger' ? <Trash2 size={20} /> : <AlertTriangle size={20} />}
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <h3 className="text-sm font-bold text-stone-900 dark:text-zinc-100 leading-snug">
                  {title}
                </h3>
                <div className="mt-1.5 text-[11px] leading-relaxed text-stone-500 dark:text-zinc-400">
                  {description}
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={onCancel}
                className="h-9 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-stone-700 dark:text-zinc-300 text-xs font-bold transition-colors cursor-pointer"
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`h-9 rounded-xl text-white text-xs font-bold transition-all shadow-sm cursor-pointer ${
                  type === 'danger'
                    ? 'bg-red-600 hover:bg-red-500 active:scale-98 shadow-red-600/20'
                    : 'bg-amber-600 hover:bg-amber-500 active:scale-98 shadow-amber-600/20'
                }`}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
