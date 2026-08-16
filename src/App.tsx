import React, { useState, useEffect, Component, type ReactNode, type ErrorInfo } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import { ViewMode } from './types';
import { PracticeView } from './views/PracticeView';
import { LibraryView } from './views/LibraryView';
import { SetsView } from './views/SetsView';
import { HistoryView } from './views/HistoryView';
import { PracticeWindow } from './views/PracticeWindow';
import { SettingsView } from './views/SettingsView';
import { Layout, Image as ImageIcon, Layers, Clock, Settings, Moon, Sun, Pin, Minus, X, FolderOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { StartupSplash } from './components/StartupSplash';

import { toggleAlwaysOnTop, setAlwaysOnTop, minimizeWindow, closeWindow, startDraggingWindow, startRightClickDrag, isTauriEnvironment } from './utils/tauriWindow';

type LibrarySetupStatus = {
  configured: boolean;
  libraryPath?: string;
};

const LibrarySetupGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<'checking' | 'required' | 'ready' | 'error'>(
    isTauriEnvironment() ? 'checking' : 'ready',
  );
  const [error, setError] = useState<string>();
  const [isChoosing, setIsChoosing] = useState(false);

  const checkStatus = async () => {
    if (!isTauriEnvironment()) return;
    setState('checking');
    setError(undefined);
    try {
      const status = await invoke<LibrarySetupStatus>('get_library_status');
      setState(status.configured ? 'ready' : 'required');
    } catch (reason) {
      setError(String(reason));
      setState('error');
    }
  };

  useEffect(() => {
    void checkStatus();
  }, []);

  const chooseDirectory = async () => {
    setIsChoosing(true);
    setError(undefined);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择画谱图库目录',
      });
      if (!selected || Array.isArray(selected)) return;
      await invoke<LibrarySetupStatus>('set_library_directory', { path: selected });
      setState('ready');
    } catch (reason) {
      setError(String(reason));
      setState('required');
    } finally {
      setIsChoosing(false);
    }
  };

  return (
    <>
      <div className={state === 'ready' ? 'contents' : 'hidden'}>{children}</div>
      <AnimatePresence>
        {state === 'checking' && <StartupSplash key="startup" />}
      </AnimatePresence>
      {(state === 'required' || state === 'error') && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-stone-100 p-6 text-stone-800 dark:bg-zinc-950 dark:text-zinc-100">
          <div className="w-full max-w-sm rounded-2xl border border-black/5 bg-white/80 p-7 text-center shadow-xl dark:border-white/10 dark:bg-zinc-900/80">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-900 text-white dark:bg-white dark:text-zinc-900">
              <FolderOpen size={25} />
            </div>
            <h1 className="text-lg font-bold">选择图库目录</h1>
            <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-zinc-400">
              画谱会读取并管理这个目录中的图片。建议选择空间充足的数据盘，原图不会写入应用数据库。
            </p>
            {error && <p className="mt-4 break-all text-xs text-red-500">{error}</p>}
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={chooseDirectory}
                disabled={isChoosing}
                className="h-10 rounded-xl bg-stone-900 text-xs font-bold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
              >
                {isChoosing ? '正在选择…' : '选择图库目录'}
              </button>
              {state === 'error' && (
                <button type="button" onClick={checkStatus} className="h-8 text-xs text-stone-500 dark:text-zinc-400">
                  重新检查
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const BottomNav: React.FC<{ active: ViewMode; onNavigate: (v: ViewMode) => void }> = ({ active, onNavigate }) => {
  const { darkMode, toggleDarkMode } = useAppContext();
  
  const navItems = [
    { id: 'practice', icon: Layout, label: '首页' },
    { id: 'library', icon: ImageIcon, label: '图库' },
    { id: 'sets', icon: Layers, label: '配置' },
  ] as const;

  return (
    <div className="w-full h-[44px] bg-stone-50/80 dark:bg-zinc-900/80 backdrop-blur-3xl border-t border-black/5 dark:border-white/10 flex items-center justify-between px-3 z-40 shrink-0 select-none">
      <div className="flex items-center gap-0.5">
        {navItems.map((item) => (
          <div key={item.id} className="relative">
            {active === item.id && (
              <motion.div
                layoutId="activeNavIndicator"
                className="absolute inset-0 bg-black/5 dark:bg-white/10 rounded-lg"
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
            <button
              onClick={() => onNavigate(item.id)}
              className={`relative z-10 flex items-center gap-1 transition-all duration-300 active:scale-95 px-2.5 h-8 justify-center rounded-lg ${
                active === item.id 
                  ? 'text-black dark:text-white font-bold' 
                  : 'text-stone-500 hover:text-black/70 dark:hover:text-white/70 hover:bg-black/5 dark:hover:bg-white/5'
              }`}
              title={item.label}
            >
              <item.icon size={15} strokeWidth={active === item.id ? 2.5 : 2} />
              {active === item.id && <span className="text-[11px] font-medium">{item.label}</span>}
            </button>
          </div>
        ))}
      </div>
      
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onNavigate('settings')}
          className={`flex items-center justify-center transition-all duration-300 active:scale-95 w-8 h-8 rounded-lg ${
            active === 'settings' 
              ? 'text-black dark:text-white bg-black/5 dark:bg-white/10' 
              : 'text-stone-500 hover:text-black/70 dark:hover:text-white/70 hover:bg-black/5 dark:hover:bg-white/5'
          }`}
          title="设置"
        >
          <Settings size={15} strokeWidth={active === 'settings' ? 2.5 : 2} />
        </button>
      </div>
    </div>
  );
};

const ControlBar = () => {
  const { settings } = useAppContext();
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    let disposed = false;
    setAlwaysOnTop(settings.startAlwaysOnTop).then(() => {
      if (!disposed) setIsPinned(settings.startAlwaysOnTop);
    });
    return () => { disposed = true; };
  }, [settings.startAlwaysOnTop]);

  const handlePin = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = await toggleAlwaysOnTop(isPinned);
    setIsPinned(next);
  };

  const handleMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await minimizeWindow();
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await closeWindow();
  };

  return (
    <div className="flex items-center gap-0.5 bg-stone-200/50 dark:bg-zinc-800/60 backdrop-blur-md px-1 py-0.5 rounded-full border border-black/5 dark:border-white/10 pointer-events-auto">
      <button 
        onClick={handlePin}
        className={`flex items-center justify-center w-6 h-6 rounded-full transition-all duration-300 active:scale-90 ${
          isPinned 
            ? 'bg-amber-500 text-white font-bold' 
            : 'text-stone-500 hover:text-black dark:text-zinc-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'
        }`} 
        title={isPinned ? "取消置顶" : "置顶窗口"}
      >
        <Pin size={11} className={isPinned ? "fill-current" : ""} />
      </button>
      <button 
        onClick={handleMinimize}
        className="flex items-center justify-center w-6 h-6 rounded-full text-stone-500 hover:text-black dark:text-zinc-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-300 active:scale-90" 
        title="最小化窗口"
      >
        <Minus size={11} />
      </button>
      <button 
        onClick={handleClose}
        className="flex items-center justify-center w-6 h-6 rounded-full text-stone-500 hover:text-red-500 dark:text-zinc-400 dark:hover:text-red-400 hover:bg-red-500/10 transition-all duration-300 active:scale-90" 
        title="关闭窗口"
      >
        <X size={11} />
      </button>
    </div>
  );
};

const MainContent = () => {
  const { settings, darkMode } = useAppContext();
  const [currentView, setCurrentView] = useState<ViewMode>('practice');
  const [practiceConfig, setPracticeConfig] = useState<any>(null);
  const [libraryLocate, setLibraryLocate] = useState<{ imageId: string; nonce: number } | null>(null);

  const startPractice = (config: any) => {
    setPracticeConfig(config);
    setCurrentView('active_practice');
  };

  const endPractice = () => {
    setPracticeConfig(null);
    setCurrentView('practice');
  };

  const locateImageInLibrary = (imageId: string) => {
    setLibraryLocate({ imageId, nonce: Date.now() });
    setCurrentView('library');
  };

  if (currentView === 'active_practice') {
    return (
      <div className="w-screen h-screen relative overflow-hidden select-none text-white">
        <PracticeWindow config={practiceConfig} onExit={endPractice} />
      </div>
    );
  }

  const isDesktop = isTauriEnvironment();
  const bgOpacityHex = Math.round((settings.bgOpacity / 100) * 255).toString(16).padStart(2, '0');
  const bgColor = darkMode ? `#18181b${bgOpacityHex}` : `#fafaf9${bgOpacityHex}`;

  return (
    <div className={`app-startup-reveal flex justify-center items-center w-screen h-screen ${isDesktop ? 'p-0 bg-transparent' : 'pl-16 bg-stone-100 dark:bg-zinc-950'} text-stone-800 dark:text-zinc-100 overflow-hidden font-sans selection:bg-black/10 dark:selection:bg-white/20 relative`}>
      {/* Global Film Grain Noise Overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.04] dark:opacity-[0.06] mix-blend-overlay z-[100]" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
      }} />
      <main className={`group ${isDesktop ? 'w-full h-full' : 'w-[600px] h-[900px]'} rounded-lg border border-black/5 dark:border-white/5 backdrop-blur-3xl overflow-hidden flex flex-col relative transition-colors duration-300`} style={{ backgroundColor: bgColor }}>
        
        {/* Navigation Header with window dragging & controls */}
        <div className="w-full h-9 px-3 flex items-center justify-between shrink-0 select-none bg-stone-100/50 dark:bg-zinc-900/50 border-b border-black/5 dark:border-white/5 z-40">
          <div data-tauri-drag-region className="flex-1 h-full cursor-default flex items-center text-[11px] font-semibold tracking-wider text-stone-500 dark:text-zinc-400">
          </div>
          <ControlBar />
        </div>

        {/* Animated Lunar Eclipse Window Background */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none rounded-lg">
          <motion.div
            className="absolute -top-[200px] -right-[200px] w-[800px] h-[800px] bg-white/40 dark:bg-white/5 rounded-full blur-[60px]"
            style={{
              '--shadow-x': '-50%',
              WebkitMaskImage: 'radial-gradient(circle 450px at var(--shadow-x) 50%, transparent 0%, transparent 75%, black 100%)',
              maskImage: 'radial-gradient(circle 450px at var(--shadow-x) 50%, transparent 0%, transparent 75%, black 100%)'
            } as any}
            animate={{
              '--shadow-x': ['-50%', '150%']
            }}
            transition={{ duration: 25, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
          />
        </div>

        <div className="flex-1 relative z-10 bg-transparent overflow-hidden">
          <div className="relative w-full h-full flex">
          <AnimatePresence initial={false}>
            <motion.div
              key={currentView}
              initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="absolute inset-0 flex flex-col w-full min-h-full overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            >
              {currentView === 'practice' && <PracticeView onStart={startPractice} />}
              {currentView === 'library' && (
                <LibraryView
                  onStart={startPractice}
                  locateTarget={libraryLocate}
                  onLocateHandled={() => setLibraryLocate(null)}
                />
              )}
              {currentView === 'sets' && <SetsView onStart={startPractice} />}
              {currentView === 'settings' && <SettingsView onLocateImage={locateImageInLibrary} />}
            </motion.div>
          </AnimatePresence>
        </div>
        </div>
        <BottomNav active={currentView} onNavigate={setCurrentView} />
      </main>
    </div>
  );
};

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class AppErrorBoundary extends (React.Component as any) {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled React Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen flex flex-col items-center justify-center bg-zinc-950 text-white p-6 select-none">
          <div className="max-w-md w-full rounded-2xl bg-zinc-900 border border-white/10 p-6 flex flex-col items-center text-center shadow-2xl">
            <h2 className="text-base font-bold mb-2 text-red-400">页面渲染遇到异常</h2>
            <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
              {this.state.error?.message || '发生未知渲染错误'}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-5 py-2 rounded-xl bg-white text-zinc-900 font-bold text-xs hover:bg-stone-200 active:scale-95 transition-all cursor-pointer"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  // Global event listeners for disabling web context menu and enabling right-click drag
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    let startX = 0;
    let startY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      // e.button === 2 indicates the secondary (right) mouse button
      if (e.button === 2) {
        // Do not right-click drag if clicking on the top title bar (which has left-click drag)
        const target = e.target as HTMLElement | null;
        if (target?.closest('[data-tauri-drag-region]')) {
          return;
        }
        
        startX = e.screenX;
        startY = e.screenY;
        startRightClickDrag(e);
      }
    };
    
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        const delta = Math.hypot(e.screenX - startX, e.screenY - startY);
        if (delta < 3) {
          // This was a click, not a drag. Trigger custom context menu.
          window.dispatchEvent(new CustomEvent('app-context-menu', { detail: { x: e.clientX, y: e.clientY } }));
        }
      }
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <AppErrorBoundary>
      <LibrarySetupGate>
        <AppProvider>
          <MainContent />
        </AppProvider>
      </LibrarySetupGate>
    </AppErrorBoundary>
  );
}
