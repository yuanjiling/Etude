# Photo Tagger 离线识别组件

用于图像标签与姿态/朝向识别的轻量离线组件包。

## 快速使用

```python
from src.final_offline_classifier import FinalOfflineClassifier

model = FinalOfflineClassifier("photo_tagger_visual_fp16_v1", device="auto")
result = model.classify("image.jpg")
```

### 命令行工具

```powershell
python onnx_offline_cli.py --input <图片目录或文件>
```
