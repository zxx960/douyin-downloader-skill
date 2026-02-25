#!/usr/bin/env node
'use strict';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1',
};

function extractFirstUrl(text) {
  const match = text.match(
    /http[s]?:\/\/(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\(\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+/,
  );
  return match ? match[0] : null;
}

function sanitizeTitle(title) {
  return String(title || '').replace(/[\\/:*?"<>|]/g, '_');
}

function parseVideoIdFromFinalUrl(finalUrl) {
  let u;
  try {
    u = new URL(finalUrl);
  } catch {
    throw new Error(`无法解析重定向后的URL: ${finalUrl}`);
  }

  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`重定向URL路径异常: ${finalUrl}`);
  }

  let last = parts[parts.length - 1];
  if ((last === 'video' || last === 'note') && parts.length >= 2) {
    last = parts[parts.length - 2];
  }
  return last;
}

function extractRouterDataJson(html) {
  const re = /window\._ROUTER_DATA\s*=\s*(.*?)<\/script>/s;
  const m = re.exec(html);
  if (!m || !m[1]) {
    throw new Error('从HTML中解析视频信息失败（未找到 window._ROUTER_DATA）');
  }

  const raw = m[1].trim().replace(/;\s*$/, '');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `解析 window._ROUTER_DATA JSON 失败: ${e && e.message ? e.message : String(e)}`,
    );
  }
}

function pickVideoInfoRes(routerData) {
  const loaderData = routerData && routerData.loaderData;
  if (!loaderData || typeof loaderData !== 'object') {
    throw new Error('window._ROUTER_DATA 结构异常（缺少 loaderData）');
  }

  const VIDEO_ID_PAGE_KEY = 'video_(id)/page';
  const NOTE_ID_PAGE_KEY = 'note_(id)/page';

  if (loaderData[VIDEO_ID_PAGE_KEY] && loaderData[VIDEO_ID_PAGE_KEY].videoInfoRes) {
    return loaderData[VIDEO_ID_PAGE_KEY].videoInfoRes;
  }
  if (loaderData[NOTE_ID_PAGE_KEY] && loaderData[NOTE_ID_PAGE_KEY].videoInfoRes) {
    return loaderData[NOTE_ID_PAGE_KEY].videoInfoRes;
  }

  // 兜底：尝试从任意 key 中找 videoInfoRes
  for (const k of Object.keys(loaderData)) {
    const v = loaderData[k];
    if (v && v.videoInfoRes) return v.videoInfoRes;
  }

  throw new Error('无法从 window._ROUTER_DATA.loaderData 中定位 videoInfoRes');
}

async function fetchText(url, headers) {
  const res = await fetch(url, { method: 'GET', redirect: 'follow', headers });
  if (!res.ok) {
    throw new Error(`请求失败: ${res.status} ${res.statusText}`);
  }
  return { text: await res.text(), finalUrl: res.url };
}

async function parseDouyinShareText(shareText) {
  const shareUrl = extractFirstUrl(shareText);
  if (!shareUrl) {
    throw new Error('未找到有效的分享链接');
  }

  // 1) 跟随短链重定向，拿到最终URL，从中解析 video_id
  const shortRes = await fetch(shareUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: HEADERS,
  });
  if (!shortRes.ok) {
    throw new Error(`访问分享链接失败: ${shortRes.status} ${shortRes.statusText}`);
  }
  const finalUrl = shortRes.url;
  const videoId = parseVideoIdFromFinalUrl(finalUrl);

  // 2) 请求分享页HTML，提取 window._ROUTER_DATA
  const pageUrl = `https://www.iesdouyin.com/share/video/${videoId}`;
  const { text: html } = await fetchText(pageUrl, HEADERS);
  const routerData = extractRouterDataJson(html);
  const videoInfoRes = pickVideoInfoRes(routerData);

  const item =
    videoInfoRes &&
    Array.isArray(videoInfoRes.item_list) &&
    videoInfoRes.item_list.length > 0
      ? videoInfoRes.item_list[0]
      : null;

  if (!item) {
    throw new Error('无法从 videoInfoRes.item_list 中读取视频数据');
  }

  const rawPlayUrl =
    item &&
    item.video &&
    item.video.play_addr &&
    Array.isArray(item.video.play_addr.url_list) &&
    item.video.play_addr.url_list.length > 0
      ? item.video.play_addr.url_list[0]
      : '';

  if (!rawPlayUrl) {
    throw new Error('无法从 item.video.play_addr.url_list[0] 中读取播放地址');
  }

  const title = sanitizeTitle(
    item.desc && String(item.desc).trim() ? item.desc : `douyin_${videoId}`,
  );

  const downloadUrl = rawPlayUrl.replace('playwm', 'play');

  return {
    video_id: videoId,
    title,
    download_url: downloadUrl,
    raw_url: rawPlayUrl,
    share_url: shareUrl,
    redirected_url: finalUrl,
    iesdouyin_url: pageUrl,
  };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const argvText = process.argv.slice(2).join(' ').trim();
  const input = argvText || (process.stdin.isTTY ? '' : (await readStdin()).trim());

  if (!input) {
    console.error('用法: node parse_douyin.js "抖音分享文本或链接"');
    process.exitCode = 2;
    return;
  }

  try {
    const result = await parseDouyinShareText(input);
    process.stdout.write(JSON.stringify(result, null, 2));
    process.stdout.write('\n');
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    process.stderr.write(JSON.stringify({ status: 'error', error: msg }, null, 2));
    process.stderr.write('\n');
    process.exitCode = 1;
  }
}

main();
