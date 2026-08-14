# 外置自动打标组件

正式安装包不包含 Python 运行时和自动打标 ONNX 模型。组件目录固定为主程序旁边的 `model/tagger-component`。用户可在“设置 → 图库与识别 → 识别模型”中直接打开该目录。

组件目录结构：

```text
model/
└─ tagger-component/
   ├─ runtime/
   │  └─ windows/
   │     ├─ python.exe
   │     └─ Lib/...
   └─ model/
      └─ photo_tagger_visual_fp16_v1/
         ├─ onnx_offline_cli.py
         ├─ manifest.json
         └─ models/
            └─ photo_tagger.nativefp16.onnx
```

从仓库资源生成独立组件目录：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-tagger-component.ps1
```

默认输出到 `release/model/tagger-component`。分发时将 `model` 目录放到 `Etude.exe` 同级位置。应用在用户点击“重新检测”时再次检测组件。
