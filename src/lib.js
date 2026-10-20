/* ────────────────────────────────────────────────────────────
   memo v2 · 基础工具：响应、编码、密码、会话
   ──────────────────────────────────────────────────────────── */

const enc = new TextEncoder();

/* ── 响应 ─────────────────────────────────────────────────── */

export const CORS = {
  'access-control-allow-origin': 'same-origin',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function fail(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, status);
}

export function ok(extra = {}) {
  return json({ ok: true, ...extra });
}

/* ── 编码 ─────────────────────────────────────────────────── */

export function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  return atob(s + '='.repeat((4 - (s.length % 4)) % 4));
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** 短随机串，去掉容易看错的 0/O/1/I/L */
export function shortId(len = 6) {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function nowMs() {
  return Date.now();
}

/* ── 密码（PBKDF2-SHA256）─────────────────────────────────── */

export const DEFAULT_ITER = 50000;

export async function hashPassword(password, salt, iterations = DEFAULT_ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: unb64(salt), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return b64(bits);
}

export function newSalt() {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

/** 密码强度：至少 6 位，不接受纯空白 */
export function checkPassword(pw) {
  if (typeof pw !== 'string') return '密码不能为空';
  if (pw.length < 6) return '密码至少 6 位';
  if (pw.length > 128) return '密码太长了';
  return null;
}

export function checkUsername(name) {
  if (typeof name !== 'string') return '名字不能为空';
  const s = name.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,20}$/.test(s)) return '登录名只能用英文小写字母、数字、下划线（2–20 位），不能用中文；中文请填在「显示名」里';
  return null;
}

/* ── 会话 ─────────────────────────────────────────────────── */

const COOKIE = 'memo_sid';
const TTL = 60 * 60 * 24 * 30; // 30 天

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export async function makeSession(env, user) {
  const payload = JSON.stringify({ u: user.id, v: user.session_ver, e: nowMs() + TTL * 1000 });
  const body = b64url(payload);
  const sig = await hmac(env.SESSION_SECRET || 'memo-dev', body);
  return body + '.' + b64url(sig);
}

export async function readSession(env, request) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expect;
  try {
    expect = b64url(await hmac(env.SESSION_SECRET || 'memo-dev', body));
  } catch {
    return null;
  }
  if (!safeEqual(sig, expect)) return null;
  let payload;
  try {
    payload = JSON.parse(unb64url(body));
  } catch {
    return null;
  }
  if (!payload || typeof payload.u !== 'number' || payload.e < nowMs()) return null;
  return payload;
}

export function sessionCookie(token, secure = true) {
  return `${COOKIE}=${token}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${TTL}`;
}

export function clearCookie(secure = true) {
  return `${COOKIE}=; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=0`;
}

/* ── 杂项 ─────────────────────────────────────────────────── */

export function timeAgo(ms, tzOffsetHours = 8) {
  const diff = nowMs() - ms;
  const min = 60_000;
  if (diff < min) return '刚刚';
  if (diff < 60 * min) return Math.floor(diff / min) + ' 分钟前';
  if (diff < 24 * 60 * min) return Math.floor(diff / (60 * min)) + ' 小时前';
  if (diff < 7 * 24 * 60 * min) return Math.floor(diff / (24 * 60 * min)) + ' 天前';
  const d = new Date(ms + tzOffsetHours * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
