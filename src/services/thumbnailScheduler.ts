import { convertFileSrc, invoke } from '@tauri-apps/api/core';

const THUMBNAIL_CONCURRENCY = 4;
const thumbnailUrlCache = new Map<string, string>();

type ThumbnailTask = {
  sourcePath: string;
  consumers: Map<symbol, number>;
  sequence: number;
  state: 'queued' | 'running';
  promise: Promise<string>;
  resolve: (url: string) => void;
  reject: (error: unknown) => void;
};

export type ThumbnailRequest = {
  promise: Promise<string>;
  cancel: () => void;
};

const thumbnailTasks = new Map<string, ThumbnailTask>();
let activeThumbnailTasks = 0;
let thumbnailTaskSequence = 0;
let queueScheduled = false;
let schedulerPaused = false;

const taskPriority = (task: ThumbnailTask) => Math.min(...task.consumers.values());

const runQueue = () => {
  if (schedulerPaused) return;
  while (activeThumbnailTasks < THUMBNAIL_CONCURRENCY) {
    const nextTask = Array.from(thumbnailTasks.values())
      .filter(task => task.state === 'queued' && task.consumers.size > 0)
      .sort((left, right) => (
        taskPriority(left) - taskPriority(right)
        || right.sequence - left.sequence
      ))[0];
    if (!nextTask) return;

    nextTask.state = 'running';
    activeThumbnailTasks += 1;
    void invoke<string>('get_library_thumbnail', { imagePath: nextTask.sourcePath })
      .then(path => convertFileSrc(path))
      .then(url => {
        thumbnailUrlCache.set(nextTask.sourcePath, url);
        nextTask.resolve(url);
      })
      .catch(nextTask.reject)
      .finally(() => {
        if (thumbnailTasks.get(nextTask.sourcePath) === nextTask) {
          thumbnailTasks.delete(nextTask.sourcePath);
        }
        activeThumbnailTasks -= 1;
        scheduleQueue();
      });
  }
};

function scheduleQueue() {
  if (queueScheduled) return;
  queueScheduled = true;
  queueMicrotask(() => {
    queueScheduled = false;
    runQueue();
  });
}

export const setThumbnailSchedulerPaused = (paused: boolean) => {
  schedulerPaused = paused;
  if (!paused) scheduleQueue();
};

export const requestThumbnail = (sourcePath: string, priority: number): ThumbnailRequest => {
  const cached = thumbnailUrlCache.get(sourcePath);
  if (cached) return { promise: Promise.resolve(cached), cancel: () => undefined };

  const consumerId = Symbol(sourcePath);
  let task = thumbnailTasks.get(sourcePath);
  if (!task) {
    let resolve!: (url: string) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<string>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    task = {
      sourcePath,
      consumers: new Map(),
      sequence: thumbnailTaskSequence += 1,
      state: 'queued',
      promise,
      resolve,
      reject,
    };
    thumbnailTasks.set(sourcePath, task);
  }

  task.consumers.set(consumerId, Math.max(0, priority));
  scheduleQueue();

  return {
    promise: task.promise,
    cancel: () => {
      if (!task) return;
      task.consumers.delete(consumerId);
      if (task.state === 'queued' && task.consumers.size === 0) {
        thumbnailTasks.delete(sourcePath);
        task.reject(new DOMException('缩略图已离开加载范围', 'AbortError'));
      }
      scheduleQueue();
    },
  };
};
