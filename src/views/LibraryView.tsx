import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Virtuoso } from 'react-virtuoso';
import type { VirtuosoHandle } from 'react-virtuoso';
import { Check, ChevronDown, ChevronRight, Crosshair, Folder, FolderOpen, FolderTree, ImagePlus, Loader2, Minus, Pencil, Play, Plus, RefreshCw, Search, Tags, Trash2, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { GlassCard } from '../components/GlassCard';
import { ConfirmModal } from '../components/ConfirmModal';
import { FocusedPracticeImage } from '../components/FocusedPracticeImage';
import { useAppContext } from '../context/AppContext';
import { POSE_MODEL_VERSION } from '../services/poseFocus';
import { CONTENT_ROUTER_VERSION, isAnalysisComplete } from '../services/contentAnalysis';
import { requestThumbnail } from '../services/thumbnailScheduler';
import { FocusRegion, ImageRecord, CustomTagGroup } from '../types';
import { getVirtualFocusTags } from '../utils/focusRegion';
import { buildLibraryFolders, folderContains, type LibraryFolder } from '../utils/libraryFolders';
import {
  ASPECT_RATIO_TAGS,
  BODY_PART_TAGS as BODY_PART_TAG_VALUES,
  COLOR_TAGS,
  compactAspectRatioLabel,
  compactVisualTagLabel,
  CONTRAST_TAGS,
  ORIENTATION_TAGS,
  TAG_CATEGORIES,
} from '../utils/tagCatalog';

type LibraryFile = {
  path: string;
  thumbnailPath?: string;
  relativePath: string;
  fileName: string;
  fileSize: number;
  modifiedAt: number;
  pixelWidth: number;
  pixelHeight: number;
};

type LibraryDisplayItem = {
  id: string;
  image: ImageRecord;
  tags: string[];
  focusRegion?: FocusRegion;
};

type ManualContentRoute = 'human_dominant' | 'general_reference';

type JustifiedRow = {
  items: Array<LibraryDisplayItem & { width: number }>;
  height: number;
  top: number;
};

type LayoutBox = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ScrollMetrics = {
  visible: boolean;
  thumbHeight: number;
  thumbTop: number;
};

type VisibleRowRange = {
  start: number;
  end: number;
  center: number;
};

const FOCUS_ID_SEPARATOR = '::focus::';
const GALLERY_GAP = 12;

const itemAspectRatio = (item: LibraryDisplayItem) => {
  if (item.focusRegion && item.focusRegion.height > 0) {
    return Math.min(8, Math.max(0.15, item.focusRegion.width / item.focusRegion.height));
  }
  const { pixelWidth = 0, pixelHeight = 0 } = item.image;
  return pixelWidth > 0 && pixelHeight > 0
    ? Math.min(8, Math.max(0.15, pixelWidth / pixelHeight))
    : 0.8;
};

const buildJustifiedLayout = (items: LibraryDisplayItem[], containerWidth: number, targetHeight: number) => {
  const rows: JustifiedRow[] = [];
  const boxes: LayoutBox[] = [];
  if (containerWidth <= 0) return { rows, boxes };

  let pending: LibraryDisplayItem[] = [];
  let ratioSum = 0;
  let top = 0;
  const commitRow = (isLast: boolean) => {
    if (pending.length === 0) return;
    const availableWidth = containerWidth - GALLERY_GAP * (pending.length - 1);
    const idealHeight = availableWidth / ratioSum;
    const height = isLast ? Math.min(targetHeight, idealHeight) : idealHeight;
    const rawWidths = pending.map(item => itemAspectRatio(item) * height);
    const shouldJustify = !isLast || idealHeight <= targetHeight * 1.15;
    const scale = shouldJustify ? availableWidth / rawWidths.reduce((sum, width) => sum + width, 0) : 1;
    let left = 0;
    const rowItems = pending.map((item, index) => {
      const width = index === pending.length - 1 && shouldJustify
        ? Math.max(1, containerWidth - left)
        : rawWidths[index] * scale;
      boxes.push({ id: item.id, left, top, width, height });
      left += width + GALLERY_GAP;
      return { ...item, width };
    });
    rows.push({ items: rowItems, height, top });
    top += height + GALLERY_GAP;
    pending = [];
    ratioSum = 0;
  };

  items.forEach(item => {
    pending.push(item);
    ratioSum += itemAspectRatio(item);
    const projectedWidth = ratioSum * targetHeight + GALLERY_GAP * (pending.length - 1);
    if (projectedWidth >= containerWidth) commitRow(false);
  });
  commitRow(true);
  return { rows, boxes };
};

const GalleryScrollbar: React.FC<{ scroller: HTMLElement | null; contentKey: string }> = ({ scroller, contentKey }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; grabOffset: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [metrics, setMetrics] = useState<ScrollMetrics>({ visible: false, thumbHeight: 0, thumbTop: 0 });

  const readMetrics = useCallback(() => {
    if (!scroller) return { visible: false, thumbHeight: 0, thumbTop: 0 };
    const viewportHeight = scroller.clientHeight;
    const contentHeight = scroller.scrollHeight;
    const trackHeight = trackRef.current?.clientHeight ?? viewportHeight;
    const maxScroll = Math.max(0, contentHeight - viewportHeight);
    if (maxScroll <= 0 || trackHeight <= 0) return { visible: false, thumbHeight: 0, thumbTop: 0 };
    const thumbHeight = Math.min(trackHeight, Math.max(28, trackHeight * viewportHeight / contentHeight));
    const travel = Math.max(0, trackHeight - thumbHeight);
    return {
      visible: true,
      thumbHeight,
      thumbTop: travel * Math.min(1, Math.max(0, scroller.scrollTop / maxScroll)),
    };
  }, [scroller]);

  const syncMetrics = useCallback(() => setMetrics(readMetrics()), [readMetrics]);

  useEffect(() => {
    if (!scroller) {
      setMetrics({ visible: false, thumbHeight: 0, thumbTop: 0 });
      return;
    }
    syncMetrics();
    const resizeObserver = new ResizeObserver(syncMetrics);
    resizeObserver.observe(scroller);
    if (scroller.firstElementChild) resizeObserver.observe(scroller.firstElementChild);
    const mutationObserver = new MutationObserver(syncMetrics);
    mutationObserver.observe(scroller, { childList: true, subtree: true });
    scroller.addEventListener('scroll', syncMetrics, { passive: true });
    window.addEventListener('resize', syncMetrics);
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      scroller.removeEventListener('scroll', syncMetrics);
      window.removeEventListener('resize', syncMetrics);
    };
  }, [scroller, contentKey, syncMetrics]);

  const scrollFromPointer = (clientY: number, grabOffset: number) => {
    const track = trackRef.current;
    if (!scroller || !track) return;
    const bounds = track.getBoundingClientRect();
    const current = readMetrics();
    const travel = Math.max(0, bounds.height - current.thumbHeight);
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const thumbTop = Math.min(travel, Math.max(0, clientY - bounds.top - grabOffset));
    scroller.scrollTop = travel > 0 ? thumbTop / travel * maxScroll : 0;
    syncMetrics();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || !metrics.visible) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerY = event.clientY - bounds.top;
    const pressedThumb = (event.target as HTMLElement).dataset.galleryScrollbarThumb !== undefined;
    const grabOffset = pressedThumb
      ? Math.min(metrics.thumbHeight, Math.max(0, pointerY - metrics.thumbTop))
      : metrics.thumbHeight / 2;
    dragRef.current = { pointerId: event.pointerId, grabOffset };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    scrollFromPointer(event.clientY, grabOffset);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    scrollFromPointer(event.clientY, drag.grabOffset);
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={trackRef}
      aria-label="图库滚动条"
      role="scrollbar"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, (scroller?.scrollHeight || 0) - (scroller?.clientHeight || 0))}
      aria-valuenow={Math.round(scroller?.scrollTop || 0)}
      className={`absolute inset-y-1 right-0 z-20 w-3 cursor-pointer touch-none transition-opacity duration-150 ${metrics.visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      <div
        className={`pointer-events-none absolute inset-y-0 right-0.5 w-[7px] rounded-full transition-colors duration-150 ${
          dragging
            ? 'bg-stone-700/20 dark:bg-white/20'
            : hovered
              ? 'bg-stone-600/14 dark:bg-white/14'
              : 'bg-transparent'
        }`}
      />
      <div
        data-gallery-scrollbar-thumb
        className={`absolute right-0.5 rounded-full transition-[width,background-color,box-shadow] duration-150 ease-out ${
          dragging
            ? 'w-[7px] bg-stone-900/95 shadow-sm dark:bg-white/95'
            : hovered
              ? 'w-[7px] bg-stone-800/82 shadow-sm dark:bg-white/85'
              : 'w-[3px] bg-stone-700/55 dark:bg-white/60'
        }`}
        style={{ height: metrics.thumbHeight, transform: `translateY(${metrics.thumbTop}px)` }}
      />
    </div>
  );
};

const BODY_PART_TAGS = [...BODY_PART_TAG_VALUES];
const GENERAL_REFERENCE_TAGS = new Set([
  ...COLOR_TAGS,
  ...CONTRAST_TAGS,
  ...ORIENTATION_TAGS,
  ...ASPECT_RATIO_TAGS,
  '综合参考',
]);

const PRACTICE_FILTER_TAGS = ['从未画', '久未画', '画过'];
const GENERAL_REFERENCE_CATEGORY_NAMES = new Set(['主色调', '对比度', '方向', '画幅']);
const MULTI_SELECT_EDITOR_CATEGORIES = new Set(['姿势', '机位', '视角']);
const EDITABLE_TAG_CATEGORIES = TAG_CATEGORIES.filter(category => category.name !== '练习');
const FILTER_CATEGORIZED_TAGS = new Set(EDITABLE_TAG_CATEGORIES.flatMap(category => category.tags));
const normalizeEditorTags = (tags: string[]) => {
  const editableTags = new Set(EDITABLE_TAG_CATEGORIES.flatMap(category => category.tags));
  const normalized = tags.filter(tag => !editableTags.has(tag) && !PRACTICE_FILTER_TAGS.includes(tag));
  EDITABLE_TAG_CATEGORIES.forEach(category => {
    const selected = category.tags.filter(tag => tags.includes(tag));
    if (MULTI_SELECT_EDITOR_CATEGORIES.has(category.name)) normalized.push(...selected);
    else if (selected.length > 0) normalized.push(selected.at(-1)!);
  });
  return normalized;
};
const GENDER_SUMMARY_TAGS = ['纯男', '纯女', '混合', '男性', '女性'] as const;
const POSE_SUMMARY_TAGS = ['站', '坐', '跪', '蹲', '躺'] as const;
const CAMERA_SUMMARY_TAGS = ['平视', '俯视', '仰视'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

const firstSummaryTag = (tags: string[], candidates: readonly string[]) => (
  candidates.find(tag => tags.includes(tag))
);

const thumbnailTagSummary = (
  tags: string[],
  focusRegion: FocusRegion | undefined,
  isTagged: boolean,
) => {
  if (tags.includes('综合参考')) {
    return [
      firstSummaryTag(tags, COLOR_TAGS),
      firstSummaryTag(tags, CONTRAST_TAGS),
      firstSummaryTag(tags, ORIENTATION_TAGS),
      compactAspectRatioLabel(firstSummaryTag(tags, ASPECT_RATIO_TAGS) || ''),
    ].filter(Boolean).join(' · ');
  }
  if (focusRegion) {
    const details = isTagged
      ? [firstSummaryTag(tags, GENDER_SUMMARY_TAGS), firstSummaryTag(tags, CAMERA_SUMMARY_TAGS)]
      : [];
    return [focusRegion.tag, ...details].filter(Boolean).join(' · ');
  }
  if (tags.includes('人体局部')) {
    return [
      firstSummaryTag(tags, BODY_PART_TAGS) || '人体局部',
      firstSummaryTag(tags, GENDER_SUMMARY_TAGS),
      firstSummaryTag(tags, CAMERA_SUMMARY_TAGS),
    ].filter(Boolean).join(' · ');
  }
  return [
    firstSummaryTag(tags, GENDER_SUMMARY_TAGS),
    firstSummaryTag(tags, POSE_SUMMARY_TAGS),
    firstSummaryTag(tags, CAMERA_SUMMARY_TAGS),
  ].filter(Boolean).join(' · ');
};

const matchesSelectedTags = (image: ImageRecord, imageTags: string[], selectedTags: string[]): boolean => {
  const activeGroups = EDITABLE_TAG_CATEGORIES
    .map(category => category.tags.filter(tag => selectedTags.includes(tag)))
    .filter(group => group.length > 0);
  const uncategorizedTags = selectedTags.filter(tag => !FILTER_CATEGORIZED_TAGS.has(tag) && !PRACTICE_FILTER_TAGS.includes(tag));
  const activePracticeFilters = PRACTICE_FILTER_TAGS.filter(tag => selectedTags.includes(tag));
  const now = Date.now();
  const matchesPractice = activePracticeFilters.length === 0 || activePracticeFilters.some(filter => {
    if (filter === '从未画') return image.practice_count <= 0;
    if (filter === '久未画') return !image.last_seen || now - image.last_seen >= 30 * DAY_MS;
    return Boolean(image.last_seen && now - image.last_seen < 7 * DAY_MS);
  });
  return matchesPractice
    && activeGroups.every(group => group.some(tag => imageTags.includes(tag)))
    && uncategorizedTags.every(tag => imageTags.includes(tag));
};

const pathId = (path: string) => {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `library_${(hash >>> 0).toString(36)}`;
};

const getRegionAspectRatio = (image: ImageRecord, region?: FocusRegion): number => {
  if (!region) {
    if (image.pixelWidth && image.pixelHeight && image.pixelHeight > 0) {
      return image.pixelWidth / image.pixelHeight;
    }
    return 1;
  }
  const imgWidth = image.pixelWidth || 1000;
  const imgHeight = image.pixelHeight || 1000;
  const rw = (region.width || 0.5) * imgWidth;
  const rh = (region.height || 0.5) * imgHeight;
  if (rh > 0 && rw > 0) {
    return Math.max(0.45, Math.min(2.4, rw / rh));
  }
  return 1;
};

export const LibraryView: React.FC<{
  onStart: (config: any) => void;
  locateTarget?: { imageId: string; nonce: number } | null;
  onLocateHandled?: () => void;
}> = ({ onStart, locateTarget, onLocateHandled }) => {
  const {
    images, upsertImages, syncLibraryImages, updateImageTags, updateImageThumbnail, removeImage, removeImages, settings, updateSettings,
    taggingTask, localizationTask, startImageTagging, startImageLocalization, stopImageTagging, stopImageLocalization,
  } = useAppContext();
  const imagesRef = useRef(images);
  const scanPromiseRef = useRef<Promise<void> | null>(null);
  const galleryViewportRef = useRef<HTMLDivElement>(null);
  const galleryGridRef = useRef<HTMLElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [galleryScroller, setGalleryScroller] = useState<HTMLElement | null>(null);
  const selectionStartRef = useRef<{
    startClientX: number;
    startClientY: number;
    startScrollTop: number;
    startScrollLeft: number;
    initialIds: string[];
    sessionHits: Set<string>;
    active: boolean;
    startedOnCard: boolean;
    startedItemId: string | null;
    lastClientX: number;
    lastClientY: number;
  } | null>(null);
  const suppressCardClickRef = useRef(false);
  const marqueeScrollFrameRef = useRef<number | null>(null);
  const handledLocateNonceRef = useRef<number | null>(null);
  imagesRef.current = images;
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [internalLocate, setInternalLocate] = useState<{ imageId: string; nonce: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [showFolders, setShowFolders] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [editingImage, setEditingImage] = useState<ImageRecord | null>(null);
  const [editingFocusRegion, setEditingFocusRegion] = useState<FocusRegion | undefined>();
  const [isBatchEditing, setIsBatchEditing] = useState(false);
  const [previewZoomItem, setPreviewZoomItem] = useState<{ image: ImageRecord; focusRegion?: FocusRegion } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isScanning, setIsScanning] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissedMessages, setDismissedMessages] = useState<Set<string>>(() => new Set());
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    description: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    description: '',
    confirmText: '确认',
    cancelText: '取消',
    type: 'danger',
    onConfirm: () => undefined,
  });
  const [practiceMinutes, setPracticeMinutes] = useState<number | string>(1);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [galleryViewportWidth, setGalleryViewportWidth] = useState(0);
  const [visibleRows, setVisibleRows] = useState<VisibleRowRange>({ start: 0, end: 0, center: 0 });
  const thumbnailWidth = Math.min(174, Math.max(76, settings.libraryThumbnailWidth || 174));
  const setGalleryScrollerRef = useCallback((element: HTMLElement | null) => {
    galleryGridRef.current = element;
    setGalleryScroller(element);
  }, []);

  useEffect(() => {
    const viewport = galleryViewportRef.current;
    if (!viewport) return;
    const updateColumns = () => {
      const width = viewport.clientWidth;
      setGalleryViewportWidth(width);
    };
    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const syncLibrary = useCallback(() => {
    if (scanPromiseRef.current) return scanPromiseRef.current;
    const task = (async () => {
      setIsScanning(true);
      try {
      const knownImages = imagesRef.current.flatMap(image => (
        image.sourcePath
          && image.fileSize !== undefined
          && image.modifiedAt !== undefined
          && image.pixelWidth !== undefined
          && image.pixelHeight !== undefined
          ? [{
              path: image.sourcePath,
              fileSize: image.fileSize,
              modifiedAt: image.modifiedAt,
              pixelWidth: image.pixelWidth,
              pixelHeight: image.pixelHeight,
            }]
          : []
      ));
      const files = await invoke<LibraryFile[]>('scan_library', { knownImages });
      const previousByPath = new Map<string, ImageRecord>();
      imagesRef.current.forEach(image => {
        if (image.sourcePath) previousByPath.set(image.sourcePath, image);
      });
      const records = files.map(file => {
        const previous = previousByPath.get(file.path);
        const changed = previous && (
          previous.modifiedAt !== file.modifiedAt || previous.fileSize !== file.fileSize
        );
        return {
          id: previous?.id || pathId(file.path),
          url: convertFileSrc(file.path),
          thumbnailUrl: file.thumbnailPath ? convertFileSrc(file.thumbnailPath) : undefined,
          sourcePath: file.path,
          libraryRelativePath: file.relativePath,
          fileName: file.fileName,
          fileSize: file.fileSize,
          modifiedAt: file.modifiedAt,
          pixelWidth: file.pixelWidth,
          pixelHeight: file.pixelHeight,
          tagStatus: changed ? 'outdated' as const : previous?.tagStatus || 'pending' as const,
          tagError: changed ? undefined : previous?.tagError,
          poseAnalysis: changed ? undefined : previous?.poseAnalysis,
          contentRouting: changed ? undefined : previous?.contentRouting,
          visualAnalysis: changed ? undefined : previous?.visualAnalysis,
          tags: previous?.tags || [],
          practice_count: previous?.practice_count || 0,
          favorite: previous?.favorite || false,
          hidden: previous?.hidden || false,
          skip_count: previous?.skip_count || 0,
        };
      });
      syncLibraryImages(records);
      } catch (error) {
        console.warn('Library scan failed:', error);
      } finally {
        setIsScanning(false);
        scanPromiseRef.current = null;
      }
    })();
    scanPromiseRef.current = task;
    return task;
  }, [syncLibraryImages]);

  useEffect(() => {
    syncLibrary();
  }, []);

  const libraryFolders = useMemo(() => buildLibraryFolders(images), [images]);
  const folderImages = useMemo(
    () => activeFolder ? images.filter(image => folderContains(activeFolder, image)) : images,
    [images, activeFolder],
  );
  const activeFolderName = activeFolder
    ? libraryFolders.find(folder => folder.path === activeFolder)?.name || '图包'
    : '全部图包';

  useEffect(() => {
    if (activeFolder && !libraryFolders.some(folder => folder.path === activeFolder)) {
      setActiveFolder(null);
    }
  }, [activeFolder, libraryFolders]);

  const pendingImages = useMemo(
    () => folderImages.filter(image => (
      image.sourcePath
      && image.tagStatus !== 'tagged'
      && image.contentRouting?.scope !== 'general_reference'
      && image.contentRouting?.scope !== 'uncertain'
    )),
    [folderImages],
  );

  const pendingPoseImages = useMemo(() => folderImages.filter(image => (
    image.sourcePath && !isAnalysisComplete(image)
  )), [folderImages]);

  const removeFilterTag = (tag: string) => {
    setActiveTags(current => {
      let next = current.filter(item => item !== tag);
      if (tag === '人体局部') {
        next = next.filter(item => !(BODY_PART_TAGS as readonly string[]).includes(item));
      }
      return next;
    });
  };

  const toggleFilterTag = (tag: string) => {
    setActiveTags(current => {
      if (current.includes(tag)) {
        let next = current.filter(item => item !== tag);
        if (tag === '人体局部') {
          next = next.filter(item => !(BODY_PART_TAGS as readonly string[]).includes(item));
        }
        return next;
      }
      if ((BODY_PART_TAGS as readonly string[]).includes(tag)) {
        return Array.from(new Set([...current, '人体局部', tag]));
      }
      if (tag === '完整人物') {
        return [...current.filter(item => !(BODY_PART_TAGS as readonly string[]).includes(item)), tag];
      }
      return [...current, tag];
    });
  };

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const displayItems = useMemo<LibraryDisplayItem[]>(() => {
    let items: LibraryDisplayItem[];
    if (!activeTags.includes('人体局部')) {
      items = folderImages
        .filter(image => !image.hidden && matchesSelectedTags(image, image.tags, activeTags))
        .map(image => ({ id: image.id, image, tags: image.tags }));
    } else {
      items = folderImages.flatMap(image => {
        if (image.hidden) return [];
        const result: LibraryDisplayItem[] = [];
        if (matchesSelectedTags(image, image.tags, activeTags)) {
          result.push({ id: image.id, image, tags: image.tags });
        }
        if (
          image.poseAnalysis?.status === 'detected'
          && image.poseAnalysis.modelVersion === POSE_MODEL_VERSION
        ) {
          image.poseAnalysis.regions.forEach(region => {
            const virtualTags = getVirtualFocusTags(image.tags, region);
            if (matchesSelectedTags(image, virtualTags, activeTags)) {
              result.push({
                id: `${image.id}${FOCUS_ID_SEPARATOR}${region.id}`,
                image,
                tags: virtualTags,
                focusRegion: region,
              });
            }
          });
        }
        return result;
      });
    }

    if (normalizedSearchQuery) {
      items = items.filter(item => {
        const fileName = (item.image.fileName || '').toLowerCase();
        if (fileName.includes(normalizedSearchQuery)) return true;
        return item.tags.some(tag => tag.toLowerCase().includes(normalizedSearchQuery));
      });
    }
    return items;
  }, [folderImages, activeTags, normalizedSearchQuery]);
  const justifiedLayout = useMemo(
    () => buildJustifiedLayout(displayItems, galleryViewportWidth, thumbnailWidth),
    [displayItems, galleryViewportWidth, thumbnailWidth],
  );

  useEffect(() => {
    const target = internalLocate || locateTarget;
    if (!target || handledLocateNonceRef.current === target.nonce) return;

    const hasActiveFilters = activeFolder !== null || activeTags.length > 0 || searchQuery !== '';
    if (hasActiveFilters) {
      setActiveFolder(null);
      setActiveTags([]);
      setSearchQuery('');
      // Wait for layout to recompute on next render cycle with cleared filters
      return;
    }

    if (justifiedLayout.rows.length === 0) {
      // Gallery layout not computed yet (e.g. initial mount or viewport width measurement pending)
      return;
    }

    const rowIndex = justifiedLayout.rows.findIndex(row => row.items.some(item => item.image.id === target.imageId));
    if (rowIndex >= 0) {
      const row = justifiedLayout.rows[rowIndex];
      const performScroll = () => {
        virtuosoRef.current?.scrollToIndex({ index: rowIndex, align: 'center' });
        const scroller = galleryGridRef.current;
        if (scroller && row) {
          const viewportHeight = scroller.clientHeight || 600;
          const targetTop = Math.max(0, row.top - Math.max(0, (viewportHeight - row.height) / 2));
          scroller.scrollTop = targetTop;
        }
      };

      // 立即触发
      performScroll();
      // 下一帧触发（确保 DOM 渲染完成）
      const rafId = requestAnimationFrame(performScroll);
      // 100ms 与 250ms 再次触发（确保视图切换动画完成时对齐）
      const timer1 = window.setTimeout(performScroll, 100);
      const timer2 = window.setTimeout(performScroll, 250);

      setSelectedIds([target.imageId]);
      handledLocateNonceRef.current = target.nonce;
      if (internalLocate) setInternalLocate(null);
      onLocateHandled?.();
      return () => {
        cancelAnimationFrame(rafId);
        window.clearTimeout(timer1);
        window.clearTimeout(timer2);
      };
    } else {
      const existsInImages = images.some(img => img.id === target.imageId);
      if (!existsInImages && !isScanning) {
        // Image definitely does not exist in library, dismiss target
        handledLocateNonceRef.current = target.nonce;
        if (internalLocate) setInternalLocate(null);
        onLocateHandled?.();
      }
    }
  }, [internalLocate, locateTarget, justifiedLayout, activeFolder, activeTags, searchQuery, images, isScanning, onLocateHandled]);
  const syncVisibleRows = useCallback(() => {
    const scroller = galleryGridRef.current;
    const rows = justifiedLayout.rows;
    if (!scroller || rows.length === 0) {
      setVisibleRows(current => current.start === 0 && current.end === 0 && current.center === 0
        ? current
        : { start: 0, end: 0, center: 0 });
      return;
    }

    const viewportTop = scroller.scrollTop;
    const viewportBottom = viewportTop + scroller.clientHeight;
    let low = 0;
    let high = rows.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const rowBottom = rows[middle].top + rows[middle].height + GALLERY_GAP;
      if (rowBottom < viewportTop) low = middle + 1;
      else high = middle;
    }
    const start = low;

    low = start;
    high = rows.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (rows[middle].top > viewportBottom) high = middle - 1;
      else low = middle;
    }
    const end = low;
    const viewportCenter = viewportTop + scroller.clientHeight / 2;
    let center = start;
    for (let index = start + 1; index <= end; index += 1) {
      const previousDistance = Math.abs(rows[center].top + rows[center].height / 2 - viewportCenter);
      const nextDistance = Math.abs(rows[index].top + rows[index].height / 2 - viewportCenter);
      if (nextDistance < previousDistance) center = index;
    }
    setVisibleRows(current => current.start === start && current.end === end && current.center === center
      ? current
      : { start, end, center });
  }, [justifiedLayout.rows]);

  useEffect(() => {
    syncVisibleRows();
  }, [galleryScroller, syncVisibleRows]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedImages = useMemo(() => {
    const targetImageIds = new Set(selectedIds.map(id => id.split(FOCUS_ID_SEPARATOR)[0]));
    return images.filter(img => targetImageIds.has(img.id));
  }, [images, selectedIds]);

  const importPaths = async (directory: boolean) => {
    setShowImportMenu(false);
    try {
      const selected = await open(directory ? {
        directory: true,
        multiple: false,
        title: '选择图片文件夹',
      } : {
        multiple: true,
        title: '选择图片',
        filters: [{ name: '图片', extensions: ['png', 'jpeg', 'jpg', 'webp', 'bmp'] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      setIsImporting(true);
      const imported = await invoke<LibraryFile[]>('import_library_paths', { sourcePaths: paths });
      const records: ImageRecord[] = imported.map(file => ({
        id: pathId(file.path),
        url: convertFileSrc(file.path),
        thumbnailUrl: file.thumbnailPath ? convertFileSrc(file.thumbnailPath) : undefined,
        sourcePath: file.path,
        libraryRelativePath: file.relativePath,
        fileName: file.fileName,
        fileSize: file.fileSize,
        modifiedAt: file.modifiedAt,
        pixelWidth: file.pixelWidth,
        pixelHeight: file.pixelHeight,
        tagStatus: 'pending',
        tags: [],
        practice_count: 0,
        favorite: false,
        hidden: false,
        skip_count: 0,
      }));
      upsertImages(records);
      setNotice(`已导入 ${records.length} 张图片，正在分析素材内容`);
      void startImageLocalization(records);
    } catch (error) {
      setNotice(`导入失败：${String(error)}`);
    } finally {
      setIsImporting(false);
    }
  };

  const tagPendingImages = () => {
    setNotice(null);
    void startImageTagging(pendingImages);
  };

  const locatePendingImages = () => {
    setNotice(null);
    void startImageLocalization(pendingPoseImages);
  };

  const routeImageContent = (image: ImageRecord, scope: ManualContentRoute, preferredTags = image.tags) => {
    const contentRouting = {
      modelVersion: CONTENT_ROUTER_VERSION,
      evidence: {
        personCount: 0,
        maxPersonArea: 0,
        unionPersonArea: 0,
        centerScore: 0,
        poseDetected: false,
        personBoxes: [],
      },
      ...image.contentRouting,
      scope,
      confidence: 1,
      manuallyCorrected: true,
    };
    const tags = scope === 'general_reference'
      ? ['综合参考']
      : preferredTags.filter(tag => !GENERAL_REFERENCE_TAGS.has(tag));
    const routedImage: ImageRecord = {
      ...image,
      tags,
      tagStatus: 'pending',
      tagError: undefined,
      poseAnalysis: undefined,
      visualAnalysis: undefined,
      contentRouting,
    };
    upsertImages([routedImage]);
    setEditingImage(null);
    setEditingFocusRegion(undefined);
    void startImageLocalization([routedImage]);
    if (scope === 'human_dominant') void startImageTagging([routedImage]);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(current => current.includes(id)
      ? current.filter(selectedId => selectedId !== id)
      : [...current, id]);
  };

  const stopMarqueeAutoScroll = () => {
    if (marqueeScrollFrameRef.current !== null) {
      cancelAnimationFrame(marqueeScrollFrameRef.current);
      marqueeScrollFrameRef.current = null;
    }
  };

  const updateMarqueeAt = (clientX: number, clientY: number) => {
    const start = selectionStartRef.current;
    const grid = galleryGridRef.current;
    if (!start || !grid) return;
    start.lastClientX = clientX;
    start.lastClientY = clientY;
    if (!start.active && Math.hypot(clientX - start.startClientX, clientY - start.startClientY) < 5) return;
    if (!start.active) {
      start.active = true;
      suppressCardClickRef.current = start.startedOnCard;
      if (start.initialIds.length === 0) setSelectedIds([]);
    }
    const bounds = grid.getBoundingClientRect();

    // 1. 计算选框在内容画卷（Content Canvas）中的绝对坐标
    const startContentX = start.startClientX - bounds.left + start.startScrollLeft;
    const startContentY = start.startClientY - bounds.top + start.startScrollTop;
    const currentContentX = clientX - bounds.left + grid.scrollLeft;
    const currentContentY = clientY - bounds.top + grid.scrollTop;

    const contentMinX = Math.min(startContentX, currentContentX);
    const contentMaxX = Math.max(startContentX, currentContentX);
    const contentMinY = Math.min(startContentY, currentContentY);
    const contentMaxY = Math.max(startContentY, currentContentY);

    // 2. 映射回当前可视容器（galleryViewportRef）的视觉渲染矩形
    // 随滚动移出视口时，visualTop 为负数，顶边自然滑出屏幕顶部（牢牢钉在原位）！
    const visualLeft = contentMinX - grid.scrollLeft;
    const visualTop = contentMinY - grid.scrollTop;
    const visualWidth = contentMaxX - contentMinX;
    const visualHeight = contentMaxY - contentMinY;

    const nextBox = {
      left: visualLeft,
      top: visualTop,
      width: visualWidth,
      height: visualHeight,
    };

    setSelectionBox(prev => (
      prev && prev.left === nextBox.left && prev.top === nextBox.top && prev.width === nextBox.width && prev.height === nextBox.height
        ? prev
        : nextBox
    ));

    // 3. 计算选框在当前屏幕可视区域内的有效相交物理矩形（Client 坐标）
    // 既实现选框顶边钉在内容上，又保证视口内的 DOM 碰撞判定 100% 绝对精准！
    const visibleClientLeft = bounds.left + Math.max(0, visualLeft);
    const visibleClientTop = bounds.top + Math.max(0, visualTop);
    const visibleClientRight = bounds.left + Math.min(bounds.width, visualLeft + visualWidth);
    const visibleClientBottom = bounds.top + Math.min(bounds.height, visualTop + visualHeight);

    const visibleHits: string[] = [];
    if (visibleClientRight > visibleClientLeft && visibleClientBottom > visibleClientTop) {
      grid.querySelectorAll<HTMLElement>('[data-library-card]').forEach(card => {
        const r = card.getBoundingClientRect();
        if (r.left < visibleClientRight && r.right > visibleClientLeft && r.top < visibleClientBottom && r.bottom > visibleClientTop) {
          const id = card.dataset.libraryItemId;
          if (id) visibleHits.push(id);
        }
      });
    }

    const hasScrolled = Math.abs(grid.scrollTop - start.startScrollTop) > 3;
    if (hasScrolled) {
      // 跨屏滚动时：持续累加所有曾被选框扫过的图片，避免 DOM 卸载导致选区丢失
      visibleHits.forEach(id => start.sessionHits.add(id));
      const nextSelected = Array.from(new Set([...start.initialIds, ...start.sessionHits, ...visibleHits]));
      setSelectedIds(prev => (
        prev.length === nextSelected.length && prev.every((id, index) => id === nextSelected[index])
          ? prev
          : nextSelected
      ));
    } else {
      // 单屏内未滚动时：支持自由拉大/缩小选框
      start.sessionHits.clear();
      visibleHits.forEach(id => start.sessionHits.add(id));
      const nextSelected = Array.from(new Set([...start.initialIds, ...visibleHits]));
      setSelectedIds(prev => (
        prev.length === nextSelected.length && prev.every((id, index) => id === nextSelected[index])
          ? prev
          : nextSelected
      ));
    }
  };

  const startMarqueeAutoScroll = () => {
    if (marqueeScrollFrameRef.current !== null) return;
    const tick = () => {
      const start = selectionStartRef.current;
      const grid = galleryGridRef.current;
      if (!start?.active || !grid) {
        marqueeScrollFrameRef.current = null;
        return;
      }
      const bounds = grid.getBoundingClientRect();
      const edge = 42;
      const topDistance = start.lastClientY - bounds.top;
      const bottomDistance = bounds.bottom - start.lastClientY;
      const delta = topDistance < edge
        ? -Math.ceil((edge - topDistance) / 5)
        : bottomDistance < edge
          ? Math.ceil((edge - bottomDistance) / 5)
          : 0;
      if (delta !== 0) {
        const previousScrollTop = grid.scrollTop;
        grid.scrollTop += delta;
        if (grid.scrollTop !== previousScrollTop) {
          updateMarqueeAt(start.lastClientX, start.lastClientY);
        }
      }
      marqueeScrollFrameRef.current = requestAnimationFrame(tick);
    };
    marqueeScrollFrameRef.current = requestAnimationFrame(tick);
  };

  const beginMarqueeSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('[data-library-action]')) return;
    const grid = galleryGridRef.current;
    if (!grid) return;
    const preserveSelection = event.ctrlKey || event.metaKey || event.shiftKey;
    const startedCard = (event.target as HTMLElement).closest<HTMLElement>('[data-library-card]');
    selectionStartRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollTop: grid.scrollTop,
      startScrollLeft: grid.scrollLeft,
      initialIds: preserveSelection ? selectedIds : [],
      sessionHits: new Set<string>(),
      active: false,
      startedOnCard: Boolean(startedCard),
      startedItemId: startedCard?.dataset.libraryItemId || null,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    if (!startedCard) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const updateMarqueeSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = selectionStartRef.current;
    const grid = galleryGridRef.current;
    if (!start || !grid) return;
    if ((event.buttons & 1) === 0) {
      selectionStartRef.current = null;
      setSelectionBox(null);
      stopMarqueeAutoScroll();
      return;
    }
    if (!start.active) {
      if (Math.hypot(event.clientX - start.startClientX, event.clientY - start.startClientY) >= 5) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }
    updateMarqueeAt(event.clientX, event.clientY);
    if (selectionStartRef.current?.active) startMarqueeAutoScroll();
  };

  const endMarqueeSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = selectionStartRef.current;
    if (!start) return;
    if (start.active) {
      suppressCardClickRef.current = true;
    } else if (!start.startedOnCard && start.initialIds.length === 0) {
      setSelectedIds([]);
    }
    selectionStartRef.current = null;
    setSelectionBox(null);
    stopMarqueeAutoScroll();
    if (start.active) {
      window.setTimeout(() => { suppressCardClickRef.current = false; }, 50);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const startSelectedPractice = () => {
    const parsedMinutes = Number(practiceMinutes);
    const minutes = (!isNaN(parsedMinutes) && parsedMinutes > 0) ? parsedMinutes : 1;
    const practiceItems = selectedIds.map(id => {
      const [imageId, focusRegionId] = id.split(FOCUS_ID_SEPARATOR);
      return { imageId, focusRegionId };
    });
    onStart({
      practiceItems,
      includeTags: [],
      excludeTags: [],
      sessionType: 'single',
      singleTimeSec: Math.round(minutes * 60),
      imageCount: selectedIds.length,
      randomize: false,
      preparationSec: settings.preparationSec,
      transitionSec: settings.transitionSec,
    });
  };

  const clearImageTags = (image: ImageRecord) => {
    setConfirmConfig({
      isOpen: true,
      title: '清除图片标签',
      description: `确定清空“${image.fileName || '这张图片'}”的标签吗？姿势与切片定位将被保留。`,
      confirmText: '清除标签',
      cancelText: '取消',
      type: 'warning',
      onConfirm: () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        upsertImages([{
          ...image,
          tags: [],
          tagStatus: 'pending',
          tagError: undefined,
        }]);
        setEditingImage(null);
        setEditingFocusRegion(undefined);
        setNotice(`已清除 ${image.fileName || '图片'} 的标签数据`);
      },
    });
  };

  const clearImageLocalization = (image: ImageRecord) => {
    setConfirmConfig({
      isOpen: true,
      title: '清除图片定位',
      description: `确定清空“${image.fileName || '这张图片'}”的姿势与局部切片吗？分类标签将被保留。`,
      confirmText: '清除定位',
      cancelText: '取消',
      type: 'warning',
      onConfirm: () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        upsertImages([{
          ...image,
          poseAnalysis: undefined,
          contentRouting: undefined,
          visualAnalysis: undefined,
        }]);
        setSelectedIds(current => current.filter(id => !id.startsWith(`${image.id}${FOCUS_ID_SEPARATOR}`)));
        setEditingImage(null);
        setEditingFocusRegion(undefined);
        setNotice(`已清除 ${image.fileName || '图片'} 的定位数据`);
      },
    });
  };

  const clearBatchTags = (imagesToClear: ImageRecord[]) => {
    if (imagesToClear.length === 0) return;
    setConfirmConfig({
      isOpen: true,
      title: `批量清除 ${imagesToClear.length} 张图片的标签`,
      description: `确定清除已选 ${imagesToClear.length} 张图片的标签吗？姿势与切片定位将被保留。`,
      confirmText: `清除标签 (${imagesToClear.length} 张)`,
      cancelText: '取消',
      type: 'warning',
      onConfirm: () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        const updated = imagesToClear.map(image => ({
          ...image,
          tags: [],
          tagStatus: 'pending' as const,
          tagError: undefined,
        }));
        upsertImages(updated);
        setIsBatchEditing(false);
        setNotice(`已清除 ${imagesToClear.length} 张图片的标签`);
      },
    });
  };

  const clearBatchLocalization = (imagesToClear: ImageRecord[]) => {
    if (imagesToClear.length === 0) return;
    setConfirmConfig({
      isOpen: true,
      title: `批量清除 ${imagesToClear.length} 张图片的定位`,
      description: `确定清除已选 ${imagesToClear.length} 张图片的姿势与局部切片吗？分类标签将被保留。`,
      confirmText: `清除定位 (${imagesToClear.length} 张)`,
      cancelText: '取消',
      type: 'warning',
      onConfirm: () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        const updated = imagesToClear.map(image => ({
          ...image,
          poseAnalysis: undefined,
          contentRouting: undefined,
          visualAnalysis: undefined,
        }));
        upsertImages(updated);
        setIsBatchEditing(false);
        setNotice(`已清除 ${imagesToClear.length} 张图片的定位数据`);
      },
    });
  };

  const removeLibraryImage = (image: ImageRecord) => {
    setConfirmConfig({
      isOpen: true,
      title: '移除照片',
      description: `确定从图库中移除“${image.fileName || '这张图片'}”吗？本地文件将被永久删除。`,
      confirmText: '确认移除',
      cancelText: '取消',
      type: 'danger',
      onConfirm: async () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        try {
          if (image.sourcePath) {
            await invoke('remove_library_image', { imagePath: image.sourcePath });
          }
          removeImage(image.id);
          setSelectedIds(current => current.filter(id => !id.startsWith(image.id)));
          setEditingImage(null);
          setEditingFocusRegion(undefined);
          setNotice(`已移除 ${image.fileName || '图片'}`);
        } catch (error) {
          setNotice(String(error));
        }
      },
    });
  };

  const removeBatchImages = (imagesToRemove: ImageRecord[]) => {
    if (imagesToRemove.length === 0) return;
    setConfirmConfig({
      isOpen: true,
      title: `批量移除 ${imagesToRemove.length} 张照片`,
      description: `确定从图库中移除已选 ${imagesToRemove.length} 张图片吗？本地文件将被永久删除。`,
      confirmText: `永久移除 (${imagesToRemove.length} 张)`,
      cancelText: '取消',
      type: 'danger',
      onConfirm: async () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        try {
          const validPaths = imagesToRemove.map(img => img.sourcePath).filter(Boolean) as string[];
          if (validPaths.length > 0) {
            await invoke('remove_library_images', { imagePaths: validPaths });
          }
          const idsToRemove = imagesToRemove.map(img => img.id);
          removeImages(idsToRemove);
          setSelectedIds([]);
          setIsBatchEditing(false);
          setNotice(`已移除 ${imagesToRemove.length} 张图片`);
        } catch (error) {
          setNotice(`移除失败：${String(error)}`);
        }
      },
    });
  };

  const viewOriginalImage = (image: ImageRecord) => {
    setEditingImage(null);
    setEditingFocusRegion(undefined);
    setPreviewZoomItem({ image, focusRegion: undefined });
  };

  const locateOriginalImage = (image: ImageRecord) => {
    setEditingImage(null);
    setEditingFocusRegion(undefined);
    setActiveFolder(null);
    setActiveTags([]);
    setSearchQuery('');
    setInternalLocate({ imageId: image.id, nonce: Date.now() });
  };

  useEffect(() => {
    if (!previewZoomItem) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewZoomItem(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewZoomItem]);

  return (
    <div className="relative px-5 pt-5 pb-5 flex flex-col h-full overflow-hidden">
      <header className="shrink-0 space-y-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 max-w-[130px] shrink whitespace-nowrap max-[390px]:max-w-[90px]">
            <h1 className="whitespace-nowrap text-2xl font-bold tracking-tight max-[390px]:text-xl">图库</h1>
            <p className="truncate whitespace-nowrap text-[10px] font-medium text-stone-500 dark:text-white/50">
              {activeFolderName} · {displayItems.length} 个素材{selectedIds.length > 0 ? ` · 已选 ${selectedIds.length} 个` : ''}
            </p>
          </div>
          <div className="min-w-0 flex-1 pb-1">
          <div className="flex w-full items-center justify-end gap-1">
            <button
              onClick={syncLibrary}
              disabled={isScanning}
              title="重新扫描图库"
              aria-label="重新扫描图库"
              className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-black/5 bg-black/[0.03] text-stone-500 transition-colors hover:bg-black/[0.06] disabled:opacity-40 dark:border-white/5 dark:bg-white/[0.05] dark:hover:bg-white/[0.1]"
            >
              <RefreshCw size={12} className={isScanning ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={taggingTask.running ? stopImageTagging : tagPendingImages}
              disabled={!taggingTask.running && pendingImages.length === 0}
              title={taggingTask.running ? '停止本次自动打标' : pendingImages.length > 0 ? `当前图包有 ${pendingImages.length} 张图片等待自动打标` : '当前图包没有待打标图片'}
              aria-label={taggingTask.running ? '停止自动打标签' : '自动打标签'}
              className={`flex h-8 min-w-8 shrink items-center justify-center gap-1 rounded-lg border border-amber-300/60 bg-amber-50/80 text-[9px] font-bold text-amber-900 transition-all disabled:opacity-40 dark:border-amber-700/40 dark:bg-amber-950/20 dark:text-amber-200 ${taggingTask.running || pendingImages.length > 0 ? 'px-2 max-[520px]:px-0' : 'w-8'}`}
            >
              {taggingTask.running ? <X size={12} /> : <Tags size={12} />}
              {taggingTask.running
                ? <span className="whitespace-nowrap max-[520px]:hidden">{taggingTask.current}/{taggingTask.total} · 停止</span>
                : pendingImages.length > 0 && <span className="whitespace-nowrap max-[520px]:hidden">{pendingImages.length} 未打标</span>}
            </button>
            <button
              onClick={localizationTask.running ? stopImageLocalization : locatePendingImages}
              disabled={!localizationTask.running && pendingPoseImages.length === 0}
              title={localizationTask.running ? '停止本次素材分析' : pendingPoseImages.length > 0 ? `当前图包有 ${pendingPoseImages.length} 张图片等待素材分析` : '当前图包没有待分析图片'}
              aria-label={localizationTask.running ? '停止素材分析' : '分析素材内容'}
              className={`flex h-8 min-w-8 shrink items-center justify-center gap-1 rounded-lg border border-sky-300/60 bg-sky-50/80 text-[9px] font-bold text-sky-900 transition-all disabled:opacity-40 dark:border-sky-700/40 dark:bg-sky-950/20 dark:text-sky-200 ${localizationTask.running || pendingPoseImages.length > 0 ? 'px-2 max-[520px]:px-0' : 'w-8'}`}
            >
              {localizationTask.running ? <X size={12} /> : <Crosshair size={12} />}
              {localizationTask.running
                ? <span className="whitespace-nowrap max-[520px]:hidden">{localizationTask.current}/{localizationTask.total} · 停止</span>
                : pendingPoseImages.length > 0 && <span className="whitespace-nowrap max-[520px]:hidden">{pendingPoseImages.length} 未分析</span>}
            </button>
            <div className="relative shrink-0">
              <button
                onClick={() => setShowImportMenu(value => !value)}
                disabled={isImporting}
                className="flex h-8 min-w-8 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-black px-2 text-[11px] font-bold text-white disabled:opacity-50 dark:bg-white dark:text-black max-[420px]:px-0"
              >
                {isImporting ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                <span className="max-[420px]:hidden">导入</span>
                <ChevronDown size={11} className="max-[420px]:hidden" />
              </button>
              <AnimatePresence>
                {showImportMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="absolute right-0 top-10 z-30 w-32 p-1.5 rounded-xl bg-white/95 dark:bg-zinc-800/95 backdrop-blur-xl border border-black/5 dark:border-white/10 shadow-xl"
                  >
                    <button onClick={() => importPaths(false)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] font-medium hover:bg-black/5 dark:hover:bg-white/10">
                      <ImagePlus size={13} /> 多选图片
                    </button>
                    <button onClick={() => importPaths(true)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] font-medium hover:bg-black/5 dark:hover:bg-white/10">
                      <FolderOpen size={13} /> 整个文件夹
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          </div>
        </div>

        {(() => {
          const currentTaskError = taggingTask.running
            ? taggingTask.error
            : localizationTask.running ? localizationTask.error : taggingTask.error || localizationTask.error;
          const currentTaskMsg = taggingTask.running
            ? taggingTask.message
            : localizationTask.running ? localizationTask.message : taggingTask.message || localizationTask.message;
          const activeNotice = notice
            || (currentTaskError && !dismissedMessages.has(currentTaskError) ? currentTaskError : null)
            || (currentTaskMsg && !dismissedMessages.has(currentTaskMsg) ? currentTaskMsg : null);
          if (!activeNotice) return null;
          return (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 text-[10px] text-stone-600 dark:text-zinc-300">
              <span className="flex-1 leading-relaxed">{activeNotice}</span>
              <button
                onClick={() => {
                  setNotice(null);
                  if (currentTaskError) setDismissedMessages(prev => new Set(prev).add(currentTaskError));
                  if (currentTaskMsg) setDismissedMessages(prev => new Set(prev).add(currentTaskMsg));
                }}
                className="shrink-0 p-0.5 hover:opacity-70 cursor-pointer"
                aria-label="关闭提示"
              >
                <X size={12} />
              </button>
            </div>
          );
        })()}

        <div className="min-w-0">
          <div className="flex w-full min-w-0 items-center gap-1">
            <button
              onClick={() => { setShowFolders(value => !value); setShowFilters(false); }}
              className={`flex h-7 min-w-0 max-w-[100px] shrink items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[10px] font-bold transition-colors ${showFolders || activeFolder ? 'bg-stone-800 dark:bg-zinc-100 text-white dark:text-zinc-900' : 'bg-black/5 dark:bg-white/5 text-stone-500'}`}
            >
              <FolderTree size={12} className="shrink-0" />
              <span className="truncate">{activeFolderName}</span>
              {showFolders ? <ChevronDown size={10} className="shrink-0" /> : <ChevronRight size={10} className="shrink-0" />}
            </button>
            <button
              onClick={() => { setShowFilters(value => !value); setShowFolders(false); }}
              className={`flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[10px] font-bold transition-colors ${showFilters || activeTags.length > 0 ? 'bg-stone-800 dark:bg-zinc-100 text-white dark:text-zinc-900' : 'bg-black/5 dark:bg-white/5 text-stone-500'}`}
            >
              <Tags size={12} /> 筛选{activeTags.length > 0 ? ` · ${activeTags.length}` : ''}
            </button>
            <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-lg border border-black/5 bg-black/[0.03] px-2 dark:border-white/5 dark:bg-white/[0.05]">
              <Search size={12} className="shrink-0 text-stone-400" />
              <input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="搜索文件名 / 标签"
                className="min-w-0 flex-1 bg-transparent text-[10px] font-medium text-stone-700 placeholder:text-stone-400 focus:outline-none dark:text-zinc-200 dark:placeholder:text-zinc-500"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="shrink-0 text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200" aria-label="清除搜索">
                  <X size={11} />
                </button>
              )}
            </div>
            <ThumbnailSizeControl
              value={thumbnailWidth}
              onChange={value => updateSettings({ libraryThumbnailWidth: value })}
            />
          </div>
          {activeTags.length > 0 && (
            <div className="mt-1.5 flex min-w-0 flex-wrap gap-1 overflow-hidden">
              {activeTags.map(tag => (
                <button key={tag} onClick={() => removeFilterTag(tag)} className="flex h-6 items-center gap-1 rounded-md border border-white/80 bg-white px-2 text-[9px] font-medium text-stone-900 shadow-[0_0_12px_rgba(255,255,255,0.9),0_2px_6px_rgba(0,0,0,0.08)] dark:border-white/10 dark:bg-zinc-700 dark:text-zinc-100 dark:shadow-[0_0_12px_rgba(255,255,255,0.15)]">
                  {tag}<X size={9} />
                </button>
              ))}
            </div>
          )}
          <AnimatePresence>
            {showFolders && (
              <FolderList
                folders={libraryFolders}
                selected={activeFolder}
                total={images.length}
                onSelect={folder => { setActiveFolder(folder); setSelectedIds([]); }}
              />
            )}
            {showFilters && (
              <TagCategoryList selected={activeTags} onToggle={toggleFilterTag} customTagGroups={settings.customTagGroups} />
            )}
          </AnimatePresence>
        </div>
      </header>

      <div ref={galleryViewportRef} className="relative flex-1 min-h-0 mt-3 overflow-hidden">
        {isScanning && images.length === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-stone-400 dark:text-zinc-500">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-[10px] font-medium">正在读取图库…</span>
          </div>
        )}
        <Virtuoso
          ref={virtuosoRef}
          data={justifiedLayout.rows}
          computeItemKey={(_, row) => row.items.map(item => item.id).join('|')}
          defaultItemHeight={thumbnailWidth + GALLERY_GAP}
          increaseViewportBy={{ top: 280, bottom: 480 }}
          overscan={{ main: 240, reverse: 160 }}
          scrollerRef={setGalleryScrollerRef}
          onPointerDown={beginMarqueeSelection}
          onPointerMove={updateMarqueeSelection}
          onPointerUp={endMarqueeSelection}
          onPointerCancel={endMarqueeSelection}
          onScroll={() => {
            syncVisibleRows();
            const start = selectionStartRef.current;
            if (start?.active) updateMarqueeAt(start.lastClientX, start.lastClientY);
          }}
          onClickCapture={event => {
            if (!suppressCardClickRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            suppressCardClickRef.current = false;
          }}
          className="absolute inset-0 w-full max-w-full overflow-x-hidden overscroll-contain select-none touch-pan-y [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          itemContent={(rowIndex, row) => (
            <div className="flex w-full max-w-full overflow-hidden" style={{ height: row.height + GALLERY_GAP, gap: GALLERY_GAP, paddingBottom: GALLERY_GAP }}>
              {row.items.map((item, itemIndex) => (
                <div key={item.id} className="h-full min-w-0" style={{ width: item.width, height: row.height, flex: '0 0 auto' }}>
                  <ImageCard
                    itemId={item.id}
                    image={item.image}
                    tags={item.tags}
                    focusRegion={item.focusRegion}
                    thumbnailPriority={
                      Math.abs(rowIndex - visibleRows.center) * 100
                      + Math.abs(itemIndex - (row.items.length - 1) / 2)
                    }
                    useSourceFallback={rowIndex >= visibleRows.start && rowIndex <= visibleRows.end}
                    onThumbnailChange={url => updateImageThumbnail(item.image.id, url)}
                    selected={selectedIdSet.has(item.id)}
                    onSelect={() => toggleSelection(item.id)}
                    onPreview={() => setPreviewZoomItem({ image: item.image, focusRegion: item.focusRegion })}
                    onEdit={() => {
                      if (selectedIds.length > 1 && selectedIdSet.has(item.id)) {
                        setIsBatchEditing(true);
                      } else {
                        setEditingImage(item.image);
                        setEditingFocusRegion(item.focusRegion);
                      }
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        />
        <GalleryScrollbar
          scroller={galleryScroller}
          contentKey={`${justifiedLayout.rows.length}:${justifiedLayout.rows.at(-1)?.top || 0}:${justifiedLayout.rows.at(-1)?.height || 0}`}
        />
        {selectionBox && (
          <div
            className="absolute z-30 pointer-events-none rounded-sm border border-stone-700/70 dark:border-white/70 bg-stone-500/10 dark:bg-white/10"
            style={selectionBox}
          />
        )}
      </div>

      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
            className="absolute left-4 right-4 bottom-3 z-20 flex items-center gap-2 p-2 rounded-2xl bg-zinc-900/95 dark:bg-zinc-100/95 backdrop-blur-xl text-white dark:text-zinc-900 shadow-2xl"
          >
            <button onClick={() => setSelectedIds([])} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 dark:bg-black/5 hover:bg-white/20 dark:hover:bg-black/10 transition-colors"><X size={13} /></button>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold">已选 {selectedIds.length} 张</div>
              <div className="text-[8px] opacity-60">按选择顺序练习</div>
            </div>
            <button
              onClick={() => setIsBatchEditing(true)}
              className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg bg-white/15 dark:bg-black/10 text-[10px] font-bold hover:bg-white/25 dark:hover:bg-black/15 transition-colors cursor-pointer"
              title="批量编辑标签"
            >
              <Tags size={12} />
              <span>编辑标签</span>
            </button>
            <label className="h-7 flex items-center gap-1 px-2 rounded-lg bg-white/10 dark:bg-black/5 text-[9px]">
              <input
                type="number" min={0} step={0.5} value={practiceMinutes}
                onChange={event => setPracticeMinutes(event.target.value)}
                className="w-8 bg-transparent text-center font-bold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
              分/张
            </label>
            <button onClick={startSelectedPractice} className="h-7 flex items-center gap-1.5 px-3 rounded-lg bg-white dark:bg-zinc-900 text-black dark:text-white text-[10px] font-bold">
              <Play size={11} fill="currentColor" /> 练习
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isBatchEditing && selectedImages.length > 0 && (
          <BatchTagEditor
            images={selectedImages}
            customTagGroups={settings.customTagGroups || []}
            onClose={() => setIsBatchEditing(false)}
            onClearTags={() => clearBatchTags(selectedImages)}
            onClearLocalization={() => clearBatchLocalization(selectedImages)}
            onRemoveImages={() => removeBatchImages(selectedImages)}
            onApply={(tagsToAdd, tagsToRemove) => {
              if (tagsToAdd.length === 0 && tagsToRemove.length === 0) {
                setIsBatchEditing(false);
                return;
              }
              const updatedList: ImageRecord[] = [];
              selectedImages.forEach(img => {
                const nextTags = Array.from(
                  new Set(
                    img.tags
                      .filter(t => !tagsToRemove.includes(t))
                      .concat(tagsToAdd)
                  )
                );
                updateImageTags(img.id, nextTags);
                updatedList.push({
                  ...img,
                  tags: nextTags,
                  tagStatus: 'tagged',
                  tagError: undefined,
                });
              });
              upsertImages(updatedList);
              setIsBatchEditing(false);
              setNotice(`已批量更新 ${selectedImages.length} 张图片的标签`);
              window.setTimeout(() => setNotice(null), 2500);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingImage && (
          <TagEditor
            image={editingImage}
            focusRegion={editingFocusRegion}
            customTagGroups={settings.customTagGroups || []}
            onClose={() => { setEditingImage(null); setEditingFocusRegion(undefined); }}
            onRoute={scope => routeImageContent(editingImage, scope)}
            onSave={tags => {
              const selectedScope = tags.includes('综合参考')
                ? 'general_reference'
                : tags.some(tag => tag === '完整人物' || tag === '人体局部')
                  ? 'human_dominant'
                  : undefined;
              if (selectedScope && selectedScope !== editingImage.contentRouting?.scope) {
                routeImageContent(editingImage, selectedScope, tags);
                return;
              }
              const contentRouting = selectedScope
                ? {
                  modelVersion: CONTENT_ROUTER_VERSION,
                  evidence: {
                    personCount: 0,
                    maxPersonArea: 0,
                    unionPersonArea: 0,
                    centerScore: 0,
                    poseDetected: false,
                    personBoxes: [],
                  },
                  ...editingImage.contentRouting,
                  scope: selectedScope,
                  confidence: 1,
                  manuallyCorrected: true,
                }
                : editingImage.contentRouting;
              updateImageTags(editingImage.id, tags);
              upsertImages([{ ...editingImage, tags, contentRouting, tagStatus: 'tagged', tagError: undefined }]);
              setEditingImage(null);
              setEditingFocusRegion(undefined);
            }}
            onClearTags={() => clearImageTags(editingImage)}
            onClearLocalization={() => clearImageLocalization(editingImage)}
            onRemove={() => removeLibraryImage(editingImage)}
            onViewOriginal={() => viewOriginalImage(editingImage)}
            onLocateOriginal={() => locateOriginalImage(editingImage)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {previewZoomItem && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 sm:p-10 cursor-default select-none"
            onClick={() => setPreviewZoomItem(null)}
          >
            {/* 精简小巧的悬浮关闭按钮 */}
            <button 
              type="button"
              className="absolute top-4 right-4 z-20 w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white/80 hover:text-white rounded-full backdrop-blur-md transition-all hover:scale-105 active:scale-95 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setPreviewZoomItem(null);
              }}
              aria-label="关闭预览"
              title="关闭 (Esc / 单击任意处)"
            >
              <X size={16} strokeWidth={2.2} />
            </button>

            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.1 }}
              style={
                previewZoomItem.focusRegion
                  ? {
                      aspectRatio: `${getRegionAspectRatio(previewZoomItem.image, previewZoomItem.focusRegion)}`,
                      maxHeight: '88vh',
                      maxWidth: '88vw',
                    }
                  : undefined
              }
              className={`relative flex items-center justify-center overflow-hidden rounded-2xl cursor-default ${
                previewZoomItem.focusRegion
                  ? 'w-[85vw] max-w-[700px] bg-zinc-950 shadow-2xl'
                  : 'max-w-[90vw] max-h-[90vh]'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {previewZoomItem.focusRegion ? (
                <FocusedPracticeImage
                  image={previewZoomItem.image}
                  region={previewZoomItem.focusRegion}
                  flipped={false}
                  grayscale={false}
                />
              ) : (
                <img
                  src={previewZoomItem.image.url}
                  className="max-w-[90vw] max-h-[90vh] w-auto h-auto object-contain rounded-2xl shadow-2xl pointer-events-none"
                  alt={previewZoomItem.image.fileName || ''}
                />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        description={confirmConfig.description}
        confirmText={confirmConfig.confirmText}
        cancelText={confirmConfig.cancelText}
        type={confirmConfig.type}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

const ThumbnailSizeControl = ({ value, onChange }: { value: number; onChange: (value: number) => void }) => {
  const setValue = (next: number) => onChange(Math.min(174, Math.max(76, next)));
  return (
    <div className="flex h-7 min-w-0 shrink items-center gap-1 px-1 rounded-lg bg-black/[0.035] text-stone-500 dark:bg-white/[0.05] dark:text-zinc-400" title="调整图库行高">
      <button onClick={() => setValue(value - 14)} className="w-4 h-5 flex items-center justify-center hover:text-stone-900 dark:hover:text-white" aria-label="缩小缩略图">
        <Minus size={11} />
      </button>
      <input
        type="range"
        min={76}
        max={174}
        step={7}
        value={value}
        onChange={event => setValue(Number(event.target.value))}
        className="thumbnail-size-slider w-12 min-w-6 max-[380px]:w-8"
        aria-label="图库缩略图大小"
      />
      <button onClick={() => setValue(value + 14)} className="w-4 h-5 flex items-center justify-center hover:text-stone-900 dark:hover:text-white" aria-label="放大缩略图">
        <Plus size={11} />
      </button>
    </div>
  );
};

const expandableFolderPaths = (folders: LibraryFolder[]) => {
  const paths = new Set(folders.map(folder => folder.path));
  const parents = new Set<string>();
  folders.forEach(folder => {
    if (folder.path.startsWith('__')) return;
    const separator = folder.path.lastIndexOf('/');
    if (separator > 0) {
      const parent = folder.path.slice(0, separator);
      if (paths.has(parent)) parents.add(parent);
    }
  });
  return parents;
};

const FolderList = ({ folders, selected, total, onSelect }: {
  folders: LibraryFolder[];
  selected: string | null;
  total: number;
  onSelect: (folder: string | null) => void;
}) => {
  const expandable = useMemo(() => expandableFolderPaths(folders), [folders]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => expandableFolderPaths(folders));
  const knownExpandable = useRef(new Set(expandable));
  useEffect(() => {
    const newlyExpandable = Array.from(expandable).filter(path => !knownExpandable.current.has(path));
    if (newlyExpandable.length > 0) {
      setCollapsed(current => new Set([...current, ...newlyExpandable]));
      newlyExpandable.forEach(path => knownExpandable.current.add(path));
    }
  }, [expandable]);
  const visibleFolders = useMemo(() => folders.filter(folder => {
    if (folder.path.startsWith('__')) return true;
    const segments = folder.path.split('/');
    return segments.slice(0, -1).every((_, index) => !collapsed.has(segments.slice(0, index + 1).join('/')));
  }), [collapsed, folders]);
  const toggleFolder = (path: string) => {
    setCollapsed(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div
        onWheel={e => e.stopPropagation()}
        className="mt-2 max-h-56 overflow-y-auto p-1.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/5 dark:border-white/5 overscroll-contain [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-black/10 dark:[&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full"
      >
        <div className="flex h-8 items-center gap-1">
          <button
            onClick={() => onSelect(null)}
            className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-[10px] transition-colors ${selected === null ? 'bg-stone-800 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold' : 'text-stone-600 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5'}`}
          >
            <FolderTree size={13} />
            <span className="flex-1 text-left">全部图包</span>
            <span className="text-[9px] opacity-55">{total}</span>
          </button>
          {expandable.size > 0 && (
            <button
              onClick={() => setCollapsed(current => current.size > 0 ? new Set() : new Set(expandable))}
              className="h-7 rounded-md px-2 text-[9px] font-bold text-stone-500 hover:bg-black/5 dark:hover:bg-white/5"
            >
              {collapsed.size > 0 ? '展开' : '折叠'}
            </button>
          )}
        </div>
        {visibleFolders.map(folder => {
          const hasChildren = expandable.has(folder.path);
          const isCollapsed = collapsed.has(folder.path);
          const isSelected = selected === folder.path;
          return (
            <div key={folder.path} style={{ paddingLeft: `${folder.depth * 14}px` }} className={`flex h-8 items-center rounded-lg text-[10px] transition-colors ${isSelected ? 'bg-stone-800 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold' : 'text-stone-600 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5'}`}>
              <button
                onClick={() => hasChildren && toggleFolder(folder.path)}
                disabled={!hasChildren}
                className="flex h-8 w-7 shrink-0 items-center justify-center disabled:opacity-20"
                aria-label={hasChildren ? `${isCollapsed ? '展开' : '折叠'} ${folder.name}` : undefined}
              >
                {hasChildren ? (isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />) : <span className="w-[11px]" />}
              </button>
              <button onClick={() => onSelect(folder.path)} className="flex h-8 min-w-0 flex-1 items-center gap-2 pr-2">
                <Folder size={12} fill="currentColor" className="shrink-0 opacity-55" />
                <span className="flex-1 truncate text-left">{folder.name}</span>
                <span className="text-[9px] opacity-55">{folder.count}</span>
              </button>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};

const TagCategoryList = ({
  selected,
  onToggle,
  customTagGroups = [],
}: {
  selected: string[];
  onToggle: (tag: string) => void;
  customTagGroups?: CustomTagGroup[];
}) => {
  const categories = useMemo(() => [
    ...TAG_CATEGORIES,
    ...(customTagGroups || []).filter(g => g.tags.length > 0).map(g => ({ name: g.name, tags: g.tags })),
  ], [customTagGroups]);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="mt-2 max-h-48 overflow-y-auto p-2.5 space-y-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/5 dark:border-white/5 [&::-webkit-scrollbar]:hidden">
        {categories.map(category => (
          <div key={category.name} className="flex items-start gap-2">
            <div className="w-12 pt-1 text-[9px] font-bold text-stone-500 shrink-0">{category.name}</div>
            <div className="flex flex-wrap gap-1">
              {category.tags.map(tag => (
                <button
                  key={tag}
                  onClick={() => onToggle(tag)}
                  className={`min-w-[34px] rounded-md border px-2 py-1 text-[9px] font-medium transition-colors cursor-pointer ${
                    selected.includes(tag)
                      ? 'border-white/80 bg-white text-stone-900 shadow-[0_0_14px_rgba(255,255,255,0.95),0_2px_8px_rgba(0,0,0,0.10)] dark:border-white/10 dark:bg-zinc-700 dark:text-zinc-100 dark:shadow-[0_0_14px_rgba(255,255,255,0.18)]'
                      : 'border-black/10 bg-white/35 text-stone-600 hover:border-black/25 dark:border-white/10 dark:bg-transparent dark:text-zinc-400 dark:hover:border-white/25'
                  }`}
                >
                  {compactVisualTagLabel(tag)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

const ImageCard: React.FC<{
  itemId: string;
  image: ImageRecord;
  tags: string[];
  focusRegion?: FocusRegion;
  thumbnailPriority: number;
  useSourceFallback: boolean;
  onThumbnailChange: (url?: string) => void;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onEdit: () => void;
}> = ({ itemId, image, tags, focusRegion, thumbnailPriority, useSourceFallback, onThumbnailChange, selected, onSelect, onPreview, onEdit }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const onThumbnailChangeRef = useRef(onThumbnailChange);
  onThumbnailChangeRef.current = onThumbnailChange;
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null);
  const [generatedThumbnail, setGeneratedThumbnail] = useState<{ sourcePath: string; url: string } | null>(null);
  const generatedUrl = generatedThumbnail?.sourcePath === image.sourcePath ? generatedThumbnail.url : null;
  const thumbnailUrl = image.thumbnailUrl || generatedUrl;
  const canUseSource = !image.sourcePath || useSourceFallback || isNearViewport;
  const previewUrl = thumbnailUrl && thumbnailUrl !== failedPreviewUrl
    ? thumbnailUrl
    : canUseSource ? image.url : null;
  const effectiveThumbnailPriority = isNearViewport ? 0 : thumbnailPriority;
  const tagSummary = thumbnailTagSummary(tags, focusRegion, image.tagStatus === 'tagged');

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new IntersectionObserver(([entry]) => {
      setIsNearViewport(entry.isIntersecting);
    }, { rootMargin: '120px 0px', threshold: 0.01 });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (image.thumbnailUrl || !image.sourcePath) return;
    let disposed = false;
    const request = requestThumbnail(image.sourcePath, effectiveThumbnailPriority);
    request.promise
      .then(url => {
        if (!disposed) {
          setFailedPreviewUrl(null);
          setGeneratedThumbnail({ sourcePath: image.sourcePath!, url });
          onThumbnailChangeRef.current(url);
        }
      })
      .catch(error => {
        if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn(`Thumbnail generation failed for ${image.fileName || image.id}:`, error);
        }
      });
    return () => {
      disposed = true;
      request.cancel();
    };
  }, [effectiveThumbnailPriority, image.fileName, image.id, image.sourcePath, image.thumbnailUrl, image.url]);

  const handlePreviewError = () => {
    if (!previewUrl || previewUrl === image.url) return;
    setFailedPreviewUrl(previewUrl);
    setGeneratedThumbnail(null);
    onThumbnailChangeRef.current(undefined);
  };

  return (
  <div ref={cardRef} data-library-card data-library-item-id={itemId} onDragStart={event => event.preventDefault()} className="h-full select-none">
    <GlassCard className={`group/card relative h-full overflow-hidden !rounded-xl border transition-all cursor-pointer ${selected ? '!border-stone-800 dark:!border-white ring-2 ring-stone-800/20 dark:ring-white/20' : 'border-transparent'}`}>
      <button onClick={onPreview} onDragStart={event => event.preventDefault()} title="点击放大预览" className="relative block w-full h-full touch-none select-none text-left bg-stone-200/70 dark:bg-zinc-800">
        {focusRegion
          ? previewUrl
            ? <FocusedPracticeImage image={image} src={previewUrl} region={focusRegion} flipped={false} grayscale={false} quickFade onImageError={handlePreviewError} />
            : <ThumbnailPlaceholder />
          : previewUrl
            ? <FadeInThumbnail src={previewUrl} alt={image.fileName || ''} onError={handlePreviewError} />
            : <ThumbnailPlaceholder />}
      </button>
      <button
        data-library-action
        onClick={event => {
          event.stopPropagation();
          onSelect();
        }}
        title={selected ? "取消选择" : "选择进行练习"}
        className={`absolute top-2 left-2 w-5 h-5 flex items-center justify-center rounded-full border backdrop-blur-md transition-all ${selected ? 'bg-stone-900 dark:bg-white border-transparent text-white dark:text-black opacity-100' : 'bg-black/20 border-white/40 text-white opacity-0 group-hover/card:opacity-100 hover:scale-110'}`}
      >
        {selected && <Check size={11} strokeWidth={3} />}
      </button>
      <button data-library-action onClick={event => { event.stopPropagation(); onEdit(); }} className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-lg bg-black/45 backdrop-blur-md text-white opacity-0 group-hover/card:opacity-100 transition-opacity hover:scale-105" aria-label="编辑标签">
        <Pencil size={11} />
      </button>
      {image.practice_count > 0 && (
        <div className="absolute bottom-2 right-2 z-10 rounded-md bg-black/55 px-1.5 py-0.5 text-[8px] font-bold tabular-nums text-white backdrop-blur-md">
          {image.practice_count} 次
        </div>
      )}
      {(tagSummary || image.tagStatus !== 'tagged') && (
        <div className="absolute inset-x-0 bottom-0 p-2 pt-8 bg-gradient-to-t from-black/70 to-transparent pointer-events-none">
          <div className={`text-[9px] font-medium text-white/90 truncate ${image.practice_count > 0 ? 'pr-10' : ''}`}>
            {tagSummary
              ? tagSummary
              : image.contentRouting?.scope === 'uncertain'
                ? '内容待确认'
                : image.contentRouting?.scope === 'human_dominant'
                  ? '人物主体 · 待补标签'
                  : image.poseAnalysis?.modelVersion === POSE_MODEL_VERSION ? '已定位 · 待补标签' : '待补标签'}
          </div>
        </div>
      )}
    </GlassCard>
  </div>
  );
};

const ThumbnailPlaceholder = () => (
  <div className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-br from-stone-200 via-stone-100 to-stone-200 dark:from-zinc-800 dark:via-zinc-700 dark:to-zinc-800" />
);

const FadeInThumbnail = ({ src, alt, onError }: { src: string; alt: string; onError?: () => void }) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const revealFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setLoaded(false);
    return () => {
      if (revealFrameRef.current !== null) cancelAnimationFrame(revealFrameRef.current);
    };
  }, [src]);

  const reveal = () => {
    if (revealFrameRef.current !== null) cancelAnimationFrame(revealFrameRef.current);
    revealFrameRef.current = requestAnimationFrame(() => {
      revealFrameRef.current = requestAnimationFrame(() => {
        setLoaded(true);
        revealFrameRef.current = null;
      });
    });
  };

  useEffect(() => {
    const element = imageRef.current;
    if (!element) return;
    let disposed = false;
    const accept = () => {
      if (!disposed && element.naturalWidth > 0) reveal();
    };
    if (element.complete && element.naturalWidth > 0) accept();
    else element.decode().then(accept).catch(() => undefined);
    return () => { disposed = true; };
  }, [src]);

  return (
    <>
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br from-stone-200 via-stone-100 to-stone-200 transition-opacity duration-300 dark:from-zinc-800 dark:via-zinc-700 dark:to-zinc-800 ${loaded ? 'opacity-0' : 'opacity-100'}`}
      />
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        draggable={false}
        loading="eager"
        decoding="async"
        onLoad={reveal}
        onError={onError}
        fetchPriority="high"
        className={`pointer-events-none absolute inset-0 h-full w-full select-none object-cover will-change-[opacity,transform] transition-[opacity,transform] duration-300 ease-out ${loaded ? 'scale-100 opacity-100' : 'scale-[1.015] opacity-0'}`}
      />
    </>
  );
};

const TagEditor = ({
  image,
  focusRegion,
  customTagGroups = [],
  onClose,
  onRoute,
  onSave,
  onClearTags,
  onClearLocalization,
  onRemove,
  onViewOriginal,
  onLocateOriginal,
}: {
  image: ImageRecord;
  focusRegion?: FocusRegion;
  customTagGroups?: CustomTagGroup[];
  onClose: () => void;
  onRoute: (scope: ManualContentRoute) => void;
  onSave: (tags: string[]) => void;
  onClearTags: () => void;
  onClearLocalization: () => void;
  onRemove: () => void;
  onViewOriginal?: () => void;
  onLocateOriginal?: () => void;
}) => {
  const initialScope: ManualContentRoute = image.contentRouting?.scope === 'general_reference' || image.tags.includes('综合参考')
    ? 'general_reference'
    : 'human_dominant';
  const [currentScope, setCurrentScope] = useState<ManualContentRoute>(initialScope);
  const [tags, setTags] = useState(() => normalizeEditorTags(image.tags));

  const allCustomTags = useMemo(() => customTagGroups.flatMap(g => g.tags), [customTagGroups]);
  const customGroupNames = useMemo(() => new Set(customTagGroups.map(g => g.name)), [customTagGroups]);

  const handleScopeChange = (nextScope: ManualContentRoute) => {
    setCurrentScope(nextScope);
    if (nextScope === 'general_reference') {
      setTags(current => {
        const genTags = current.filter(t => (GENERAL_REFERENCE_TAGS.has(t) || allCustomTags.includes(t)) && t !== '完整人物' && t !== '人体局部');
        return genTags.includes('综合参考') ? genTags : ['综合参考', ...genTags];
      });
    } else {
      setTags(current => {
        const withoutGeneral = current.filter(t => !GENERAL_REFERENCE_TAGS.has(t) && t !== '综合参考');
        const hasContent = withoutGeneral.some(t => t === '完整人物' || t === '人体局部');
        return hasContent ? withoutGeneral : ['完整人物', ...withoutGeneral];
      });
    }
  };

  const toggleTag = (categoryName: string, categoryTags: string[], tag: string) => {
    setTags(current => {
      if (current.includes(tag)) return current.filter(item => item !== tag);
      if (customGroupNames.has(categoryName) || MULTI_SELECT_EDITOR_CATEGORIES.has(categoryName)) return [...current, tag];
      return [...current.filter(item => !categoryTags.includes(item)), tag];
    });
  };

  const customCategories = useMemo(() => (
    (customTagGroups || []).filter(g => g.tags.length > 0).map(g => ({ name: g.name, tags: g.tags }))
  ), [customTagGroups]);

  const visibleCategories = [
    ...EDITABLE_TAG_CATEGORIES.filter(category => {
      if (focusRegion) {
        return !GENERAL_REFERENCE_CATEGORY_NAMES.has(category.name) && category.name !== '部位' && category.name !== '内容';
      }
      if (currentScope === 'general_reference') {
        return GENERAL_REFERENCE_CATEGORY_NAMES.has(category.name);
      }
      return !GENERAL_REFERENCE_CATEGORY_NAMES.has(category.name);
    }),
    ...customCategories,
  ];

  const handleSave = () => {
    const finalTags = currentScope === 'general_reference'
      ? ['综合参考', ...tags.filter(t => (GENERAL_REFERENCE_TAGS.has(t) || allCustomTags.includes(t)) && t !== '完整人物' && t !== '人体局部' && t !== '综合参考')]
      : tags.filter(t => !GENERAL_REFERENCE_TAGS.has(t) && t !== '综合参考');
    onSave(finalTags);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-40 flex items-end bg-black/25 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ y: 30 }} animate={{ y: 0 }} exit={{ y: 30 }} onClick={event => event.stopPropagation()} className="w-full max-h-[78%] flex flex-col rounded-t-2xl bg-stone-50 dark:bg-zinc-900 border-t border-black/5 dark:border-white/10 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/5">
          <div>
            <div className="text-sm font-bold">编辑标签</div>
            <div className="text-[9px] text-stone-500 truncate max-w-56">{image.fileName || '图片'}</div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-black/5 dark:bg-white/5"><X size={13} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 [&::-webkit-scrollbar]:hidden">
          {!focusRegion && (
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-stone-500">
                素材路由
                {image.contentRouting?.scope === 'uncertain' && (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] tracking-normal text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">待确认</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleScopeChange('human_dominant')}
                  className={`h-9 rounded-xl text-[10px] font-bold transition-colors ${currentScope === 'human_dominant' ? 'bg-stone-800 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-black/5 text-stone-600 dark:bg-white/5 dark:text-zinc-300'}`}
                >
                  人物主体
                </button>
                <button
                  onClick={() => handleScopeChange('general_reference')}
                  className={`h-9 rounded-xl text-[10px] font-bold transition-colors ${currentScope === 'general_reference' ? 'bg-stone-800 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-black/5 text-stone-600 dark:bg-white/5 dark:text-zinc-300'}`}
                >
                  综合参考
                </button>
              </div>
            </div>
          )}
          {focusRegion && (
            <div>
              <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-stone-500">定位部位</div>
              <span className="inline-flex rounded-lg bg-stone-800 px-2.5 py-1.5 text-[10px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                {focusRegion.tag}
              </span>
              <p className="mt-2 text-[9px] leading-relaxed text-stone-500 dark:text-zinc-400">
                这是从原图生成的虚拟局部，标签与定位归属于整张原图。如需修改，请打开原图后编辑。
              </p>
            </div>
          )}
          {!focusRegion && visibleCategories.map(category => (
            <div key={category.name}>
              <div className="mb-1.5 text-[9px] uppercase tracking-widest font-bold text-stone-500">{category.name}</div>
              <div className="flex flex-wrap gap-1.5">
                {category.tags.map(tag => (
                  <button key={tag} onClick={() => toggleTag(category.name, category.tags, tag)} className={`px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors cursor-pointer ${tags.includes(tag) ? 'bg-stone-800 dark:bg-zinc-100 text-white dark:text-zinc-900' : 'bg-black/5 dark:bg-white/5 text-stone-500 dark:text-zinc-400'}`}>
                    {compactVisualTagLabel(tag)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-black/5 dark:border-white/5 space-y-2 bg-stone-50 dark:bg-zinc-900 shrink-0">
          {focusRegion ? (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={onViewOriginal} className="h-9 rounded-xl bg-black/5 dark:bg-white/5 text-stone-700 dark:text-zinc-200 text-[10px] font-bold hover:bg-black/10 transition-colors cursor-pointer">
                查看原图
              </button>
              <button onClick={onLocateOriginal} className="h-9 flex items-center justify-center gap-1.5 rounded-xl bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-[10px] font-bold cursor-pointer">
                在图库中定位原图
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={onClearTags}
                  className="h-8 flex items-center justify-center gap-1 rounded-xl bg-black/[0.035] dark:bg-white/[0.05] hover:bg-black/[0.07] dark:hover:bg-white/[0.09] text-stone-700 dark:text-zinc-300 text-[10px] font-bold transition-all active:scale-98 cursor-pointer"
                  title="清空分类标签，保留姿势与定位"
                >
                  <Tags size={12} className="opacity-70" />
                  <span>清除标签</span>
                </button>
                <button
                  type="button"
                  onClick={onClearLocalization}
                  className="h-8 flex items-center justify-center gap-1 rounded-xl bg-black/[0.035] dark:bg-white/[0.05] hover:bg-black/[0.07] dark:hover:bg-white/[0.09] text-stone-700 dark:text-zinc-300 text-[10px] font-bold transition-all active:scale-98 cursor-pointer"
                  title="清空姿势与切片定位，保留标签"
                >
                  <Crosshair size={12} className="opacity-70" />
                  <span>清除定位</span>
                </button>
                <button
                  type="button"
                  onClick={onRemove}
                  className="h-8 flex items-center justify-center gap-1 rounded-xl bg-red-500/10 hover:bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-bold transition-all active:scale-98 cursor-pointer"
                  title="从图库和本地永久删除图片"
                >
                  <Trash2 size={12} className="opacity-80" />
                  <span>移除照片</span>
                </button>
              </div>
              <button
                type="button"
                onClick={handleSave}
                className="w-full h-9 rounded-xl bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold shadow-sm hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer"
              >
                保存标签
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

const BatchTagEditor = ({
  images,
  customTagGroups = [],
  onClose,
  onApply,
  onClearTags,
  onClearLocalization,
  onRemoveImages,
}: {
  images: ImageRecord[];
  customTagGroups?: CustomTagGroup[];
  onClose: () => void;
  onApply: (tagsToAdd: string[], tagsToRemove: string[]) => void;
  onClearTags: () => void;
  onClearLocalization: () => void;
  onRemoveImages: () => void;
}) => {
  const [tagActions, setTagActions] = useState<Record<string, '+' | '-' | undefined>>({});

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    images.forEach(img => {
      img.tags.forEach(t => {
        counts.set(t, (counts.get(t) || 0) + 1);
      });
    });
    return counts;
  }, [images]);

  const total = images.length;

  const handleTagClick = (tag: string) => {
    const currentAction = tagActions[tag];
    const initialCount = tagCounts.get(tag) || 0;

    let nextAction: '+' | '-' | undefined;
    if (!currentAction) {
      if (initialCount === 0) {
        nextAction = '+';
      } else if (initialCount === total) {
        nextAction = '-';
      } else {
        nextAction = '+';
      }
    } else if (currentAction === '+') {
      nextAction = '-';
    } else if (currentAction === '-') {
      nextAction = undefined;
    }

    setTagActions(prev => ({
      ...prev,
      [tag]: nextAction,
    }));
  };

  const tagsToAdd = useMemo(() => (
    Object.entries(tagActions)
      .filter(([_, action]) => action === '+')
      .map(([tag]) => tag)
  ), [tagActions]);

  const tagsToRemove = useMemo(() => (
    Object.entries(tagActions)
      .filter(([_, action]) => action === '-')
      .map(([tag]) => tag)
  ), [tagActions]);

  const hasChanges = tagsToAdd.length > 0 || tagsToRemove.length > 0;

  const renderBatchTag = (tag: string) => {
    const action = tagActions[tag];
    const initialCount = tagCounts.get(tag) || 0;

    const badgeText = compactVisualTagLabel(tag);
    let stateLabel = '';
    let btnStyle = '';

    if (action === '+') {
      stateLabel = '+添加';
      btnStyle = 'bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-bold border-stone-900 dark:border-white shadow-sm';
    } else if (action === '-') {
      stateLabel = '−移除';
      btnStyle = 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300 border-red-300 dark:border-red-900 line-through opacity-80';
    } else {
      if (initialCount === total) {
        stateLabel = '全选已含';
        btnStyle = 'bg-black/10 dark:bg-white/15 text-stone-900 dark:text-white border-black/15 dark:border-white/20 font-semibold';
      } else if (initialCount > 0) {
        stateLabel = `${initialCount}/${total}`;
        btnStyle = 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-dashed border-amber-500/40 font-semibold';
      } else {
        btnStyle = 'bg-black/[0.03] dark:bg-white/[0.04] text-stone-500 dark:text-zinc-400 border-black/5 dark:border-white/5 hover:border-black/20 dark:hover:border-white/20';
      }
    }

    return (
      <button
        key={tag}
        type="button"
        onClick={() => handleTagClick(tag)}
        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all border flex items-center gap-1 cursor-pointer active:scale-95 ${btnStyle}`}
      >
        <span>{action === '+' ? `+ ${badgeText}` : action === '-' ? `− ${badgeText}` : badgeText}</span>
        {stateLabel && (
          <span className="text-[8px] opacity-75 font-semibold">
            {stateLabel}
          </span>
        )}
      </button>
    );
  };

  const activeCustomGroups = (customTagGroups || []).filter(g => g.tags.length > 0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex items-end bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40 }}
        animate={{ y: 0 }}
        exit={{ y: 40 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-h-[82%] flex flex-col rounded-t-2xl bg-stone-50 dark:bg-zinc-900 border-t border-black/5 dark:border-white/10 shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/5 shrink-0">
          <div>
            <div className="text-sm font-bold text-stone-800 dark:text-zinc-100 flex items-center gap-2">
              批量编辑标签
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-stone-800 dark:bg-zinc-100 text-white dark:text-zinc-900">
                已选 {total} 张
              </span>
            </div>
            <div className="text-[9px] text-stone-400 mt-0.5">
              点击切换状态：+全部添加 / −全部移除 / 保持原样
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer">
            <X size={13} />
          </button>
        </div>

        {/* Selected Thumbnails Strip */}
        <div className="px-4 py-2 bg-black/[0.02] dark:bg-black/20 border-b border-black/5 dark:border-white/5 shrink-0 flex items-center gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          {images.slice(0, 16).map(img => (
            <div key={img.id} className="w-8 h-10 rounded-md overflow-hidden bg-zinc-200 dark:bg-zinc-800 shrink-0 border border-black/5 dark:border-white/5 shadow-xs">
              <img src={img.thumbnailUrl || img.url} className="w-full h-full object-cover" alt="" loading="lazy" />
            </div>
          ))}
          {images.length > 16 && (
            <div className="h-10 px-2 flex items-center justify-center rounded-md bg-black/5 dark:bg-white/5 text-[9px] font-bold text-stone-400 shrink-0">
              +{images.length - 16}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3.5 [&::-webkit-scrollbar]:hidden">
          {/* Custom Tag Groups */}
          {activeCustomGroups.length > 0 && (
            <div className="space-y-2.5">
              <div className="text-[9px] font-bold uppercase tracking-wider text-stone-400 dark:text-zinc-500">
                自定义标签分组
              </div>
              {activeCustomGroups.map(group => (
                <div key={group.id} className="p-2.5 rounded-xl bg-white dark:bg-zinc-800/60 border border-black/5 dark:border-white/5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-bold text-stone-700 dark:text-zinc-300">
                      {group.name}
                    </div>
                    <span className="text-[8px] text-stone-400 font-semibold">{group.tags.length} 个标签</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.tags.map(renderBatchTag)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Native Categories */}
          <div className="space-y-3">
            <div className="text-[9px] font-bold uppercase tracking-wider text-stone-400 dark:text-zinc-500">
              原生分类标签
            </div>
            {EDITABLE_TAG_CATEGORIES.map(category => (
              <div key={category.name}>
                <div className="mb-1 text-[9px] font-bold text-stone-500">{category.name}</div>
                <div className="flex flex-wrap gap-1.5">
                  {category.tags.map(renderBatchTag)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3 border-t border-black/5 dark:border-white/5 bg-stone-50 dark:bg-zinc-900 space-y-2 shrink-0">
          {(tagsToAdd.length > 0 || tagsToRemove.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 text-[9px] text-stone-500 font-medium px-1">
              {tagsToAdd.length > 0 && <span className="text-emerald-600 dark:text-emerald-400 font-bold">将添加: {tagsToAdd.join('、')}</span>}
              {tagsToRemove.length > 0 && <span className="text-red-500 font-bold">将移除: {tagsToRemove.join('、')}</span>}
            </div>
          )}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={onClearTags}
              className="h-8 flex items-center justify-center gap-1 rounded-xl bg-black/[0.035] dark:bg-white/[0.05] hover:bg-black/[0.07] dark:hover:bg-white/[0.09] text-stone-700 dark:text-zinc-300 text-[10px] font-bold transition-all active:scale-98 cursor-pointer"
              title="清空选中图片的分类标签，保留定位"
            >
              <Tags size={12} className="opacity-70" />
              <span>清除标签</span>
            </button>
            <button
              type="button"
              onClick={onClearLocalization}
              className="h-8 flex items-center justify-center gap-1 rounded-xl bg-black/[0.035] dark:bg-white/[0.05] hover:bg-black/[0.07] dark:hover:bg-white/[0.09] text-stone-700 dark:text-zinc-300 text-[10px] font-bold transition-all active:scale-98 cursor-pointer"
              title="清空选中图片的姿势与切片定位，保留标签"
            >
              <Crosshair size={12} className="opacity-70" />
              <span>清除定位</span>
            </button>
            <button
              type="button"
              onClick={onRemoveImages}
              className="h-8 flex items-center justify-center gap-1 rounded-xl bg-red-500/10 hover:bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-bold transition-all active:scale-98 cursor-pointer"
              title="从图库和本地永久删除选中图片"
            >
              <Trash2 size={12} className="opacity-80" />
              <span>移除照片</span>
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-xl bg-black/5 dark:bg-white/5 text-stone-600 dark:text-zinc-300 text-xs font-bold hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => onApply(tagsToAdd, tagsToRemove)}
              disabled={!hasChanges}
              className="h-9 rounded-xl bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold hover:opacity-90 active:scale-98 disabled:opacity-40 disabled:pointer-events-none transition-all shadow-sm cursor-pointer"
            >
              应用修改 ({total} 张)
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
