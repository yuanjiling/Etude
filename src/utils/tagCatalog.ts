export const CONTENT_TAGS = ['完整人物', '人体局部', '综合参考'] as const;
export const BODY_PART_TAGS = ['手', '足', '臂', '腿', '躯干', '头部面部', '骨盆臀部'] as const;
export const COLOR_TAGS = ['红色调', '橙色调', '黄色调', '绿色调', '青色调', '蓝色调', '紫色调', '粉色调', '灰阶'] as const;
export const CONTRAST_TAGS = ['低对比', '中对比', '高对比'] as const;
export const ORIENTATION_TAGS = ['横幅', '竖幅', '方形'] as const;
export const ASPECT_RATIO_TAGS = ['1:1画幅', '4:3画幅', '3:2画幅', '16:10画幅', '16:9画幅', '2:1画幅', '超宽画幅'] as const;

export const GENERAL_REFERENCE_CATEGORIES = [
  { name: '主色调', tags: [...COLOR_TAGS] },
  { name: '对比度', tags: [...CONTRAST_TAGS] },
  { name: '方向', tags: [...ORIENTATION_TAGS] },
  { name: '画幅', tags: [...ASPECT_RATIO_TAGS] },
];

export const TAG_CATEGORIES = [
  { name: '练习', tags: ['从未画', '久未画', '画过'] },
  { name: '内容', tags: [...CONTENT_TAGS] },
  { name: '部位', tags: [...BODY_PART_TAGS] },
  { name: '人数', tags: ['单人', '双人', '群体'] },
  { name: '性别', tags: ['男性', '女性', '纯男', '纯女', '混合'] },
  { name: '穿着', tags: ['裸体', '部分着装', '完整着装'] },
  { name: '景别', tags: ['全身', '身体裁切', '头肩肖像'] },
  { name: '姿势', tags: ['站', '坐', '跪', '蹲', '躺'] },
  { name: '动态', tags: ['静态', '动态'] },
  { name: '机位', tags: ['平视', '俯视', '仰视'] },
  { name: '视角', tags: ['正面', '背面', '纯侧面'] },
  ...GENERAL_REFERENCE_CATEGORIES,
];

export const FIGURE_TAG_GROUPS: readonly (readonly string[])[] = [
  ['全身', '身体裁切', '头肩肖像'],
  ['单人', '双人', '群体'],
  ['男性', '女性', '纯男', '纯女', '混合'],
  ['裸体', '部分着装', '完整着装'],
  ['站', '坐', '跪', '蹲', '躺'],
  ['静态', '动态'],
  ['平视', '俯视', '仰视'],
  ['正面', '背面', '纯侧面'],
];

export const PART_TAG_GROUPS: readonly (readonly string[])[] = [
  [...BODY_PART_TAGS],
  ['男性', '女性', '混合'],
  ['裸体', '部分着装', '完整着装'],
  ['站', '坐', '跪', '蹲', '躺'],
  ['静态', '动态'],
  ['平视', '俯视', '仰视'],
  ['正面', '背面', '纯侧面'],
];

export const GENERAL_TAG_GROUPS: readonly (readonly string[])[] = [
  [...COLOR_TAGS],
  [...CONTRAST_TAGS],
  [...ORIENTATION_TAGS],
  [...ASPECT_RATIO_TAGS],
];

export const matchesBranchTags = (
  itemTags: string[],
  includeTags: string[],
  excludeTags: string[],
  categoryGroups: readonly (readonly string[])[],
): boolean => {
  if (excludeTags && excludeTags.some(tag => itemTags.includes(tag))) return false;
  if (!includeTags || includeTags.length === 0) return true;

  const relevantInclude = includeTags.filter(tag => categoryGroups.some(group => group.includes(tag)));
  if (relevantInclude.length === 0) return true;

  const activeGroups = categoryGroups
    .map(group => group.filter(tag => relevantInclude.includes(tag)))
    .filter(group => group.length > 0);

  return activeGroups.every(group => group.some(tag => itemTags.includes(tag)));
};

export const FILTER_TAG_GROUPS = TAG_CATEGORIES
  .filter(category => category.name !== '练习')
  .map(category => category.tags);

export const COMPACT_VISUAL_TAG_LABELS: Record<string, string> = {
  红色调: '红',
  橙色调: '橙',
  黄色调: '黄',
  绿色调: '绿',
  青色调: '青',
  蓝色调: '蓝',
  紫色调: '紫',
  粉色调: '粉',
  灰阶: '灰',
  低对比: '低',
  中对比: '中',
  高对比: '高',
  横幅: '横',
  竖幅: '竖',
  方形: '方',
  '1:1画幅': '1:1',
  '4:3画幅': '4:3',
  '3:2画幅': '3:2',
  '16:10画幅': '16:10',
  '16:9画幅': '16:9',
  '2:1画幅': '2:1',
  超宽画幅: '超宽',
};

export const compactVisualTagLabel = (tag: string) => COMPACT_VISUAL_TAG_LABELS[tag] || tag;

export const compactAspectRatioLabel = (tag: string) => (
  ASPECT_RATIO_TAGS.includes(tag as typeof ASPECT_RATIO_TAGS[number])
    ? compactVisualTagLabel(tag)
    : tag
);
