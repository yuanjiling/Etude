import React from 'react';
import { motion } from 'motion/react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const GlassCard: React.FC<GlassCardProps> = ({ children, className = '', onClick }) => {
  return (
    <motion.div
      whileHover={onClick ? { scale: 1.01 } : {}}
      whileTap={onClick ? { scale: 0.98 } : {}}
      onClick={onClick}
      className={`
        bg-white/60 dark:bg-zinc-800/50 backdrop-blur-3xl
        border border-black/5 dark:border-white/5
         rounded-xl 
        ${onClick ? 'cursor-pointer hover:bg-stone-50/80 dark:hover:bg-zinc-700/80 transition-colors' : ''}
        ${className}
      `}
    >
      {children}
    </motion.div>
  );
};
