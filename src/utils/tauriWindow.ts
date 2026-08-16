import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { PhysicalPosition } from '@tauri-apps/api/dpi';

export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
};

export const checkAlwaysOnTop = async (): Promise<boolean> => {
  if (isTauriEnvironment()) {
    try {
      const appWindow = getCurrentWindow();
      return await appWindow.isAlwaysOnTop();
    } catch (err) {
      console.warn('Tauri window isAlwaysOnTop error:', err);
    }
  }
  return false;
};

let alwaysOnTopOperation: Promise<unknown> = Promise.resolve();

const queueAlwaysOnTopOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = alwaysOnTopOperation.then(operation, operation);
  alwaysOnTopOperation = result.catch(() => undefined);
  return result;
};

export const toggleAlwaysOnTop = async (currentPinned: boolean): Promise<boolean> => {
  const nextPinned = !currentPinned;
  if (isTauriEnvironment()) {
    return queueAlwaysOnTopOperation(async () => {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.setAlwaysOnTop(nextPinned);
      } catch (err) {
        console.warn('Tauri window setAlwaysOnTop error:', err);
      }
      return nextPinned;
    });
  }
  return nextPinned;
};

export const setAlwaysOnTop = async (pinned: boolean): Promise<void> => {
  if (isTauriEnvironment()) {
    await queueAlwaysOnTopOperation(async () => {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.setAlwaysOnTop(pinned);
      } catch (err) {
        console.warn('Tauri window setAlwaysOnTop error:', err);
      }
    });
  }
};

export const setClickThrough = async (ignore: boolean): Promise<void> => {
  if (isTauriEnvironment()) {
    try {
      await invoke('set_window_click_through', { ignore });
    } catch (err) {
      console.warn('Tauri set_window_click_through error:', err);
    }
  }
};

let lockMonitorOperation: Promise<unknown> = Promise.resolve();

const queueLockMonitorOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = lockMonitorOperation.then(operation, operation);
  lockMonitorOperation = result.catch(() => undefined);
  return result;
};

export const startPracticeLockMonitor = async (locked: boolean): Promise<boolean> => {
  if (!isTauriEnvironment()) return locked;
  return queueLockMonitorOperation(() => invoke<boolean>('start_lock_monitor', { locked }));
};

export const stopPracticeLockMonitor = async (): Promise<void> => {
  if (!isTauriEnvironment()) return;
  await queueLockMonitorOperation(() => invoke('stop_lock_monitor'));
};

export const setPracticeLocked = async (locked: boolean): Promise<boolean> => {
  if (!isTauriEnvironment()) return locked;
  return invoke<boolean>('set_practice_locked', { locked });
};

export const togglePracticeLocked = async (): Promise<boolean> => {
  if (!isTauriEnvironment()) return false;
  return invoke<boolean>('toggle_practice_locked');
};

export const startRightClickDrag = async (e: MouseEvent): Promise<void> => {
  if (!isTauriEnvironment() || e.button !== 2) return;
  
  try {
    await invoke('start_native_drag');
  } catch (err) {
    console.warn('Native right click drag failed:', err);
  }
};

export const startDraggingWindow = async (): Promise<void> => {
  if (isTauriEnvironment()) {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.startDragging();
    } catch (err) {
      console.warn('Tauri window startDragging error:', err);
    }
  }
};

export const minimizeWindow = async (): Promise<void> => {
  if (isTauriEnvironment()) {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.minimize();
    } catch (err) {
      console.warn('Tauri window minimize error:', err);
    }
  }
};

export const closeWindow = async (): Promise<void> => {
  if (isTauriEnvironment()) {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.close();
    } catch (err) {
      console.warn('Tauri window close error:', err);
      try {
        await invoke('exit_app');
      } catch {
        // ignore
      }
    }
  }
};
