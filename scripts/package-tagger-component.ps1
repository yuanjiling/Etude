param(
    [string]$OutputDirectory = "release\model\tagger-component"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $projectRoot $OutputDirectory
if (Test-Path -LiteralPath $destination) {
    throw "输出目录已存在，请先移动或删除：$destination"
}

$runtimeSource = Join-Path $projectRoot "assets\tagger-runtime\windows"
$modelSource = Join-Path $projectRoot "assets\model\photo_tagger_visual_fp16_v1"
$runtimeDestination = Join-Path $destination "runtime\windows"
$modelDestination = Join-Path $destination "model\photo_tagger_visual_fp16_v1"

New-Item -ItemType Directory -Path $runtimeDestination -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $modelDestination "models") -Force | Out-Null

Copy-Item -Path (Join-Path $runtimeSource "*") -Destination $runtimeDestination -Recurse -Force
Copy-Item -LiteralPath (Join-Path $modelSource "onnx_offline_cli.py") -Destination $modelDestination
Copy-Item -LiteralPath (Join-Path $modelSource "manifest.json") -Destination $modelDestination
Copy-Item -LiteralPath (Join-Path $modelSource "models\photo_tagger.nativefp16.onnx") -Destination (Join-Path $modelDestination "models")

Write-Output "自动打标组件已生成：$destination"
