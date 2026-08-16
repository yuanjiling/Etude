import { useState, useEffect } from "react";
import {
  Folder,
  Minus,
  X,
  Play,
  Loader2,
  Check,
  AlertCircle,
  ArrowRight,
} from "lucide-react";

interface InstallInfo {
  default_path: string;
  is_update: boolean;
  existing_version: string | null;
  current_version: string;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.warn(`[Browser Mock] invoke('${cmd}')`, args, err);
    if (cmd === "get_install_info") {
      return {
        default_path: "C:\\Users\\User\\AppData\\Local\\Programs\\Etude",
        is_update: false,
        existing_version: null,
        current_version: "1.1.0",
      } as unknown as T;
    }
    if (cmd === "get_default_install_path") {
      return "C:\\Users\\User\\AppData\\Local\\Programs\\Etude" as unknown as T;
    }
    if (cmd === "select_install_directory") {
      return "D:\\Programs\\Etude" as unknown as T;
    }
    return {} as unknown as T;
  }
}

export default function App() {
  const [step, setStep] = useState<"ready" | "installing" | "finished" | "error">("ready");
  const [installPath, setInstallPath] = useState<string>("");
  const [isUpdate, setIsUpdate] = useState<boolean>(false);
  const [existingVersion, setExistingVersion] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>("1.1.0");
  const [createDesktopShortcut, setCreateDesktopShortcut] = useState<boolean>(true);
  const [showPathInput, setShowPathInput] = useState<boolean>(false);

  // Progress state
  const [progress, setProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    tauriInvoke<InstallInfo>("get_install_info")
      .then((info) => {
        if (info) {
          if (info.default_path) setInstallPath(info.default_path);
          setIsUpdate(!!info.is_update);
          setExistingVersion(info.existing_version || null);
          if (info.current_version) setCurrentVersion(info.current_version);
        }
      })
      .catch((err) => {
        console.error("get_install_info failed, falling back to get_default_install_path", err);
        tauriInvoke<string>("get_default_install_path")
          .then((path) => {
            if (path) setInstallPath(path);
          })
          .catch(console.error);
      });

    // Disable WebView default context menu, text selection and drag selection
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    const handleSelectStart = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName !== 'INPUT' && target?.tagName !== 'TEXTAREA') {
        e.preventDefault();
      }
    };
    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("selectstart", handleSelectStart);
    window.addEventListener("dragstart", handleDragStart);

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("selectstart", handleSelectStart);
      window.removeEventListener("dragstart", handleDragStart);
    };
  }, []);

  const handleClose = async () => {
    try {
      await tauriInvoke("exit_app");
    } catch {
      window.close();
    }
  };

  const handleMinimize = async () => {
    try {
      await tauriInvoke("minimize_app");
    } catch {
      // ignore
    }
  };

  const handleDrag = async () => {
    try {
      await tauriInvoke("start_drag");
    } catch {
      // ignore
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const selected = await tauriInvoke<string | null>("select_install_directory", {
        defaultPath: installPath,
      });
      if (selected) {
        setInstallPath(selected);
      }
    } catch (err) {
      console.error("Browse directory failed:", err);
    }
  };

  const handleInstall = async () => {
    setStep("installing");
    setProgress(20);

    try {
      await new Promise((r) => setTimeout(r, 200));
      setProgress(55);

      await new Promise((r) => setTimeout(r, 250));
      setProgress(85);

      await tauriInvoke("perform_install", {
        targetDir: installPath,
        createDesktopShortcut,
        createStartMenuShortcut: true,
      });

      setProgress(100);
      await new Promise((r) => setTimeout(r, 200));
      setStep("finished");
    } catch (err: any) {
      console.error("Installation failed:", err);
      setErrorMessage(err?.toString() || "安装失败，请检查目录权限或重试。");
      setStep("error");
    }
  };

  const handleLaunch = async () => {
    try {
      await tauriInvoke("launch_installed_app", { targetDir: installPath });
    } catch (e) {
      console.error("Launch failed:", e);
    }
  };

  return (
    <div className="w-full h-full bg-[#fafaf9] text-stone-800 flex flex-col justify-between overflow-hidden select-none border border-black/10 font-sans relative">
      {/* Top Header with Centered Title & Minimalist Control Pill */}
      <div
        onMouseDown={handleDrag}
        className="w-full h-9 px-3 flex items-center justify-between shrink-0 bg-stone-100/60 border-b border-black/5 cursor-move"
      >
        <div className="w-12" />

        {/* Centered Title */}
        <span className="text-[11px] font-semibold tracking-wider text-stone-500 pointer-events-none">
          画谱 · Etude
        </span>

        {/* Window Controls Pill */}
        <div
          className="flex items-center gap-0.5 bg-stone-200/60 px-1 py-0.5 rounded-full border border-black/5 pointer-events-auto shrink-0"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleMinimize}
            className="w-5 h-5 flex items-center justify-center rounded-full text-stone-500 hover:text-stone-900 hover:bg-black/5 transition-all cursor-pointer"
            title="最小化"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            onClick={handleClose}
            className="w-5 h-5 flex items-center justify-center rounded-full text-stone-500 hover:text-red-500 hover:bg-red-500/10 transition-all cursor-pointer"
            title="关闭"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 px-5 py-3.5 flex flex-col justify-between">
        {/* Step 1: Ready - Pure Solid Flat UI with Etude's Standard rounded-xl Button */}
        {step === "ready" && (
          <div className="flex flex-col justify-between h-full">
            {/* Center Area: App Identity & Start Install Button */}
            <div className="my-auto flex flex-col gap-3">
              <div className="flex items-center justify-between px-0.5">
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-bold text-stone-900 tracking-tight">画谱 · Etude</h1>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-stone-200/70 text-stone-600 font-mono">
                    v{currentVersion}
                  </span>
                </div>
                {isUpdate && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-stone-200/50 text-stone-600 font-medium border border-black/5">
                    {existingVersion ? `覆盖旧版本 v${existingVersion}` : "检测到已安装"}
                  </span>
                )}
              </div>

              {/* Main Action Button - Matching Etude's rounded-xl */}
              <button
                onClick={handleInstall}
                className="w-full h-10 rounded-xl bg-stone-900 text-white font-medium text-xs flex items-center justify-center gap-2 hover:bg-stone-800 active:scale-[0.98] transition-all shadow-sm cursor-pointer"
              >
                <span>{isUpdate ? "开始更新" : "开始安装"}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Bottom: Custom Path & Options */}
            <div className="flex flex-col gap-1 pt-2 border-t border-black/5 text-[11px] text-stone-500">
              {!showPathInput ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 truncate max-w-[240px]" title={installPath}>
                    <Folder className="w-3 h-3 shrink-0 text-stone-400" />
                    <span className="truncate">{installPath || (isUpdate ? "获取已安装目录..." : "获取默认目录...")}</span>
                  </div>
                  <button
                    onClick={() => setShowPathInput(true)}
                    className="text-stone-700 hover:text-stone-900 font-medium cursor-pointer shrink-0 ml-2"
                  >
                    更改
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={installPath}
                    onChange={(e) => setInstallPath(e.target.value)}
                    className="flex-1 px-2.5 py-1 bg-white border border-stone-200 rounded-lg text-stone-800 text-[11px] font-mono focus:outline-none focus:border-stone-400 truncate"
                  />
                  <button
                    onClick={handleBrowseFolder}
                    className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg border border-stone-200 text-[11px] transition-colors cursor-pointer shrink-0"
                  >
                    浏览
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between text-[10px] text-stone-400 pt-0.5">
                <label className="flex items-center gap-1 cursor-pointer hover:text-stone-600">
                  <input
                    type="checkbox"
                    checked={createDesktopShortcut}
                    onChange={(e) => setCreateDesktopShortcut(e.target.checked)}
                    className="w-3 h-3 rounded border-stone-300 accent-stone-800 cursor-pointer"
                  />
                  <span>创建桌面快捷方式</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Installing Progress */}
        {step === "installing" && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-2">
            <div className="flex items-center gap-2 text-xs font-medium text-stone-700">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-500" />
              <span>{isUpdate ? "正在更新..." : "正在安装..."}</span>
              <span className="font-mono text-stone-400 ml-1">{progress}%</span>
            </div>

            <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-stone-900 rounded-full transition-all duration-200 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Step 3: Finished Success */}
        {step === "finished" && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-8 h-8 rounded-full bg-stone-900 text-white flex items-center justify-center shadow-sm">
              <Check className="w-4 h-4" />
            </div>

            <h2 className="text-xs font-bold text-stone-800">{isUpdate ? "更新完成" : "安装完成"}</h2>

            <div className="flex items-center gap-2 w-full max-w-[220px] mt-1">
              <button
                onClick={handleLaunch}
                className="flex-1 h-8 rounded-xl bg-stone-900 text-white font-medium text-xs flex items-center justify-center gap-1.5 hover:bg-stone-800 active:scale-95 transition-all shadow-sm cursor-pointer"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>立即启动</span>
              </button>
              <button
                onClick={handleClose}
                className="px-3 h-8 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-medium transition-colors cursor-pointer"
              >
                完成
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Error State */}
        {step === "error" && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-2">
            <AlertCircle className="w-6 h-6 text-red-500" />
            <div className="flex flex-col gap-0.5">
              <h2 className="text-xs font-bold text-stone-800">{isUpdate ? "更新失败" : "安装失败"}</h2>
              <p className="text-[10px] text-stone-400 font-mono max-w-[280px] truncate">{errorMessage}</p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => setStep("ready")}
                className="px-3 py-1 rounded-lg bg-stone-100 text-stone-600 text-xs transition-colors cursor-pointer"
              >
                返回
              </button>
              <button
                onClick={handleInstall}
                className="px-3 py-1 rounded-lg bg-stone-900 text-white text-xs hover:bg-stone-800 transition-colors cursor-pointer"
              >
                重试
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
