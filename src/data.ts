import { ImageRecord, PracticeSet } from './types';

export const INITIAL_IMAGES: ImageRecord[] = [];

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
