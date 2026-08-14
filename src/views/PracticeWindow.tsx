import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, ChevronRight, ChevronLeft, X, TimerReset, Check, Lock, Unlock, Snowflake, Focus } from 'lucide-react';
import { CircularTimer } from '../components/CircularTimer';
import { FocusedPracticeImage } from '../components/FocusedPracticeImage';
import { PracticeReview } from '../components/PracticeReview';
import { useAppContext } from '../context/AppContext';
import { POSE_MODEL_VERSION } from '../services/poseFocus';
import type { FocusRegion, ImageRecord } from '../types';
import {
  CONTENT_TAGS,
  FIGURE_TAG_GROUPS,
  PART_TAG_GROUPS,
  GENERAL_TAG_GROUPS,
  matchesBranchTags,
  FILTER_TAG_GROUPS,
} from '../utils/tagCatalog';
import { getVirtualFocusTags } from '../utils/focusRegion';
import { weightedPracticeShuffle } from '../utils/practiceSampling';
import { playTickSound, playFinishSound } from '../utils/sound';
import { shortcutFromKeyboardEvent, type PracticeShortcutAction } from '../utils/shortcuts';

const formatCountdown = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
};
import { listen } from '@tauri-apps/api/event';
import {
  isTauriEnvironment,
  setAlwaysOnTop,
  setPracticeLocked,
  startPracticeLockMonitor,
  stopPracticeLockMonitor,
  togglePracticeLocked,
} from '../utils/tauriWindow';

export const PracticeWindow: React.FC<{
  config: any;
  onExit: () => void;
}> = ({ config, onExit }) => {
  const { settings, images, addHistory } = useAppContext();
  
  // Click-through / Pass-through state
  const [isClickThrough, setIsClickThrough] = useState(settings.defaultClickThrough);
  const isClickThroughRef = useRef(settings.defaultClickThrough);
  
  // Apply initial click-through state and always-on-top for practice mode
  useEffect(() => {
    let disposed = false;
    let unlistenLock: (() => void) | undefined;

    const syncLockState = (locked: boolean) => {
      isClickThroughRef.current = locked;
      setIsClickThrough(locked);
    };

    setAlwaysOnTop(true);
    if (isTauriEnvironment()) {
      listen<boolean>('practice-lock-changed', event => syncLockState(event.payload))
        .then(unlisten => {
          if (disposed) unlisten();
          else unlistenLock = unlisten;
        })
        .catch(console.warn);
      startPracticeLockMonitor(settings.defaultClickThrough)
        .then(syncLockState)
        .catch(console.warn);
    }

    return () => {
      disposed = true;
      unlistenLock?.();
      stopPracticeLockMonitor().catch(console.warn);
      // Keep always-on-top as requested by user
    };
  }, []);
  
  type PlaylistItem = { image: ImageRecord; durationSec: number; stageIdx?: number; focusRegion?: FocusRegion };
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isBuildingPlaylist, setIsBuildingPlaylist] = useState(true);
  const [playlistBuildError, setPlaylistBuildError] = useState<string | null>(null);
  
  const [timeLeft, setTimeLeft] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [isPreparing, setIsPreparing] = useState(true);
  const [prepTimeLeft, setPrepTimeLeft] = useState(config.preparationSec);
  const [uiVisible, setUiVisible] = useState(true);
  const [canvasView, setCanvasView] = useState({ x: 0, y: 0, scale: 1 });
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const canvasViewRef = useRef(canvasView);
  const canvasDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [originalReviewState, setOriginalReviewState] = useState<{ items: { image: any; focusRegion?: any }[]; totalElapsedSec: number } | null>(null);
  
  // Real time tracking
  const sessionStartTimeRef = useRef(0);
  const totalPausedTimeRef = useRef(0);
  const lastPauseTimeRef = useRef(0);
  const shortcutActionRef = useRef<(action: PracticeShortcutAction) => void>(() => undefined);
  const [reviewState, setReviewState] = useState<{ items: { image: ImageRecord; focusRegion?: FocusRegion }[], totalElapsedSec: number } | null>(null);

  const updateCanvasView = (next: { x: number; y: number; scale: number }) => {
    canvasViewRef.current = next;
    setCanvasView(next);
  };

  const resetCanvasView = () => updateCanvasView({ x: 0, y: 0, scale: 1 });

  useEffect(() => {
    canvasDragRef.current = null;
    setIsDraggingCanvas(false);
    resetCanvasView();
  }, [currentIndex]);

  const handleCanvasWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const current = canvasViewRef.current;
    const nextScale = Math.min(8, Math.max(0.2, current.scale * Math.exp(-event.deltaY * 0.0015)));
    if (nextScale === current.scale) return;
    const ratio = nextScale / current.scale;
    updateCanvasView({
      scale: nextScale,
      x: pointerX - (pointerX - current.x) * ratio,
      y: pointerY - (pointerY - current.y) * ratio,
    });
  };

  const handleCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const current = canvasViewRef.current;
    canvasDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDraggingCanvas(true);
    event.preventDefault();
  };

  const handleCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = canvasDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateCanvasView({
      ...canvasViewRef.current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  };

  const finishCanvasDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = canvasDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    canvasDragRef.current = null;
    setIsDraggingCanvas(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // Initialize playlist
  useEffect(() => {
    let cancelled = false;

    const buildUnionPool = (includeTags: string[], excludeTags: string[]) => {
      const selectedContentModes = (includeTags || []).filter(t => CONTENT_TAGS.includes(t as any));
      const isFigureMode = selectedContentModes.length === 0 || selectedContentModes.includes('完整人物');
      const isPartMode = selectedContentModes.length === 0 || selectedContentModes.includes('人体局部');
      const isGeneralMode = selectedContentModes.length === 0 || selectedContentModes.includes('综合参考');

      const figureItems: PlaylistItem[] = [];
      const partItems: PlaylistItem[] = [];
      const generalItems: PlaylistItem[] = [];

      for (const image of images) {
        if (image.hidden) continue;

        // 1. Full Figure
        if (isFigureMode && (image.tags.includes('完整人物') || image.contentRouting?.scope === 'human_dominant')) {
          if (matchesBranchTags(image.tags, includeTags, excludeTags, FIGURE_TAG_GROUPS)) {
            figureItems.push({ image, durationSec: 0 });
          }
        }

        // 2. Body Part
        if (isPartMode) {
          if (image.tags.includes('人体局部')) {
            if (matchesBranchTags(image.tags, includeTags, excludeTags, PART_TAG_GROUPS)) {
              partItems.push({ image, durationSec: 0 });
            }
          } else if (
            image.poseAnalysis?.status === 'detected'
            && image.poseAnalysis.modelVersion === POSE_MODEL_VERSION
            && image.poseAnalysis.regions.length > 0
          ) {
            for (const region of image.poseAnalysis.regions) {
              const virtualTags = getVirtualFocusTags(image.tags, region);
              if (matchesBranchTags(virtualTags, includeTags, excludeTags, PART_TAG_GROUPS)) {
                partItems.push({ image, durationSec: 0, focusRegion: region });
              }
            }
          }
        }

        // 3. General Reference
        if (isGeneralMode && (image.tags.includes('综合参考') || image.contentRouting?.scope === 'general_reference')) {
          if (matchesBranchTags(image.tags, includeTags, excludeTags, GENERAL_TAG_GROUPS)) {
            generalItems.push({ image, durationSec: 0 });
          }
        }
      }

      const combinedPool = [...figureItems, ...partItems, ...generalItems];
      return config.randomize ? weightedPracticeShuffle(combinedPool) : combinedPool;
    };

    const build = async () => {
      const newPlaylist: PlaylistItem[] = [];

      if (Array.isArray(config.practiceItems) && config.practiceItems.length > 0) {
        const imagesById = new Map<string, ImageRecord>(images.map(image => [image.id, image]));
        config.practiceItems.forEach((item: { imageId: string; focusRegionId?: string }) => {
          const image = imagesById.get(item.imageId);
          if (!image) return;
          const focusRegion = item.focusRegionId
            ? image.poseAnalysis?.regions.find(region => region.id === item.focusRegionId)
            : undefined;
          newPlaylist.push({ image, focusRegion, durationSec: config.singleTimeSec || 0 });
        });
      } else if (Array.isArray(config.imageIds) && config.imageIds.length > 0) {
        const imagesById = new Map(images.map(image => [image.id, image]));
        config.imageIds
          .map((id: string) => imagesById.get(id))
          .filter((image): image is ImageRecord => Boolean(image))
          .forEach(image => newPlaylist.push({ image, durationSec: config.singleTimeSec || 0 }));
      } else if (config.sessionType === 'progressive' && config.progressiveStages) {
        for (let idx = 0; idx < config.progressiveStages.length; idx += 1) {
          const stage = config.progressiveStages[idx];
          const stageInclude = [...(config.includeTags || []), ...(stage.includeTags || [])];
          const stageExclude = [...(config.excludeTags || []), ...(stage.excludeTags || [])];
          const stagePool = buildUnionPool(stageInclude, stageExclude);
          stagePool.slice(0, stage.count).forEach(item => {
            newPlaylist.push({ ...item, durationSec: stage.durationSec, stageIdx: idx });
          });
        }
      } else {
        const includeTags = config.includeTags || [];
        const excludeTags = config.excludeTags || [];
        const pool = buildUnionPool(includeTags, excludeTags);
        const limit = config.imageCount && config.imageCount < 999 ? config.imageCount : pool.length;
        pool.slice(0, limit).forEach(item => {
          newPlaylist.push({ ...item, durationSec: config.singleTimeSec || 0 });
        });
      }

      if (cancelled) return;
      setPlaylist(newPlaylist);
      if (newPlaylist.length > 0) setTimeLeft(newPlaylist[0].durationSec);
    };

    build()
      .catch(error => {
        if (!cancelled) setPlaylistBuildError(String(error));
      })
      .finally(() => {
        if (!cancelled) setIsBuildingPlaylist(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentItem = playlist[currentIndex];
  const currentDuration = currentItem?.durationSec || 0;

  // Timer logic
  useEffect(() => {
    let timer: any;
    if (isPreparing) {
      if (prepTimeLeft > 0) {
        if (settings.soundEnabled && prepTimeLeft <= 3) {
          playTickSound();
        }
        timer = setTimeout(() => setPrepTimeLeft(p => p - 1), 1000);
      } else {
        if (settings.soundEnabled) playTickSound();
        setIsPreparing(false);
        sessionStartTimeRef.current = Date.now();
      }
    } else if (!isPaused && playlist.length > 0 && currentDuration > 0) {
      if (isFrozen) {
        // When frozen, timer doesn't decrement, but real time continues
      } else if (timeLeft > 0) {
        if (settings.soundEnabled && timeLeft <= 3) {
          playTickSound();
        }
        timer = setTimeout(() => setTimeLeft(t => t - 1), 1000);
      } else {
        setCurrentIndex(current => {
          if (current < playlist.length - 1) {
            if (settings.soundEnabled) playTickSound();
            setTimeLeft(playlist[current + 1].durationSec);
            return current + 1;
          } else {
            if (settings.soundEnabled) playFinishSound();
            finishSession(playlist.length);
            return current;
          }
        });
      }
    }
    return () => clearTimeout(timer);
  }, [isPreparing, prepTimeLeft, isPaused, isFrozen, timeLeft, playlist.length, currentDuration, settings.soundEnabled]);

  // Pause time tracking
  useEffect(() => {
    if (isPreparing || reviewState) return;
    if (isPaused) {
      lastPauseTimeRef.current = Date.now();
    } else {
      if (lastPauseTimeRef.current > 0) {
        totalPausedTimeRef.current += Date.now() - lastPauseTimeRef.current;
        lastPauseTimeRef.current = 0;
      }
    }
  }, [isPaused, isPreparing, reviewState]);

  shortcutActionRef.current = (action: PracticeShortcutAction) => {
      if (action === 'togglePause') setIsPaused(paused => !paused);
      if (action === 'nextImage') { setIsFrozen(false); handleNext(); }
      if (action === 'previousImage') { setIsFrozen(false); handlePrev(); }
      if (action === 'toggleClickThrough') {
        if (isTauriEnvironment()) togglePracticeLocked().catch(console.warn);
        else setIsClickThrough(locked => !locked);
      }
      if (action === 'toggleControls') setUiVisible(visible => !visible);
      if (action === 'resetTimer') setTimeLeft(currentDuration);
      if (action === 'exitPractice') {
        if (isClickThroughRef.current) setPracticeLocked(false).catch(console.warn);
        else finishSession(currentIndex);
      }
  };

  // Keyboard shortcuts and Global Shortcuts
  useEffect(() => {
    let disposed = false;
    const registeredShortcuts = new Set<string>();
    const runShortcut = (action: PracticeShortcutAction) => shortcutActionRef.current(action);
    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcut = shortcutFromKeyboardEvent(e);
      if (!shortcut) return;
      const action = (Object.entries(settings.shortcuts) as [PracticeShortcutAction, string][]).find(([, value]) => value === shortcut)?.[0];
      if (!action || registeredShortcuts.has(shortcut)) return;
      e.preventDefault();
      runShortcut(action);
    };
    window.addEventListener('keydown', handleKeyDown);

    if (isTauriEnvironment()) {
      import('@tauri-apps/plugin-global-shortcut').then(async ({ register, unregister, unregisterAll }) => {
        await unregisterAll();
        for (const [action, shortcut] of Object.entries(settings.shortcuts) as [PracticeShortcutAction, string][]) {
          if (disposed) break;
          try {
            await register(shortcut, event => {
              if (event.state === 'Pressed') runShortcut(action);
            });
            if (disposed) {
              await unregister(shortcut);
              break;
            }
            registeredShortcuts.add(shortcut);
          } catch (error) {
            console.warn(`快捷键 ${shortcut} 注册失败:`, error);
          }
        }
      }).catch(console.warn);
    }

    return () => {
      disposed = true;
      window.removeEventListener('keydown', handleKeyDown);
      if (isTauriEnvironment()) {
        import('@tauri-apps/plugin-global-shortcut').then(({ unregisterAll }) => unregisterAll().catch(console.warn)).catch(console.warn);
      }
    };
  }, [settings.shortcuts]);

  // Auto-hide UI on mouse idle or touch
  useEffect(() => {
    let timeout: any;
    const handleActivity = () => {
      setUiVisible(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setUiVisible(false), 1500);
    };
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      clearTimeout(timeout);
    };
  }, []);

  const [isFlipped, setIsFlipped] = useState(settings.defaultFlip);
  const [isGrayscale, setIsGrayscale] = useState(settings.defaultGrayscale);
  const [isGridEnabled, setIsGridEnabled] = useState(settings.defaultGrid);

  useEffect(() => {
    setIsFlipped(settings.defaultFlip);
    setIsGrayscale(settings.defaultGrayscale);
    setIsGridEnabled(settings.defaultGrid);
  }, [currentIndex, settings]);

  // In-component context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const MENU_W = 140;
  const MENU_H = 148;

  useEffect(() => {
    const handleContextMenuEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const x = detail.x + MENU_W > vw ? vw - MENU_W - 6 : detail.x;
        const y = detail.y + MENU_H > vh ? vh - MENU_H - 6 : detail.y;
        setCtxMenu({ x: Math.max(6, x), y: Math.max(6, y) });
      }
    };
    window.addEventListener('app-context-menu', handleContextMenuEvent);

    const handleDismiss = () => setCtxMenu(null);
    window.addEventListener('click', handleDismiss);

    return () => {
      window.removeEventListener('app-context-menu', handleContextMenuEvent);
      window.removeEventListener('click', handleDismiss);
    };
  }, []);

  const handleNext = () => {
    if (currentIndex < playlist.length - 1) {
      setCurrentIndex(i => i + 1);
      setTimeLeft(playlist[currentIndex + 1].durationSec);
    } else {
      finishSession();
    }
    setIsFrozen(false);
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1);
      setTimeLeft(playlist[currentIndex - 1].durationSec);
    }
    setIsFrozen(false);
  };

  const finishSession = (finalLength?: number) => {
    if (originalReviewState) {
      setReviewState(originalReviewState);
      setOriginalReviewState(null);
      return;
    }

    const len = finalLength !== undefined ? finalLength : playlist.length;
    if (len === 0) {
      onExit();
      return;
    }
    
    // Add pending pause time
    if (isPaused && lastPauseTimeRef.current > 0) {
      totalPausedTimeRef.current += Date.now() - lastPauseTimeRef.current;
      lastPauseTimeRef.current = 0;
    }
    
    const realElapsedSec = Math.floor((Date.now() - sessionStartTimeRef.current - totalPausedTimeRef.current) / 1000);
    
    const imagesToSave = [];
    const itemsToSave = [];
    for (let i = 0; i < len; i++) {
      imagesToSave.push(playlist[i].image);
      itemsToSave.push({ image: playlist[i].image, focusRegion: playlist[i].focusRegion });
    }
    
    addHistory({
      id: Date.now().toString(),
      date: Date.now(),
      durationSec: Math.max(0, realElapsedSec),
      imageCount: len,
      images: imagesToSave,
      items: itemsToSave,
    });
    
    // Show review screen
    setReviewState({ items: itemsToSave, totalElapsedSec: Math.max(0, realElapsedSec) });
  };

  if (isBuildingPlaylist) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center text-white bg-zinc-900 sm:rounded-3xl">
        <div className="w-7 h-7 mb-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
        <p className="text-sm font-medium">正在准备练习…</p>
      </div>
    );
  }

  if (playlist.length === 0) {
    return (
      <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center text-white sm:rounded-3xl ${isClickThrough ? 'bg-transparent' : 'bg-zinc-900'}`}>
        <p className="text-lg font-medium mb-2">没有找到符合条件的图片</p>
        {playlistBuildError && <p className="max-w-72 mb-6 text-center text-xs text-red-300/80">{playlistBuildError}</p>}
        {!playlistBuildError && <p className="max-w-72 mb-6 text-center text-xs text-white/45">请先在图库中完成“定位局部”，或导入带有人体局部标签的图片</p>}
        <button onClick={onExit} className="px-6 py-3 bg-white text-black rounded-2xl font-bold">返回</button>
      </div>
    );
  }

  const progress = currentDuration > 0 ? timeLeft / currentDuration : 1;
  const isCanvasModified = canvasView.scale !== 1 || Math.abs(canvasView.x) > 1 || Math.abs(canvasView.y) > 1;

  return (
    <div className="absolute inset-0 z-50 text-white overflow-hidden flex items-center justify-center select-none rounded-2xl border border-white/5 bg-transparent">
      
      {/* Unified Practice Canvas Layer (Dark Background + Reference Image + Grid + Film Grain) */}
      <div 
        className="absolute inset-0 pointer-events-none transition-opacity duration-300"
        style={{ opacity: settings.canvasOpacity / 100 }}
      >
        {/* Canvas Dark Backdrop */}
        {!isClickThrough && (
          <div className="absolute inset-0 bg-[#09090b]" />
        )}

        {/* Film Grain Noise Overlay */}
        <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] mix-blend-overlay" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
        }} />

        {/* PureRef-style canvas viewport */}
        <div
          className="absolute inset-0 will-change-transform"
          style={{
            transform: `translate3d(${canvasView.x}px, ${canvasView.y}px, 0) scale(${canvasView.scale})`,
            transformOrigin: '0 0',
          }}
        >
          <AnimatePresence mode="wait">
            <FocusedPracticeImage
              key={`${currentItem.image.id}:${currentItem.focusRegion?.id || 'full'}`}
              image={currentItem.image}
              region={currentItem.focusRegion}
              flipped={isFlipped}
              grayscale={isGrayscale}
              animateFlip={settings.flipAnimation}
            />
          </AnimatePresence>

          {isGridEnabled && (
            <div 
              className="absolute inset-0 pointer-events-none mix-blend-difference" 
              style={{
                opacity: settings.gridOpacity / 100,
                backgroundImage: `linear-gradient(to right, ${settings.gridColor} ${settings.gridLineWidth}px, transparent ${settings.gridLineWidth}px), linear-gradient(to bottom, ${settings.gridColor} ${settings.gridLineWidth}px, transparent ${settings.gridLineWidth}px)`,
                backgroundSize: `${100 / settings.gridDensity}% ${100 / settings.gridDensity}%`,
                backgroundPosition: 'center center',
              }}
            />
          )}
        </div>
      </div>

      {/* Interactive Surface for Canvas Drag / Wheel / Double Click */}
      <div
        className="absolute inset-0 touch-none cursor-default"
        onWheel={handleCanvasWheel}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={finishCanvasDrag}
        onPointerCancel={finishCanvasDrag}
        onDoubleClick={resetCanvasView}
      />



      {/* Preparation Overlay */}
      <AnimatePresence>
        {isPreparing && (
          <motion.div 
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-2xl flex flex-col items-center justify-center"
          >
            <h2 className="text-xl font-bold text-white/50 mb-4 tracking-widest uppercase">准备</h2>
            <motion.div
              key={prepTimeLeft}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
              className="text-8xl font-bold tracking-tighter"
            >
              {prepTimeLeft}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {!isPreparing && currentDuration > 0 && (
        <div className="absolute top-6 right-6 pointer-events-none text-white bg-black/10 backdrop-blur-md rounded-full p-1.5">
          <CircularTimer progress={progress} size={settings.timerSize} strokeWidth={3} text={formatCountdown(timeLeft)} />
        </div>
      )}

      {/* Controls UI */}
      <AnimatePresence>
        {uiVisible && !isPreparing && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 pointer-events-none"
          >
            {/* Top Bar */}
            <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start pointer-events-auto">
              <div className="flex items-center gap-3">
                <button onClick={() => finishSession(currentIndex)} className="w-8 h-8 rounded-xl bg-black/10 border border-white/10 flex items-center justify-center hover:bg-black/20 transition-colors text-white">
                  <X size={16} />
                </button>
                <div className="flex flex-col gap-1">
                  <div className="bg-black/10 border border-white/10 px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-widest text-white/90">
                    {currentIndex + 1} / {playlist.length}
                  </div>
                  {currentItem.stageIdx !== undefined && (
                    <div className="px-1.5 py-0.5 rounded-md bg-white/10 text-[9px] font-bold tracking-widest text-white/70 self-start border border-white/5">
                      阶段 {currentItem.stageIdx + 1}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Bar */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 h-11 flex items-center gap-1.5 px-2.5 rounded-xl border border-white/10 bg-black/10 text-white pointer-events-auto select-none">
              {/* Left: Timer Controls */}
              <div className="flex items-center gap-0.5">
                {currentDuration > 0 && (
                  <motion.button
                    onClick={() => setTimeLeft(currentDuration)}
                    className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    title={`重置本张倒计时 (${formatCountdown(currentDuration)}) · Ctrl+R`}
                    aria-label="重置倒计时"
                  >
                    <TimerReset size={15} />
                  </motion.button>
                )}
                <motion.button
                  onClick={() => setIsFrozen(!isFrozen)}
                  className={`p-1.5 rounded-lg transition-colors flex items-center justify-center ${
                    isFrozen ? 'text-cyan-400 bg-cyan-400/20 hover:text-cyan-300' : 'text-white/60 hover:text-white hover:bg-white/10'
                  }`}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  title={isFrozen ? '解冻倒计时' : '冻结倒计时'}
                  aria-label={isFrozen ? '解冻倒计时' : '冻结倒计时'}
                >
                  <Snowflake size={15} />
                </motion.button>
              </div>

              {/* Separator */}
              <div className="h-4 w-px bg-white/10 mx-0.5" />

              {/* Center: Playback Controls */}
              <div className="flex items-center gap-1">
                <motion.button
                  onClick={handlePrev}
                  className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  title="上一张 (Ctrl+←)"
                  aria-label="上一张"
                >
                  <ChevronLeft size={16} />
                </motion.button>
                <motion.button
                  onClick={() => setIsPaused(!isPaused)}
                  className="flex h-7.5 w-7.5 items-center justify-center rounded-xl bg-white text-black shadow-md hover:bg-zinc-100 transition-colors mx-0.5"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  title={isPaused ? '恢复练习 (Space)' : '暂停练习 (Space)'}
                  aria-label={isPaused ? '恢复练习' : '暂停练习'}
                >
                  {isPaused ? <Play size={13} fill="currentColor" className="ml-0.5" /> : <Pause size={13} fill="currentColor" />}
                </motion.button>
                <motion.button
                  onClick={handleNext}
                  className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  title="下一张 (Ctrl+→)"
                  aria-label="下一张"
                >
                  <ChevronRight size={16} />
                </motion.button>
              </div>

              {/* Separator */}
              <div className="h-4 w-px bg-white/10 mx-0.5" />

              {/* Right: Canvas / Photo View Reset */}
              <div className="flex items-center">
                <motion.button
                  onClick={resetCanvasView}
                  className={`flex items-center gap-1 px-1.5 py-1 rounded-lg transition-colors ${
                    isCanvasModified
                      ? 'text-amber-300 bg-amber-400/15 hover:bg-amber-400/25'
                      : 'text-white/60 hover:text-white hover:bg-white/10'
                  }`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  title={
                    isCanvasModified
                      ? `复位画面视角 (${Math.round(canvasView.scale * 100)}% · 点击居中) · 双击画布也可复位`
                      : '复位画面视角 (已居中 100%)'
                  }
                  aria-label="复位画面视角"
                >
                  <Focus size={15} />
                  {isCanvasModified && (
                    <span className="text-[10px] font-mono font-medium tracking-tight leading-none text-amber-300/90">
                      {Math.round(canvasView.scale * 100)}%
                    </span>
                  )}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rust owns the native hit area; this WebView element only renders state. */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 z-[998] flex items-center justify-center"
      >
        <motion.button
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          onClick={() => {
            if (!isTauriEnvironment()) {
              setIsClickThrough(current => !current);
            }
          }}
          aria-label={isClickThrough ? '解除锁定' : '锁定练习窗口'}
          className={`pointer-events-auto w-10 h-8 rounded-b-xl flex items-center justify-center transition-colors border border-t-0 ${
            isClickThrough
              ? 'bg-white/90 text-black border-white/20'
              : 'bg-black/20 backdrop-blur-3xl text-white/70 border-white/10 hover:bg-black/40 hover:text-white'
          }`}
        >
          {isClickThrough ? <Lock size={13} /> : <Unlock size={13} />}
        </motion.button>
      </div>

      {/* In-component Context Menu */}
      {ctxMenu && (
        <div
          className="absolute z-[999] bg-zinc-900/95 backdrop-blur-2xl border border-zinc-700/50 rounded-xl p-1.5 shadow-2xl font-sans select-none flex flex-col gap-0.5 min-w-[120px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {[
            { label: '复位视角', active: false, action: resetCanvasView },
            { label: '九宫格', active: isGridEnabled, action: () => setIsGridEnabled(g => !g) },
            { label: '水平翻转', active: isFlipped, action: () => setIsFlipped(f => !f) },
            { label: '黑白滤镜', active: isGrayscale, action: () => setIsGrayscale(g => !g) },
          ].map(item => (
            <button
              key={item.label}
              onClick={() => { item.action(); setCtxMenu(null); }}
              className="w-full flex items-center justify-between px-3 py-2 text-[13px] text-zinc-300 hover:text-white hover:bg-white/10 transition-colors rounded-lg cursor-default"
            >
              <span className={item.active ? 'font-bold text-white' : ''}>{item.label}</span>
              {item.active && <Check size={12} className="text-white opacity-70" />}
            </button>
          ))}
        </div>
      )}

      {/* Review Screen */}
      <AnimatePresence>
        {reviewState && (
          <PracticeReview 
            items={reviewState.items}
            totalElapsedSec={reviewState.totalElapsedSec}
            onExit={onExit}
            onContinueDrawing={(image, region) => {
              setOriginalReviewState(reviewState);
              resetCanvasView();
              setPlaylist([{ image, durationSec: 1, focusRegion: region }]);
              setCurrentIndex(0);
              setTimeLeft(1);
              setIsFrozen(true); // Default to frozen so they have infinite time
              setReviewState(null);
              sessionStartTimeRef.current = Date.now();
              totalPausedTimeRef.current = 0;
              lastPauseTimeRef.current = 0;
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
