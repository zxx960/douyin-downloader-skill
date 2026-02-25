#!/usr/bin/env node
'use strict';

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1',
  Referer: 'https://www.douyin.com/',
};

async function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const req = protocol.get(url, { headers: HEADERS }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Handle redirect
        const redirectUrl = res.headers.location;
        return downloadFile(redirectUrl, outputPath).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`下载失败: HTTP ${res.statusCode}`));
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastProgress = -1;

      const fileStream = fs.createWriteStream(outputPath);

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const progress = Math.floor((downloadedBytes / totalBytes) * 100);
          if (progress !== lastProgress && progress % 10 === 0) {
            process.stderr.write(`下载进度: ${progress}%\n`);
            lastProgress = progress;
          }
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve(outputPath);
      });

      fileStream.on('error', (err) => {
        fs.unlink(outputPath, () => {}); // Clean up on error
        reject(err);
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('下载超时'));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('用法: node download_video.js <视频URL> <输出路径>');
    process.exitCode = 2;
    return;
  }

  const videoUrl = args[0];
  const outputPath = args[1];

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    process.stderr.write(`开始下载: ${videoUrl}\n`);
    process.stderr.write(`保存到: ${outputPath}\n`);

    await downloadFile(videoUrl, outputPath);

    process.stderr.write(`下载完成: ${outputPath}\n`);
    process.stdout.write(
      JSON.stringify({ status: 'success', path: outputPath }, null, 2),
    );
    process.stdout.write('\n');
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    process.stderr.write(
      JSON.stringify({ status: 'error', error: msg }, null, 2),
    );
    process.stderr.write('\n');
    process.exitCode = 1;
  }
}

main();
