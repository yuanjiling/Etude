const TAG_MAP: Record<string, string> = {
  figure: '完整人物', body_detail: '人体局部',
  hand: '手', foot: '足', arm: '臂', leg: '腿', torso: '躯干', head_face: '头部面部', pelvis_hip: '骨盆臀部',
  single: '单人', two_people: '双人', group: '群体',
  male: '男性', female: '女性', male_only: '纯男', female_only: '纯女', mixed: '混合',
  nude: '裸体', partially_clothed: '部分着装', clothed: '完整着装',
  full_body: '全身', body_crop: '身体裁切', portrait: '头肩肖像',
  standing: '站', sitting: '坐', kneeling: '跪', crouching: '蹲', lying: '躺',
  static: '静态', active: '动态',
  no_props: '无道具', props: '有道具',
  eye_level: '平视', high_angle: '俯视', low_angle: '仰视',
  front: '正面', back: '背面', side: '纯侧面',
};

export const mapModelTags = (result: unknown): string[] => {
  const labels = (result as { labels?: Record<string, unknown> } | null)?.labels;
  if (!labels) return [];
  const mapped = Object.values(labels)
    .flatMap(value => String(value || '').split('|'))
    .map(value => TAG_MAP[value])
    .filter((tag): tag is string => Boolean(tag));
  return Array.from(new Set(mapped));
};
