import type { PracticeShortcuts } from '../types';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export type PracticeShortcutAction = keyof PracticeShortcuts;

export const DEFAULT_PRACTICE_SHORTCUTS: PracticeShortcuts = {
  togglePause: 'CommandOrControl+Space',
  nextImage: 'CommandOrControl+Right',
  previousImage: 'CommandOrControl+Left',
  toggleClickThrough: 'CommandOrControl+Shift+I',
  toggleControls: 'CommandOrControl+Tab',
  resetTimer: 'CommandOrControl+R',
  exitPractice: 'CommandOrControl+Escape',
};

export const PRACTICE_SHORTCUTS: { id: PracticeShortcutAction; label: string }[] = [
  { id: 'togglePause', label: '暂停 / 恢复' },
  { id: 'nextImage', label: '下一张' },
  { id: 'previousImage', label: '上一张' },
  { id: 'toggleClickThrough', label: '锁定窗口' },
  { id: 'toggleControls', label: '显示 / 隐藏控制栏' },
  { id: 'resetTimer', label: '重置倒计时' },
  { id: 'exitPractice', label: '退出练习' },
];

const normalizeKey = (key: string): string | null => {
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return null;
  if (key === ' ') return 'Space';
  if (key === 'ArrowRight') return 'Right';
  if (key === 'ArrowLeft') return 'Left';
  if (key === 'ArrowUp') return 'Up';
  if (key === 'ArrowDown') return 'Down';
  if (key === 'Esc') return 'Escape';
  return key.length === 1 ? key.toUpperCase() : key;
};

export const shortcutFromKeyboardEvent = (event: KeyboardEvent | ReactKeyboardEvent): string | null => {
  const key = normalizeKey(event.key);
  if (!key) return null;
  const modifiers: string[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push('CommandOrControl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (modifiers.length === 0) return null;
  return [...modifiers, key].join('+');
};

export const formatShortcut = (shortcut: string): string => shortcut
  .replace('CommandOrControl', 'Ctrl')
  .replace('Right', '→')
  .replace('Left', '←')
  .replace('Up', '↑')
  .replace('Down', '↓')
  .split('+')
  .join(' + ');
