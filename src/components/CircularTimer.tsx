import React from 'react';
import { motion } from 'motion/react';

interface CircularTimerProps {
  progress: number; // 0 to 1
  size?: number;
  strokeWidth?: number;
  text: string;
}

export const CircularTimer: React.FC<CircularTimerProps> = ({ progress, size = 64, strokeWidth = 4, text }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - progress * circumference;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Background circle */}
      <svg className="absolute top-0 left-0 -rotate-90" width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="opacity-20"
        />
        {/* Progress circle */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="opacity-100"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.5, ease: "linear" }}
          strokeLinecap="round"
        />
      </svg>
      <span className={`absolute whitespace-nowrap font-medium tracking-tighter ${text.length > 5 ? 'text-[10px]' : 'text-sm'}`}>
        {text}
      </span>
    </div>
  );
};
