# 画谱 (Etude)

基于 Tauri 2 与 React 构建的速写与姿态练习桌面工具。

[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri&logoColor=black)](https://tauri.app/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4.0-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

提供悬浮窗练习、阶段递进倒计时、身体部位特写裁剪与本地图库管理功能。所有图像与模型均在本地处理，无需联网。

---

## 功能特性

- **速写计时**：支持固定时长单图练习与多阶段阶梯计时（如 30s 动态速写、60s 结构、5min 深入刻画）。
- **观察辅助**：支持九宫格构图参考线、水平镜像翻转、黑白灰阶显示与画布透明度调整。
- **局部特写**：内置离线姿态解析，支持针对手、足、头部、躯干等关键区域自动裁剪并进行特写练习。
- **图库与套组**：支持按视角、动态、体型等多维度标签筛选题卡，支持创建自定义练习套组并记录练习历史。
- **桌面模式**：支持窗口置顶、锁定交互与快捷键盲操。
- **本地运行**：数据与离线模型均存储于本地，不收集任何用户数据。

---

## 快捷键

| 快捷键 | 功能 |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>Space</kbd> | 暂停 / 恢复倒计时 |
| <kbd>Ctrl</kbd> + <kbd>→</kbd> | 下一张图片 |
| <kbd>Ctrl</kbd> + <kbd>←</kbd> | 上一张图片 |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd> | 锁定 / 解锁窗口交互 |
| <kbd>Ctrl</kbd> + <kbd>Tab</kbd> | 显示 / 隐藏控制栏 |
| <kbd>Ctrl</kbd> + <kbd>R</kbd> | 重置当前倒计时 |
| <kbd>Ctrl</kbd> + <kbd>Esc</kbd> | 退出练习 |

*(macOS 下使用 <kbd>Cmd ⌘</kbd> 替代 <kbd>Ctrl</kbd>)*

---

## 技术架构

- **前端**：React 19、TypeScript、Tailwind CSS v4、Motion、MediaPipe Vision (WASM)
- **桌面端**：Tauri 2 (Rust)
- **构建工具**：Vite 6

---

## 开发与构建

### 前置要求

- Node.js >= 18.0.0
- Rust 与 Cargo（桌面端构建环境）

### 安装依赖

```bash
git clone https://github.com/your-username/etude.git
cd etude
npm install
```

### 开发调试

```bash
# 启动 Web 页面调试
npm run dev

# 启动 Tauri 桌面端调试
npm run tauri:dev
```

### 构建打包

```bash
# 构建前端产物
npm run build

# 运行 TypeScript 类型检查
npm run lint

# 构建 Windows 安装包
npm run tauri:build
```

---

## 目录结构

```text
etude/
├── src/                      # 前端源码
│   ├── components/           # UI 组件
│   ├── views/                # 业务视图（练习、图库、套组、历史、设置）
│   ├── context/              # 全局状态
│   ├── hooks/                # 自定义 Hooks
│   ├── services/             # MediaPipe 姿态解析与检测服务
│   └── utils/                # 快捷键、标签数据与窗口辅助
├── src-tauri/                # Tauri 原生桌面端配置与 Rust 源码
├── public/                   # 静态资源与浏览器端 WASM 视觉模型
├── scripts/                  # 离线组件导出与打包脚本
├── docs/                     # 架构与外置组件说明
└── package.json
```

---

## 开源协议

本项目基于 [MIT License](LICENSE) 授权。
