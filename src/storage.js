/* ────────────────────────────────────────────────────────────
   memo v2 · 图片存储层
   R2 / Backblaze B2（S3 兼容）/ Workers KV，可切换、可回退
   ──────────────────────────────────────────────────────────── */

import { AwsClient } from 'aws4fetch';

export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export const STORAGE_LABELS = {
  r2: 'Cloudflare R2',
  b2: 'Backblaze B2',
  kv: 'Workers KV',
};

/** auto 模式的优先顺序 */
const AUTO_ORDER = ['b2', 'kv', 'r2'];

const KV_MAX_BYTES = 20 * 1024 * 1024;

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

function mimeFromKey(key) {
  const ext = String(key).split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function b2Ready(env) {
  return !!(env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET && env.B2_ENDPOINT);
}

export function storageAvailable(env) {
  return {
    r2: !!env.IMAGES,
    b2: b2Ready(env),
    kv: !!env.IMAGE_KV,
  };
}

/**
 * 当前该用哪个存储。数据库里的 image_storage 优先，其次环境变量，
 * 最后按 B2 → KV → R2 自动挑一个可用的。
 */
export function resolveStorage(env, setting) {
  const available = storageAvailable(env);
  const wanted = [];
  const fromDb = String(setting || '').toLowerCase();
  const fromEnv = String(env.IMAGE_STORAGE || '').toLowerCase();
  if (fromDb && fromDb !== 'auto') wanted.push(fromDb);
  if (fromEnv && fromEnv !== 'auto') wanted.push(fromEnv);
  wanted.push(...AUTO_ORDER);
  for (const name of wanted) {
    if (available[name]) return name;
  }
  return null;
}

export function storageInfo(env, setting) {
  const available = storageAvailable(env);
  return {
    active: resolveStorage(env, setting),
    available,
    labels: STORAGE_LABELS,
  };
}

/* ── B2 ───────────────────────────────────────────────────── */

function b2Client(env) {
  return new AwsClient({
    accessKeyId: env.B2_KEY_ID,
    secretAccessKey: env.B2_APP_KEY,
    service: 's3',
    region: env.B2_REGION || 'us-east-005',
  });
}

function b2Url(env, key) {
  const base = String(env.B2_ENDPOINT).replace(/\/+$/, '');
  const path = String(key).split('/').map(encodeURIComponent).join('/');
  return `${base}/${env.B2_BUCKET}/${path}`;
}

async function b2Failure(res, action) {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch { /* ignore */ }
  return new Error(`B2 ${action}失败（${res.status}）${detail ? `：${detail}` : ''}`);
}

/* ── 写入 / 读取 / 删除 ───────────────────────────────────── */

async function putTo(env, store, key, buf, mime) {
  if (store === 'r2') {
    await env.IMAGES.put(key, buf, {
      httpMetadata: { contentType: mime, cacheControl: IMAGE_CACHE_CONTROL },
    });
    return;
  }

  if (store === 'b2') {
    // B2 前面可能还有一层缓存，长 TTL 会让删除后仍读到旧图。
    // 边缘缓存交给 Worker 自己的 Cache API，B2 对象一律不缓存。
    const res = await b2Client(env).fetch(b2Url(env, key), {
      method: 'PUT',
      headers: { 'content-type': mime, 'cache-control': 'no-store' },
      body: buf,
    });
    if (!res.ok) throw await b2Failure(res, '上传');
    return;
  }

  if (store === 'kv') {
    if (buf.byteLength > KV_MAX_BYTES) {
      throw new Error('KV 单个对象不能超过 20 MB');
    }
    await env.IMAGE_KV.put(key, buf, {
      metadata: { mime, size: buf.byteLength },
    });
    return;
  }

  throw new Error(`未知存储：${store}`);
}

/**
 * 写入当前存储。当前存储出错时依次尝试其他可用存储，
 * 读取端会跨存储回退，所以图片不会因为一次故障丢掉。
 */
export async function putObject(env, key, buf, mime, preferred) {
  const available = storageAvailable(env);
  const order = [];
  if (preferred && available[preferred]) order.push(preferred);
  for (const name of AUTO_ORDER) {
    if (!order.includes(name) && available[name]) order.push(name);
  }

  let lastErr = null;
  for (const store of order) {
    try {
      await putTo(env, store, key, buf, mime);
      return store;
    } catch (err) {
      lastErr = err;
      console.error('[storage] 写入失败', store, err && err.stack ? err.stack : err);
    }
  }
  throw lastErr || new Error('没有可用的图片存储');
}

async function getFrom(env, store, key) {
  if (store === 'r2') {
    const obj = await env.IMAGES.get(key);
    if (!obj) return null;
    const body = await obj.arrayBuffer();
    return {
      body,
      mime: obj.httpMetadata?.contentType || mimeFromKey(key),
      size: obj.size,
      etag: obj.httpEtag,
    };
  }

  if (store === 'b2') {
    // 每次读都带一个随机查询串：即使 B2 前面的缓存层忽略 no-store，
    // 也不会把已删除的旧对象再吐回来。
    const u = new URL(b2Url(env, key));
    u.searchParams.set('_cb', Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    const res = await b2Client(env).fetch(u.toString(), { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) throw await b2Failure(res, '读取');
    const body = await res.arrayBuffer();
    return {
      body,
      mime: res.headers.get('content-type') || mimeFromKey(key),
      size: body.byteLength,
      etag: res.headers.get('etag') || null,
    };
  }

  if (store === 'kv') {
    const { value, metadata } = await env.IMAGE_KV.getWithMetadata(key, 'arrayBuffer');
    if (!value) return null;
    return {
      body: value,
      mime: metadata?.mime || mimeFromKey(key),
      size: value.byteLength,
      etag: `"kv-${String(key).replace(/[^a-z0-9]/gi, '')}"`,
    };
  }

  return null;
}

/** 先读当前存储，没有就依次找其他已配置的存储（兼容切换前的旧图） */
export async function getObject(env, key, preferred) {
  const available = storageAvailable(env);
  const order = [];
  if (preferred && available[preferred]) order.push(preferred);
  for (const name of AUTO_ORDER) {
    if (!order.includes(name) && available[name]) order.push(name);
  }

  for (const store of order) {
    try {
      const obj = await getFrom(env, store, key);
      if (obj) {
        console.log('[storage] hit', store, key);
        return { ...obj, store };
      }
    } catch (err) {
      console.error('[storage] 读取失败', store, err && err.stack ? err.stack : err);
    }
  }
  return null;
}

async function b2DeleteVersions(env, key) {
  const client = b2Client(env);
  const base = String(env.B2_ENDPOINT).replace(/\/+$/, '');
  const bucketUrl = `${base}/${env.B2_BUCKET}`;
  const listRes = await client.fetch(`${bucketUrl}?versions&prefix=${encodeURIComponent(key)}`, { method: 'GET' });
  if (!listRes.ok) return { listed: false, failed: 0 };
  const xml = await listRes.text();
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  let failed = 0;
  for (const block of xml.split(/<(?:Version|DeleteMarker)>/).slice(1)) {
    const km = /<Key>([^<]*)<\/Key>/.exec(block);
    const vm = /<VersionId>([^<]*)<\/VersionId>/.exec(block);
    if (!km || !vm || km[1] !== key) continue;
    const url = `${bucketUrl}/${key.split('/').map(encodeURIComponent).join('/')}?versionId=${encodeURIComponent(vm[1])}`;
    const res = await client.fetch(url, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) failed += 1;
  }
  return { listed: !truncated, failed };
}

async function deleteFrom(env, store, key) {
  if (store === 'r2') {
    await env.IMAGES.delete(key);
    return;
  }

  if (store === 'b2') {
    // 桶有版本控制时，普通 DELETE 只加删除标记；直接清掉所有版本。
    // 列表成功且没有失败就结束，避免给只存在于 KV 的 key 留一个删除标记。
    const { listed, failed } = await b2DeleteVersions(env, key);
    if (listed && !failed) return;
    const res = await b2Client(env).fetch(b2Url(env, key), { method: 'DELETE' });
    if (res.status !== 204 && res.status !== 404) throw await b2Failure(res, '删除');
    return;
  }

  if (store === 'kv') {
    await env.IMAGE_KV.delete(key);
  }
}

/** 删除所有已配置存储里的同一个 key，避免切换后留下副本 */
export async function deleteObjectEverywhere(env, key) {
  const available = storageAvailable(env);
  await Promise.all(AUTO_ORDER.filter((name) => available[name]).map(async (store) => {
    try {
      await deleteFrom(env, store, key);
    } catch (err) {
      console.error('[storage] 删除失败', store, err && err.stack ? err.stack : err);
    }
  }));
}
