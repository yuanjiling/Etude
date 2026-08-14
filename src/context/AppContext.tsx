import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { ImageRecord, PracticeSet, HistoryRecord, PracticeConfig, AppSettings } from '../types';
import { MOCK_IMAGES, INITIAL_SETS } from '../data';
import { analyzeContent, visualAnalysisTags } from '../services/contentAnalysis';
import { mapModelTags } from '../utils/modelTags';

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
  settingsVersion: 4,
  theme: 'system',
  preparationSec: 3,
  transitionSec: 1,
  soundEnabled: true,
  defaultGrid: false,
  defaultFlip: false,
  defaultGrayscale: false,
  defaultClickThrough: false,
  bgOpacity: 95,
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
};

const loadSettings = (stored: unknown): AppSettings => {
  const source = stored && typeof stored === 'object' ? stored as Record<string, unknown> : {};
  const loaded = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [key, source[key] ?? fallback]),
  ) as unknown as AppSettings;
  loaded.shortcuts = { ...DEFAULT_SETTINGS.shortcuts, ...(source.shortcuts as Partial<AppSettings['shortcuts']> | undefined) };
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

  // Load Data
  useEffect(() => {
    const loadData = async () => {
      try {
        const json = await invoke<string>('read_data');
        if (json && json !== '{}') {
          const data = JSON.parse(json);
          if (data.images) setImages(data.images);
          else setImages(MOCK_IMAGES);
          
          if (data.sets) setSets(data.sets);
          else setSets(INITIAL_SETS);
          
          if (data.history) setHistory(data.history);
          if (data.darkMode !== undefined) setDarkMode(data.darkMode);
          if (data.settings) {
            const nextSettings = loadSettings(data.settings);
            if (!data.settings.theme && data.darkMode !== undefined) {
              nextSettings.theme = data.darkMode ? 'dark' : 'light';
            }
            setSettings(nextSettings);
          }
        } else {
          setImages(MOCK_IMAGES);
          setSets(INITIAL_SETS);
        }
      } catch (err) {
        console.warn('Failed to load data from Tauri:', err);
        setImages(MOCK_IMAGES);
        setSets(INITIAL_SETS);
      } finally {
        setIsLoaded(true);
      }
    };
    loadData();
  }, []);

  // Save Data
  useEffect(() => {
    if (!isLoaded) return;
    const saveTimer = window.setTimeout(async () => {
      const data = { images, sets, history, darkMode, settings };
      try {
        await invoke('write_data', { data: JSON.stringify(data) });
      } catch (err) {
        console.warn('Failed to save data to Tauri:', err);
      }
    }, 500);
    return () => window.clearTimeout(saveTimer);
  }, [images, sets, history, darkMode, settings, isLoaded]);

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
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const toggleDarkMode = () => updateSettings({ theme: darkMode ? 'light' : 'dark' });

  const updateImageTags = (id: string, tags: string[]) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, tags } : img));
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

  const updateImageAnalysis = (
    target: ImageRecord,
    patch: Partial<ImageRecord>,
    expectedScope = target.contentRouting?.scope,
  ) => {
    setImages(current => current.map(image => (
      (target.sourcePath && image.sourcePath === target.sourcePath) || image.id === target.id
        ? expectedScope && image.contentRouting?.scope && image.contentRouting.scope !== expectedScope
          ? image
          : { ...image, ...patch }
        : image
    )));
  };

  const startImageTagging = async (targets: ImageRecord[]) => {
    const queue = targets.filter((image): image is ImageRecord & { sourcePath: string } => (
      Boolean(image.sourcePath) && image.contentRouting?.scope !== 'general_reference'
    ));
    if (taggingRunningRef.current || queue.length === 0) return;
    taggingRunningRef.current = true;
    setTaggingTask({ running: true, current: 0, total: queue.length });
    const applied = new Set<number>();
    try {
      const progress = new Channel<Record<string, unknown>>();
      progress.onmessage = message => {
        const current = Number(message.current) || 0;
        setTaggingTask({ running: true, current, total: queue.length });
        if (current < 1 || current > queue.length || !message.result) return;
        const index = current - 1;
        applied.add(index);
        updateImageAnalysis(queue[index], {
          tags: mapModelTags(message.result),
          tagStatus: 'tagged',
          tagError: undefined,
        }, 'human_dominant');
      };
      const results = await invoke<unknown[]>('auto_tag_images', {
        imagePaths: queue.map(image => image.sourcePath),
        onProgress: progress,
      });
      results.forEach((result, index) => {
        if (applied.has(index) || !queue[index]) return;
        updateImageAnalysis(queue[index], {
          tags: mapModelTags(result),
          tagStatus: 'tagged',
          tagError: undefined,
        }, 'human_dominant');
      });
      setTaggingTask({
        running: false,
        current: results.length,
        total: queue.length,
        message: `已完成 ${results.length} 张图片的自动打标`,
      });
    } catch (error) {
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
    setLocalizationTask({ running: true, current: 0, total: queue.length });
    let completed = 0;
    let failed = 0;
    let regionCount = 0;
    try {
      for (const image of queue) {
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
          updateImageAnalysis(image, patch, contentRouting.scope);
          completed += 1;
          regionCount += analysis.poseAnalysis.regions.length;
        } catch (error) {
          failed += 1;
          console.warn(`Pose localization failed for ${image.fileName || image.id}:`, error);
        }
        setLocalizationTask({ running: true, current: completed + failed, total: queue.length });
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      setLocalizationTask({
        running: false,
        current: queue.length,
        total: queue.length,
        message: `已分析 ${completed} 张图片，生成 ${regionCount} 个虚拟局部${failed > 0 ? `，${failed} 张失败` : ''}`,
      });
    } finally {
      localizationRunningRef.current = false;
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
    return <div className="h-screen w-screen flex items-center justify-center bg-stone-100 dark:bg-zinc-950 text-black dark:text-white font-bold text-sm">正在加载配置...</div>;
  }

  return (
    <AppContext.Provider value={{
      images, sets, history, darkMode, toggleDarkMode,
      settings, updateSettings,
      updateImageTags, toggleImageFavorite, toggleImageHidden, addImages, upsertImages, syncLibraryImages, removeImage, saveSet, deleteSet, addHistory, clearHistory,
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
