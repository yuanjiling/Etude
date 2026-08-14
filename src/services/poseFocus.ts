import type { NormalizedLandmark, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { BodyPartTag, FocusRegion, PoseAnalysis } from '../types';

export const POSE_MODEL_VERSION = 'mediapipe-pose-lite-f16-v6-compact-torso';

const MIN_VISIBILITY = 0.35;
const GROUPS = [
  { id: 'head_face', tag: '头部面部', indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], paddingX: 0.48, paddingY: 0.48, minPoints: 4, minSize: 0.08 },
  { id: 'bust', tag: '躯干', indices: [0, 7, 8, 11, 12, 13, 14], paddingX: 0.28, paddingY: 0.28, minPoints: 4, minSize: 0.12 },
  { id: 'torso', tag: '躯干', indices: [11, 12, 23, 24], paddingX: 0.24, paddingY: 0.24, minPoints: 3, minSize: 0.12 },
  { id: 'pelvis_hip', tag: '骨盆臀部', indices: [23, 24], paddingX: 0.42, paddingY: 0.42, minPoints: 2, minSize: 0.1 },
  { id: 'left_arm', tag: '臂', indices: [11, 13, 15, 17, 19, 21], paddingX: 0.3, paddingY: 0.3, minPoints: 3, minSize: 0.07 },
  { id: 'right_arm', tag: '臂', indices: [12, 14, 16, 18, 20, 22], paddingX: 0.3, paddingY: 0.3, minPoints: 3, minSize: 0.07 },
  { id: 'left_hand', tag: '手', indices: [15, 17, 19, 21], paddingX: 0.95, paddingY: 0.95, minPoints: 2, minSize: 0.055 },
  { id: 'right_hand', tag: '手', indices: [16, 18, 20, 22], paddingX: 0.95, paddingY: 0.95, minPoints: 2, minSize: 0.055 },
  { id: 'legs', tag: '腿', indices: [23, 24, 25, 26, 27, 28], paddingX: 0.2, paddingY: 0.2, minPoints: 4, minSize: 0.1 },
  { id: 'left_foot', tag: '足', indices: [27, 29, 31], paddingX: 1, paddingY: 0.85, bottomExtension: 0.4, minPoints: 2, minSize: 0.055 },
  { id: 'right_foot', tag: '足', indices: [28, 30, 32], paddingX: 1, paddingY: 0.85, bottomExtension: 0.4, minPoints: 2, minSize: 0.055 },
] as const;

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const getLandmarker = () => {
  if (!landmarkerPromise) {
    landmarkerPromise = import('@mediapipe/tasks-vision').then(async ({ FilesetResolver, PoseLandmarker }) => {
      const wasm = await FilesetResolver.forVisionTasks('/mediapipe');
      return PoseLandmarker.createFromOptions(wasm, {
        baseOptions: {
          modelAssetPath: '/models/pose_landmarker_lite.task',
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        numPoses: 6,
        minPoseDetectionConfidence: 0.35,
        minPosePresenceConfidence: 0.35,
        outputSegmentationMasks: false,
      });
    });
  }
  return landmarkerPromise;
};

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`无法读取图片：${src}`));
  image.src = src;
});

const landmarkScore = (landmark: NormalizedLandmark) => landmark.visibility ?? 1;

const createRegion = (
  landmarks: NormalizedLandmark[],
  id: string,
  personIndex: number,
  tag: BodyPartTag,
  indices: readonly number[],
  paddingX: number,
  paddingY: number,
  bottomExtension: number,
  minPoints: number,
  minSize: number,
): FocusRegion | null => {
  const points = indices
    .map(index => landmarks[index])
    .filter((point): point is NormalizedLandmark => Boolean(point) && landmarkScore(point) >= MIN_VISIBILITY);
  if (points.length < minPoints) return null;

  const minX = Math.min(...points.map(point => point.x));
  const maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y));
  const maxY = Math.max(...points.map(point => point.y));
  const rawWidth = Math.max(minSize, maxX - minX);
  const rawHeight = Math.max(minSize, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const halfWidth = rawWidth * (0.5 + paddingX);
  const halfHeight = rawHeight * (0.5 + paddingY);
  const x1 = clamp(centerX - halfWidth);
  const y1 = clamp(centerY - halfHeight);
  const x2 = clamp(centerX + halfWidth);
  const y2 = clamp(centerY + halfHeight + rawHeight * bottomExtension);

  if (x2 - x1 < 0.02 || y2 - y1 < 0.02) return null;
  return {
    id,
    personIndex,
    tag,
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    confidence: points.reduce((sum, point) => sum + landmarkScore(point), 0) / points.length,
  };
};

const mergeNearbyPair = (
  regions: FocusRegion[],
  tag: BodyPartTag,
  mergedId: string,
): FocusRegion[] => {
  const pair = regions.filter(region => region.tag === tag);
  if (pair.length !== 2) return regions;
  const [first, second] = pair;
  const horizontalGap = Math.max(
    0,
    Math.max(first.x, second.x) - Math.min(first.x + first.width, second.x + second.width),
  );
  const verticalGap = Math.max(
    0,
    Math.max(first.y, second.y) - Math.min(first.y + first.height, second.y + second.height),
  );
  const nearHorizontally = horizontalGap <= Math.max(first.width, second.width) * 0.8;
  const nearVertically = verticalGap <= Math.max(first.height, second.height) * 0.8;
  if (!nearHorizontally || !nearVertically) return regions;

  const x1 = Math.min(first.x, second.x);
  const y1 = Math.min(first.y, second.y);
  const x2 = Math.max(first.x + first.width, second.x + second.width);
  const y2 = Math.max(first.y + first.height, second.y + second.height);
  const unionWidth = x2 - x1;
  const unionHeight = y2 - y1;
  const merged: FocusRegion = {
    id: mergedId,
    personIndex: first.personIndex,
    tag,
    x: clamp(x1 - unionWidth * 0.1),
    y: clamp(y1 - unionHeight * 0.1),
    width: 0,
    height: 0,
    confidence: (first.confidence + second.confidence) / 2,
  };
  const mergedX2 = clamp(x2 + unionWidth * 0.1);
  const mergedY2 = clamp(y2 + unionHeight * 0.1);
  merged.width = mergedX2 - merged.x;
  merged.height = mergedY2 - merged.y;

  const firstIndex = regions.findIndex(region => region === first || region === second);
  const remaining = regions.filter(region => region !== first && region !== second);
  remaining.splice(firstIndex, 0, merged);
  return remaining;
};

const keepSmallestRegionForTag = (
  regions: FocusRegion[],
  tag: BodyPartTag,
): FocusRegion[] => {
  const matching = regions.filter(region => region.tag === tag);
  if (matching.length <= 1) return regions;
  const smallest = matching.reduce((current, region) => (
    region.width * region.height < current.width * current.height ? region : current
  ));
  return regions.filter(region => region.tag !== tag || region === smallest);
};

export const analyzePoseFocus = async (src: string): Promise<PoseAnalysis> => {
  const [landmarker, image] = await Promise.all([getLandmarker(), loadImage(src)]);
  const result = landmarker.detect(image);
  if (result.landmarks.length === 0) {
    return { modelVersion: POSE_MODEL_VERSION, status: 'not_found', regions: [] };
  }

  const regions = result.landmarks.flatMap((landmarks, personIndex) => {
    const personId = `person_${personIndex + 1}`;
    const personRegions = GROUPS
      .map(group => createRegion(
        landmarks,
        `${personId}_${group.id}`,
        personIndex,
        group.tag,
        group.indices,
        group.paddingX,
        group.paddingY,
        'bottomExtension' in group ? group.bottomExtension : 0,
        group.minPoints,
        group.minSize,
      ))
      .filter((region): region is FocusRegion => region !== null);
    const compactRegions = keepSmallestRegionForTag(personRegions, '躯干');
    return mergeNearbyPair(
      mergeNearbyPair(compactRegions, '手', `${personId}_hands`),
      '足',
      `${personId}_feet`,
    );
  });
  return {
    modelVersion: POSE_MODEL_VERSION,
    status: regions.length > 0 ? 'detected' : 'not_found',
    regions,
  };
};
