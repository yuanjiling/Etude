import type { FocusRegion } from '../types';

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
