import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { ImageRecord, PracticeSet, HistoryRecord, PracticeConfig, AppSettings, CustomTagGroup } from '../types';
import { INITIAL_SETS } from '../data';
import { analyzeContent, isAnalysisComplete, visualAnalysisTags } from '../services/contentAnalysis';
import { mapModelTags } from '../utils/modelTags';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriEnvironment } from '../utils/tauriWindow';
import { StartupSplash } from '../components/StartupSplash';
import { setThumbnailSchedulerPaused } from '../services/thumbnailScheduler';
import { inferenceProfile } from '../utils/inference';

export type LibraryTaskState = {
  running: boolean;
  current: number;
  total: number;
  message?: string;
  error?: string;
};

interface AppState {
  images: ImageRecord[];
  libraryRoot: string | null;
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
  syncLibraryImages: (scannedImages: ImageRecord[]) => void;
  updateLibraryRoot: (root: string | null) => void;
  removeTagsFromAllImages: (tags: string[]) => void;
  resetAllImageTags: () => void;
  resetAllImageLocalization: () => void;
  resetAllImageMetadata: () => void;
  removeImage: (id: string) => void;
  removeImages: (ids: string[]) => void;
  saveSet: (set: PracticeSet) => void;
  deleteSet: (id: string) => void;
  addHistory: (record: HistoryRecord) => void;
  clearHistory: () => void;
  taggingTask: LibraryTaskState;
  localizationTask: LibraryTaskState;
  startImageTagging: (targets: ImageRecord[]) => Promise<void>;
  startImageLocalization: (targets: ImageRecord[]) => Promise<void>;
  stopImageTagging: () => void;
  stopImageLocalization: () => void;
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
  shortcuts: DEFAULT_PRACTICE_SHORTCUTS,
  customTagGroups: [],
  customTags: [],
  practiceContentTypes: undefined,
  prioritizeUndrawnImages: true,
  inferencePerformance: 'balanced',
  gpuInferenceEnabled: true,
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

const normalizePathForCompare = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const isPathUnderRoot = (path: string, root: string) => {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedRoot = normalizePathForCompare(root);
  if (!normalizedRoot) return false;
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
};

type AnalysisUpdateItem = {
  target: ImageRecord;
  patch: Partial<ImageRecord>;
  expectedScope?: string;
};

const applyAnalysisPatch = (images: ImageRecord[], updates: AnalysisUpdateItem[]): ImageRecord[] => {
  if (updates.length === 0) return images;
  const patchByPath = new Map<string, { patch: Partial<ImageRecord>; expectedScope?: string }>();
  const patchById = new Map<string, { patch: Partial<ImageRecord>; expectedScope?: string }>();
  for (const update of updates) {
    const scope = update.expectedScope ?? update.target.contentRouting?.scope;
    if (update.target.sourcePath) patchByPath.set(update.target.sourcePath, { patch: update.patch, expectedScope: scope });
    if (update.target.id) patchById.set(update.target.id, { patch: update.patch, expectedScope: scope });
  }
  return images.map(image => {
    const match = (image.sourcePath && patchByPath.get(image.sourcePath)) || patchById.get(image.id);
    if (!match) return image;
    if (match.expectedScope && image.contentRouting?.scope && image.contentRouting.scope !== match.expectedScope) {
      return image;
    }
    return { ...image, ...match.patch };
  });
};

const historyImageSnapshot = (image: ImageRecord): ImageRecord => ({
  id: image.id,
  url: image.url,
  thumbnailUrl: image.thumbnailUrl,
  sourcePath: image.sourcePath,
  fileName: image.fileName,
  pixelWidth: image.pixelWidth,
  pixelHeight: image.pixelHeight,
  tags: [],
  practice_count: image.practice_count,
  last_seen: image.last_seen,
  favorite: image.favorite,
  hidden: image.hidden,
  skip_count: image.skip_count,
});

const compactHistoryRecord = (record: HistoryRecord): HistoryRecord => ({
  ...record,
  images: record.images.map(historyImageSnapshot),
  items: record.items?.map(item => ({
    image: historyImageSnapshot(item.image),
    focusRegion: item.focusRegion,
  })),
});

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [archivedImages, setArchivedImages] = useState<ImageRecord[]>([]);
  const [sets, setSets] = useState<PracticeSet[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null);
  const [taggingTask, setTaggingTask] = useState<LibraryTaskState>({ running: false, current: 0, total: 0 });
  const [localizationTask, setLocalizationTask] = useState<LibraryTaskState>({ running: false, current: 0, total: 0 });
  const taggingRunningRef = useRef(false);
  const localizationRunningRef = useRef(false);
  const cancelTaggingRef = useRef(false);
  const cancelLocalizationRef = useRef(false);
  const lastUiInteractionRef = useRef(0);
  const persistenceEnabledRef = useRef(false);
  const skipNextStatePersistenceRef = useRef(false);
  const latestStateRef = useRef({ images, archivedImages, sets, history, settings });
  latestStateRef.current = { images, archivedImages, sets, history, settings };
  const saveTimeoutRef = useRef<number | null>(null);
  const lastSaveTimeRef = useRef<number>(Date.now());
  const shuttingDownRef = useRef(false);
  const pendingAnalysisUpdatesRef = useRef<AnalysisUpdateItem[]>([]);
  const flushAnalysisUpdatesRef = useRef<() => void>(() => undefined);

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
        data: JSON.stringify({ images: [...latest.images, ...latest.archivedImages], sets: latest.sets, history: latest.history }),
      });
    } catch (err) {
      console.warn('Failed to save app state to SQLite:', err);
    }
  };

  // Load Data
  useEffect(() => {
    const loadData = async () => {
      let allImages: ImageRecord[] = [];
      let root: string | null = null;
      try {
        const [json, settingsJson] = await Promise.all([
          invoke<string>('read_app_state'),
          invoke<string>('read_settings'),
        ]);
        if (json && json !== '{}') {
          const data = JSON.parse(json);
          if (Array.isArray(data.images)) allImages = data.images;

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
          setSets(INITIAL_SETS);
        }
        setSettings(loadSettings(settingsJson && settingsJson !== '{}' ? JSON.parse(settingsJson) : undefined));

        try {
          const status = await invoke<{ libraryPath?: string } | null>('get_library_status');
          root = status?.libraryPath || null;
        } catch {
          root = null;
        }
      } catch (err) {
        console.warn('Failed to load data from Tauri:', err);
        allImages = [];
        setSets(INITIAL_SETS);
      } finally {
        const examples = allImages.filter(image => !image.sourcePath);
        const sourceImages = allImages.filter(image => Boolean(image.sourcePath));
        setImages(root
          ? [...examples, ...sourceImages.filter(image => isPathUnderRoot(image.sourcePath!, root!))]
          : allImages);
        setArchivedImages(root
          ? sourceImages.filter(image => !isPathUnderRoot(image.sourcePath!, root!))
          : []);
        setLibraryRoot(root);
        persistenceEnabledRef.current = true;
        setIsLoaded(true);
      }
    };
    loadData();
  }, []);

  // Save database-backed application data with Debounce + MaxWait (2.5s) throttle.
  useEffect(() => {
    if (!isLoaded || !persistenceEnabledRef.current) return;
    if (skipNextStatePersistenceRef.current) {
      skipNextStatePersistenceRef.current = false;
      return;
    }
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
  }, [images, archivedImages, sets, history, isLoaded]);

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
      // Stop the background tasks from starting new images and hide the window instantly.
      shuttingDownRef.current = true;
      void invoke('begin_shutdown').catch(() => undefined);
      appWindow.hide().catch(() => undefined);
      // Flush any results that were already produced but still buffered.
      flushAnalysisUpdatesRef.current();
      const latest = latestStateRef.current;
      try {
        await Promise.race([
          Promise.all([
            invoke('write_app_state', { data: JSON.stringify({ images: [...latest.images, ...latest.archivedImages], sets: latest.sets, history: latest.history }) }),
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

  const updateImageThumbnail = (_id: string, _thumbnailUrl?: string) => {
    // Thumbnails are cached on disk by the Rust thumbnail cache and are re-attached by the
    // next library scan. Deliberately do NOT mutate `images` here: writing a thumbnail URL
    // into the image record used to force the whole gallery (displayItems + justified layout
    // + Virtuoso) to recompute for every single thumbnail completion, which froze the UI
    // while many thumbnails streamed in.
  };

  const toggleImageFavorite = (id: string) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, favorite: !img.favorite } : img));
  };

  const toggleImageHidden = (id: string) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, hidden: !img.hidden } : img));
  };

  const updateLibraryRoot = (root: string | null) => {
    const current = latestStateRef.current;
    const examples = current.images.filter(image => !image.sourcePath);
    const sourceByPath = new Map<string, ImageRecord>();
    [...current.images.filter(image => Boolean(image.sourcePath)), ...current.archivedImages].forEach(image => {
      if (image.sourcePath) sourceByPath.set(normalizePathForCompare(image.sourcePath), image);
    });
    const allSource = Array.from(sourceByPath.values());
    const nextImages = [...examples];
    const nextArchived: ImageRecord[] = [];
    allSource.forEach(image => {
      if (root && image.sourcePath && isPathUnderRoot(image.sourcePath, root)) {
        nextImages.push(image);
      } else {
        nextArchived.push(image);
      }
    });
    setImages(nextImages);
    setArchivedImages(nextArchived);
    setLibraryRoot(root);
  };

  const mapAllImages = (mapper: (image: ImageRecord) => ImageRecord) => {
    setImages(prev => prev.map(mapper));
    setArchivedImages(prev => prev.map(mapper));
  };

  const removeTagsFromAllImages = (tags: string[]) => {
    const toRemove = new Set(tags.filter(tag => Boolean(tag)));
    if (toRemove.size === 0) return;
    mapAllImages(image => {
      if (!image.tags.some(tag => toRemove.has(tag))) return image;
      return { ...image, tags: image.tags.filter(tag => !toRemove.has(tag)) };
    });
  };

  const resetAllImageTags = () => {
    mapAllImages(image => ({
      ...image,
      tags: [],
      tagStatus: 'pending',
      tagError: undefined,
    }));
  };

  const resetAllImageLocalization = () => {
    mapAllImages(image => ({
      ...image,
      poseAnalysis: undefined,
      contentRouting: undefined,
      visualAnalysis: undefined,
    }));
  };

  const resetAllImageMetadata = () => {
    mapAllImages(image => ({
      ...image,
      tags: [],
      tagStatus: 'pending',
      tagError: undefined,
      poseAnalysis: undefined,
      contentRouting: undefined,
      visualAnalysis: undefined,
    }));
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

  const updateImagesAnalysisBatch = (updates: AnalysisUpdateItem[]) => {
    if (updates.length === 0) return;
    const next = applyAnalysisPatch(latestStateRef.current.images, updates);
    latestStateRef.current = { ...latestStateRef.current, images: next };
    setImages(next);
  };

  const flushAnalysisUpdates = () => {
    if (pendingAnalysisUpdatesRef.current.length === 0) return;
    const batch = pendingAnalysisUpdatesRef.current.splice(0, pendingAnalysisUpdatesRef.current.length);
    updateImagesAnalysisBatch(batch);
  };
  flushAnalysisUpdatesRef.current = flushAnalysisUpdates;

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
    cancelTaggingRef.current = false;
    setTaggingTask({ running: true, current: 0, total: queue.length });
    const profile = inferenceProfile(settings.inferencePerformance);
    const applied = new Set<number>();
    let lastFlushTime = Date.now();
    let lastTaskTime = 0;
    let runtimeMessage = '';

    try {
      const progress = new Channel<Record<string, unknown>>();
      progress.onmessage = message => {
        if (cancelTaggingRef.current) return;
        if (message.type === 'runtime') {
          const fallback = typeof message.gpuFallback === 'string' ? message.gpuFallback : '';
          const provider = String(message.provider || 'CPUExecutionProvider');
          runtimeMessage = fallback
            ? `${fallback}，已自动使用 CPU`
            : provider === 'CPUExecutionProvider' ? '自动打标正在使用 CPU' : `自动打标正在使用 GPU（${provider}）`;
          setTaggingTask(current => ({ ...current, message: runtimeMessage }));
          return;
        }
        const current = Number(message.current) || 0;
        const now = Date.now();
        if (now - lastTaskTime >= 120 || current === queue.length) {
          lastTaskTime = now;
          setTaggingTask({ running: true, current, total: queue.length });
        }
        if (current < 1 || current > queue.length || !message.result) return;
        const index = current - 1;
        applied.add(index);
        pendingAnalysisUpdatesRef.current.push({
          target: queue[index],
          patch: {
            tags: mapModelTags(message.result),
            tagStatus: 'tagged',
            tagError: undefined,
          },
          expectedScope: 'human_dominant',
        });
        if (pendingAnalysisUpdatesRef.current.length >= 5 || now - lastFlushTime >= 200) {
          flushAnalysisUpdates();
          lastFlushTime = now;
        }
      };
      const results = await invoke<unknown[]>('auto_tag_images', {
        imagePaths: queue.map(image => image.sourcePath),
        preferGpu: settings.gpuInferenceEnabled,
        cpuThreads: profile.cpuThreads,
        interImageDelayMs: profile.betweenImagesMs,
        onProgress: progress,
      });
      results.forEach((result, index) => {
        if (applied.has(index) || !queue[index]) return;
        pendingAnalysisUpdatesRef.current.push({
          target: queue[index],
          patch: {
            tags: mapModelTags(result),
            tagStatus: 'tagged',
            tagError: undefined,
          },
          expectedScope: 'human_dominant',
        });
      });
      flushAnalysisUpdates();
      void flushSave();
      setTaggingTask({
        running: false,
        current: results.length,
        total: queue.length,
        message: [`已完成 ${results.length} 张图片的自动打标`, runtimeMessage].filter(Boolean).join(' · '),
      });
    } catch (error) {
      flushAnalysisUpdates();
      void flushSave();
      if (cancelTaggingRef.current) {
        setTaggingTask(current => ({ ...current, running: false, message: '已停止自动打标' }));
      } else {
        console.warn('Background tagging failed:', error);
        setTaggingTask(current => ({ ...current, running: false, error: String(error) }));
      }
    } finally {
      taggingRunningRef.current = false;
    }
  };

  const startImageLocalization = async (targets: ImageRecord[]) => {
    const queue = targets.filter(image => Boolean(image.sourcePath) && !isAnalysisComplete(image));
    if (localizationRunningRef.current || queue.length === 0) return;
    localizationRunningRef.current = true;
    cancelLocalizationRef.current = false;
    setThumbnailSchedulerPaused(true);
    setLocalizationTask({ running: true, current: 0, total: queue.length });
    const profile = inferenceProfile(settings.inferencePerformance);
    const gpuFallbacks = new Set<string>();
    const inferenceOptions = {
      preferGpu: settings.gpuInferenceEnabled,
      performance: settings.inferencePerformance,
      onGpuFallback: (reason: string) => {
        if (gpuFallbacks.has(reason)) return;
        gpuFallbacks.add(reason);
        setLocalizationTask(current => ({
          ...current,
          message: `${Array.from(gpuFallbacks).join('；')}，已自动使用 CPU`,
        }));
      },
    };
    let completed = 0;
    let failed = 0;
    let regionCount = 0;
    let lastFlushTime = Date.now();
    let lastTaskTime = 0;

    const waitForAnalysisSlot = () => new Promise<void>(resolve => {
      const waitUntilQuiet = () => {
        if (shuttingDownRef.current || cancelLocalizationRef.current) {
          resolve();
          return;
        }
        const quietFor = performance.now() - lastUiInteractionRef.current;
        if (quietFor < profile.interactionQuietMs) {
          globalThis.setTimeout(waitUntilQuiet, Math.ceil(profile.interactionQuietMs - quietFor));
          return;
        }
        const timeout = taggingRunningRef.current
          ? Math.max(500, profile.idleTimeoutMs)
          : profile.idleTimeoutMs;
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(() => {
            if (performance.now() - lastUiInteractionRef.current < profile.interactionQuietMs) waitUntilQuiet();
            else resolve();
          }, { timeout });
        } else {
          globalThis.setTimeout(resolve, taggingRunningRef.current ? Math.max(100, profile.betweenImagesMs) : profile.betweenImagesMs);
        }
      };
      waitUntilQuiet();
    });

    try {
      for (const image of queue) {
        if (shuttingDownRef.current || cancelLocalizationRef.current) break;
        await waitForAnalysisSlot();
        if (shuttingDownRef.current || cancelLocalizationRef.current) break;
        try {
          const analysis = await analyzeContent(image.url, inferenceOptions);
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
          pendingAnalysisUpdatesRef.current.push({ target: image, patch, expectedScope: contentRouting.scope });
          completed += 1;
          regionCount += analysis.poseAnalysis.regions.length;
        } catch (error) {
          failed += 1;
          console.warn(`Pose localization failed for ${image.fileName || image.id}:`, error);
        }

        const now = Date.now();
        if (pendingAnalysisUpdatesRef.current.length >= 5 || now - lastFlushTime >= 200) {
          flushAnalysisUpdates();
          lastFlushTime = now;
        }
        if (now - lastTaskTime >= 120 || (completed + failed) === queue.length) {
          lastTaskTime = now;
          setLocalizationTask({ running: true, current: completed + failed, total: queue.length });
        }

        // Yield to the main browser thread to allow UI rendering and smooth user interaction
        await new Promise<void>(resolve => setTimeout(
          resolve,
          taggingRunningRef.current ? Math.max(64, profile.betweenImagesMs) : profile.betweenImagesMs,
        ));
      }
      flushAnalysisUpdates();
      void flushSave();
      if (!shuttingDownRef.current) {
        setLocalizationTask({
          running: false,
          current: completed + failed,
          total: queue.length,
          message: cancelLocalizationRef.current
            ? `已停止素材分析（完成 ${completed} 张${failed > 0 ? `，${failed} 张失败` : ''}）`
            : [
              `已分析 ${completed} 张图片，生成 ${regionCount} 个虚拟局部${failed > 0 ? `，${failed} 张失败` : ''}`,
              gpuFallbacks.size > 0 ? 'GPU 不可用，本次已使用 CPU' : settings.gpuInferenceEnabled ? 'GPU 推理' : 'CPU 推理',
            ].join(' · '),
        });
      }
    } catch (error) {
      flushAnalysisUpdates();
      void flushSave();
      console.warn('Localization task failed:', error);
      if (!shuttingDownRef.current) {
        setLocalizationTask(current => ({ ...current, running: false, error: String(error) }));
      }
    } finally {
      localizationRunningRef.current = false;
      setThumbnailSchedulerPaused(false);
    }
  };

  const stopImageTagging = () => {
    cancelTaggingRef.current = true;
    void invoke('stop_tagging').catch(() => undefined);
  };

  const stopImageLocalization = () => {
    cancelLocalizationRef.current = true;
  };

  const syncLibraryImages = (scannedImages: ImageRecord[]) => {
    setImages(prev => {
      const next = [
        ...scannedImages,
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

  const removeImages = (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setImages(prev => prev.filter(image => !idSet.has(image.id)));
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
    const compactRecord = compactHistoryRecord(record);
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
    const persistIncrementally = isTauriEnvironment();
    if (persistIncrementally) skipNextStatePersistenceRef.current = true;
    setHistory(prev => [compactRecord, ...prev]);
    if (persistIncrementally) {
      void invoke('append_practice_session', { data: JSON.stringify(compactRecord) }).catch(error => {
        console.warn('Failed to append practice session:', error);
        globalThis.setTimeout(() => { void flushSave(); }, 0);
      });
    }
  };

  const clearHistory = () => {
    setHistory([]);
  };

  if (!isLoaded) {
    return <StartupSplash />;
  }

  return (
    <AppContext.Provider value={{
      images, libraryRoot, sets, history, darkMode, toggleDarkMode,
      settings, updateSettings,
      updateImageTags, updateImageThumbnail, toggleImageFavorite, toggleImageHidden, addImages, upsertImages, syncLibraryImages, updateLibraryRoot, removeTagsFromAllImages, resetAllImageTags, resetAllImageLocalization, resetAllImageMetadata, removeImage, removeImages, saveSet, deleteSet, addHistory, clearHistory,
      taggingTask, localizationTask, startImageTagging, startImageLocalization, stopImageTagging, stopImageLocalization,
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
