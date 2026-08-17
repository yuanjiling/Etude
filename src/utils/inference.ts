export type InferencePerformance = 'responsive' | 'balanced' | 'maximum';

export interface InferenceRunOptions {
  preferGpu: boolean;
  performance: InferencePerformance;
  onGpuFallback?: (reason: string) => void;
}

export const inferenceProfile = (performance: InferencePerformance) => {
  const logicalCores = Math.max(1, navigator.hardwareConcurrency || 4);
  if (performance === 'responsive') {
    return {
      cpuThreads: Math.max(1, Math.floor(logicalCores * 0.25)),
      interactionQuietMs: 240,
      idleTimeoutMs: 700,
      betweenImagesMs: 48,
    };
  }
  if (performance === 'maximum') {
    return {
      cpuThreads: 0,
      interactionQuietMs: 60,
      idleTimeoutMs: 120,
      betweenImagesMs: 0,
    };
  }
  return {
    cpuThreads: Math.max(1, Math.floor(logicalCores * 0.5)),
    interactionQuietMs: 140,
    idleTimeoutMs: 320,
    betweenImagesMs: 16,
  };
};
