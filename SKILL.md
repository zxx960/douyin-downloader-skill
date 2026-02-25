---
name: douyin-downloader
description: Download Douyin (抖音) videos from share links. Use when the user provides a Douyin share link or share text and wants to download the video. Supports both video and note types. Extracts metadata (title, video_id) and downloads the watermark-free version.
---

# Douyin Video Downloader

Parse Douyin share links and download videos without watermarks.

## Workflow

### 1. Parse Share Link

When the user provides a Douyin share text or link, extract video metadata:

```bash
node scripts/parse_douyin.js "<分享文本或链接>"
```

**Input examples:**
- Full share text: `7.43 FuL:/ 你别说，真挺好看的 https://v.douyin.com/iFDbjn2M/ 复制此链接...`
- Just the URL: `https://v.douyin.com/iFDbjn2M/`

**Output (JSON):**
```json
{
  "video_id": "7445842287652441376",
  "title": "你别说_真挺好看的",
  "download_url": "https://...play.../video/...",
  "raw_url": "https://...playwm.../video/...",
  "share_url": "https://v.douyin.com/iFDbjn2M/",
  "redirected_url": "https://www.douyin.com/video/7445842287652441376",
  "iesdouyin_url": "https://www.iesdouyin.com/share/video/7445842287652441376"
}
```

**Key fields:**
- `download_url` - No watermark version (playwm → play)
- `title` - Sanitized video description (safe for filenames)
- `video_id` - Unique video identifier

### 2. Download Video

Use the `download_url` from step 1:

```bash
node scripts/download_video.js "<download_url>" "<output_path>"
```

**Example:**
```bash
node scripts/download_video.js "https://v3-web.douyinvod.com/..." "./downloads/你别说_真挺好看的.mp4"
```

**Output:**
```json
{
  "status": "success",
  "path": "./downloads/你别说_真挺好看的.mp4"
}
```

Progress is written to stderr during download.

## Complete Example

```bash
# Step 1: Parse
result=$(node scripts/parse_douyin.js "7.43 FuL:/ 你别说，真挺好看的 https://v.douyin.com/iFDbjn2M/")

# Step 2: Extract fields (using jq or Node.js JSON parsing)
download_url=$(echo "$result" | jq -r '.download_url')
title=$(echo "$result" | jq -r '.title')

# Step 3: Download
node scripts/download_video.js "$download_url" "./downloads/${title}.mp4"
```

## Notes

- **Watermark removal**: The script automatically converts `playwm` URLs to `play` URLs
- **Title sanitization**: Removes invalid filename characters (`\/:*?"<>|`)
- **Both video and note**: Supports both `/video/` and `/note/` URLs
- **Mobile UA required**: Uses iPhone user agent for compatibility
- **Timeout**: 60 seconds per download
- **Progress**: Displays progress every 10% on stderr

## Error Handling

Common errors:
- `未找到有效的分享链接` - Invalid or missing URL in input
- `访问分享链接失败` - Network error or blocked request
- `从HTML中解析视频信息失败` - Page structure changed (script needs update)
- `下载超时` - Network timeout (try again)

When errors occur, both scripts return JSON with `{ "status": "error", "error": "<message>" }` on stderr and exit with code 1.
