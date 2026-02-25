#!/usr/bin/env node
'use strict';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const API_URL =
  'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';

function parseArgs(argv) {
  const args = [...argv];
  const out = {
    inputPath: '',
    outputPath: '',
    textPath: '',
    appKey: process.env.VOLC_APP_KEY || '',
    accessKey: process.env.VOLC_ACCESS_KEY || '',
    resourceId: process.env.VOLC_RESOURCE_ID || 'volc.bigasr.auc_turbo',
    modelName: process.env.VOLC_ASR_MODEL_NAME || 'bigmodel',
  };

  while (args.length > 0) {
    const token = args.shift();
    if (!token) continue;

    if (!out.inputPath && !token.startsWith('--')) {
      out.inputPath = token;
      continue;
    }

    if (token === '--out') out.outputPath = args.shift() || '';
    else if (token === '--text-out') out.textPath = args.shift() || '';
    else if (token === '--app-key') out.appKey = args.shift() || '';
    else if (token === '--access-key') out.accessKey = args.shift() || '';
    else if (token === '--resource-id') out.resourceId = args.shift() || out.resourceId;
    else if (token === '--model') out.modelName = args.shift() || out.modelName;
    else if (token === '--help' || token === '-h') out.help = true;
  }

  return out;
}

function printUsage() {
  console.log(`用法:
  node scripts/transcribe_audio.js <音频文件路径> [--out result.json] [--text-out result.txt]

参数:
  --app-key      火山引擎 APP ID (默认读取 VOLC_APP_KEY)
  --access-key   火山引擎 Access Token (默认读取 VOLC_ACCESS_KEY)
  --resource-id  资源ID (默认 volc.bigasr.auc_turbo)
  --model        模型名 (默认 bigmodel)

说明:
  - 支持 WAV / MP3 / OGG OPUS
  - 文件限制: <=100MB, <=2小时
`);
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printUsage();
    return;
  }

  if (!opts.inputPath) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  if (!opts.appKey || !opts.accessKey) {
    process.stderr.write(
      JSON.stringify(
        {
          status: 'error',
          error:
            '缺少鉴权参数：请提供 --app-key / --access-key 或设置 VOLC_APP_KEY / VOLC_ACCESS_KEY',
        },
        null,
        2,
      ) + '\n',
    );
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(opts.inputPath)) {
    process.stderr.write(
      JSON.stringify({ status: 'error', error: `文件不存在: ${opts.inputPath}` }, null, 2) +
        '\n',
    );
    process.exitCode = 1;
    return;
  }

  const stat = fs.statSync(opts.inputPath);
  if (stat.size > 100 * 1024 * 1024) {
    process.stderr.write(
      JSON.stringify(
        { status: 'error', error: '文件超过100MB限制，请先压缩音频后重试' },
        null,
        2,
      ) + '\n',
    );
    process.exitCode = 1;
    return;
  }

  const dataB64 = fs.readFileSync(opts.inputPath).toString('base64');
  const requestId = getUuid();

  const payload = {
    user: { uid: String(opts.appKey) },
    audio: { data: dataB64 },
    request: { model_name: opts.modelName },
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-App-Key': String(opts.appKey),
      'X-Api-Access-Key': String(opts.accessKey),
      'X-Api-Resource-Id': String(opts.resourceId),
      'X-Api-Request-Id': requestId,
      'X-Api-Sequence': '-1',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  const statusCode = res.headers.get('x-api-status-code') || '';
  const statusMsg = res.headers.get('x-api-message') || '';
  const logId = res.headers.get('x-tt-logid') || '';

  const outObj = {
    status: res.ok && statusCode === '20000000' ? 'success' : 'error',
    http_status: res.status,
    api_status_code: statusCode,
    api_message: statusMsg,
    log_id: logId,
    result_text: json?.result?.text || '',
    result: json,
  };

  if (opts.outputPath) {
    ensureParentDir(opts.outputPath);
    fs.writeFileSync(opts.outputPath, JSON.stringify(outObj, null, 2));
  }

  if (opts.textPath) {
    ensureParentDir(opts.textPath);
    fs.writeFileSync(opts.textPath, outObj.result_text || '');
  }

  if (outObj.status === 'error') {
    process.stderr.write(JSON.stringify(outObj, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write(JSON.stringify(outObj, null, 2) + '\n');
}

main().catch((e) => {
  process.stderr.write(
    JSON.stringify(
      { status: 'error', error: e?.message || String(e) },
      null,
      2,
    ) + '\n',
  );
  process.exitCode = 1;
});
