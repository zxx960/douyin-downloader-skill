#!/usr/bin/env node
'use strict';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const FLASH_URL =
  'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
const SUBMIT_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit';
const QUERY_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query';

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
    mode: process.env.VOLC_ASR_MODE || 'auto', // auto|flash|standard
    pollIntervalMs: Number(process.env.VOLC_POLL_INTERVAL_MS || 1500),
    pollTimeoutMs: Number(process.env.VOLC_POLL_TIMEOUT_MS || 120000),
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
    else if (token === '--mode') out.mode = (args.shift() || 'auto').toLowerCase();
    else if (token === '--poll-interval-ms') out.pollIntervalMs = Number(args.shift() || 1500);
    else if (token === '--poll-timeout-ms') out.pollTimeoutMs = Number(args.shift() || 120000);
    else if (token === '--help' || token === '-h') out.help = true;
  }
  return out;
}

function printUsage() {
  console.log(`用法:
  node scripts/transcribe_audio.js <音频文件路径> [--out result.json] [--text-out result.txt]

参数:
  --app-key      火山引擎 APP ID (默认 VOLC_APP_KEY)
  --access-key   火山引擎 Access Token (默认 VOLC_ACCESS_KEY)
  --resource-id  资源ID (如 volc.bigasr.auc_turbo / volc.seedasr.auc)
  --model        模型名 (默认 bigmodel)
  --mode         auto|flash|standard (默认 auto)
  --poll-interval-ms  standard 模式轮询间隔
  --poll-timeout-ms   standard 模式轮询超时
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

function chooseMode(mode, resourceId) {
  if (mode === 'flash' || mode === 'standard') return mode;
  return resourceId === 'volc.seedasr.auc' ? 'standard' : 'flash';
}

function buildBodyByMode(mode, appKey, audioB64, modelName) {
  if (mode === 'flash') {
    return {
      user: { uid: String(appKey) },
      audio: { data: audioB64 },
      request: { model_name: modelName },
    };
  }

  // standard submit/query body
  return {
    user: { uid: '豆包语音' },
    audio: {
      data: audioB64,
      format: 'mp3',
      codec: 'raw',
      rate: 16000,
      bits: 16,
      channel: 1,
    },
    request: {
      model_name: modelName,
      enable_itn: true,
      enable_punc: false,
      enable_ddc: false,
      enable_speaker_info: false,
      enable_channel_split: false,
      show_utterances: false,
      vad_segment: false,
      sensitive_words_filter: '',
    },
  };
}

async function callFlash(opts, requestId, body) {
  const res = await fetch(FLASH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-App-Key': String(opts.appKey),
      'X-Api-Access-Key': String(opts.accessKey),
      'X-Api-Resource-Id': String(opts.resourceId),
      'X-Api-Request-Id': requestId,
      'X-Api-Sequence': '-1',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { res, text, stage: 'flash' };
}

async function callStandard(opts, requestId, body) {
  const submitRes = await fetch(SUBMIT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': String(opts.appKey),
      'X-Api-Resource-Id': String(opts.resourceId),
      'X-Api-Request-Id': requestId,
      'X-Api-Sequence': '-1',
    },
    body: JSON.stringify(body),
  });
  const submitText = await submitRes.text();

  if (!submitRes.ok) {
    return { res: submitRes, text: submitText, stage: 'submit' };
  }

  const start = Date.now();
  while (Date.now() - start < opts.pollTimeoutMs) {
    await new Promise((r) => setTimeout(r, opts.pollIntervalMs));
    const queryRes = await fetch(QUERY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': String(opts.appKey),
        'X-Api-Resource-Id': String(opts.resourceId),
        'X-Api-Request-Id': requestId,
      },
      body: '{}',
    });

    const queryText = await queryRes.text();
    const statusCode = queryRes.headers.get('x-api-status-code') || '';
    const parsed = parseJsonSafely(queryText);
    const hasText = !!getResultText(parsed);

    if (queryRes.ok && statusCode === '20000000') {
      return { res: queryRes, text: queryText, stage: 'query' };
    }

    // 某些返回不会立即给 20000000，但文本已可用
    if (queryRes.ok && hasText) {
      return { res: queryRes, text: queryText, stage: 'query' };
    }

    // 处理中，继续轮询
    if (queryRes.ok && (statusCode === '20000001' || queryText.trim() === '{}' || !hasText)) {
      continue;
    }

    // non-2xx 或明确错误
    if (!queryRes.ok) return { res: queryRes, text: queryText, stage: 'query' };
  }

  return {
    res: new Response('{}', { status: 408, statusText: 'Query Timeout' }),
    text: JSON.stringify({ status: 'error', error: 'standard query timeout' }),
    stage: 'query',
  };
}

function parseJsonSafely(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function getResultText(parsed) {
  return parsed?.result?.text || parsed?.payload_msg?.result?.text || '';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return printUsage();
  if (!opts.inputPath) {
    printUsage();
    process.exitCode = 2;
    return;
  }
  if (!opts.appKey) {
    process.stderr.write(JSON.stringify({ status: 'error', error: '缺少 app-key' }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(opts.inputPath)) {
    process.stderr.write(JSON.stringify({ status: 'error', error: `文件不存在: ${opts.inputPath}` }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }
  const stat = fs.statSync(opts.inputPath);
  if (stat.size > 100 * 1024 * 1024) {
    process.stderr.write(JSON.stringify({ status: 'error', error: '文件超过100MB限制' }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }

  const mode = chooseMode(opts.mode, opts.resourceId);
  const requestId = getUuid();
  const audioB64 = fs.readFileSync(opts.inputPath).toString('base64');
  const body = buildBodyByMode(mode, opts.appKey, audioB64, opts.modelName);

  const { res, text, stage } =
    mode === 'flash'
      ? await callFlash(opts, requestId, body)
      : await callStandard(opts, requestId, body);

  const parsed = parseJsonSafely(text);
  const outObj = {
    status: res.ok ? 'success' : 'error',
    mode,
    stage,
    request_id: requestId,
    http_status: res.status,
    api_status_code: res.headers.get('x-api-status-code') || '',
    api_message: res.headers.get('x-api-message') || '',
    log_id: res.headers.get('x-tt-logid') || '',
    result_text: getResultText(parsed),
    result: parsed,
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
  process.stderr.write(JSON.stringify({ status: 'error', error: e?.message || String(e) }, null, 2) + '\n');
  process.exitCode = 1;
});
