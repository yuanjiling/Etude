import type { ObjectDetector } from '@mediapipe/tasks-vision';
import type { ContentRoutingAnalysis, ImageRecord, PersonDetectionBox, PoseAnalysis, VisualAnalysis } from '../types';
import { analyzePoseFocus, POSE_MODEL_VERSION } from './poseFocus';

export const CONTENT_ROUTER_VERSION = 'mediapipe-efficientdet-lite0-rules-v1';
export const VISUAL_ANALYSIS_VERSION = 'canvas-lab-lightness-aspect-v3';

export const isAnalysisComplete = (image: ImageRecord): boolean => {
  if (!image.contentRouting || image.contentRouting.modelVersion !== CONTENT_ROUTER_VERSION) return false;
  if (image.contentRouting.scope === 'general_reference') {
    return image.visualAnalysis?.modelVersion === VISUAL_ANALYSIS_VERSION;
  }
  return image.poseAnalysis?.modelVersion === POSE_MODEL_VERSION;
};

const PERSON_SCORE_THRESHOLD = 0.35;
const MAX_INFERENCE_EDGE = 1440;
let detectorPromise: Promise<ObjectDetector> | null = null;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`无法读取图片：${src}`));
  image.src = src;
});

const prepareInferenceImage = async (image: HTMLImageElement) => {
  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
  if (longestEdge <= MAX_INFERENCE_EDGE || typeof createImageBitmap !== 'function') {
    return { source: image as HTMLImageElement | ImageBitmap, release: () => undefined };
  }
  const scale = MAX_INFERENCE_EDGE / longestEdge;
  const bitmap = await createImageBitmap(image, {
    resizeWidth: Math.max(1, Math.round(image.naturalWidth * scale)),
    resizeHeight: Math.max(1, Math.round(image.naturalHeight * scale)),
    resizeQuality: 'medium',
  });
  return { source: bitmap as HTMLImageElement | ImageBitmap, release: () => bitmap.close() };
};

const yieldForBrowserFrame = () => new Promise<void>(resolve => {
  requestAnimationFrame(() => window.setTimeout(resolve, 0));
});

const getDetector = () => {
  if (!detectorPromise) {
    detectorPromise = import('@mediapipe/tasks-vision').then(async ({ FilesetResolver, ObjectDetector }) => {
      const wasm = await FilesetResolver.forVisionTasks('/mediapipe');
      return ObjectDetector.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: '/models/efficientdet_lite0_uint8.tflite', delegate: 'CPU' },
        runningMode: 'IMAGE',
        scoreThreshold: PERSON_SCORE_THRESHOLD,
        maxResults: 10,
        categoryAllowlist: ['person'],
      });
    });
  }
  return detectorPromise;
};

const boxArea = (box: PersonDetectionBox) => box.width * box.height;

const unionArea = (boxes: PersonDetectionBox[]) => {
  if (boxes.length === 0) return 0;
  const xs = Array.from(new Set(boxes.flatMap(box => [box.x, box.x + box.width]))).sort((a, b) => a - b);
  let area = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const x1 = xs[index];
    const x2 = xs[index + 1];
    const intervals = boxes
      .filter(box => box.x < x2 && box.x + box.width > x1)
      .map(box => [box.y, box.y + box.height] as const)
      .sort((left, right) => left[0] - right[0]);
    if (intervals.length === 0) continue;
    let coveredHeight = 0;
    let start = intervals[0][0];
    let end = intervals[0][1];
    intervals.slice(1).forEach(([nextStart, nextEnd]) => {
      if (nextStart <= end) end = Math.max(end, nextEnd);
      else {
        coveredHeight += end - start;
        start = nextStart;
        end = nextEnd;
      }
    });
    area += (x2 - x1) * (coveredHeight + end - start);
  }
  return clamp(area);
};

const boxCenterScore = (box: PersonDetectionBox) => {
  const distance = Math.hypot(box.x + box.width / 2 - 0.5, box.y + box.height / 2 - 0.5) / Math.SQRT1_2;
  return clamp(1 - distance);
};

const routeContent = (boxes: PersonDetectionBox[], poseAnalysis: PoseAnalysis): ContentRoutingAnalysis => {
  const maxPersonArea = boxes.reduce((maximum, box) => Math.max(maximum, boxArea(box)), 0);
  const unionPersonArea = unionArea(boxes);
  const mostProminent = boxes.reduce<PersonDetectionBox | undefined>((current, box) => (
    !current || boxArea(box) > boxArea(current) ? box : current
  ), undefined);
  const centerScore = mostProminent ? boxCenterScore(mostProminent) : 0;
  const poseDetected = poseAnalysis.status === 'detected';
  const evidence = {
    personCount: boxes.length,
    maxPersonArea,
    unionPersonArea,
    centerScore,
    poseDetected,
    personBoxes: boxes,
  };

  if (boxes.length === 0 && !poseDetected) {
    return { modelVersion: CONTENT_ROUTER_VERSION, scope: 'general_reference', confidence: 0.9, evidence };
  }
  if (
    maxPersonArea >= 0.2
    || unionPersonArea >= 0.3
    || (maxPersonArea >= 0.08 && centerScore >= 0.65 && poseDetected)
  ) {
    const confidence = clamp(0.72 + Math.max(maxPersonArea, unionPersonArea) * 0.65, 0.72, 0.96);
    return { modelVersion: CONTENT_ROUTER_VERSION, scope: 'human_dominant', confidence, evidence };
  }
  if (boxes.length > 0 && maxPersonArea <= 0.05 && unionPersonArea <= 0.12) {
    return { modelVersion: CONTENT_ROUTER_VERSION, scope: 'general_reference', confidence: 0.8, evidence };
  }
  return { modelVersion: CONTENT_ROUTER_VERSION, scope: 'uncertain', confidence: 0.5, evidence };
};

const rgbToHsl = (red: number, green: number, blue: number) => {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const lightness = (maximum + minimum) / 2;
  if (maximum === minimum) return { hue: 0, saturation: 0, lightness };
  const delta = maximum - minimum;
  const saturation = lightness > 0.5 ? delta / (2 - maximum - minimum) : delta / (maximum + minimum);
  const hueBase = maximum === r
    ? (g - b) / delta + (g < b ? 6 : 0)
    : maximum === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: hueBase * 60, saturation, lightness };
};

const dominantColorTag = (pixels: Uint8ClampedArray) => {
  const hueWeights = new Array<number>(8).fill(0);
  let validPixels = 0;
  let chromaticPixels = 0;
  let saturationSum = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    const { hue, saturation, lightness } = rgbToHsl(pixels[index], pixels[index + 1], pixels[index + 2]);
    if (lightness <= 0.03 || lightness >= 0.97) continue;
    validPixels += 1;
    saturationSum += saturation;
    if (saturation < 0.1) continue;
    chromaticPixels += 1;
    const usefulLightness = lightness > 0.06 && lightness < 0.94 ? 1 : 0.35;
    const weight = usefulLightness * saturation;
    const bin = hue < 15 || hue >= 345 ? 0
      : hue < 45 ? 1
        : hue < 70 ? 2
          : hue < 165 ? 3
            : hue < 195 ? 4
              : hue < 255 ? 5
                : hue < 300 ? 6 : 7;
    hueWeights[bin] += weight;
  }
  if (validPixels === 0) return '灰阶';
  const chromaticCoverage = chromaticPixels / validPixels;
  const averageSaturation = saturationSum / validPixels;
  if (chromaticCoverage < 0.08 && averageSaturation < 0.08) return '灰阶';
  const labels = ['红色调', '橙色调', '黄色调', '绿色调', '青色调', '蓝色调', '紫色调', '粉色调'];
  const index = hueWeights.reduce((best, value, current) => value > hueWeights[best] ? current : best, 0);
  return labels[index];
};

const srgbToLinear = (channel: number) => {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

const perceptualLightness = (red: number, green: number, blue: number) => {
  const relativeLuminance = (
    0.2126 * srgbToLinear(red)
    + 0.7152 * srgbToLinear(green)
    + 0.0722 * srgbToLinear(blue)
  );
  const delta = 6 / 29;
  const transformed = relativeLuminance > delta ** 3
    ? Math.cbrt(relativeLuminance)
    : relativeLuminance / (3 * delta ** 2) + 4 / 29;
  return (116 * transformed - 16) / 100;
};

const contrastTag = (pixels: Uint8ClampedArray): VisualAnalysis['contrast'] => {
  const lightnessValues: number[] = [];
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    lightnessValues.push(perceptualLightness(pixels[index], pixels[index + 1], pixels[index + 2]));
  }
  lightnessValues.sort((left, right) => left - right);
  if (lightnessValues.length === 0) return '中对比';
  const percentile = (value: number) => lightnessValues[Math.floor((lightnessValues.length - 1) * value)];
  const range = percentile(0.9) - percentile(0.1);
  if (range < 0.25) return '低对比';
  if (range >= 0.5) return '高对比';
  return '中对比';
};

export const classifyAspectRatio = (width: number, height: number) => {
  const aspectRatio = width > 0 && height > 0 ? width / height : 1;
  const longSideRatio = Math.max(aspectRatio, 1 / aspectRatio);
  const orientation: VisualAnalysis['orientation'] = longSideRatio <= 1.08
    ? '方形'
    : aspectRatio > 1 ? '横幅' : '竖幅';
  const candidates = [
    { ratio: 1, tag: '1:1画幅' },
    { ratio: 4 / 3, tag: '4:3画幅' },
    { ratio: 3 / 2, tag: '3:2画幅' },
    { ratio: 16 / 10, tag: '16:10画幅' },
    { ratio: 16 / 9, tag: '16:9画幅' },
    { ratio: 2, tag: '2:1画幅' },
  ];
  const closest = candidates.reduce((best, candidate) => (
    Math.abs(Math.log(longSideRatio / candidate.ratio)) < Math.abs(Math.log(longSideRatio / best.ratio))
      ? candidate : best
  ));
  return {
    aspectRatio,
    orientation,
    aspectRatioTag: longSideRatio > 2.2 ? '超宽画幅' : closest.tag,
  };
};

const analyzeVisual = (image: HTMLImageElement): VisualAnalysis => {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 96 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建图片分析画布');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return {
    modelVersion: VISUAL_ANALYSIS_VERSION,
    dominantColor: dominantColorTag(pixels),
    contrast: contrastTag(pixels),
    ...classifyAspectRatio(image.naturalWidth, image.naturalHeight),
  };
};

export const visualAnalysisTags = (analysis: VisualAnalysis) => [
  '综合参考', analysis.dominantColor, analysis.contrast, analysis.orientation, analysis.aspectRatioTag,
];

export const analyzeContent = async (src: string) => {
  const [detector, image] = await Promise.all([getDetector(), loadImage(src)]);
  const inferenceImage = await prepareInferenceImage(image);
  try {
    const detectionResult = detector.detect(inferenceImage.source);
    await yieldForBrowserFrame();
    const poseAnalysis = await analyzePoseFocus(inferenceImage.source);
    const width = Math.max(1, 'naturalWidth' in inferenceImage.source
      ? inferenceImage.source.naturalWidth
      : inferenceImage.source.width);
    const height = Math.max(1, 'naturalHeight' in inferenceImage.source
      ? inferenceImage.source.naturalHeight
      : inferenceImage.source.height);
    const personBoxes = detectionResult.detections.flatMap(detection => {
      const box = detection.boundingBox;
      const confidence = detection.categories[0]?.score ?? 0;
      if (!box || confidence < PERSON_SCORE_THRESHOLD) return [];
      return [{
        x: clamp(box.originX / width),
        y: clamp(box.originY / height),
        width: clamp(box.width / width),
        height: clamp(box.height / height),
        confidence,
      }];
    });
    return {
      poseAnalysis,
      contentRouting: routeContent(personBoxes, poseAnalysis),
      visualAnalysis: analyzeVisual(image),
    };
  } finally {
    inferenceImage.release();
  }
};
