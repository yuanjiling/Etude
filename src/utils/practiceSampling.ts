import type { ImageRecord } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

const practiceWeight = (image: ImageRecord, now: number) => {
  if (!image.last_seen || image.practice_count <= 0) return 2.4;
  const daysSincePractice = Math.max(0, (now - image.last_seen) / DAY_MS);
  const recencyWeight = daysSincePractice < 1
    ? 0.18
    : daysSincePractice < 7
      ? 0.4
      : daysSincePractice < 30
        ? 0.8
        : 1.25;
  const repetitionWeight = 1 / (1 + Math.sqrt(image.practice_count) * 0.22);
  return Math.max(0.05, recencyWeight * repetitionWeight);
};

export const weightedPracticeShuffle = <T extends ImageRecord | { image: ImageRecord }>(items: T[]): T[] => {
  const now = Date.now();
  return items
    .map(entry => {
      const record: ImageRecord = 'image' in entry && (entry as any).image ? (entry as any).image : (entry as ImageRecord);
      return {
        entry,
        key: -Math.log(Math.max(Number.EPSILON, Math.random())) / practiceWeight(record, now),
      };
    })
    .sort((left, right) => left.key - right.key)
    .map(wrap => wrap.entry);
};

export const samplePracticePool = <T extends ImageRecord | { image: ImageRecord }>(
  items: T[],
  prioritizeUndrawn: boolean = true
): T[] => {
  if (!prioritizeUndrawn || items.length <= 1) {
    return weightedPracticeShuffle(items);
  }

  const undrawn: T[] = [];
  const drawn: T[] = [];

  for (const entry of items) {
    const record: ImageRecord = 'image' in entry && (entry as any).image ? (entry as any).image : (entry as ImageRecord);
    if (!record.practice_count || record.practice_count <= 0) {
      undrawn.push(entry);
    } else {
      drawn.push(entry);
    }
  }

  // 若全部都是已画过或全部都是未画过，直接进行加权随机
  if (undrawn.length === 0) {
    return weightedPracticeShuffle(drawn);
  }
  if (drawn.length === 0) {
    return weightedPracticeShuffle(undrawn);
  }

  // 优先排布未画过的素材；当需求量超过未画过的素材总数时，顺延从已画过（加权随机）中补充
  return [
    ...weightedPracticeShuffle(undrawn),
    ...weightedPracticeShuffle(drawn),
  ];
};

