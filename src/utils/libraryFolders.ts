import type { ImageRecord } from '../types';

export type LibraryFolder = {
  path: string;
  name: string;
  depth: number;
  count: number;
};

export const EXAMPLE_FOLDER = '__examples__';
export const LOOSE_FOLDER = '__loose__';

export const imageFolder = (image: ImageRecord) => {
  if (!image.sourcePath) return EXAMPLE_FOLDER;
  const relativePath = image.libraryRelativePath?.replace(/\\/g, '/');
  if (!relativePath?.includes('/')) return LOOSE_FOLDER;
  return relativePath.slice(0, relativePath.lastIndexOf('/'));
};

export const folderContains = (folder: string, image: ImageRecord) => {
  const current = imageFolder(image);
  return current === folder || (!folder.startsWith('__') && current.startsWith(`${folder}/`));
};

export const folderDisplayName = (path: string) => (
  path === EXAMPLE_FOLDER ? '示例素材' : path === LOOSE_FOLDER ? '未分组图片' : path.split('/').at(-1) || path
);

export const buildLibraryFolders = (images: ImageRecord[]): LibraryFolder[] => {
  const counts = new Map<string, number>();
  images.forEach(image => {
    const folder = imageFolder(image);
    if (folder.startsWith('__')) {
      counts.set(folder, (counts.get(folder) || 0) + 1);
      return;
    }
    const segments = folder.split('/');
    segments.forEach((_, index) => {
      const path = segments.slice(0, index + 1).join('/');
      counts.set(path, (counts.get(path) || 0) + 1);
    });
  });
  return Array.from(counts)
    .map(([path, count]) => ({
      path,
      name: folderDisplayName(path),
      depth: path.startsWith('__') ? 0 : path.split('/').length - 1,
      count,
    }))
    .sort((left, right) => {
      if (left.path.startsWith('__') !== right.path.startsWith('__')) return left.path.startsWith('__') ? 1 : -1;
      return left.path.localeCompare(right.path, 'zh-CN');
    });
};
