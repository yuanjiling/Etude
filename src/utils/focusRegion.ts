import type { FocusRegion } from '../types';

export interface FocusFrame {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

/**
 * Returns the exact source-image frame used for a virtual body-part crop.
 * Hand and foot frames receive the same symmetric aspect-ratio padding in
 * every place that renders or overlays the crop.
 */
export const getFocusFrame = (
  region: FocusRegion,
  naturalWidth: number,
  naturalHeight: number,
): FocusFrame => {
  let width = region.width * naturalWidth;
  let height = region.height * naturalHeight;

  if (region.tag === '手' || region.tag === '足') {
    const aspect = width / Math.max(height, 1);
    if (aspect < 0.65) width = height * 0.65;
    if (aspect > 1.5) height = width / 1.5;
  }

  return {
    centerX: (region.x + region.width / 2) * naturalWidth,
    centerY: (region.y + region.height / 2) * naturalHeight,
    width: Math.max(width, 1),
    height: Math.max(height, 1),
  };
};

export const BODY_PART_TAGS = ['手', '足', '臂', '腿', '躯干', '头部面部', '骨盆臀部'] as const;

const REPLACED_SOURCE_TAGS = new Set([
  '完整人物',
  '人体局部',
  ...BODY_PART_TAGS,
]);

export const getVirtualFocusTags = (sourceTags: string[], region: FocusRegion): string[] => (
  Array.from(new Set([
    '人体局部',
    region.tag,
    ...sourceTags.filter(tag => !REPLACED_SOURCE_TAGS.has(tag)),
  ]))
);
