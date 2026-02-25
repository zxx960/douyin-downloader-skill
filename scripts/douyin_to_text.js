#!/usr/bin/env node
'use strict';

import { spawnSync } from 'child_process';
import path from 'path';

function runNodeScript(scriptPath, args) {
  const ret = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (ret.status !== 0) {
    throw new Error(ret.stderr || ret.stdout || `命令失败: ${scriptPath}`);
  }
  return (ret.stdout || '').trim();
}

function parseArgs(argv) {
  const args = [...argv];
  const out = {
    shareText: '',
    apiKey: process.env.VOLC_APP_KEY || '',
    resourceId: process.env.VOLC_RESOURCE_ID || 'volc.seedasr.auc',
    mode: process.env.VOLC_ASR_MODE || 'standard',
    outputDir: './downloads',
  };

  while (args.length > 0) {
    const t = args.shift();
    if (!t) continue;
    if (!out.shareText && !t.startsWith('--')) {
      out.shareText = t;
      continue;
    }
    if (t === '--api-key') out.apiKey = args.shift() || '';
    else if (t === '--resource-id') out.resourceId = args.shift() || out.resourceId;
    else if (t === '--mode') out.mode = args.shift() || out.mode;
    else if (t === '--output-dir') out.outputDir = args.shift() || out.outputDir;
    else if (t === '--help' || t === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`用法:
  node scripts/douyin_to_text.js "<抖音分享文本/链接>" --api-key <API_KEY>

说明:
  - 先下载抖音视频
  - 再自动调用 ASR 转写
  - 只输出文案，不保存本地转写文件
`);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.shareText) {
    printHelp();
    process.exitCode = opts.help ? 0 : 2;
    return;
  }
  if (!opts.apiKey) {
    throw new Error('缺少 --api-key（或环境变量 VOLC_APP_KEY）');
  }

  const baseDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const parseScript = path.join(baseDir, 'scripts', 'parse_douyin.js');
  const downloadScript = path.join(baseDir, 'scripts', 'download_video.js');
  const transcribeScript = path.join(baseDir, 'scripts', 'transcribe_audio.js');

  // 1) parse share link
  const parsedRaw = runNodeScript(parseScript, [opts.shareText]);
  const parsed = safeJsonParse(parsedRaw);
  if (!parsed || !parsed.download_url || !parsed.title) {
    throw new Error('解析抖音链接失败');
  }

  // 2) download video
  const videoPath = path.join(opts.outputDir, `${parsed.title}.mp4`);
  runNodeScript(downloadScript, [parsed.download_url, videoPath]);

  // 3) transcribe (no local transcript save)
  const transRaw = runNodeScript(transcribeScript, [
    videoPath,
    '--app-key',
    opts.apiKey,
    '--resource-id',
    opts.resourceId,
    '--mode',
    opts.mode,
  ]);

  const trans = safeJsonParse(transRaw);
  const text = trans?.result_text || '';
  if (!text) {
    throw new Error('转写完成但未拿到文案');
  }

  process.stdout.write(text + '\n');
}

main().catch((e) => {
  process.stderr.write(
    JSON.stringify({ status: 'error', error: e?.message || String(e) }, null, 2) + '\n',
  );
  process.exitCode = 1;
});
