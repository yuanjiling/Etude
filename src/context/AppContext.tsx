import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { ImageRecord, PracticeSet, HistoryRecord, PracticeConfig, AppSettings, CustomTagGroup } from '../types';
import { INITIAL_SETS } from '../data';
import { analyzeContent, visualAnalysisTags } from '../services/contentAnalysis';
import { mapModelTags } from '../utils/modelTags';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriEnvironment } from '../utils/tauriWindow';
import { StartupSplash } from '../components/StartupSplash';
import { setThumbnailSchedulerPaused } from '../services/thumbnailScheduler';

export type LibraryTaskState = {
  running: boolean;
  current: number;
  total: number;
  message?: string;
  error?: string;
};

interface AppState {
  images: ImageRecord[];
  sets: PracticeSet[];
  history: HistoryRecord[];
  darkMode: boolean;
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  toggleDarkMode: () => void;
  updateImageTags: (id: string, tags: string[]) => void;
  updateImageThumbnail: (id: string, thumbnailUrl?: string) => void;
  toggleImageFavorite: (id: string) => void;
  toggleImageHidden: (id: string) => void;
  addImages: (newImgs: ImageRecord[]) => void;
  upsertImages: (newImgs: ImageRecord[]) => void;
  syncLibraryImages: (libraryImages: ImageRecord[]) => void;
  removeImage: (id: string) => void;
  saveSet: (set: PracticeSet) => void;
  deleteSet: (id: string) => void;
  addHistory: (record: HistoryRecord) => void;
  clearHistory: () => void;
  taggingTask: LibraryTaskState;
  localizationTask: LibraryTaskState;
  startImageTagging: (targets: ImageRecord[]) => Promise<void>;
  startImageLocalization: (targets: ImageRecord[]) => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

import { DEFAULT_PRACTICE_SHORTCUTS } from '../utils/shortcuts';

const DEFAULT_SETTINGS: AppSettings = {
  settingsVersion: 5,
  theme: 'system',
  preparationSec: 3,
  transitionSec: 0,
  soundEnabled: true,
  defaultGrid: false,
  defaultFlip: false,
  defaultGrayscale: false,
  defaultClickThrough: false,
  bgOpacity: 100,
  canvasOpacity: 100,
  timerSize: 60,
  gridColor: 'white',
  gridDensity: 3,
  gridLineWidth: 1,
  gridOpacity: 25,
  flipAnimation: true,
  libraryThumbnailWidth: 174,
  startAlwaysOnTop: false,
  rememberWindowBounds: true,
  windowBounds: undefined,
  shortcuts: DEFAULT_PRACTICE_SHORTCUTS,
  customTagGroups: [],
  customTags: [],
};

const loadSettings = (stored: unknown): AppSettings => {
  const source = stored && typeof stored === 'object' ? stored as Record<string, unknown> : {};
  const loaded = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [key, source[key] ?? fallback]),
  ) as unknown as AppSettings;
  loaded.shortcuts = { ...DEFAULT_SETTINGS.shortcuts, ...(source.shortcuts as Partial<AppSettings['shortcuts']> | undefined) };

  let customTagGroups: CustomTagGroup[] = [];
  if (Array.isArray(source.customTagGroups)) {
    customTagGroups = source.customTagGroups
      .filter((g): g is Record<string, unknown> => typeof g === 'object' && g !== null && typeof g.name === 'string' && Boolean(g.name.trim()))
      .map(g => ({
        id: typeof g.id === 'string' && g.id ? g.id : `group_${Math.random().toString(36).substring(2, 9)}`,
        name: (g.name as string).trim(),
        tags: Array.isArray(g.tags) ? (g.tags as unknown[]).filter((t): t is string => typeof t === 'string' && Boolean(t.trim())).map(t => t.trim()) : [],
      }));
  } else if (Array.isArray(source.customTags) && source.customTags.length > 0) {
    const oldTags = (source.customTags as unknown[]).filter((t): t is string => typeof t === 'string' && Boolean(t.trim())).map(t => t.trim());
    if (oldTags.length > 0) {
      customTagGroups = [{ id: 'custom_default', name: '自定义', tags: oldTags }];
    }
  }

  loaded.customTagGroups = customTagGroups;
  loaded.customTags = Array.from(new Set(customTagGroups.flatMap(g => g.tags)));

  if (!source.settingsVersion) {
    loaded.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
    loaded.timerSize = 60;
  }
  return loaded;
};

const imageRecordsEqual = (left: ImageRecord, right: ImageRecord) => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)] as (keyof ImageRecord)[]);
  return Array.from(keys).every(key => left[key] === right[key]);
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [sets, setSets] = useState<PracticeSet[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [taggingTask, setTaggingTask] = useState<LibraryTaskState>({ running: false, current: 0, total: 0 });
  const [localizationTask, setLocalizationTask] = useState<LibraryTaskState>({ running: false, current: 0, total: 0 });
  const taggingRunningRef = useRef(false);
  const localizationRunningRef = useRef(false);
  const lastUiInteractionRef = useRef(0);
  const persistenceEnabledRef = useRef(false);
  const latestStateRef = useRef({ images, sets, history, settings });
  latestStateRef.current = { images, sets, history, settings };
  const saveTimeoutRef = useRef<number | null>(null);
  const lastSaveTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    const markInteraction = () => { lastUiInteractionRef.current = performance.now(); };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'wheel', 'keydown'];
    events.forEach(event => window.addEventListener(event, markInteraction, { passive: true }));
    return () => events.forEach(event => window.removeEventListener(event, markInteraction));
  }, []);

  const flushSave = async () => {
    if (!persistenceEnabledRef.current) return;
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    lastSaveTimeRef.current = Date.now();
    const latest = latestStateRef.current;
    try {
      await invoke('write_app_state', {
        data: JSON.stringify({ images: latest.images, sets: latest.sets, history: latest.history }),
      });
    } catch (err) {
      console.warn('Failed to save app state to SQLite:', err);
    }
  };

  // Load Data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [json, settingsJson] = await Promise.all([
          invoke<string>('read_app_state'),
          invoke<string>('read_settings'),
        ]);
        if (json && json !== '{}') {
          const data = JSON.parse(json);
          if (data.images) setImages(data.images);
          else setImages([]);

          if (data.sets && Array.isArray(data.sets)) {
            const hasOldDefault = data.sets.some((s: any) => (s.id === 's1' && s.name === '动态热身') || (s.id === 's2' && s.name === '头像速写'));
            if (hasOldDefault) {
              setSets(INITIAL_SETS);
            } else {
              setSets(data.sets);
            }
          } else {
            setSets(INITIAL_SETS);
          }

          if (data.history) setHistory(data.history);
        } else {
          setImages([]);
          setSets(INITIAL_SETS);
        }
        setSettings(loadSettings(settingsJson && settingsJson !== '{}' ? JSON.parse(settingsJson) : undefined));
      } catch (err) {
        console.warn('Failed to load data from Tauri:', err);
        setImages([]);
        setSets(INITIAL_SETS);
      } finally {
        persistenceEnabledRef.current = true;
        setIsLoaded(true);
      }
    };
    loadData();
  }, []);

  // Save database-backed application data with Debounce + MaxWait (2.5s) throttle.
  useEffect(() => {
    if (!isLoaded || !persistenceEnabledRef.current) return;
    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimeRef.current;

    if (timeSinceLastSave >= 2500) {
      void flushSave();
      return;
    }

    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      void flushSave();
    }, 500);

    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [images, sets, history, isLoaded]);

  // Settings are intentionally independent from the library database.
  useEffect(() => {
    if (!isLoaded || !persistenceEnabledRef.current) return;
    const saveTimer = window.setTimeout(async () => {
      try {
        await invoke('write_settings', { data: JSON.stringify(settings) });
      } catch (err) {
        console.warn('Failed to save settings:', err);
      }
    }, 500);
    return () => window.clearTimeout(saveTimer);
  }, [settings, isLoaded]);

  // Flush the latest snapshot before the desktop window is destroyed.
  useEffect(() => {
    if (!isLoaded || !persistenceEnabledRef.current || !isTauriEnvironment()) return;
    const appWindow = getCurrentWindow();
    let isClosing = false;
    const unlisten = appWindow.onCloseRequested(async event => {
      if (isClosing) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      isClosing = true;
      const latest = latestStateRef.current;
      try {
        await Promise.race([
          Promise.all([
            invoke('write_app_state', { data: JSON.stringify({ images: latest.images, sets: latest.sets, history: latest.history }) }),
            invoke('write_settings', { data: JSON.stringify(latest.settings) }),
          ]),
          new Promise(resolve => setTimeout(resolve, 1000)),
        ]);
      } catch (error) {
        console.warn('Failed to flush application data before closing:', error);
      } finally {
        try {
          await invoke('exit_app');
        } catch {
          await appWindow.destroy();
        }
      }
    });
    return () => { void unlisten.then(dispose => dispose()); };
  }, [isLoaded]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const nextDarkMode = settings.theme === 'dark' || (settings.theme === 'system' && media.matches);
      setDarkMode(nextDarkMode);
      document.documentElement.classList.toggle('dark', nextDarkMode);
    };
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [settings.theme]);

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...newSettings };
      if (newSettings.customTagGroups && !newSettings.customTags) {
        next.customTags = Array.from(new Set(newSettings.customTagGroups.flatMap(g => g.tags)));
      }
      return next;
    });
  };

  const toggleDarkMode = () => updateSettings({ theme: darkMode ? 'light' : 'dark' });

  const updateImageTags = (id: string, tags: string[]) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, tags } : img));
  };

  const updateImageThumbnail = (id: string, thumbnailUrl?: string) => {
    setImages(prev => prev.map(img => (
      img.id === id && img.thumbnailUrl !== thumbnailUrl ? { ...img, thumbnailUrl } : img
    )));
  };

  const toggleImageFavorite = (id: string) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, favorite: !img.favorite } : img));
  };

  const toggleImageHidden = (id: string) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, hidden: !img.hidden } : img));
  };

  const addImages = (newImgs: ImageRecord[]) => {
    setImages(prev => [...newImgs, ...prev]);
  };

  const upsertImages = (newImgs: ImageRecord[]) => {
    setImages(prev => {
      const incoming = new Map(newImgs.map(image => [image.sourcePath || image.id, image]));
      const merged = prev.map(image => {
        const key = image.sourcePath || image.id;
        const next = incoming.get(key);
        if (!next) return image;
        incoming.delete(key);
        return { ...image, ...next };
      });
      return [...incoming.values(), ...merged];
    });
  };

  type AnalysisUpdateItem = {
    target: ImageRecord;
    patch: Partial<ImageRecord>;
    expectedScope?: string;
  };

  const updateImagesAnalysisBatch = (updates: AnalysisUpdateItem[]) => {
    if (updates.length === 0) return;
    const patchByPath = new Map<string, { patch: Partial<ImageRecord>; expectedScope?: string }>();
    const patchById = new Map<string, { patch: Partial<ImageRecord>; expectedScope?: string }>();
    for (const update of updates) {
      const scope = update.expectedScope ?? update.target.contentRouting?.scope;
      if (update.target.sourcePath) patchByPath.set(update.target.sourcePath, { patch: update.patch, expectedScope: scope });
      if (update.target.id) patchById.set(update.target.id, { patch: update.patch, expectedScope: scope });
    }
    setImages(current => current.map(image => {
      const match = (image.sourcePath && patchByPath.get(image.sourcePath)) || patchById.get(image.id);
      if (!match) return image;
      if (match.expectedScope && image.contentRouting?.scope && image.contentRouting.scope !== match.expectedScope) {
        return image;
      }
      return { ...image, ...match.patch };
    }));
  };

  const updateImageAnalysis = (
    target: ImageRecord,
    patch: Partial<ImageRecord>,
    expectedScope = target.contentRouting?.scope,
  ) => {
    updateImagesAnalysisBatch([{ target, patch, expectedScope }]);
  };

  const startImageTagging = async (targets: ImageRecord[]) => {
    const queue = targets.filter((image): image is ImageRecord & { sourcePath: string } => (
      Boolean(image.sourcePath) && image.contentRouting?.scope !== 'general_reference'
    ));
    if (taggingRunningRef.current || queue.length === 0) return;
    taggingRunningRef.current = true;
    setTaggingTask({ running: true, current: 0, total: queue.length });
    const applied = new Set<number>();
    const bufferedUpdates: AnalysisUpdateItem[] = [];
    let lastFlushTime = Date.now();
    let lastTaskTime = 0;

    const flushBatch = () => {
      if (bufferedUpdates.length === 0) return;
      const batch = bufferedUpdates.splice(0, bufferedUpdates.length);
      updateImagesAnalysisBatch(batch);
      lastFlushTime = Date.now();
    };

    try {
      const progress = new Channel<Record<string, unknown>>();
      progress.onmessage = message => {
        const current = Number(message.current) || 0;
        const now = Date.now();
        if (now - lastTaskTime >= 120 || current === queue.length) {
          lastTaskTime = now;
          setTaggingTask({ running: true, current, total: queue.length });
        }
        if (current < 1 || current > queue.length || !message.result) return;
        const index = current - 1;
        applied.add(index);
        bufferedUpdates.push({
          target: queue[index],
          patch: {
            tags: mapModelTags(message.result),
            tagStatus: 'tagged',
            tagError: undefined,
          },
          expectedScope: 'human_dominant',
        });
        if (bufferedUpdates.length >= 5 || now - lastFlushTime >= 200) {
          flushBatch();
        }
      };
      const results = await invoke<unknown[]>('auto_tag_images', {
        imagePaths: queue.map(image => image.sourcePath),
        onProgress: progress,
      });
      results.forEach((result, index) => {
        if (applied.has(index) || !queue[index]) return;
        bufferedUpdates.push({
          target: queue[index],
          patch: {
            tags: mapModelTags(result),
            tagStatus: 'tagged',
            tagError: undefined,
          },
          expectedScope: 'human_dominant',
        });
      });
      flushBatch();
      void flushSave();
      setTaggingTask({
        running: false,
        current: results.length,
        total: queue.length,
        message: `已完成 ${results.length} 张图片的自动打标`,
      });
    } catch (error) {
      flushBatch();
      void flushSave();
      console.warn('Background tagging failed:', error);
      setTaggingTask(current => ({ ...current, running: false, error: String(error) }));
    } finally {
      taggingRunningRef.current = false;
    }
  };

  const startImageLocalization = async (targets: ImageRecord[]) => {
    const queue = targets.filter(image => Boolean(image.sourcePath));
    if (localizationRunningRef.current || queue.length === 0) return;
    localizationRunningRef.current = true;
    setThumbnailSchedulerPaused(true);
    setLocalizationTask({ running: true, current: 0, total: queue.length });
    let completed = 0;
    let failed = 0;
    let regionCount = 0;
    const bufferedUpdates: AnalysisUpdateItem[] = [];
    let lastFlushTime = Date.now();
    let lastTaskTime = 0;

    const flushBatch = () => {
      if (bufferedUpdates.length === 0) return;
      const batch = bufferedUpdates.splice(0, bufferedUpdates.length);
      updateImagesAnalysisBatch(batch);
      lastFlushTime = Date.now();
    };

    const waitForAnalysisSlot = () => new Promise<void>(resolve => {
      const waitUntilQuiet = () => {
        const quietFor = performance.now() - lastUiInteractionRef.current;
        if (quietFor < 120) {
          globalThis.setTimeout(waitUntilQuiet, Math.ceil(120 - quietFor));
          return;
        }
        const timeout = taggingRunningRef.current ? 500 : 240;
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(() => {
            if (performance.now() - lastUiInteractionRef.current < 120) waitUntilQuiet();
            else resolve();
          }, { timeout });
        } else {
          globalThis.setTimeout(resolve, taggingRunningRef.current ? 100 : 32);
        }
      };
      waitUntilQuiet();
    });

    try {
      for (const image of queue) {
        await waitForAnalysisSlot();
        try {
          const analysis = await analyzeContent(image.url);
          const contentRouting = image.contentRouting?.manuallyCorrected
            ? {
              ...analysis.contentRouting,
              scope: image.contentRouting.scope,
              confidence: 1,
              manuallyCorrected: true,
            }
            : analysis.contentRouting;
          const isGeneralReference = contentRouting.scope === 'general_reference';
          const patch: Partial<ImageRecord> = { contentRouting, tagError: undefined };
          if (isGeneralReference) {
            patch.poseAnalysis = undefined;
            patch.visualAnalysis = analysis.visualAnalysis;
            patch.tags = visualAnalysisTags(analysis.visualAnalysis);
            patch.tagStatus = 'tagged';
          } else {
            patch.poseAnalysis = analysis.poseAnalysis;
            patch.visualAnalysis = undefined;
          }
          bufferedUpdates.push({ target: image, patch, expectedScope: contentRouting.scope });
          completed += 1;
          regionCount += analysis.poseAnalysis.regions.length;
        } catch (error) {
          failed += 1;
          console.warn(`Pose localization failed for ${image.fileName || image.id}:`, error);
        }

        const now = Date.now();
        if (bufferedUpdates.length >= 5 || now - lastFlushTime >= 200) {
          flushBatch();
        }
        if (now - lastTaskTime >= 120 || (completed + failed) === queue.length) {
          lastTaskTime = now;
          setLocalizationTask({ running: true, current: completed + failed, total: queue.length });
        }

        // Yield to the main browser thread to allow UI rendering and smooth user interaction
        await new Promise<void>(resolve => setTimeout(resolve, taggingRunningRef.current ? 48 : 12));
      }
      flushBatch();
      void flushSave();
      setLocalizationTask({
        running: false,
        current: queue.length,
        total: queue.length,
        message: `已分析 ${completed} 张图片，生成 ${regionCount} 个虚拟局部${failed > 0 ? `，${failed} 张失败` : ''}`,
      });
    } catch (error) {
      flushBatch();
      void flushSave();
      console.warn('Localization task failed:', error);
      setLocalizationTask(current => ({ ...current, running: false, error: String(error) }));
    } finally {
      localizationRunningRef.current = false;
      setThumbnailSchedulerPaused(false);
    }
  };

  const syncLibraryImages = (libraryImages: ImageRecord[]) => {
    setImages(prev => {
      const next = [
        ...libraryImages,
        ...prev.filter(image => !image.sourcePath),
      ];
      if (prev.length === next.length && prev.every((image, index) => imageRecordsEqual(image, next[index]))) {
        return prev;
      }
      return next;
    });
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(image => image.id !== id));
  };

  const saveSet = (set: PracticeSet) => {
    setSets(prev => {
      const idx = prev.findIndex(s => s.id === set.id);
      if (idx >= 0) {
        const newSets = [...prev];
        newSets[idx] = set;
        return newSets;
      }
      return [...prev, set];
    });
  };

  const deleteSet = (id: string) => {
    setSets(prev => prev.filter(s => s.id !== id));
  };

  const addHistory = (record: HistoryRecord) => {
    const practiceCounts = new Map<string, number>();
    record.images.forEach(image => {
      practiceCounts.set(image.id, (practiceCounts.get(image.id) || 0) + 1);
    });
    setImages(current => current.map(image => {
      const increment = practiceCounts.get(image.id) || 0;
      return increment > 0
        ? { ...image, practice_count: image.practice_count + increment, last_seen: record.date }
        : image;
    }));
    setHistory(prev => [record, ...prev]);
  };

  const clearHistory = () => {
    setHistory([]);
  };

  if (!isLoaded) {
    return <StartupSplash />;
  }

  return (
    <AppContext.Provider value={{
      images, sets, history, darkMode, toggleDarkMode,
      settings, updateSettings,
      updateImageTags, updateImageThumbnail, toggleImageFavorite, toggleImageHidden, addImages, upsertImages, syncLibraryImages, removeImage, saveSet, deleteSet, addHistory, clearHistory,
      taggingTask, localizationTask, startImageTagging, startImageLocalization,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
};
