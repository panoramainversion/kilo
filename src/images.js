/* ────────────────────────────────────────────────────────────
   memo v2 · 图片：类型嗅探、上传、读取、清理
   存储走 storage.js（R2 / B2 / KV 可切换），元数据走 D1（images 表）
   ──────────────────────────────────────────────────────────── */

import { fail, json, nowMs } from './lib.js';
import {
  IMAGE_CACHE_CONTROL, deleteObjectEverywhere, getObject, putObject, resolveStorage,
} from './storage.js';

const MB = 1024 * 1024;

/** 每小时每人的上传上限，防止被当成图床刷 */
const HOURLY_LIMIT = 40;

const KEY_RE = /^i\/\d{6}\/[a-f0-9]{16}\.(jpg|png|gif|webp)$/;

const MAGIC = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/gif', ext: 'gif', test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/** 只看文件头，不信客户端声明的 Content-Type */
export function sniff(bytes) {
  if (!bytes || bytes.length < 12) return null;
  for (const m of MAGIC) if (m.test(bytes)) return m;
  return null;
}

function stamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function randomName() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

/** 最近一小时该用户上传了几张 */
async function recentCount(env, userId) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM images WHERE user_id = ? AND created_at > ?',
  ).bind(userId, nowMs() - 3600_000).first();
  return row ? row.n : 0;
}

/** 读图前查当前存储。只有边缘缓存没命中时才会走这里 */
async function storageSetting(env) {
  try {
    const row = await env.DB.prepare("SELECT v FROM settings WHERE k = 'image_storage'").first();
    return row ? row.v : '';
  } catch {
    return '';
  }
}

function imageResponse(obj, cacheable = true) {
  const headers = new Headers();
  headers.set('content-type', obj.mime || 'application/octet-stream');
  headers.set('cache-control', cacheable ? IMAGE_CACHE_CONTROL : 'no-store');
  // CDN 默认会把带 cache-control 的图片响应再缓存一层，删除时清不掉。
  // 这里只让 Worker 的 Cache API 缓存，删除时 caches.default.delete 才有效。
  headers.set('cdn-cache-control', 'no-store');
  headers.set('content-length', String(obj.size || 0));
  headers.set('x-content-type-options', 'nosniff');
  // 别被搜索引擎当成公共图床收录
  headers.set('x-robots-tag', 'noindex, noimageindex');
  headers.set('x-image-at', String(Date.now()));
  if (obj.store) headers.set('x-image-store', obj.store);
  if (obj.etag) headers.set('etag', obj.etag);
  return new Response(obj.body, { headers });
}

/**
 * 上传一张图。请求体是原始二进制，宽高从 query 传（前端压缩时已知）。
 * 返回 { key, w, h, url, size, store }
 */
export async function uploadImage(env, user, request, url, ctx) {
  const store = resolveStorage(env, ctx && ctx.settings ? ctx.settings.image_storage : '');
  if (!store) return fail('图片存储还没配置（B2 / KV / R2）', 503);

  let maxMb = Number.parseInt(ctx && ctx.settings ? ctx.settings.max_image_mb : '', 10);
  if (!Number.isFinite(maxMb)) {
    const settings = await env.DB.prepare("SELECT v FROM settings WHERE k = 'max_image_mb'").first();
    maxMb = Number.parseInt(settings ? settings.v : '3', 10) || 3;
  }
  maxMb = Math.min(10, Math.max(1, maxMb));

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared && declared > maxMb * MB) {
    return fail(`图片不能超过 ${maxMb} MB`, 413);
  }

  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxMb * MB) return fail(`图片不能超过 ${maxMb} MB`, 413);
  if (buf.byteLength < 128) return fail('图片内容为空', 400);

  const bytes = new Uint8Array(buf);
  const kind = sniff(bytes);
  if (!kind) return fail('只支持 JPG / PNG / GIF / WebP', 415);

  const used = await recentCount(env, user.id);
  if (used >= HOURLY_LIMIT) {
    return fail(`上传太频繁，每小时最多 ${HOURLY_LIMIT} 张，歇一会儿再来`, 429);
  }

  const w = Math.min(20000, Math.max(0, Number.parseInt(url.searchParams.get('w') || '0', 10) || 0));
  const h = Math.min(20000, Math.max(0, Number.parseInt(url.searchParams.get('h') || '0', 10) || 0));

  const key = `i/${stamp()}/${randomName()}.${kind.ext}`;

  let usedStore;
  try {
    usedStore = await putObject(env, key, buf, kind.mime, store);
  } catch {
    return fail('图片写入失败，稍后再试', 503);
  }

  await env.DB.prepare(
    'INSERT INTO images (key, user_id, mime, size, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(key, user.id, kind.mime, buf.byteLength, w, h, nowMs()).run();

  // KV 写入是最终一致的，把刚上传的图先放进当前边缘缓存，
  // 让上传者马上能看到；其他机房最多晚 60 秒。
  if (ctx && typeof caches !== 'undefined' && ctx.waitUntil) {
    try {
      const cacheKey = new Request(new URL(`/i/${key}`, url).toString());
      const cached = imageResponse({ mime: kind.mime, size: buf.byteLength, etag: null, store: usedStore });
      ctx.waitUntil(caches.default.put(cacheKey, cached).catch(() => {}));
    } catch { /* ignore */ }
  }

  return json({ key, w, h, url: `/i/${key}`, size: buf.byteLength, store: usedStore }, 201);
}

/** 读图：先看边缘缓存，再回当前存储（找不到时回退到其他已配置存储） */
export async function serveImage(env, request, key, ctx) {
  if (!KEY_RE.test(key)) return fail('Not found', 404);

  // 带查询串的请求只用于调试/破缓存，不进边缘缓存，避免留下清不掉的副本
  const cacheable = !request.url.includes('?');
  const cache = cacheable && typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }

  const preferred = resolveStorage(env, await storageSetting(env));
  if (!preferred) return fail('图片存储未配置', 503);

  const obj = await getObject(env, key, preferred);
  if (!obj) return fail('Not found', 404);

  const res = imageResponse(obj, cacheable);
  if (cache && ctx) ctx.waitUntil(cache.put(request, res.clone()).catch(() => {}));
  return res;
}

/** 删掉一个对象（所有已配置存储 + 边缘缓存 + 元数据）。失败不抛，避免影响主流程 */
export async function deleteImage(env, key, origin) {
  if (!key) return;
  await deleteObjectEverywhere(env, key);
  if (origin && typeof caches !== 'undefined') {
    try {
      await caches.default.delete(new Request(new URL(`/i/${key}`, origin).toString()));
    } catch { /* ignore */ }
  }
  try {
    await env.DB.prepare('DELETE FROM images WHERE key = ?').bind(key).run();
  } catch { /* ignore */ }
}

export async function imageExists(env, key) {
  const row = await env.DB.prepare('SELECT 1 AS x FROM images WHERE key = ?').bind(key).first();
  return !!row;
}
