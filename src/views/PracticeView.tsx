import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Play, Plus, ChevronDown, ChevronRight, Check, Folder, FolderTree } from 'lucide-react';
import { AppSettings, ImageRecord, SessionType } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { StageEditor } from '../components/StageEditor';
import { SetEditorModal } from '../components/SetEditorModal';
import { POSE_MODEL_VERSION } from '../services/poseFocus';
import { getVirtualFocusTags } from '../utils/focusRegion';
import { ProgressSegmentedControl } from '../components/ProgressSegmentedControl';
import {
  BODY_PART_TAGS,
  COMPACT_VISUAL_TAG_LABELS,
  CONTENT_TAGS,
  FIGURE_TAG_GROUPS,
  PART_TAG_GROUPS,
  GENERAL_TAG_GROUPS,
  matchesBranchTags,
  GENERAL_REFERENCE_CATEGORIES,
  getSetDetailText,
} from '../utils/tagCatalog';
import { buildLibraryFolders, folderContains, folderDisplayName, type LibraryFolder } from '../utils/libraryFolders';

const TIME_PRESETS = [0.5, 1, 2, 5, 10];
const COUNT_PRESETS = [10, 20, 30, 50, 100];
const PART_TAGS = [...BODY_PART_TAGS];
const PERSON_COUNT_TAGS = ['单人', '双人', '群体'];
const SINGLE_GENDER_TAGS = ['男性', '女性'];
const MULTI_GENDER_TAGS = ['纯男', '纯女', '混合'];
const FIGURE_RIGHT_CATEGORIES = [
  { name: '景别', tags: ['全身', '身体裁切', '头肩肖像'] },
  { name: '姿势', tags: ['站', '坐', '跪', '蹲', '躺'] },
  { name: '动态', tags: ['静态', '动态'] },
  { name: '机位', tags: ['平视', '俯视', '仰视'] },
  { name: '视角', tags: ['正面', '背面', '纯侧面'] },
];

const DETAIL_LEFT_CATEGORIES = [
  { name: '部位', tags: PART_TAGS },
  { name: '性别', tags: ['男性', '女性', '混合'] },
  { name: '穿着', tags: ['裸体', '部分着装', '完整着装'] },
];

const COMPACT_TAG_LABELS: Record<string, string> = {
  身体裁切: '裁切',
  头肩肖像: '肖像',
  部分着装: '部分',
  完整着装: '完整',
  纯侧面: '侧面',
  头部面部: '头面',
  骨盆臀部: '骨盆',
  ...COMPACT_VISUAL_TAG_LABELS,
};

const computeInitialContentTypes = (settings: AppSettings, images: ImageRecord[]): string[] => {
  const saved = settings.practiceContentTypes;
  if (Array.isArray(saved)) {
    return saved.filter(tag => (CONTENT_TAGS as readonly string[]).includes(tag));
  }
  const hasPersonClassification = images.some(image => (
    image.contentRouting?.scope === 'human_dominant'
    || image.tags.includes('完整人物')
    || image.tags.includes('人体局部')
  ));
  return hasPersonClassification ? ['完整人物'] : [];
};

const expandableFolderPaths = (folders: LibraryFolder[]): Set<string> => {
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

const PracticeFolderPicker: React.FC<{
  folders: LibraryFolder[];
  selected: string | null;
  total: number;
  onSelect: (folder: string | null) => void;
  onClose: () => void;
}> = ({ folders, selected, total, onSelect, onClose }) => {
  const expandable = useMemo(() => expandableFolderPaths(folders), [folders]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(expandableFolderPaths(folders)));
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
    <div
      onWheel={e => e.stopPropagation()}
      className="max-h-60 overflow-y-auto p-1.5 overscroll-contain select-none [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-black/10 dark:[&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full"
    >
      <div className="flex h-7 items-center gap-1">
        <button
          onClick={() => { onSelect(null); onClose(); }}
          className={`flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-[10px] transition-colors ${selected === null ? 'bg-stone-800 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-stone-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/5'}`}
        >
          <FolderTree size={12} className="shrink-0" />
          <span className="flex-1 text-left">全部图包</span>
          <span className="text-[8px] opacity-55">{total}</span>
        </button>
        {expandable.size > 0 && (
          <button
            onClick={() => setCollapsed(current => current.size > 0 ? new Set() : new Set(expandable))}
            className="h-6 shrink-0 rounded-md px-2 text-[9px] font-bold text-stone-500 hover:bg-black/5 dark:hover:bg-white/5"
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
          <div
            key={folder.path}
            style={{ paddingLeft: `${folder.depth * 12}px` }}
            className={`flex h-7 items-center rounded-md text-[10px] transition-colors ${isSelected ? 'bg-stone-800 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-stone-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/5'}`}
          >
            <button
              onClick={() => hasChildren && toggleFolder(folder.path)}
              disabled={!hasChildren}
              className="flex h-7 w-6 shrink-0 items-center justify-center disabled:opacity-20 cursor-pointer"
              aria-label={hasChildren ? `${isCollapsed ? '展开' : '折叠'} ${folder.name}` : undefined}
            >
              {hasChildren ? (isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />) : <span className="w-[11px]" />}
            </button>
            <button onClick={() => { onSelect(folder.path); onClose(); }} className="flex h-7 min-w-0 flex-1 items-center gap-2 pr-2 cursor-pointer">
              <Folder size={12} fill="currentColor" className="shrink-0 opacity-55" />
              <span className="flex-1 truncate text-left">{folder.name}</span>
              <span className="text-[8px] opacity-55">{folder.count}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
};

export const PracticeView: React.FC<{ onStart: (config: any) => void }> = ({ onStart }) => {
  const { settings, images, sets, saveSet, updateSettings } = useAppContext();
  const initialContentTypes = useMemo(() => computeInitialContentTypes(settings, images), []);
  const [includeTags, setIncludeTags] = useState<string[]>(initialContentTypes);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [sessionType, setSessionType] = useState<SessionType>('single');
  const [singleTimeMin, setSingleTimeMin] = useState<number | string>(1);
  const [imageCount, setImageCount] = useState<number | string>(20);
  const [isTimeLimited, setIsTimeLimited] = useState<boolean>(true);
  const [isCountLimited, setIsCountLimited] = useState<boolean>(true);
  const [activeStageIdx, setActiveStageIdx] = useState<number | null>(null);
  const [progressiveStages, setProgressiveStages] = useState<any[]>([
    { id: '1', durationSec: 300, count: 5, includeTags: [], excludeTags: [] },
    { id: '2', durationSec: 600, count: 5, includeTags: [], excludeTags: [] }
  ]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [activeContentPage, setActiveContentPage] = useState<(typeof CONTENT_TAGS)[number]>(
    initialContentTypes.length > 0 ? initialContentTypes[0] as (typeof CONTENT_TAGS)[number] : '完整人物',
  );

  const isFilterDisabled = sessionType === 'progressive' && activeStageIdx === null;

  const contentFilterReadyRef = useRef(false);
  useEffect(() => {
    if (!contentFilterReadyRef.current) {
      contentFilterReadyRef.current = true;
      return;
    }
    const contentTypes = includeTags.filter(tag => (CONTENT_TAGS as readonly string[]).includes(tag));
    updateSettings({ practiceContentTypes: contentTypes });
  }, [includeTags]);

  const activeIncludeTags = sessionType === 'progressive'
    ? (activeStageIdx !== null ? (progressiveStages[activeStageIdx]?.includeTags || []) : [])
    : includeTags;
  const activeExcludeTags = sessionType === 'progressive'
    ? (activeStageIdx !== null ? (progressiveStages[activeStageIdx]?.excludeTags || []) : [])
    : excludeTags;

  const selectedContentModes = activeIncludeTags.filter(t => CONTENT_TAGS.includes(t as any));
  const isUnlimited = selectedContentModes.length === 0;
  const isFigureMode = selectedContentModes.length === 0 || selectedContentModes.includes('完整人物');
  const isPartMode = selectedContentModes.length === 0 || selectedContentModes.includes('人体局部');
  const isGeneralMode = selectedContentModes.length === 0 || selectedContentModes.includes('综合参考');

  const libraryFolders = useMemo(() => buildLibraryFolders(images), [images]);
  const folderScopedImages = useMemo(
    () => activeFolder ? images.filter(image => folderContains(activeFolder, image)) : images,
    [images, activeFolder],
  );

  const matchingImagesCount = folderScopedImages.reduce((count, image) => {
    if (image.hidden) return count;
    let imageMatches = 0;
    const isGeneralReference = image.tags.includes('综合参考') || image.contentRouting?.scope === 'general_reference';
    const isClassifiedFigure = image.tags.includes('完整人物') || image.contentRouting?.scope === 'human_dominant';

    // 1. Full Figure Branch
    if (isFigureMode && (isClassifiedFigure || (selectedContentModes.length === 0 && !isGeneralReference))) {
      if (matchesBranchTags(image.tags, activeIncludeTags, activeExcludeTags, FIGURE_TAG_GROUPS)) {
        imageMatches += 1;
      }
    }

    // 2. Body Part Branch
    if (isPartMode) {
      if (image.tags.includes('人体局部')) {
        if (matchesBranchTags(image.tags, activeIncludeTags, activeExcludeTags, PART_TAG_GROUPS)) {
          imageMatches += 1;
        }
      } else if (
        image.poseAnalysis?.status === 'detected'
        && image.poseAnalysis.modelVersion === POSE_MODEL_VERSION
        && image.poseAnalysis.regions.length > 0
      ) {
        for (const region of image.poseAnalysis.regions) {
          const virtualTags = getVirtualFocusTags(image.tags, region);
          if (matchesBranchTags(virtualTags, activeIncludeTags, activeExcludeTags, PART_TAG_GROUPS)) {
            imageMatches += 1;
          }
        }
      }
    }

    // 3. General Reference Branch
    if (isGeneralMode && (image.tags.includes('综合参考') || image.contentRouting?.scope === 'general_reference')) {
      if (matchesBranchTags(image.tags, activeIncludeTags, activeExcludeTags, GENERAL_TAG_GROUPS)) {
        imageMatches += 1;
      }
    }

    return count + imageMatches;
  }, 0);

  const actualCount = sessionType === 'single' 
    ? (isCountLimited ? Math.min(matchingImagesCount, Number(imageCount)) : matchingImagesCount)
    : progressiveStages.reduce((sum, stage) => sum + stage.count, 0);
    
  const totalTimeSec = sessionType === 'single' 
    ? (isTimeLimited ? actualCount * Math.floor(Number(singleTimeMin) * 60) : 0)
    : progressiveStages.reduce((sum, stage) => sum + (stage.count * stage.durationSec), 0);

  const loadSet = (set: any) => {
    const savedIncludeTags = set.config.includeTags || [];
    setIncludeTags(savedIncludeTags);
    setActiveContentPage(
      savedIncludeTags.includes('综合参考')
        ? '综合参考'
        : savedIncludeTags.includes('人体局部') && !savedIncludeTags.includes('完整人物') ? '人体局部' : '完整人物',
    );
    setExcludeTags(set.config.excludeTags || []);
    setSessionType(set.config.sessionType || 'single');
    if (set.config.sessionType === 'single') {
      setSingleTimeMin(set.config.singleTimeSec ? set.config.singleTimeSec / 60 : 1);
      setImageCount(set.config.imageCount || 20);
      setIsTimeLimited(!!set.config.singleTimeSec);
      setIsCountLimited(!!set.config.imageCount);
      setActiveStageIdx(null);
    } else {
      setProgressiveStages(set.config.progressiveStages || []);
      setActiveStageIdx(0);
    }
    setActiveSetId(set.id);
  };

  const toggleTag = (tag: string, mode: 'include' | 'exclude') => {
    if (isFilterDisabled) return;
    if (sessionType === 'progressive' && activeStageIdx !== null) {
      const stages = [...progressiveStages];
      const stage = { ...stages[activeStageIdx] };
      const stageInc = stage.includeTags || [];
      const stageExc = stage.excludeTags || [];
      if (mode === 'include') {
        if (stageInc.includes(tag)) stage.includeTags = stageInc.filter((item: string) => item !== tag);
        else {
          stage.includeTags = [...stageInc, tag];
          stage.excludeTags = stageExc.filter((item: string) => item !== tag);
        }
      } else {
        // mode === 'exclude'：若已处于包含状态，右键等价于取消选中；若处于排除状态，右键取消排除；若未选中，右键加入排除
        if (stageInc.includes(tag)) {
          stage.includeTags = stageInc.filter((item: string) => item !== tag);
        } else if (stageExc.includes(tag)) {
          stage.excludeTags = stageExc.filter((item: string) => item !== tag);
        } else {
          stage.excludeTags = [...stageExc, tag];
        }
      }
      stages[activeStageIdx] = stage;
      setProgressiveStages(stages);
      return;
    }

    if (mode === 'include') {
      setIncludeTags(current => current.includes(tag)
        ? current.filter(item => item !== tag)
        : [...current, tag]);
      setExcludeTags(current => current.filter(item => item !== tag));
    } else {
      // mode === 'exclude'：若已处于包含状态，右键等价于取消选中；若处于排除状态，右键取消排除；若未选中，右键加入排除
      if (activeIncludeTags.includes(tag)) {
        setIncludeTags(current => current.filter(item => item !== tag));
      } else if (activeExcludeTags.includes(tag)) {
        setExcludeTags(current => current.filter(item => item !== tag));
      } else {
        setExcludeTags(current => [...current, tag]);
      }
    }
    setActiveSetId(null);
  };

  const replaceCurrentTags = (nextInclude: string[], nextExclude: string[]) => {
    if (isFilterDisabled) return;
    if (sessionType === 'progressive' && activeStageIdx !== null) {
      setProgressiveStages(stages => stages.map((stage, index) => (
        index === activeStageIdx
          ? { ...stage, includeTags: nextInclude, excludeTags: nextExclude }
          : stage
      )));
      setActiveSetId(null);
      return;
    }
    setIncludeTags(nextInclude);
    setExcludeTags(nextExclude);
    setActiveSetId(null);
  };

  const selectContent = (content: (typeof CONTENT_TAGS)[number]) => {
    if (isFilterDisabled) return;
    const isSelected = activeIncludeTags.includes(content);
    const isActivePage = activeContentPage === content;
    
    if (!isActivePage) {
      setActiveContentPage(content);
      if (!isSelected) {
        replaceCurrentTags([...activeIncludeTags, content], activeExcludeTags.filter(tag => tag !== content));
      }
    } else {
      if (isSelected) {
        const nextInclude = activeIncludeTags.filter(tag => tag !== content);
        const nextExclude = activeExcludeTags.filter(tag => tag !== content);
        const hasRemainingContentMode = nextInclude.some(tag => (CONTENT_TAGS as readonly string[]).includes(tag));
        replaceCurrentTags(
          hasRemainingContentMode ? nextInclude : [],
          hasRemainingContentMode ? nextExclude : [],
        );
      } else {
        replaceCurrentTags(
          [...activeIncludeTags, content],
          activeExcludeTags.filter(tag => tag !== content),
        );
      }
    }
  };

  const selectUnlimited = () => {
    if (isFilterDisabled) return;
    replaceCurrentTags([], []);
  };

  const togglePersonCount = (countTag: string, mode: 'include' | 'exclude') => {
    if (isFilterDisabled) return;
    if (sessionType === 'progressive' && activeStageIdx !== null) {
      toggleTag(countTag, mode);
      return;
    }

    if (mode === 'exclude' && activeIncludeTags.includes(countTag)) {
      // 若已包含该人数标签，右键等价于取消选中
      const nextInclude = activeIncludeTags.filter(tag => tag !== countTag);
      const hasMultiPerson = nextInclude.some(tag => ['双人', '群体'].includes(tag));
      const hasSinglePerson = nextInclude.includes('单人');
      const nextVisibleGenders = hasMultiPerson 
        ? MULTI_GENDER_TAGS 
        : (hasSinglePerson ? SINGLE_GENDER_TAGS : [...SINGLE_GENDER_TAGS, ...MULTI_GENDER_TAGS]);
      const filteredInclude = nextInclude.filter(t => 
        (!SINGLE_GENDER_TAGS.includes(t) && !MULTI_GENDER_TAGS.includes(t)) || nextVisibleGenders.includes(t)
      );
      const filteredExclude = activeExcludeTags.filter(t =>
        (!SINGLE_GENDER_TAGS.includes(t) && !MULTI_GENDER_TAGS.includes(t)) || nextVisibleGenders.includes(t)
      );
      replaceCurrentTags(filteredInclude, filteredExclude);
      return;
    }

    const nextInclude = mode === 'include'
      ? (activeIncludeTags.includes(countTag)
        ? activeIncludeTags.filter(tag => tag !== countTag)
        : [...activeIncludeTags, countTag])
      : activeIncludeTags;
      
    const hasMultiPerson = nextInclude.some(tag => ['双人', '群体'].includes(tag));
    const hasSinglePerson = nextInclude.includes('单人');
    
    const nextVisibleGenders = hasMultiPerson 
      ? MULTI_GENDER_TAGS 
      : (hasSinglePerson ? SINGLE_GENDER_TAGS : [...SINGLE_GENDER_TAGS, ...MULTI_GENDER_TAGS]);
      
    const filteredInclude = nextInclude.filter(t => 
      (!SINGLE_GENDER_TAGS.includes(t) && !MULTI_GENDER_TAGS.includes(t)) || nextVisibleGenders.includes(t)
    );
    const filteredExclude = activeExcludeTags.filter(t =>
      (!SINGLE_GENDER_TAGS.includes(t) && !MULTI_GENDER_TAGS.includes(t)) || nextVisibleGenders.includes(t)
    );
    if (mode === 'exclude') {
      replaceCurrentTags(
        filteredInclude.filter(tag => tag !== countTag),
        filteredExclude.includes(countTag)
          ? filteredExclude.filter(tag => tag !== countTag)
          : [...filteredExclude, countTag],
      );
    } else {
      replaceCurrentTags(filteredInclude, filteredExclude.filter(tag => tag !== countTag));
    }
  };

  const resetConfig = () => {
    setIncludeTags([]);
    setExcludeTags([]);
    setSessionType('single');
    setSingleTimeMin(1);
    setImageCount(20);
    setIsTimeLimited(true);
    setIsCountLimited(true);
    setActiveStageIdx(null);
    setActiveSetId(null);
    setActiveContentPage('完整人物');
  };

  const renderTag = (tag: string) => {
    const isInc = activeIncludeTags.includes(tag);
    const isExc = activeExcludeTags.includes(tag);

    return (
      <motion.button
        key={tag}
        layout
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.92 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        onClick={event => {
          const mode = event.altKey || event.metaKey ? 'exclude' : 'include';
          if (PERSON_COUNT_TAGS.includes(tag)) togglePersonCount(tag, mode);
          else toggleTag(tag, mode);
        }}
        onMouseDown={event => { if (event.button === 2) event.stopPropagation(); }}
        onContextMenu={event => {
          event.preventDefault();
          event.stopPropagation();
          if (PERSON_COUNT_TAGS.includes(tag)) togglePersonCount(tag, 'exclude');
          else toggleTag(tag, 'exclude');
        }}
        className={`min-w-[34px] px-2 py-1 rounded-md text-[10px] leading-none font-medium transition-colors border ${
          isInc
            ? 'bg-white dark:bg-zinc-700 text-stone-900 dark:text-zinc-100 border-white/80 dark:border-white/10 shadow-[0_0_14px_rgba(255,255,255,0.95),0_2px_8px_rgba(0,0,0,0.10)] dark:shadow-[0_0_14px_rgba(255,255,255,0.18)]'
            : isExc
              ? 'bg-red-50/80 dark:bg-red-950/20 text-red-600 dark:text-red-300 border-red-200/80 dark:border-red-900/60'
              : 'bg-white/35 dark:bg-transparent text-stone-600 dark:text-zinc-400 border-black/10 dark:border-white/10 hover:border-black/25 dark:hover:border-white/25'
        }`}
      >
        {isExc ? `−${COMPACT_TAG_LABELS[tag] || tag}` : COMPACT_TAG_LABELS[tag] || tag}
      </motion.button>
    );
  };

  const renderCategory = (category: { name: string; tags: string[] }) => (
    <motion.div layout key={category.name} className="grid grid-cols-[30px_1fr] items-start gap-1.5 min-w-0">
      <motion.div layout className="pt-1 text-[10px] leading-none font-semibold text-stone-500">
        {category.name}
      </motion.div>
      <div className="flex flex-wrap gap-1 min-w-0 relative">
        <AnimatePresence mode="popLayout" initial={false}>
          {category.tags.map(renderTag)}
        </AnimatePresence>
      </div>
    </motion.div>
  );

  const hasMultiPerson = activeIncludeTags.some(tag => ['双人', '群体'].includes(tag));
  const hasSinglePerson = activeIncludeTags.includes('单人');
  const visibleGenderTags = hasMultiPerson
    ? MULTI_GENDER_TAGS
    : hasSinglePerson
      ? SINGLE_GENDER_TAGS
      : [...SINGLE_GENDER_TAGS, ...MULTI_GENDER_TAGS];
  const figureLeftCategories = [
    { name: '人数', tags: PERSON_COUNT_TAGS },
    { name: '性别', tags: visibleGenderTags },
    { name: '穿着', tags: ['裸体', '部分着装', '完整着装'] },
  ];

  const handleQuickStart = () => {
    onStart({
      includeTags: [],
      excludeTags: [],
      sessionType: 'single',
      singleTimeSec: 0,
      imageCount: 999,
      randomize: true,
      folder: activeFolder || undefined,
      preparationSec: settings.preparationSec,
      transitionSec: settings.transitionSec
    });
  };

  const handleStart = () => {
    onStart({
      includeTags: sessionType === 'progressive' ? [] : includeTags,
      excludeTags: sessionType === 'progressive' ? [] : excludeTags,
      sessionType,
      singleTimeSec: sessionType === 'single' && !isTimeLimited ? 0 : Math.floor(Number(singleTimeMin) * 60),
      imageCount: sessionType === 'single' && !isCountLimited ? 999 : Number(imageCount),
      progressiveStages: sessionType === 'progressive' ? progressiveStages : undefined,
      folder: activeFolder || undefined,
      randomize: true,
      preparationSec: settings.preparationSec,
      transitionSec: settings.transitionSec
    });
  };

  return (
    <div className="h-full overflow-y-auto px-4 pt-3 pb-4 [@media(min-height:700px)]:pt-5 [@media(min-height:820px)]:pt-7 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      <section className="flex min-h-full flex-col gap-3 [@media(min-height:700px)]:gap-4 [@media(min-height:820px)]:gap-5">
        <header className="flex items-center justify-between">
          <div className="relative">
            <div className="mb-0.5 text-[9px] font-semibold tracking-wide text-stone-500">方案</div>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-2 group"
            >
              <h1 className="text-lg font-bold tracking-tight text-stone-800 dark:text-zinc-100 transition-colors group-hover:text-black dark:group-hover:text-white">
                {activeSetId ? sets.find(s => s.id === activeSetId)?.name || '自由练习' : '自由练习'}
              </h1>
              <div className={`p-1 rounded-md transition-all ${
                isDropdownOpen 
                  ? 'bg-black/10 dark:bg-white/20 text-stone-800 dark:text-white rotate-180' 
                  : 'bg-black/5 dark:bg-white/10 text-stone-500 group-hover:bg-black/10 dark:group-hover:bg-white/20'
              }`}>
                <ChevronDown size={14} />
              </div>
            </button>

            <AnimatePresence>
              {isDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsDropdownOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 mt-2 w-56 bg-white/95 dark:bg-zinc-800/95 backdrop-blur-xl rounded-xl shadow-xl border border-black/5 dark:border-white/10 p-1.5 z-50 flex flex-col"
                  >
                    <div className="max-h-[240px] overflow-y-auto scrollbar-hide flex flex-col gap-0.5">
                      <button
                        onClick={() => { resetConfig(); setIsDropdownOpen(false); }}
                        className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-[12px] font-bold transition-colors ${
                          !activeSetId
                            ? 'bg-stone-100 dark:bg-zinc-700 text-black dark:text-white'
                            : 'text-stone-600 dark:text-zinc-400 hover:bg-stone-50 dark:hover:bg-zinc-700/50 hover:text-stone-800 dark:hover:text-zinc-200'
                        }`}
                      >
                        自由练习
                        {!activeSetId && <Check size={14} />}
                      </button>
                      
                      {sets.length > 0 && <div className="h-px bg-black/5 dark:bg-white/10 my-1 mx-1" />}
                      
                      {sets.map(set => (
                        <button
                          key={set.id}
                          onClick={() => { loadSet(set); setIsDropdownOpen(false); }}
                          className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-[12px] font-bold transition-colors ${
                            activeSetId === set.id
                              ? 'bg-stone-100 dark:bg-zinc-700 text-black dark:text-white'
                              : 'text-stone-600 dark:text-zinc-400 hover:bg-stone-50 dark:hover:bg-zinc-700/50 hover:text-stone-800 dark:hover:text-zinc-200'
                          }`}
                        >
                          <div className="text-left min-w-0 flex-1 pr-2">
                            <div className="truncate">{set.name}</div>
                            <div className="text-[9px] font-medium text-stone-400 dark:text-zinc-500 truncate">
                              {getSetDetailText(set.config)}
                            </div>
                          </div>
                          {activeSetId === set.id && <Check size={14} className="shrink-0" />}
                        </button>
                      ))}
                    </div>
                    
                    <div className="h-px bg-black/5 dark:bg-white/10 my-1 mx-1" />
                    <button
                      onClick={() => { setIsModalOpen(true); setIsDropdownOpen(false); }}
                      className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[12px] font-bold text-stone-500 hover:text-stone-800 hover:bg-stone-50 dark:hover:bg-zinc-700/50 dark:hover:text-zinc-200 transition-colors"
                    >
                      <Plus size={14} />
                      新建练习配置
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={handleQuickStart}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 rounded-lg text-[11px] font-bold border border-black/5 dark:border-white/10 hover:-translate-y-0.5 active:translate-y-0 transition-all shadow-sm"
          >
            <Play size={12} fill="currentColor" />
            随机开始
          </button>
        </header>

        <div className="space-y-2 border-y border-black/5 py-2.5 dark:border-white/5 [@media(min-height:700px)]:space-y-3 [@media(min-height:700px)]:py-4">
          <div className="text-[10px] font-bold text-stone-700 dark:text-zinc-300">计时设置</div>
          <div className="grid grid-cols-[38px_1fr] items-center gap-2">
            <div className="text-[10px] font-semibold text-stone-500">模式</div>
            <div className="inline-flex w-fit p-0.5 rounded-md border border-black/10 dark:border-white/10">
              <button onClick={() => { setSessionType('single'); setActiveStageIdx(null); }} className={`h-6 px-3 rounded-[4px] text-[10px] font-bold transition-colors ${sessionType === 'single' ? 'bg-stone-800 dark:bg-zinc-100 text-white dark:text-zinc-900' : 'text-stone-500'}`}>固定时长</button>
              <button onClick={() => { setSessionType('progressive'); setActiveStageIdx(0); }} className={`h-6 px-3 rounded-[4px] text-[10px] font-bold transition-colors ${sessionType === 'progressive' ? 'bg-stone-800 dark:bg-zinc-100 text-white dark:text-zinc-900' : 'text-stone-500'}`}>Class Mode</button>
            </div>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {sessionType === 'single' ? (
              <motion.div key="single" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1.5">
                <div className="grid grid-cols-[38px_1fr] items-center gap-2">
                  <div className="text-[10px] font-semibold text-stone-500">时长</div>
                  <ProgressSegmentedControl presets={TIME_PRESETS} value={singleTimeMin} onChange={setSingleTimeMin} isLimited={isTimeLimited} onLimitedChange={setIsTimeLimited} defaultCustomValue={15} />
                </div>
                <div className="grid grid-cols-[38px_1fr] items-center gap-2">
                  <div className="text-[10px] font-semibold text-stone-500">数量</div>
                  <ProgressSegmentedControl presets={COUNT_PRESETS} value={imageCount} onChange={setImageCount} isLimited={isCountLimited} onLimitedChange={setIsCountLimited} defaultCustomValue={40} />
                </div>
              </motion.div>
            ) : (
              <motion.div key="progressive" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pt-1">
                <StageEditor stages={progressiveStages} onChange={setProgressiveStages} activeStageIdx={activeStageIdx} onSelectStage={setActiveStageIdx} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className={`space-y-2.5 [@media(min-height:700px)]:space-y-4 transition-all duration-200 ${isFilterDisabled ? 'opacity-40 pointer-events-none select-none grayscale-[20%]' : ''}`}>
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-[13px] font-bold">内容筛选</h2>
              <div className="text-[9px] text-stone-500/70">
                {isFilterDisabled ? '请在上方选择阶段进行配置' : isUnlimited ? '已选「不限」· 下方筛选已停用' : '左键包含 · 右键排除'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  onClick={() => setShowFolderPicker(value => !value)}
                  className={`flex h-6 items-center gap-1 rounded-md px-2 text-[9px] font-bold transition-colors ${activeFolder ? 'bg-stone-800 dark:bg-zinc-100 text-white dark:text-zinc-900' : 'bg-black/5 dark:bg-white/5 text-stone-500 hover:text-stone-800 dark:hover:text-zinc-200'}`}
                  title="选择图包筛选范围"
                >
                  <FolderTree size={12} className="shrink-0" />
                  <span className="max-w-24 truncate">{activeFolder ? folderDisplayName(activeFolder) : '全部图包'}</span>
                  <ChevronDown size={10} className={`shrink-0 transition-transform ${showFolderPicker ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence>
                  {showFolderPicker && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowFolderPicker(false)}
                        onWheel={e => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      />
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.98 }}
                        transition={{ duration: 0.15 }}
                        onWheel={e => e.stopPropagation()}
                        className="absolute right-0 top-7 z-50 w-52 sm:w-60 rounded-xl border border-black/10 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/95 overscroll-contain"
                      >
                        <PracticeFolderPicker
                          folders={libraryFolders}
                          selected={activeFolder}
                          total={images.length}
                          onSelect={setActiveFolder}
                          onClose={() => setShowFolderPicker(false)}
                        />
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
              {!isFilterDisabled && (activeIncludeTags.length > 0 || activeExcludeTags.length > 0) && (
                <button onClick={() => replaceCurrentTags([], [])} className="text-[9px] font-bold text-stone-500 hover:text-stone-800 dark:hover:text-zinc-200">清除筛选</button>
              )}
              {isFilterDisabled ? (
                <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400">未选择阶段 · 筛选已冻结</span>
              ) : (
                sessionType === 'progressive' && activeStageIdx !== null && <span className="text-[9px] font-bold text-stone-500">正在设置阶段 {activeStageIdx + 1}</span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-[38px_1fr] items-center gap-2">
            <div className="text-[10px] font-semibold text-stone-500">素材</div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={selectUnlimited}
                className={`relative min-w-[44px] px-2 py-1.5 rounded-md border text-[10px] font-bold transition-colors ${
                  selectedContentModes.length === 0
                    ? 'bg-white dark:bg-zinc-700 text-stone-900 dark:text-zinc-100 border-white/80 dark:border-white/10 shadow-[0_0_14px_rgba(255,255,255,0.95),0_2px_8px_rgba(0,0,0,0.10)] dark:shadow-[0_0_14px_rgba(255,255,255,0.18)]'
                    : 'bg-white/35 dark:bg-transparent border-black/10 dark:border-white/10 text-stone-500 dark:text-zinc-400'
                }`}
              >
                不限
              </button>
              {CONTENT_TAGS.map(content => (
                <button
                  key={content}
                  onClick={() => selectContent(content)}
                  onMouseDown={event => { if (event.button === 2) event.stopPropagation(); }}
                  onContextMenu={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (selectedContentModes.includes(content)) {
                      selectContent(content);
                    }
                  }}
                  className={`relative min-w-[72px] px-2 py-1.5 rounded-md border text-[10px] font-bold transition-colors cursor-pointer ${
                    selectedContentModes.includes(content)
                      ? 'bg-white dark:bg-zinc-700 text-stone-900 dark:text-zinc-100 border-white/80 dark:border-white/10 shadow-[0_0_14px_rgba(255,255,255,0.95),0_2px_8px_rgba(0,0,0,0.10)] dark:shadow-[0_0_14px_rgba(255,255,255,0.18)]'
                      : 'bg-white/35 dark:bg-transparent border-black/10 dark:border-white/10 text-stone-600 dark:text-zinc-400'
                  }`}
                >
                  {content}
                  {selectedContentModes.includes(content) && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                </button>
              ))}
            </div>
          </div>
          <div className={`transition-all duration-200 ${isUnlimited ? 'opacity-40 pointer-events-none select-none grayscale-[20%]' : ''}`}>
          <AnimatePresence mode="wait" initial={false}>
            {activeContentPage === '完整人物' ? (
              <motion.div key="figure-categories" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-2 gap-x-4 [@media(min-height:700px)]:gap-x-5">
                <div className="space-y-1.5 [@media(min-height:700px)]:space-y-2.5">
                  <h3 className="mb-2 text-[9px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">人物属性</h3>
                  {figureLeftCategories.map(renderCategory)}
                </div>
                <div className="space-y-1.5 [@media(min-height:700px)]:space-y-2.5">
                  <h3 className="mb-2 text-[9px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">画面属性</h3>
                  {FIGURE_RIGHT_CATEGORIES.map(renderCategory)}
                </div>
              </motion.div>
            ) : activeContentPage === '人体局部' ? (
              <motion.div key="detail-categories" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-2 gap-x-4 [@media(min-height:700px)]:gap-x-5">
                <div className="space-y-1.5 [@media(min-height:700px)]:space-y-2.5">
                  <h3 className="mb-2 text-[9px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">局部属性</h3>
                  {DETAIL_LEFT_CATEGORIES.map(renderCategory)}
                </div>
                <div className="space-y-1.5 [@media(min-height:700px)]:space-y-2.5">
                  <h3 className="mb-2 text-[9px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">画面属性</h3>
                  {FIGURE_RIGHT_CATEGORIES.map(renderCategory)}
                </div>
              </motion.div>
            ) : (
              <motion.div key="general-categories" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-2 gap-x-4 [@media(min-height:700px)]:gap-x-5">
                <div className="space-y-1.5 [@media(min-height:700px)]:space-y-2.5">
                  <h3 className="mb-2 text-[9px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">视觉属性</h3>
                  {GENERAL_REFERENCE_CATEGORIES.slice(0, 2).map(renderCategory)}
                </div>
                <div className="space-y-1.5 [@media(min-height:700px)]:space-y-2.5">
                  <h3 className="mb-2 text-[9px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">画幅属性</h3>
                  {GENERAL_REFERENCE_CATEGORIES.slice(2).map(renderCategory)}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {settings.customTagGroups && settings.customTagGroups.filter(g => g.tags.length > 0).length > 0 && (
            <motion.div layout className="space-y-1.5 pt-2 border-t border-black/5 dark:border-white/5 min-w-0">
              <div className="flex items-center justify-between">
                <h3 className="text-[9px] font-bold tracking-wide text-stone-400 dark:text-zinc-500">自定义分组</h3>
                <span className="text-[8px] text-stone-400 font-semibold">{settings.customTags?.length || 0} 个标签</span>
              </div>
              <div className="space-y-1.5 [@media(min-height:700px)]:space-y-2">
                {settings.customTagGroups.filter(g => g.tags.length > 0).map(renderCategory)}
              </div>
            </motion.div>
          )}
          </div>
        </div>

        <motion.button
          onClick={handleStart}
          className="sticky bottom-0 z-20 isolate mt-auto flex w-full shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-xl bg-stone-200 py-2.5 text-stone-800 shadow-[0_-6px_18px_rgba(250,250,249,0.9)] dark:bg-zinc-800 dark:text-zinc-200 dark:shadow-[0_-6px_18px_rgba(24,24,27,0.9)]"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <div className="absolute z-0 left-1/2 top-1/2 w-[120px] h-[120px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white dark:bg-white/10 shadow-[0_0_24px_rgba(255,255,255,0.85)] dark:shadow-[0_0_24px_rgba(255,255,255,0.08)] pointer-events-none" />
          <motion.div
            className="absolute z-10 left-1/2 top-1/2 w-[180px] h-[180px] rounded-full bg-stone-200 dark:bg-zinc-800 blur-[8px] pointer-events-none will-change-transform"
            initial={{ x: '-170%', y: '-50%' }}
            animate={{ x: ['-170%', '50%'], y: '-50%' }}
            transition={{ duration: 12, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
          />
          <span className="relative z-20 text-sm font-bold tracking-widest">开始练习</span>
          <span className="relative z-20 text-[9px] opacity-70 font-medium tracking-wide">
            {sessionType === 'single' ? (
              isCountLimited ? (
                matchingImagesCount >= Number(imageCount) 
                  ? `${matchingImagesCount} 张符合条件 · 抽取 ${imageCount} 张` 
                  : `${matchingImagesCount} 张符合条件 · 少于设定的 ${imageCount} 张`
              ) : (
                `${matchingImagesCount} 张符合条件 · 全部抽取`
              )
            ) : (
              matchingImagesCount >= actualCount 
                ? `${matchingImagesCount} 张符合条件 · 包含 ${actualCount} 张阶梯` 
                : `${matchingImagesCount} 张符合条件 · 少于阶梯需要的 ${actualCount} 张`
            )}
            {totalTimeSec > 0 && ` · 预计 ${Math.ceil(totalTimeSec / 60)} 分钟`}
          </span>
        </motion.button>

        <SetEditorModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={newSet => {
            saveSet(newSet);
            loadSet(newSet);
            setIsModalOpen(false);
          }}
        />
      </section>
    </div>
  );
};
