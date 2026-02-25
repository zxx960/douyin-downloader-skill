# douyin-downloader-skill

一个用于 **抖音视频下载 + 音频转文字（豆包语音）** 的技能项目。

## 功能

- 解析抖音分享文本/短链，提取真实视频信息
- 下载无水印视频
- 支持音频转文字（豆包语音）
  - 极速版（flash）
  - 标准版（submit/query）
- 一键流程：下载视频 → 转音频 → 转写文案

## 目录结构

- `SKILL.md`：技能说明与触发描述
- `scripts/parse_douyin.js`：解析抖音分享链接
- `scripts/download_video.js`：下载视频
- `scripts/transcribe_audio.js`：调用豆包语音做转写
- `scripts/douyin_to_text.js`：一键下载并转写（先抽音频）
- `downloads/`：下载文件目录

## 环境要求

- Node.js 18+
- `ffmpeg`（用于从视频提取音频）

检查：

```bash
node -v
ffmpeg -version
```

## 快速开始

进入项目目录：

```bash
cd /Users/ximu/.openclaw/workspace/douyin-downloader-skill
```

### 1）只下载视频

```bash
node scripts/parse_douyin.js "<抖音分享文本或链接>"
node scripts/download_video.js "<download_url>" "./downloads/视频名.mp4"
```

### 2）转写本地音频/视频

```bash
node scripts/transcribe_audio.js "./downloads/xxx.mp4" \
  --app-key "你的API_KEY" \
  --resource-id "volc.seedasr.auc" \
  --mode standard
```

### 3）一键：下载并转写

```bash
node scripts/douyin_to_text.js "<抖音分享文本或链接>" \
  --api-key "你的API_KEY" \
  --resource-id "volc.seedasr.auc" \
  --mode standard
```

说明：

- 当前一键流程会：下载视频 → 转成 16k 单声道 mp3 → 调用 ASR
- 文案结果直接输出到终端，不默认保存 transcript 文件

## 参数说明

### `transcribe_audio.js`

- `--app-key`：火山引擎 API Key（必填）
- `--access-key`：极速版模式可用（按需）
- `--resource-id`：资源 ID
  - `volc.bigasr.auc_turbo`（极速版）
  - `volc.seedasr.auc`（标准版）
- `--mode`：`auto | flash | standard`
- `--out`：输出 JSON 文件（可选）
- `--text-out`：输出 TXT 文件（可选）

### `douyin_to_text.js`

- `--api-key`：火山引擎 API Key
- `--resource-id`：默认 `volc.seedasr.auc`
- `--mode`：默认 `standard`
- `--output-dir`：下载目录，默认 `./downloads`

## 常见问题

### 1. 403: `requested resource not granted`

表示当前 API Key 未开通对应资源。检查控制台中资源是否已授权到当前应用。

### 2. 没有标点符号

标准版参数 `enable_punc` 已开启；若仍无标点，可确认是否使用了最新脚本版本。

### 3. 找不到 downloads 文件夹

完整路径：

`/Users/ximu/.openclaw/workspace/douyin-downloader-skill/downloads`

该路径位于 `.openclaw` 隐藏目录下，Finder 默认可能不显示。

## 免责声明

请仅在合法合规、获得授权的前提下处理音视频内容。