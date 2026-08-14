import { ImageRecord, PracticeSet } from './types';

export const MOCK_TAGS = [
  '完整人物', '人体局部',
  '全身', '身体裁切', '头肩肖像',
  '站', '坐', '跪', '蹲', '躺',
  '正面', '背面', '纯侧面',
  '平视', '俯视', '仰视'
];

export const MOCK_IMAGES: ImageRecord[] = [
  { id: '1', url: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&q=80&w=800', tags: ['完整人物', '全身', '站', '平视'], tagStatus: 'tagged', practice_count: 0, favorite: false, hidden: false, skip_count: 0 },
  { id: '2', url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=800', tags: ['完整人物', '头肩肖像', '正面', '平视'], tagStatus: 'tagged', practice_count: 2, favorite: true, hidden: false, skip_count: 0 },
  { id: '3', url: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&q=80&w=800', tags: ['完整人物', '全身', '动态'], tagStatus: 'tagged', practice_count: 1, favorite: false, hidden: false, skip_count: 0 },
  { id: '4', url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=800', tags: ['完整人物', '身体裁切', '正面'], tagStatus: 'tagged', practice_count: 0, favorite: false, hidden: false, skip_count: 0 },
  { id: '5', url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=800', tags: ['完整人物', '头肩肖像', '正面'], tagStatus: 'tagged', practice_count: 5, favorite: true, hidden: false, skip_count: 0 },
  { id: '6', url: 'https://images.unsplash.com/photo-1555685812-4b943f1cb0eb?auto=format&fit=crop&q=80&w=800', tags: ['人体局部', '身体裁切', '站'], tagStatus: 'tagged', practice_count: 0, favorite: false, hidden: false, skip_count: 0 },
  { id: '7', url: 'https://images.unsplash.com/photo-1472491235688-bdc81a63246e?auto=format&fit=crop&q=80&w=800', tags: ['人体局部', '身体裁切', '坐'], tagStatus: 'tagged', practice_count: 1, favorite: false, hidden: false, skip_count: 0 },
  { id: '8', url: 'https://images.unsplash.com/photo-1480796927426-f609979314bd?auto=format&fit=crop&q=80&w=800', tags: ['完整人物', '全身', '站', '俯视'], tagStatus: 'tagged', practice_count: 0, favorite: false, hidden: false, skip_count: 0 },
  { id: '9', url: 'https://images.unsplash.com/photo-1511818966892-d7d671e672a2?auto=format&fit=crop&q=80&w=800', tags: ['完整人物', '身体裁切', '坐', '纯侧面'], tagStatus: 'tagged', practice_count: 0, favorite: false, hidden: false, skip_count: 0 },
  { id: '10', url: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&q=80&w=800', tags: ['完整人物', '头肩肖像', '纯侧面'], tagStatus: 'tagged', practice_count: 0, favorite: false, hidden: false, skip_count: 0 },
  { id: '11', url: 'https://images.unsplash.com/photo-1520113412548-bc1c9bd00cfa?auto=format&fit=crop&q=80&w=800', tags: ['完整人物', '全身', '动态'], tagStatus: 'tagged', practice_count: 0, favorite: false, hidden: false, skip_count: 0 },
  { id: '12', url: 'https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&q=80&w=800', tags: ['完整人物', '头肩肖像', '纯侧面'], tagStatus: 'tagged', practice_count: 0, favorite: false, hidden: false, skip_count: 0 },
];

export const INITIAL_SETS: PracticeSet[] = [
  {
    id: 's1',
    name: '半小时 1',
    config: {
      includeTags: ['完整人物', '全身'],
      excludeTags: [],
      sessionType: 'progressive',
      progressiveStages: [
        { durationSec: 60, count: 5, includeTags: ['完整人物', '全身'], excludeTags: [] },
        { durationSec: 120, count: 4, includeTags: ['完整人物', '全身'], excludeTags: [] },
        { durationSec: 300, count: 2, includeTags: ['完整人物', '全身'], excludeTags: [] },
      ]
    }
  }
];
