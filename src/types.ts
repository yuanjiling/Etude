export type ViewMode = 'practice' | 'library' | 'sets' | 'history' | 'active_practice' | 'settings';

export interface PracticeShortcuts {
  togglePause: string;
  nextImage: string;
  previousImage: string;
  toggleClickThrough: string;
  toggleControls: string;
  resetTimer: string;
  exitPractice: string;
}

export interface CustomTagGroup {
  id: string;
  name: string;
  tags: string[];
}

export interface AppSettings {
  settingsVersion: number;
  theme: 'system' | 'light' | 'dark';
  preparationSec: number;
  transitionSec: number;
  soundEnabled: boolean;
  defaultGrid: boolean;
  defaultFlip: boolean;
  defaultGrayscale: boolean;
  defaultClickThrough: boolean;
  bgOpacity: number;
  canvasOpacity: number;
  timerSize: number;
  gridColor: string;
  gridDensity: number;
  gridLineWidth: number;
  gridOpacity: number;
  flipAnimation: boolean;
  libraryThumbnailWidth: number;
  startAlwaysOnTop: boolean;
  shortcuts: PracticeShortcuts;
  customTagGroups: CustomTagGroup[];
  customTags: string[];
  practiceContentTypes?: string[];
  prioritizeUndrawnImages?: boolean;
  inferencePerformance: 'responsive' | 'balanced' | 'maximum';
  gpuInferenceEnabled: boolean;
}

export type BodyPartTag = '手' | '足' | '臂' | '腿' | '躯干' | '头部面部' | '骨盆臀部';

export interface FocusRegion {
  id: string;
  personIndex?: number;
  tag: BodyPartTag;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface PoseAnalysis {
  modelVersion: string;
  status: 'detected' | 'not_found';
  regions: FocusRegion[];
}

export interface PersonDetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface ContentRoutingAnalysis {
  modelVersion: string;
  scope: 'human_dominant' | 'general_reference' | 'uncertain';
  confidence: number;
  manuallyCorrected?: boolean;
  evidence: {
    personCount: number;
    maxPersonArea: number;
    unionPersonArea: number;
    centerScore: number;
    poseDetected: boolean;
    personBoxes: PersonDetectionBox[];
  };
}

export interface VisualAnalysis {
  modelVersion: string;
  dominantColor: string;
  contrast: '低对比' | '中对比' | '高对比';
  orientation: '横幅' | '竖幅' | '方形';
  aspectRatio: number;
  aspectRatioTag: string;
}

export interface ImageRecord {
  id: string;
  url: string;
  thumbnailUrl?: string;
  sourcePath?: string;
  libraryRelativePath?: string;
  fileName?: string;
  fileSize?: number;
  modifiedAt?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  tagStatus?: 'pending' | 'tagged' | 'outdated' | 'failed';
  tagError?: string;
  poseAnalysis?: PoseAnalysis;
  contentRouting?: ContentRoutingAnalysis;
  visualAnalysis?: VisualAnalysis;
  tags: string[];
  practice_count: number;
  last_seen?: number;
  favorite: boolean;
  hidden: boolean;
  skip_count: number;
}

export type SessionType = 'single' | 'progressive';

export interface StageConfig {
  id?: string;
  durationSec: number;
  count: number;
  includeTags?: string[];
  excludeTags?: string[];
}

export interface PracticeConfig {
  includeTags: string[];
  excludeTags: string[];
  imageIds?: string[];
  practiceItems?: Array<{ imageId: string; focusRegionId?: string }>;
  sessionType: SessionType;
  singleTimeSec?: number; // for single
  imageCount?: number;    // for single
  progressiveStages?: StageConfig[]; // for progressive
  folder?: string;        // restrict the pool to a library folder
}

export interface PracticeSet {
  id: string;
  name: string;
  config: PracticeConfig;
}

export interface HistoryRecord {
  id: string;
  date: number; // timestamp
  durationSec: number;
  imageCount: number;
  images: ImageRecord[];
  items?: HistoryItem[];
}

export interface HistoryItem {
  image: ImageRecord;
  focusRegion?: FocusRegion;
}
