import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Copy, FolderOpen, FlipHorizontal, Palette, LayoutGrid, MousePointer2, MoreHorizontal, X, Plus, AlertCircle, ChevronDown, Tag, Trash2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-dialog';
import { FocusedPracticeImage } from '../components/FocusedPracticeImage';
import type { FocusRegion, ImageRecord } from '../types';
import { DEFAULT_PRACTICE_SHORTCUTS, formatShortcut, PRACTICE_SHORTCUTS, shortcutFromKeyboardEvent, type PracticeShortcutAction } from '../utils/shortcuts';
import { BUILTIN_TAG_CATEGORIES, isBuiltinTag, compactVisualTagLabel } from '../utils/tagCatalog';

type LibraryStatus = {
  libraryPath?: string;
  configured: boolean;
  taggerPath: string;
  pythonVersion?: string;
  taggingReady: boolean;
  taggingError?: string;
  localizationReady: boolean;
};

const SettingSwitch = ({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={onChange}
    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-zinc-800 dark:bg-zinc-100' : 'bg-stone-300 dark:bg-zinc-700'}`}
  >
    <span className={`absolute top-[3px] h-3.5 w-3.5 rounded-full bg-white transition-all dark:bg-zinc-900 ${checked ? 'left-[19px]' : 'left-[3px]'}`} />
  </button>
);

const GridRange = ({ label, value, min, max, step, suffix, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) => (
  <div className="grid grid-cols-[64px_1fr_54px] items-center gap-2">
    <span className="text-[10px] font-semibold text-stone-600 dark:text-zinc-300">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={event => onChange(Number(event.target.value))}
      className="h-1 min-w-0 cursor-pointer appearance-none rounded-lg bg-black/10 accent-black dark:bg-white/20 dark:accent-white"
    />
    <span className="whitespace-nowrap text-right text-[9px] font-bold tabular-nums text-stone-400">{suffix}</span>
  </div>
);

const GradientPresetSlider = ({
  value,
  options,
  onChange,
}: {
  value: number;
  options: { value: number; label: string }[];
  onChange: (value: number) => void;
}) => {
  const activeIndex = Math.max(0, options.findIndex(option => option.value === value));
  const progress = ((activeIndex + 1) / options.length) * 100;

  return (
    <div className="relative flex h-8 min-w-0 flex-1 overflow-hidden rounded-lg bg-stone-200/50 p-1 dark:bg-zinc-800/50">
      <motion.div
        className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-md bg-gradient-to-r from-transparent to-white shadow-[0_0_12px_rgba(255,255,255,0.55)] dark:to-white/20 dark:shadow-none"
        initial={false}
        animate={{ width: `calc(${progress}% - 8px)` }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      />
      {options.map((option, index) => (
        <button
          type="button"
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`relative z-10 flex-1 rounded-md text-[10px] font-bold transition-colors ${index <= activeIndex ? 'text-stone-900 dark:text-white' : 'text-stone-400 hover:text-stone-700 dark:text-zinc-500 dark:hover:text-zinc-300'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

export const SettingsView = () => {
  const { settings, updateSettings, history, clearHistory } = useAppContext();
  const [activeTab, setActiveTab] = useState<'basic' | 'history' | 'library' | 'shortcuts'>('history');
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus | null>(null);
  const [libraryFileCount, setLibraryFileCount] = useState(0);
  const [isCheckingLibrary, setIsCheckingLibrary] = useState(false);
  const [isCheckingModel, setIsCheckingModel] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<'library' | 'tagger' | null>(null);
  const [selectedItem, setSelectedItem] = useState<{ image: ImageRecord; focusRegion?: FocusRegion } | null>(null);
  const [expandedHistoryDays, setExpandedHistoryDays] = useState<Set<string>>(() => new Set());
  const [recordingShortcut, setRecordingShortcut] = useState<PracticeShortcutAction | null>(null);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('1.1.0');
  const [newGroupName, setNewGroupName] = useState('');
  const [groupInputError, setGroupInputError] = useState<string | null>(null);
  const [newTagInputs, setNewTagInputs] = useState<Record<string, string>>({});
  const [tagInputErrors, setTagInputErrors] = useState<Record<string, string>>({});
  const [showNativeTags, setShowNativeTags] = useState(false);

  const customGroups = settings.customTagGroups || [];

  const handleCreateGroup = (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    const trimmed = newGroupName.trim();
    if (!trimmed) return;
    if (trimmed.length > 16) {
      setGroupInputError('分组名称不能超过 16 个字符');
      return;
    }
    if (customGroups.some(g => g.name === trimmed)) {
      setGroupInputError('该分组名称已存在');
      return;
    }
    const newGroup = {
      id: `group_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
      name: trimmed,
      tags: [],
    };
    updateSettings({ customTagGroups: [...customGroups, newGroup] });
    setNewGroupName('');
    setGroupInputError(null);
  };

  const handleDeleteGroup = (groupId: string) => {
    updateSettings({
      customTagGroups: customGroups.filter(g => g.id !== groupId),
    });
  };

  const handleAddTagToGroup = (groupId: string, event?: React.FormEvent) => {
    if (event) event.preventDefault();
    const inputVal = (newTagInputs[groupId] || '').trim();
    if (!inputVal) return;
    if (inputVal.length > 24) {
      setTagInputErrors(prev => ({ ...prev, [groupId]: '标签名称不能超过 24 个字符' }));
      return;
    }
    if (isBuiltinTag(inputVal)) {
      setTagInputErrors(prev => ({ ...prev, [groupId]: '该标签为系统原生标签，无需重复添加' }));
      return;
    }
    const allCustomTags = customGroups.flatMap(g => g.tags);
    if (allCustomTags.includes(inputVal)) {
      setTagInputErrors(prev => ({ ...prev, [groupId]: '该自定义标签已存在' }));
      return;
    }

    const updatedGroups = customGroups.map(g => (
      g.id === groupId ? { ...g, tags: [...g.tags, inputVal] } : g
    ));
    updateSettings({ customTagGroups: updatedGroups });
    setNewTagInputs(prev => ({ ...prev, [groupId]: '' }));
    setTagInputErrors(prev => ({ ...prev, [groupId]: '' }));
  };

  const handleDeleteTagFromGroup = (groupId: string, tagToDelete: string) => {
    const updatedGroups = customGroups.map(g => (
      g.id === groupId ? { ...g, tags: g.tags.filter(t => t !== tagToDelete) } : g
    ));
    updateSettings({ customTagGroups: updatedGroups });
  };

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedItem) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedItem(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItem]);

  const recordShortcut = (action: PracticeShortcutAction, event: React.KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) {
      setShortcutError('快捷键需要包含 Ctrl、Alt 或 Shift');
      return;
    }
    const conflict = (Object.entries(settings.shortcuts) as [PracticeShortcutAction, string][]).find(([id, value]) => id !== action && value === shortcut);
    if (conflict) {
      const label = PRACTICE_SHORTCUTS.find(item => item.id === conflict[0])?.label;
      setShortcutError(`已用于“${label}”`);
      return;
    }
    updateSettings({ shortcuts: { ...settings.shortcuts, [action]: shortcut } });
    setShortcutError(null);
    setRecordingShortcut(null);
  };

  // Process history by day
  const historyByDay = React.useMemo(() => {
    const groups: { dateStr: string; items: { image: any, focusRegion?: any, recordId: string }[], totalSec: number, totalImages: number }[] = [];
    
    // Sort descending by date
    const sortedHistory = [...history].sort((a, b) => b.date - a.date);
    
    sortedHistory.forEach(record => {
      const date = new Date(record.date);
      const today = new Date();
      let dateStr = date.toLocaleDateString();
      if (date.toDateString() === today.toDateString()) {
        dateStr = '今天';
      } else {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
          dateStr = '昨天';
        }
      }

      let group = groups.find(g => g.dateStr === dateStr);
      if (!group) {
        group = { dateStr, items: [], totalSec: 0, totalImages: 0 };
        groups.push(group);
      }
      
      const recordItems = record.items || record.images?.map(image => ({ image })) || [];
      recordItems.forEach(item => {
        group!.items.push({ ...item, recordId: record.id });
      });
      group.totalSec += record.durationSec || 0;
      group.totalImages += recordItems.length;
    });
    
    return groups;
  }, [history]);

  const tabs = [
    { id: 'history', label: '记录' },
    { id: 'basic', label: '常规' },
    { id: 'shortcuts', label: '练习界面' },
    { id: 'library', label: '图库与识别' },
  ] as const;

  const totalTimeSec = history.reduce((acc, curr) => acc + curr.durationSec, 0);
  const totalImages = history.reduce((acc, curr) => acc + curr.imageCount, 0);
  const todayRecords = history.filter(record => new Date(record.date).toDateString() === new Date().toDateString());
  const todayTimeSec = todayRecords.reduce((sum, record) => sum + record.durationSec, 0);
  const todayImages = todayRecords.reduce((sum, record) => sum + record.imageCount, 0);
  const formatTime = (sec: number) => {
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    return `${min}m`;
  };

  const refreshLibraryCount = async () => {
    setIsCheckingLibrary(true);
    setLibraryError(null);
    try {
      setLibraryFileCount(await invoke<number>('count_library_images'));
    } catch (error) {
      console.warn('Failed to count library images:', error);
      setLibraryError(String(error));
    } finally {
      setIsCheckingLibrary(false);
    }
  };

  const refreshModelStatus = async () => {
    setIsCheckingModel(true);
    setModelError(null);
    try {
      setLibraryStatus(await invoke<LibraryStatus>('get_library_status'));
    } catch (error) {
      console.warn('Failed to inspect model status:', error);
      setModelError(String(error));
    } finally {
      setIsCheckingModel(false);
    }
  };

  const copyPath = async (path: string | undefined, target: 'library' | 'tagger') => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(target);
      window.setTimeout(() => setCopiedPath(null), 1200);
    } catch (error) {
      setLibraryError(`复制失败：${String(error)}`);
    }
  };

  const chooseLibraryDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择本地图库目录',
        defaultPath: libraryStatus?.libraryPath,
      });
      if (!selected || Array.isArray(selected)) return;
      setIsCheckingLibrary(true);
      const status = await invoke<LibraryStatus>('set_library_directory', { path: selected });
      setLibraryStatus(status);
      const count = await invoke<number>('count_library_images');
      setLibraryFileCount(count);
      setLibraryError(null);
    } catch (error) {
      setLibraryError(String(error));
    } finally {
      setIsCheckingLibrary(false);
    }
  };

  const handleClearHistory = () => {
    if (history.length > 0 && window.confirm('清除全部练习记录？此操作无法撤销。')) {
      clearHistory();
    }
  };

  useEffect(() => {
    if (activeTab === 'library') {
      void refreshModelStatus();
      void refreshLibraryCount();
    }
  }, [activeTab]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <header className="shrink-0 h-12 px-4 flex items-center gap-3 border-b border-black/5 dark:border-white/5">
        <h1 className="shrink-0 text-base font-bold tracking-tight">设置</h1>
      <div className="min-w-0 flex-1 grid grid-cols-4 gap-0.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-0.5">
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-center h-8 rounded-md transition-all relative ${
                isActive ? 'text-black dark:text-white' : 'text-stone-500 hover:text-stone-800 dark:hover:text-zinc-200'
              }`}
            >
              {isActive && (
                <motion.div 
                  layoutId="settingsTab" 
                  className="absolute inset-0 bg-white dark:bg-zinc-800 border border-black/5 dark:border-white/5 rounded-md"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className="text-[9px] font-bold relative z-10 truncate">{tab.label}</span>
            </button>
          );
        })}
      </div></header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-8 [@media(min-height:700px)]:pt-5 [@media(min-height:700px)]:pb-10 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
            className="flex min-h-full w-full flex-col gap-5 [@media(min-height:700px)]:gap-6"
          >
            {activeTab === 'basic' && (
              <>
                <section>
                  <h3 className="mb-2 text-[10px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">练习环境</h3>
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-[84px_1fr] items-center gap-2">
                      <div className="text-xs font-semibold text-stone-800 dark:text-zinc-200">准备时间</div>
                      <GradientPresetSlider
                        value={settings.preparationSec}
                        options={[{ value: 0, label: '无' }, { value: 3, label: '3s' }, { value: 5, label: '5s' }, { value: 10, label: '10s' }]}
                        onChange={preparationSec => updateSettings({ preparationSec })}
                      />
                    </div>
                    <div className="grid grid-cols-[84px_1fr] items-center gap-2">
                      <div className="text-xs font-semibold text-stone-800 dark:text-zinc-200">切换间隔</div>
                      <GradientPresetSlider
                        value={settings.transitionSec}
                        options={[{ value: 0, label: '无' }, { value: 1, label: '1s' }, { value: 2, label: '2s' }, { value: 5, label: '5s' }]}
                        onChange={transitionSec => updateSettings({ transitionSec })}
                      />
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-[10px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">外观与系统</h3>
                  <div className="divide-y divide-black/5 dark:divide-white/5">
                    <div className="flex min-h-9 items-center justify-between">
                      <div className="text-xs font-semibold text-stone-800 dark:text-zinc-200">界面提示音</div>
                      <SettingSwitch label="界面提示音" checked={settings.soundEnabled} onChange={() => updateSettings({ soundEnabled: !settings.soundEnabled })} />
                    </div>
                    <div className="grid min-h-10 grid-cols-[64px_1fr] items-center gap-3">
                      <div className="text-xs font-semibold text-stone-800 dark:text-zinc-200">主题</div>
                      <div className="grid grid-cols-3 rounded-lg bg-black/[0.035] p-0.5 dark:bg-white/[0.05]">
                        {([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([theme, label]) => (
                          <button key={theme} onClick={() => updateSettings({ theme })} className={`h-7 rounded-md text-[9px] font-bold transition-all ${settings.theme === theme ? 'bg-white text-stone-900 border border-black/5 dark:border-white/5 dark:bg-zinc-700 dark:text-white' : 'text-stone-400 hover:text-stone-700 dark:hover:text-zinc-300'}`}>{label}</button>
                        ))}
                      </div>
                    </div>
                    <div className="flex min-h-9 items-center justify-between">
                      <div className="text-xs font-semibold text-stone-800 dark:text-zinc-200">启动时置顶</div>
                      <SettingSwitch label="启动时置顶" checked={settings.startAlwaysOnTop} onChange={() => updateSettings({ startAlwaysOnTop: !settings.startAlwaysOnTop })} />
                    </div>
                    <div className="flex min-h-9 items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-stone-800 dark:text-zinc-200">记住练习窗口位置和尺寸</div>
                        <div className="mt-0.5 text-[8px] text-stone-400">下次启动沿用上次窗口布局</div>
                      </div>
                      <SettingSwitch label="记住练习窗口位置和尺寸" checked={settings.rememberWindowBounds} onChange={() => updateSettings({ rememberWindowBounds: !settings.rememberWindowBounds })} />
                    </div>
                  </div>
                </section>

                <section className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">标签管理</h3>
                    <span className="text-[9px] text-stone-400">原生标签不可改动 · 支持自定义标签分组</span>
                  </div>

                  <div className="rounded-xl border border-black/5 bg-white/60 p-3.5 space-y-3 dark:border-white/5 dark:bg-zinc-800/60">
                    {/* 自定义标签分组 */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold text-stone-800 dark:text-zinc-200 flex items-center gap-1.5">
                          自定义标签
                          <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded-full bg-black/5 dark:bg-white/10 text-stone-500 dark:text-zinc-400">
                            {customGroups.reduce((sum, g) => sum + g.tags.length, 0)} 个标签 · {customGroups.length} 个分组
                          </span>
                        </div>
                      </div>

                      {/* 分组列表 */}
                      {customGroups.length === 0 ? (
                        <div className="h-10 flex items-center justify-center text-[10px] text-stone-400 dark:text-zinc-500 rounded-lg bg-black/[0.02] dark:bg-black/20 border border-black/5 dark:border-white/5">
                          暂无自定义分组，在下方输入名称新建分组
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {customGroups.map(group => (
                            <div key={group.id} className="p-2.5 rounded-lg bg-black/[0.02] dark:bg-black/20 border border-black/5 dark:border-white/5 space-y-2">
                              {/* 分组头部 */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-stone-700 dark:text-zinc-300">{group.name}</span>
                                  <span className="text-[8px] text-stone-400 font-semibold">{group.tags.length} 个标签</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteGroup(group.id)}
                                  className="text-[9px] text-stone-400 hover:text-red-500 flex items-center gap-0.5 transition-colors cursor-pointer"
                                  title={`删除分组 "${group.name}"`}
                                >
                                  <Trash2 size={10} />
                                  <span>删除分组</span>
                                </button>
                              </div>

                              {/* 分组标签列表 */}
                              <div className="flex flex-wrap gap-1 min-h-6 items-center">
                                {group.tags.length === 0 ? (
                                  <span className="text-[9px] text-stone-400 dark:text-zinc-500">暂无标签</span>
                                ) : (
                                  group.tags.map(tag => (
                                    <span
                                      key={tag}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/[0.035] dark:bg-white/[0.05] text-[9px] font-medium text-stone-600 dark:text-zinc-400 border border-black/5 dark:border-white/5 select-none"
                                    >
                                      <span>{tag}</span>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteTagFromGroup(group.id, tag)}
                                        className="w-3.5 h-3.5 flex items-center justify-center rounded text-stone-400 hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                                        title={`删除标签 "${tag}"`}
                                      >
                                        <X size={10} strokeWidth={2.5} />
                                      </button>
                                    </span>
                                  ))
                                )}
                              </div>

                              {/* 添加标签至该分组 */}
                              <form onSubmit={e => handleAddTagToGroup(group.id, e)} className="flex gap-1 pt-1 border-t border-black/5 dark:border-white/5">
                                <input
                                  type="text"
                                  value={newTagInputs[group.id] || ''}
                                  onChange={e => {
                                    setNewTagInputs(prev => ({ ...prev, [group.id]: e.target.value }));
                                    if (tagInputErrors[group.id]) setTagInputErrors(prev => ({ ...prev, [group.id]: '' }));
                                  }}
                                  placeholder="添加标签..."
                                  className="flex-1 h-7 px-2 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/5 dark:border-white/5 text-[10px] font-medium text-stone-800 dark:text-zinc-200 placeholder:text-stone-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-stone-400 dark:focus:border-zinc-500 transition-colors"
                                />
                                <button
                                  type="submit"
                                  disabled={!newTagInputs[group.id]?.trim()}
                                  className="h-7 px-2.5 rounded-md bg-stone-800 dark:bg-zinc-200 text-white dark:text-zinc-900 text-[10px] font-bold flex items-center gap-1 hover:opacity-90 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                                >
                                  <Plus size={11} strokeWidth={2.5} />
                                  添加
                                </button>
                              </form>
                              {tagInputErrors[group.id] && (
                                <div className="text-[8px] text-red-500 flex items-center gap-1 font-medium">
                                  <AlertCircle size={10} /> {tagInputErrors[group.id]}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 新建分组输入栏 */}
                      <form onSubmit={handleCreateGroup} className="flex gap-1.5 pt-1">
                        <input
                          type="text"
                          value={newGroupName}
                          onChange={e => {
                            setNewGroupName(e.target.value);
                            if (groupInputError) setGroupInputError(null);
                          }}
                          placeholder="新建分组名称..."
                          className="flex-1 h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/5 dark:border-white/10 text-xs font-medium text-stone-800 dark:text-zinc-200 placeholder:text-stone-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-stone-400 dark:focus:border-zinc-500 transition-colors"
                        />
                        <button
                          type="submit"
                          disabled={!newGroupName.trim()}
                          className="h-8 px-3 rounded-lg bg-stone-800 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold flex items-center gap-1 hover:opacity-90 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                        >
                          <Plus size={13} strokeWidth={2.5} />
                          新建分组
                        </button>
                      </form>
                      {groupInputError && (
                        <div className="text-[9px] text-red-500 flex items-center gap-1 font-medium">
                          <AlertCircle size={11} /> {groupInputError}
                        </div>
                      )}
                    </div>

                    {/* 原生标签列表（折叠/展开查看） */}
                    <div className="pt-2 border-t border-black/5 dark:border-white/5">
                      <button
                        type="button"
                        onClick={() => setShowNativeTags(!showNativeTags)}
                        className="w-full flex items-center justify-between text-left group cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-stone-800 dark:text-zinc-200">系统原生标签</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-stone-200/70 dark:bg-zinc-700/70 text-stone-600 dark:text-zinc-400 font-semibold">内置 · 不可修改</span>
                        </div>
                        <div className="flex items-center gap-1 text-[9px] font-semibold text-stone-400 group-hover:text-stone-700 dark:group-hover:text-zinc-200 transition-colors">
                          <span>{showNativeTags ? '收起' : '展开查看'}</span>
                          <ChevronDown size={13} className={`transition-transform duration-200 ${showNativeTags ? 'rotate-180' : ''}`} />
                        </div>
                      </button>

                      <AnimatePresence>
                        {showNativeTags && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden mt-2.5 space-y-2"
                          >
                            <div className="p-2.5 rounded-lg bg-black/[0.02] dark:bg-black/20 border border-black/5 dark:border-white/5 space-y-2">
                              {BUILTIN_TAG_CATEGORIES.map(category => (
                                <div key={category.name} className="flex items-start gap-2">
                                  <div className="w-12 pt-0.5 text-[9px] font-bold text-stone-400 shrink-0">{category.name}</div>
                                  <div className="flex flex-wrap gap-1">
                                    {category.tags.map(tag => (
                                      <span
                                        key={tag}
                                        className="px-1.5 py-0.5 rounded bg-black/[0.035] dark:bg-white/[0.05] text-[9px] font-medium text-stone-600 dark:text-zinc-400 border border-black/5 dark:border-white/5 select-none"
                                      >
                                        {compactVisualTagLabel(tag)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </section>

                <div className="mt-auto pt-4 text-center text-[8px] leading-relaxed text-stone-400 dark:text-zinc-600">
                  <div className="font-semibold">画谱 Etude</div>
                  <div>Version {appVersion}</div>
                </div>
              </>
            )}

            {activeTab === 'history' && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-stone-900 dark:text-white">今天</div>
                    <div className="mt-0.5 text-[10px] font-semibold text-stone-400">{todayImages} 张 · {formatTime(todayTimeSec)}</div>
                  </div>
                  <details className="group relative">
                    <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md text-stone-400 hover:bg-black/5 hover:text-stone-700 dark:hover:bg-white/5 dark:hover:text-zinc-200" aria-label="记录菜单">
                      <MoreHorizontal size={15} />
                    </summary>
                    <div className="absolute right-0 top-8 z-20 w-32 rounded-lg border border-black/5 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-zinc-800">
                      <button onClick={handleClearHistory} disabled={history.length === 0} className="h-8 w-full rounded-md px-2 text-left text-[9px] font-bold text-red-500 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-500/10">清除全部记录</button>
                    </div>
                  </details>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-black/5 bg-white/60 p-3 dark:border-white/5 dark:bg-zinc-800/60">
                    <div className="text-[10px] uppercase text-stone-500 font-bold mb-1">累计时间</div>
                    <div className="text-xl font-bold tracking-tight">{formatTime(totalTimeSec)}</div>
                  </div>
                  <div className="rounded-lg border border-black/5 bg-white/60 p-3 dark:border-white/5 dark:bg-zinc-800/60">
                    <div className="text-[10px] uppercase text-stone-500 font-bold mb-1">累计张数</div>
                    <div className="text-xl font-bold tracking-tight">{totalImages}</div>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  {historyByDay.length === 0 ? (
                    <div className="text-center text-xs text-stone-500 py-10">暂无练习记录</div>
                  ) : (
                    historyByDay.map(group => {
                      const isExpanded = expandedHistoryDays.has(group.dateStr);
                      const visibleItems = isExpanded ? group.items : group.items.slice(0, 6);
                      return (
                      <div key={group.dateStr} className="flex flex-col">
                        <div className="mb-2.5 flex items-center gap-3">
                          <h4 className="text-sm font-bold text-stone-800 dark:text-stone-200 shrink-0">{group.dateStr}</h4>
                          <span className="text-[10px] font-bold tracking-wider text-stone-400 shrink-0">练习 {group.totalImages} 张 · 耗时 {formatTime(group.totalSec)}</span>
                          <div className="h-[1px] bg-black/5 dark:bg-white/5 w-full"></div>
                        </div>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
                          {visibleItems.map((item, i) => (
                            <div 
                              key={`${item.recordId}-${i}`} 
                              className="group relative aspect-[4/5] overflow-hidden rounded-lg bg-zinc-100 shadow-sm transition-shadow hover:shadow-md dark:bg-zinc-800"
                              onClick={() => setSelectedItem({ image: item.image, focusRegion: item.focusRegion })}
                            >
                              {item.focusRegion
                                ? <FocusedPracticeImage image={item.image} region={item.focusRegion} flipped={false} grayscale={false} />
                                : <img src={item.image.url} className="h-full w-full object-cover" alt="" loading="lazy" draggable={false} />}
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none"></div>
                            </div>
                          ))}
                        </div>
                        {group.items.length > 6 && (
                          <button
                            onClick={() => setExpandedHistoryDays(current => {
                              const next = new Set(current);
                              if (next.has(group.dateStr)) next.delete(group.dateStr);
                              else next.add(group.dateStr);
                              return next;
                            })}
                            className="mt-2 h-7 self-start rounded-md border border-black/5 bg-white/40 px-2.5 text-[9px] font-bold text-stone-500 hover:bg-white/75 hover:text-stone-800 dark:border-white/5 dark:bg-white/[0.03] dark:hover:bg-white/[0.07] dark:hover:text-zinc-200"
                          >
                            {isExpanded ? '收起' : `查看全部 ${group.items.length} 张`}
                          </button>
                        )}
                      </div>
                    )})
                  )}
                </div>
              </div>
            )}

            {activeTab === 'library' && (
              <div className="flex flex-col gap-4">
                <section>
                  <h3 className="mb-2 text-[10px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">图库文件</h3>
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-white/60 dark:bg-zinc-800/60 border border-black/5 dark:border-white/5">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="text-xs font-bold">本地图库目录</div>
                          <div className="text-[9px] text-stone-500 mt-0.5">检测到 {libraryFileCount} 张图片</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={refreshLibraryCount} disabled={isCheckingLibrary} className="h-7 rounded-md px-2 text-[9px] font-bold text-stone-500 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5">
                            {isCheckingLibrary ? '统计中…' : '重新统计'}
                          </button>
                          <button onClick={chooseLibraryDirectory} disabled={isCheckingLibrary} className="h-7 rounded-md px-2 text-[9px] font-bold text-stone-500 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5">
                            更改
                          </button>
                          <button onClick={() => copyPath(libraryStatus?.libraryPath, 'library')} disabled={!libraryStatus?.libraryPath} className="w-7 h-7 flex items-center justify-center rounded-md text-stone-500 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-30" title="复制路径">
                            {copiedPath === 'library' ? <Check size={11} /> : <Copy size={11} />}
                          </button>
                          <button onClick={() => invoke('open_library_folder')} className="h-7 flex items-center gap-1.5 px-2.5 rounded-md bg-black/5 dark:bg-white/10 text-[10px] font-bold">
                            <FolderOpen size={12} /> 打开
                          </button>
                        </div>
                      </div>
                      {libraryError && <div className="mt-2 text-[9px] leading-relaxed text-red-500">读取失败：{libraryError}</div>}
                      <div className="px-2 py-1.5 rounded-lg bg-black/[0.03] dark:bg-black/20 text-[9px] text-stone-500 break-all select-text">
                        {libraryStatus?.libraryPath || '正在读取…'}
                      </div>
                    </div>
                    <p className="text-[10px] leading-relaxed text-stone-500">
                      目录可以位于任意本地磁盘。更改目录只会切换图库来源，不会移动原目录中的图片。
                    </p>
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-[10px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">识别模型</h3>
                  <div className="rounded-lg border border-black/5 bg-white/50 p-3 dark:border-white/5 dark:bg-zinc-800/50">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold text-stone-800 dark:text-zinc-200">识别模型</div>
                      <div className={`flex items-center gap-1.5 text-[9px] font-bold ${!libraryStatus ? 'text-stone-400' : libraryStatus.localizationReady ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${!libraryStatus ? 'bg-stone-400' : libraryStatus.localizationReady ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        {!libraryStatus ? '检测中…' : libraryStatus.localizationReady ? '已就绪' : '需要检查'}
                      </div>
                    </div>
                    <div className="mt-1.5 text-[9px] text-stone-400">
                      局部定位 {!libraryStatus ? '检测中' : libraryStatus.localizationReady ? '可用' : '不可用'} · 自动打标 {!libraryStatus ? '检测中' : libraryStatus.taggingReady ? '可用' : '未安装（可选）'}
                    </div>
                    <div className="mt-3 flex items-center gap-1">
                      <button onClick={refreshModelStatus} disabled={isCheckingModel} className="h-7 rounded-md px-2 text-[9px] font-bold text-stone-500 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5">
                        {isCheckingModel ? '检测中…' : '重新检测'}
                      </button>
                      <button onClick={() => copyPath(libraryStatus?.taggerPath, 'tagger')} disabled={!libraryStatus?.taggerPath} className="h-7 w-7 flex items-center justify-center rounded-md text-stone-500 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-30" title="复制路径">
                        {copiedPath === 'tagger' ? <Check size={11} /> : <Copy size={11} />}
                      </button>
                      <button onClick={() => invoke('open_tagger_folder')} className="h-7 flex items-center gap-1.5 px-2.5 rounded-md bg-black/5 dark:bg-white/10 text-[10px] font-bold">
                        <FolderOpen size={12} /> 打开
                      </button>
                    </div>
                    <div className="mt-2 px-2 py-1.5 rounded-lg bg-black/[0.03] dark:bg-black/20 text-[9px] text-stone-500 break-all select-text">
                      {libraryStatus?.taggerPath || '正在读取…'}
                    </div>
                    <div className="mt-2 text-[9px] leading-relaxed text-stone-400">
                      此目录固定为软件目录下的 model/tagger-component。将独立组件包中的 runtime 与 model 文件夹放入这里，然后点击“重新检测”即可检测。
                    </div>
                    {modelError && <div className="mt-2 text-[9px] leading-relaxed text-red-500">检测失败：{modelError}</div>}
                    {libraryStatus?.taggingError && (
                      <div className="mt-2 text-[9px] leading-relaxed text-amber-600 dark:text-amber-400">{libraryStatus.taggingError}</div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <>
                <section>
                  <h3 className="mb-2 text-[10px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">默认开启</h3>
                  <div className="grid grid-cols-4 gap-1 rounded-lg bg-black/[0.035] p-1 dark:bg-white/[0.04]">
                    {[
                      { label: '网格', icon: LayoutGrid, active: settings.defaultGrid, toggle: () => updateSettings({ defaultGrid: !settings.defaultGrid }) },
                      { label: '镜像', icon: FlipHorizontal, active: settings.defaultFlip, toggle: () => updateSettings({ defaultFlip: !settings.defaultFlip }) },
                      { label: '黑白', icon: Palette, active: settings.defaultGrayscale, toggle: () => updateSettings({ defaultGrayscale: !settings.defaultGrayscale }) },
                      { label: '锁定', icon: MousePointer2, active: settings.defaultClickThrough, toggle: () => updateSettings({ defaultClickThrough: !settings.defaultClickThrough }) },
                    ].map(item => (
                      <button
                        key={item.label}
                        onClick={item.toggle}
                        aria-pressed={item.active}
                        className={`flex h-9 min-w-0 items-center justify-center gap-1 rounded-md text-[9px] font-bold transition-all ${item.active ? 'bg-white text-stone-900 border border-black/5 dark:border-white/5 dark:bg-zinc-700 dark:text-white' : 'text-stone-400 hover:text-stone-700 dark:text-zinc-500 dark:hover:text-zinc-300'}`}
                      >
                        <item.icon size={12} className="shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-[10px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">效果调整</h3>
                  <div className="rounded-lg border border-black/5 bg-white/35 px-3 dark:border-white/5 dark:bg-white/[0.025]">
                    <div className="space-y-3 py-3">
                      <div className="flex items-center gap-2 text-[10px] font-bold text-stone-700 dark:text-zinc-200"><LayoutGrid size={13} /> 网格线</div>
                      <GridRange label="密度" value={settings.gridDensity} min={2} max={16} step={1} suffix={`${settings.gridDensity} × ${settings.gridDensity}`} onChange={gridDensity => updateSettings({ gridDensity })} />
                      <GridRange label="线宽" value={settings.gridLineWidth} min={0.5} max={4} step={0.5} suffix={`${settings.gridLineWidth}px`} onChange={gridLineWidth => updateSettings({ gridLineWidth })} />
                      <GridRange label="明显程度" value={settings.gridOpacity} min={5} max={80} step={5} suffix={`${settings.gridOpacity}%`} onChange={gridOpacity => updateSettings({ gridOpacity })} />
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-stone-600 dark:text-zinc-300">颜色</span>
                        <div className="flex gap-2">
                          {[
                            { color: 'white', label: '白' },
                            { color: 'black', label: '黑' },
                            { color: '#888888', label: '灰' },
                            { color: '#ef4444', label: '红' },
                          ].map(c => (
                            <button
                              key={c.color}
                              onClick={() => updateSettings({ gridColor: c.color })}
                              className={`h-5 w-5 rounded-full border transition-transform ${settings.gridColor === c.color ? 'scale-110 ring-2 ring-stone-400 ring-offset-2 ring-offset-stone-50 dark:ring-zinc-400 dark:ring-offset-zinc-900' : 'border-black/10 hover:scale-110 dark:border-white/10'}`}
                              style={{ backgroundColor: c.color }}
                              title={c.label}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex min-h-11 items-center justify-between border-t border-black/5 dark:border-white/5">
                      <div className="flex items-center gap-2 text-[10px] font-bold text-stone-700 dark:text-zinc-200"><FlipHorizontal size={13} /> 镜像翻转动画</div>
                      <SettingSwitch label="镜像翻转动画" checked={settings.flipAnimation} onChange={() => updateSettings({ flipAnimation: !settings.flipAnimation })} />
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-[10px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">界面外观</h3>
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-semibold text-xs text-stone-700 dark:text-zinc-300">练习画布不透明度 ({settings.canvasOpacity}%)</div>
                      <input
                        type="range"
                        min="10" max="100" step="5"
                        value={settings.canvasOpacity}
                        onChange={(e) => updateSettings({ canvasOpacity: parseInt(e.target.value) })}
                        className="w-32 h-1 bg-black/10 dark:bg-white/20 rounded-lg appearance-none cursor-pointer accent-black dark:accent-white"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-semibold text-xs text-stone-700 dark:text-zinc-300">主窗口背景不透明度 ({settings.bgOpacity}%)</div>
                      <input 
                        type="range" 
                        min="10" max="100" step="5"
                        value={settings.bgOpacity} 
                        onChange={(e) => updateSettings({ bgOpacity: parseInt(e.target.value) })}
                        className="w-32 h-1 bg-black/10 dark:bg-white/20 rounded-lg appearance-none cursor-pointer accent-black dark:accent-white"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-semibold text-xs text-stone-700 dark:text-zinc-300">倒计时大小 ({settings.timerSize || 60}px)</div>
                      <input 
                        type="range" 
                        min="20" max="100" step="2"
                        value={settings.timerSize || 60} 
                        onChange={(e) => updateSettings({ timerSize: parseInt(e.target.value) })}
                        className="w-32 h-1 bg-black/10 dark:bg-white/20 rounded-lg appearance-none cursor-pointer accent-black dark:accent-white"
                      />
                    </div>
                  </div>
                </section>

                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[10px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">快捷键</h3>
                    <button onClick={() => { updateSettings({ shortcuts: { ...DEFAULT_PRACTICE_SHORTCUTS } }); setShortcutError(null); }} className="text-[9px] font-bold text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200">恢复默认</button>
                  </div>
                  <div className="divide-y divide-black/5 rounded-lg border border-black/5 px-3 dark:divide-white/5 dark:border-white/5">
                    {PRACTICE_SHORTCUTS.map(item => (
                      <div key={item.id} className="flex min-h-9 items-center justify-between gap-3">
                        <span className="text-[10px] font-semibold text-stone-700 dark:text-zinc-300">{item.label}</span>
                        <button
                          onClick={() => { setRecordingShortcut(item.id); setShortcutError(null); }}
                          onKeyDown={event => recordingShortcut === item.id && recordShortcut(item.id, event)}
                          onBlur={() => setRecordingShortcut(current => current === item.id ? null : current)}
                          className={`min-w-[108px] rounded-md px-2 py-1 text-right font-mono text-[9px] font-bold outline-none transition-colors ${recordingShortcut === item.id ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30' : 'bg-black/[0.035] text-stone-600 hover:bg-black/[0.06] dark:bg-white/[0.06] dark:text-zinc-300 dark:hover:bg-white/10'}`}
                        >
                          {recordingShortcut === item.id ? '请按新组合…' : formatShortcut(settings.shortcuts[item.id])}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className={`mt-1.5 min-h-3 text-[8px] ${shortcutError ? 'text-red-500' : 'text-stone-400'}`}>
                    {shortcutError || '点击快捷键后直接按下新组合，至少包含一个修饰键。'}
                  </div>
                </section>
              </>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      {/* Image Zoom Modal */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 sm:p-10 cursor-default select-none"
            onClick={() => setSelectedItem(null)}
          >
            {/* 精简小巧的悬浮关闭按钮 */}
            <motion.button 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute top-4 right-4 z-20 w-7 h-7 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white/80 hover:text-white rounded-full backdrop-blur-md transition-all hover:scale-105 active:scale-95 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedItem(null);
              }}
              aria-label="关闭预览"
              title="关闭 (Esc / 单击任意处)"
            >
              <X size={14} strokeWidth={2.2} />
            </motion.button>

            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              style={
                selectedItem.focusRegion
                  ? {
                      aspectRatio: `${
                        selectedItem.image.pixelWidth && selectedItem.image.pixelHeight
                          ? Math.max(0.45, Math.min(2.4, (selectedItem.focusRegion.width * selectedItem.image.pixelWidth) / (selectedItem.focusRegion.height * selectedItem.image.pixelHeight)))
                          : 1
                      }`,
                      maxHeight: '88vh',
                      maxWidth: '88vw',
                    }
                  : undefined
              }
              className={`relative flex items-center justify-center overflow-hidden rounded-2xl cursor-default ${
                selectedItem.focusRegion
                  ? 'w-[85vw] max-w-[700px] bg-zinc-950 shadow-2xl'
                  : 'max-w-[90vw] max-h-[90vh]'
              }`}
              onClick={() => setSelectedItem(null)}
            >
              {selectedItem.focusRegion ? (
                <FocusedPracticeImage
                  image={selectedItem.image}
                  region={selectedItem.focusRegion}
                  flipped={false}
                  grayscale={false}
                />
              ) : (
                <img
                  src={selectedItem.image.url}
                  className="max-w-[90vw] max-h-[90vh] w-auto h-auto object-contain rounded-2xl shadow-2xl pointer-events-none"
                  alt="练习记录"
                />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
