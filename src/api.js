/* ────────────────────────────────────────────────────────────
   memo v2 · API 处理
   ──────────────────────────────────────────────────────────── */

import {
  checkPassword, checkUsername, clearCookie, clampInt, fail, hashPassword, json,
  makeSession, newSalt, nowMs, ok, safeEqual, sessionCookie, shortId, xmlEscape, DEFAULT_ITER,
} from './lib.js';
import {
  avatarOf, countNotes, countUsers, createInvite, createUser, findInvite, getNote, getSettings,
  getUserById, getUserByName, listNotes, listUsers, noteToJson, publicUser, saveSettings, stats,
} from './data.js';
import { deleteImage, sniff, thumbKeyFor, uploadImage } from './images.js';
import { storageInfo } from './storage.js';

/** 人数上限：后台可改，1–50，没设过就退回环境变量 / 8 */
function maxUsers(ctx) {
  const n = Number.parseInt(ctx.settings.max_users || ctx.env.MAX_USERS || '8', 10);
  if (!Number.isFinite(n)) return 8;
  return Math.min(50, Math.max(1, n));
}

/** 本地 http 调试时不能带 Secure，否则浏览器/客户端不收这个 cookie */
function isHttps(ctx) {
  return ctx.url.protocol === 'https:';
}

const MAX_CONTENT = 5000;
const MAX_COMMENT = 1000;
const MAX_IMAGES = 9;

/* ── 小工具 ───────────────────────────────────────────────── */

function needLogin(ctx) {
  return ctx.me ? null : fail('请先登录', 401);
}

function needAdmin(ctx) {
  if (!ctx.me) return fail('请先登录', 401);
  if (ctx.me.role !== 'admin') return fail('只有管理员能做这件事', 403);
  return null;
}

async function readJson(request) {
  try {
    const t = await request.text();
    if (!t) return {};
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function parseTime(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== '') return n > 1e12 ? n : n * 1000;
  const d = Date.parse(String(v));
  return Number.isNaN(d) ? fallback : d;
}

/** 校验前端传来的图片数组，只认自己上传过的 key */
async function normalizeImages(env, userId, list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list.slice(0, MAX_IMAGES)) {
    const key = typeof item === 'string' ? item : item && item.k;
    if (typeof key !== 'string' || !key.startsWith('i/')) continue;
    const row = await env.DB.prepare('SELECT key, w, h FROM images WHERE key = ? AND user_id = ?')
      .bind(key, userId).first();
    if (!row) continue;
    const t = typeof item.t === 'string' && item.t === thumbKeyFor(row.key) ? item.t : '';
    out.push({
      k: row.key,
      w: row.w || 0,
      h: row.h || 0,
      ...(t ? { t } : {}),
    });
  }
  return out;
}

/* ── 初始化 / 登录 ─────────────────────────────────────────── */

export async function getSite(ctx) {
  const s = ctx.settings;
  const n = await countUsers(ctx.env);
  const storage = storageInfo(ctx.env, s.image_storage);
  return json({
    site_title: s.site_title,
    site_desc: s.site_desc,
    footer_text: s.footer_text,
    bg_light: s.bg_light,
    fg_light: s.fg_light,
    accent_light: s.accent_light,
    bg_dark: s.bg_dark,
    fg_dark: s.fg_dark,
    accent_dark: s.accent_dark,
    comments_enabled: s.comments_enabled === '1',
    max_image_mb: Number(s.max_image_mb) || 3,
    needs_setup: n === 0,
    users: n,
    max_users: maxUsers(ctx),
    // r2_ready 保留给旧前端缓存；新前端看 images_ready
    r2_ready: !!storage.active,
    images_ready: !!storage.active,
    images_enabled: !!storage.active && s.images_enabled === '1',
    image_storage: storage.active,
    image_storage_setting: s.image_storage || 'auto',
    storage_available: storage.available,
  });
}

/** 首次初始化：只在一个人都没有时可用，要 SETUP_TOKEN */
export async function setup(ctx) {
  const body = await readJson(ctx.request);
  if (!body) return fail('请求格式不对');

  if ((await countUsers(ctx.env)) > 0) return fail('已经初始化过了', 403);

  const token = String(body.token || '').trim();
  const expect = String(ctx.env.SETUP_TOKEN || '').trim();
  if (!expect) return fail('服务端没配 SETUP_TOKEN，先跑 wrangler secret put SETUP_TOKEN', 500);
  if (!safeEqual(token, expect)) return fail('初始化令牌不对', 403);

  const nameErr = checkUsername(body.username);
  if (nameErr) return fail(nameErr);
  const pwErr = checkPassword(body.password);
  if (pwErr) return fail(pwErr);

  const id = await createUser(ctx.env, {
    username: body.username,
    display_name: body.display_name || body.username,
    role: 'admin',
  });
  const salt = newSalt();
  const hash = await hashPassword(body.password, salt, DEFAULT_ITER);
  await ctx.env.DB.prepare(
    'UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, last_login_at = ? WHERE id = ?',
  ).bind(hash, salt, DEFAULT_ITER, nowMs(), id).run();

  const user = await getUserById(ctx.env, id);
  const sid = await makeSession(ctx.env, user);
  return json({ ok: true, user: publicUser(user) }, 200, { 'set-cookie': sessionCookie(sid, isHttps(ctx)) });
}

export async function login(ctx) {
  const body = await readJson(ctx.request);
  if (!body) return fail('请求格式不对');

  const user = await getUserByName(ctx.env, body.username || '');
  const generic = '用户名或密码不对';

  if (!user) return fail(generic, 401);
  if (!user.pw_hash) {
    return fail('这个账号还没设密码，用管理员给的邀请码激活一下', 403, { need_activate: true });
  }

  const hash = await hashPassword(String(body.password || ''), user.pw_salt, user.pw_iter || DEFAULT_ITER);
  if (!safeEqual(hash, user.pw_hash)) return fail(generic, 401);

  await ctx.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowMs(), user.id).run();
  const token = await makeSession(ctx.env, user);
  return json({ ok: true, user: publicUser(user) }, 200, { 'set-cookie': sessionCookie(token, isHttps(ctx)) });
}

export function logout(ctx) {
  return json({ ok: true }, 200, { 'set-cookie': clearCookie(isHttps(ctx)) });
}

export async function me(ctx) {
  if (!ctx.me) return json({ authed: false });
  return json({ authed: true, user: publicUser(ctx.me) });
}

/** 用邀请码激活：设密码 + 直接登录 */
export async function activate(ctx) {
  const body = await readJson(ctx.request);
  if (!body) return fail('请求格式不对');

  const inv = await findInvite(ctx.env, body.code || '');
  if (!inv) return fail('邀请码不对', 404);
  if (inv.used_at) return fail('这个邀请码已经用过了', 410);
  if (inv.expires_at < nowMs()) return fail('邀请码过期了，找管理员重新生成', 410);

  const pwErr = checkPassword(body.password);
  if (pwErr) return fail(pwErr);

  const user = await getUserById(ctx.env, inv.user_id);
  if (!user) return fail('账号不存在', 404);

  const salt = newSalt();
  const hash = await hashPassword(body.password, salt, DEFAULT_ITER);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      'UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, session_ver = session_ver + 1, last_login_at = ? WHERE id = ?',
    ).bind(hash, salt, DEFAULT_ITER, nowMs(), user.id),
    ctx.env.DB.prepare('UPDATE invites SET used_at = ? WHERE code = ?').bind(nowMs(), inv.code),
  ]);

  const fresh = await getUserById(ctx.env, user.id);
  const token = await makeSession(ctx.env, fresh);
  return json({ ok: true, user: publicUser(fresh) }, 200, { 'set-cookie': sessionCookie(token, isHttps(ctx)) });
}

export async function changePassword(ctx) {
  const bad = needLogin(ctx);
  if (bad) return bad;

  const body = await readJson(ctx.request);
  if (!body) return fail('请求格式不对');

  const oldHash = await hashPassword(String(body.old || ''), ctx.me.pw_salt, ctx.me.pw_iter || DEFAULT_ITER);
  if (!safeEqual(oldHash, ctx.me.pw_hash)) return fail('原密码不对', 403);

  const pwErr = checkPassword(body.new);
  if (pwErr) return fail(pwErr);

  const salt = newSalt();
  const hash = await hashPassword(body.new, salt, DEFAULT_ITER);
  await ctx.env.DB.prepare(
    'UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, session_ver = session_ver + 1 WHERE id = ?',
  ).bind(hash, salt, DEFAULT_ITER, ctx.me.id).run();

  const fresh = await getUserById(ctx.env, ctx.me.id);
  const token = await makeSession(ctx.env, fresh);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, isHttps(ctx)) });
}

export async function updateProfile(ctx) {
  const bad = needLogin(ctx);
  if (bad) return bad;

  const body = await readJson(ctx.request);
  if (!body) return fail('请求格式不对');

  const display = String(body.display_name ?? ctx.me.display_name).trim().slice(0, 30);
  if (!display) return fail('名字不能为空');
  const bio = String(body.bio ?? ctx.me.bio).trim().slice(0, 200);

  const title = String(body.title ?? ctx.me.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 12);
  const rawColor = String(body.title_color ?? ctx.me.title_color ?? '').trim();
  if (rawColor && !/^#[0-9a-fA-F]{6}$/.test(rawColor)) return fail('头衔颜色格式不对');
  const titleColor = rawColor.toLowerCase();
  const titleOn = body.title_on === undefined
    ? (ctx.me.title_on ? 1 : 0)
    : (body.title_on === true || body.title_on === 1 || body.title_on === '1' ? 1 : 0);
  if (titleOn && !title) return fail('先写一个头衔再打开');

  // 头像有两种存法：avatar_data 直接存库里（默认，不依赖 R2），avatar_key 存 R2
  let avatarData = ctx.me.avatar_data || null;
  if (body.avatar_data !== undefined) {
    const next = body.avatar_data ? String(body.avatar_data) : null;
    if (next) {
      const m = /^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(next);
      if (!m) return fail('头像格式不对，请重新选一张');
      if (m[2].length > 140000) return fail('头像太大了，换一张小一点的');
      let bin;
      try { bin = atob(m[2]); } catch { return fail('头像数据坏了'); }
      const head = new Uint8Array(12);
      for (let i = 0; i < 12 && i < bin.length; i++) head[i] = bin.charCodeAt(i);
      if (!sniff(head)) return fail('头像不是有效图片');
    }
    avatarData = next;
  }

  let avatarKey = ctx.me.avatar_key;
  if (body.avatar !== undefined) {
    const next = body.avatar ? String(body.avatar) : null;
    if (next) {
      const owned = await ctx.env.DB.prepare('SELECT key FROM images WHERE key = ? AND user_id = ?')
        .bind(next, ctx.me.id).first();
      if (!owned) return fail('头像图片无效');
      avatarKey = next;
    } else {
      avatarKey = null;
    }
    if (ctx.me.avatar_key && ctx.me.avatar_key !== avatarKey) {
      await deleteImage(ctx.env, ctx.me.avatar_key, ctx.url.origin);
    }
  }

  await ctx.env.DB.prepare(
    'UPDATE users SET display_name = ?, bio = ?, title = ?, title_color = ?, title_on = ?, avatar_key = ?, avatar_data = ? WHERE id = ?',
  ).bind(display, bio, title, titleColor, titleOn, avatarKey, avatarData, ctx.me.id).run();

  const fresh = await getUserById(ctx.env, ctx.me.id);
  return json({ ok: true, user: publicUser(fresh) });
}

/* ── 用户（公开信息）───────────────────────────────────────── */

export async function users(ctx) {
  const rows = await listUsers(ctx.env);
  return json({
    users: rows.map((r) => ({
      ...publicUser(r),
      note_count: r.note_count || 0,
      comment_count: r.comment_count || 0,
    })),
  });
}

export async function userDetail(ctx, username) {
  const row = await getUserByName(ctx.env, username);
  if (!row) return fail('没有这个用户', 404);
  const u = publicUser(row);
  const n = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM notes WHERE user_id = ?').bind(row.id).first();
  return json({ user: { ...u, note_count: n ? n.n : 0 } });
}

/* ── 笔记 ─────────────────────────────────────────────────── */

export async function notes(ctx) {
  const q = ctx.url.searchParams;
  const limit = clampInt(q.get('limit'), 1, 50, 20);
  const offset = clampInt(q.get('offset'), 0, 100000, 0);
  const tag = (q.get('tag') || '').replace(/^#/, '').slice(0, 40);
  const kw = (q.get('q') || '').slice(0, 60);
  const user = (q.get('user') || '').slice(0, 20);

  let userId = 0;
  if (user) {
    const row = await getUserByName(ctx.env, user);
    if (!row) return json({ notes: [], total: 0 });
    userId = row.id;
  }

  const [rows, total] = await Promise.all([
    listNotes(ctx.env, { limit, offset, tag, q: kw, userId }),
    countNotes(ctx.env, { tag, q: kw, userId }),
  ]);

  return json({ notes: rows, total, offset, limit });
}

export async function noteDetail(ctx, id) {
  const note = await getNote(ctx.env, Number(id));
  if (!note) return fail('这条不见了', 404);
  return json({ note });
}

export async function createNote(ctx) {
  const bad = needLogin(ctx);
  if (bad) return bad;

  const body = await readJson(ctx.request);
  if (!body) return fail('请求格式不对');

  const content = String(body.content || '').trim().slice(0, MAX_CONTENT);
  const images = await normalizeImages(ctx.env, ctx.me.id, body.images);
  if (Array.isArray(body.images) && body.images.length && !images.length) {
    return fail('图片无效，请重新上传');
  }
  if (!content && !images.length) return fail('写点什么，或者放张图');

  const created = parseTime(body.created_at, nowMs());
  const pinned = ctx.settings.allow_pin === '1' && body.pinned ? 1 : 0;

  const r = await ctx.env.DB.prepare(
    'INSERT INTO notes (user_id, content, images, created_at, pinned) VALUES (?, ?, ?, ?, ?)',
  ).bind(ctx.me.id, content, JSON.stringify(images), created, pinned).run();

  const note = await getNote(ctx.env, r.meta.last_row_id);
  return json({ note }, 201);
}

export async function updateNote(ctx, id) {
  const bad = needLogin(ctx);
  if (bad) return bad;

  const row = await ctx.env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(Number(id)).first();
  if (!row) return fail('这条不见了', 404);
  if (row.user_id !== ctx.me.id && ctx.me.role !== 'admin') return fail('只能改自己的', 403);

  const body = await readJson(ctx.request);
  if (!body) return fail('请求格式不对');

  const content = body.content === undefined
    ? row.content
    : String(body.content).trim().slice(0, MAX_CONTENT);

  let images = JSON.parse(row.images || '[]');
  if (body.images !== undefined) {
    images = await normalizeImages(ctx.env, row.user_id, body.images);
    if (Array.isArray(body.images) && body.images.length && !images.length) {
      return fail('图片无效，请重新上传');
    }
    if (!content && !images.length) return fail('至少留点内容或一张图');
  }

  let pinned = row.pinned;
  if (body.pinned !== undefined && ctx.settings.allow_pin === '1') pinned = body.pinned ? 1 : 0;

  await ctx.env.DB.prepare('UPDATE notes SET content = ?, images = ?, pinned = ?, updated_at = ? WHERE id = ?')
    .bind(content, JSON.stringify(images), pinned, nowMs(), row.id).run();

  return json({ note: await getNote(ctx.env, row.id) });
}

export async function deleteNote(ctx, id) {
  const bad = needLogin(ctx);
  if (bad) return bad;

  const row = await ctx.env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(Number(id)).first();
  if (!row) return fail('这条不见了', 404);
  if (row.user_id !== ctx.me.id && ctx.me.role !== 'admin') return fail('只能删自己的', 403);

  let imgs = [];
  try { imgs = JSON.parse(row.images || '[]'); } catch { /* ignore */ }

  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM comments WHERE note_id = ?').bind(row.id),
    ctx.env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(row.id),
  ]);
  await Promise.all(imgs.flatMap((im) => {
    const keys = [im.k, im.t || thumbKeyFor(im.k)].filter(Boolean);
    return keys.map((key) => deleteImage(ctx.env, key, ctx.url.origin));
  }));

  return ok();
}

/* ── 评论 ─────────────────────────────────────────────────── */

export async function addComment(ctx, noteId) {
  const bad = needLogin(ctx);
  if (bad) return bad;
  if (ctx.settings.comments_enabled !== '1') return fail('评论已关闭', 403);

  const body = await readJson(ctx.request);
  if (!body) return fail('请求格式不对');

  const content = String(body.content || '').trim().slice(0, MAX_COMMENT);
  if (!content) return fail('评论不能为空');

  const note = await ctx.env.DB.prepare('SELECT id FROM notes WHERE id = ?').bind(Number(noteId)).first();
  if (!note) return fail('这条不见了', 404);

  const r = await ctx.env.DB.prepare(
    'INSERT INTO comments (note_id, user_id, content, created_at) VALUES (?, ?, ?, ?)',
  ).bind(note.id, ctx.me.id, content, nowMs()).run();

  return json({
    comment: {
      id: r.meta.last_row_id,
      content,
      created_at: nowMs(),
      user: {
        username: ctx.me.username,
        display_name: ctx.me.display_name,
        avatar: avatarOf(ctx.me),
        role: ctx.me.role,
        title: ctx.me.title || '',
        title_color: ctx.me.title_color || '',
        title_on: !!ctx.me.title_on,
      },
    },
  }, 201);
}

export async function deleteComment(ctx, id) {
  const bad = needLogin(ctx);
  if (bad) return bad;

  const row = await ctx.env.DB.prepare('SELECT * FROM comments WHERE id = ?').bind(Number(id)).first();
  if (!row) return fail('评论不见了', 404);
  if (row.user_id !== ctx.me.id && ctx.me.role !== 'admin') return fail('只能删自己的', 403);

  await ctx.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(row.id).run();
  return ok();
}

/* ── 图片 ─────────────────────────────────────────────────── */

export async function upload(ctx) {
  const bad = needLogin(ctx);
  if (bad) return bad;
  if (ctx.settings.images_enabled !== '1') return fail('图片功能已关闭，管理员可以在后台打开', 403);
  return uploadImage(ctx.env, ctx.me, ctx.request, ctx.url, ctx);
}

/* ── 管理员 ───────────────────────────────────────────────── */

export async function adminUsers(ctx) {
  const bad = needAdmin(ctx);
  if (bad) return bad;

  const rows = await listUsers(ctx.env);
  return json({
    max_users: maxUsers(ctx),
    users: rows.map((r) => ({
      id: r.id,
      username: r.username,
      display_name: r.display_name,
      role: r.role,
      bio: r.bio || '',
      avatar: avatarOf(r),
      title: r.title || '',
      title_color: r.title_color || '',
      title_on: !!r.title_on,
      created_at: r.created_at,
      last_login_at: r.last_login_at,
      active: !!r.pw_hash,
      pending_code: r.pending_code || null,
      note_count: r.note_count || 0,
      comment_count: r.comment_count || 0,
    })),
  });
}

export async function adminCreateUser(ctx) {
  const bad = needAdmin(ctx);
  if (bad) return bad;

  const body = await readJson(ctx.request);
  if (!body) return fail('请求格式不对');

  const max = maxUsers(ctx);
  if ((await countUsers(ctx.env)) >= max) {
    return fail(`最多只能有 ${max} 个账号，管理员可以在后台调`, 409);
  }

  const nameErr = checkUsername(body.username);
  if (nameErr) return fail(nameErr);
  if (await getUserByName(ctx.env, body.username)) return fail('这个登录名已经有人用了', 409);

  const id = await createUser(ctx.env, {
    username: body.username,
    display_name: body.display_name || body.username,
    role: 'user',
  });
  const code = shortId(6);
  await createInvite(ctx.env, id, code);

  return json({
    ok: true,
    user_id: id,
    username: String(body.username).toLowerCase(),
    code,
    activate_url: `${ctx.url.origin}/#/activate?code=${code}`,
  }, 201);
}

/** 清空密码 + 发新邀请码，等于「重置」 */
export async function adminResetUser(ctx, id) {
  const bad = needAdmin(ctx);
  if (bad) return bad;

  const user = await getUserById(ctx.env, Number(id));
  if (!user) return fail('没有这个用户', 404);
  if (user.id === ctx.me.id) return fail('不能重置自己的密码，用「修改密码」', 400);

  await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE users SET pw_hash = NULL, pw_salt = NULL, session_ver = session_ver + 1 WHERE id = ?')
      .bind(user.id),
    ctx.env.DB.prepare('DELETE FROM invites WHERE user_id = ? AND used_at IS NULL').bind(user.id),
  ]);

  const code = shortId(6);
  await createInvite(ctx.env, user.id, code);

  return json({
    ok: true,
    username: user.username,
    code,
    activate_url: `${ctx.url.origin}/#/activate?code=${code}`,
  });
}

export async function adminDeleteUser(ctx, id) {
  const bad = needAdmin(ctx);
  if (bad) return bad;

  const user = await getUserById(ctx.env, Number(id));
  if (!user) return fail('没有这个用户', 404);
  if (user.id === ctx.me.id) return fail('不能删自己', 400);

  const { results: notes } = await ctx.env.DB.prepare('SELECT id, images FROM notes WHERE user_id = ?')
    .bind(user.id).all();
  for (const n of notes || []) {
    try {
      const imgs = JSON.parse(n.images || '[]');
      await Promise.all(imgs.flatMap((im) => {
        const keys = [im.k, im.t || thumbKeyFor(im.k)].filter(Boolean);
        return keys.map((key) => deleteImage(ctx.env, key, ctx.url.origin));
      }));
    } catch { /* ignore */ }
  }
  if (user.avatar_key) await deleteImage(ctx.env, user.avatar_key, ctx.url.origin);

  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM comments WHERE user_id = ?').bind(user.id),
    ctx.env.DB.prepare('DELETE FROM comments WHERE note_id IN (SELECT id FROM notes WHERE user_id = ?)').bind(user.id),
    ctx.env.DB.prepare('DELETE FROM notes WHERE user_id = ?').bind(user.id),
    ctx.env.DB.prepare('DELETE FROM invites WHERE user_id = ?').bind(user.id),
    ctx.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);

  return ok();
}

export async function adminGetSettings(ctx) {
  const bad = needAdmin(ctx);
  if (bad) return bad;
  return json({ settings: await getSettings(ctx.env) });
}

export async function adminPatchSettings(ctx) {
  const bad = needAdmin(ctx);
  if (bad) return bad;

  const body = await readJson(ctx.request);
  if (!body) return fail('请求格式不对');

  if (body.max_users !== undefined) {
    const want = Number.parseInt(body.max_users, 10);
    const now = await countUsers(ctx.env);
    if (!Number.isFinite(want) || want < 1 || want > 50) return fail('人数上限要在 1 到 50 之间');
    if (want < now) return fail(`现在已经 ${now} 个人了，上限不能低于这个数`);
  }

  const n = await saveSettings(ctx.env, body);
  return json({ ok: true, updated: n, settings: await getSettings(ctx.env) });
}

export async function adminStats(ctx) {
  const bad = needAdmin(ctx);
  if (bad) return bad;
  return json({ stats: await stats(ctx.env) });
}

/* ── 备份 / 恢复 ──────────────────────────────────────────── */

export async function backup(ctx) {
  const bad = needAdmin(ctx);
  if (bad) return bad;

  const [settings, users, notes, comments, images] = await Promise.all([
    ctx.env.DB.prepare('SELECT k, v FROM settings').all(),
    ctx.env.DB.prepare('SELECT * FROM users').all(),
    ctx.env.DB.prepare('SELECT * FROM notes').all(),
    ctx.env.DB.prepare('SELECT * FROM comments').all(),
    ctx.env.DB.prepare('SELECT * FROM images').all(),
  ]);

  const payload = {
    format: 'memo-v2-backup',
    version: 2,
    exported_at: nowMs(),
    settings: settings.results || [],
    users: users.results || [],
    notes: notes.results || [],
    comments: comments.results || [],
    images: images.results || [],
  };

  const name = `memo2-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(payload, null, 1), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  });
}

export async function restore(ctx) {
  const bad = needAdmin(ctx);
  if (bad) return bad;

  const body = await readJson(ctx.request);
  if (!body) return fail('请求格式不对');
  if (body.format !== 'memo-v2-backup') return fail('这不是 memo v2 的备份文件');
  if (body.confirm !== 'RESTORE') return fail('要确认恢复，请传 confirm: "RESTORE"');

  const users = Array.isArray(body.users) ? body.users : [];
  const notes = Array.isArray(body.notes) ? body.notes : [];
  const comments = Array.isArray(body.comments) ? body.comments : [];
  const images = Array.isArray(body.images) ? body.images : [];
  const settings = Array.isArray(body.settings) ? body.settings : [];

  const stmts = [
    ctx.env.DB.prepare('DELETE FROM comments'),
    ctx.env.DB.prepare('DELETE FROM notes'),
    ctx.env.DB.prepare('DELETE FROM images'),
    ctx.env.DB.prepare('DELETE FROM invites'),
    ctx.env.DB.prepare('DELETE FROM users'),
    ctx.env.DB.prepare('DELETE FROM settings'),
  ];

  for (const u of users) {
    stmts.push(ctx.env.DB.prepare(
      `INSERT INTO users (id, username, display_name, bio, avatar_key, avatar_data, role, pw_hash, pw_salt, pw_iter, session_ver, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(u.id, u.username, u.display_name, u.bio || '', u.avatar_key ?? null, u.avatar_data ?? null, u.role || 'user',
      u.pw_hash ?? null, u.pw_salt ?? null, u.pw_iter || DEFAULT_ITER, u.session_ver || 1,
      u.created_at || nowMs(), u.last_login_at ?? null));
  }
  for (const n of notes) {
    stmts.push(ctx.env.DB.prepare(
      'INSERT INTO notes (id, user_id, content, images, created_at, updated_at, pinned) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(n.id, n.user_id, n.content || '', n.images || '[]', n.created_at || nowMs(),
      n.updated_at ?? null, n.pinned ? 1 : 0));
  }
  for (const c of comments) {
    stmts.push(ctx.env.DB.prepare(
      'INSERT INTO comments (id, note_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(c.id, c.note_id, c.user_id, c.content, c.created_at || nowMs()));
  }
  for (const im of images) {
    stmts.push(ctx.env.DB.prepare(
      'INSERT INTO images (key, user_id, mime, size, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(im.key, im.user_id, im.mime || 'image/webp', im.size || 0, im.w ?? null, im.h ?? null,
      im.created_at || nowMs()));
  }
  for (const s of settings) {
    stmts.push(ctx.env.DB.prepare('INSERT INTO settings (k, v) VALUES (?, ?)').bind(s.k, s.v));
  }

  await ctx.env.DB.batch(stmts);
  return json({
    ok: true,
    restored: { users: users.length, notes: notes.length, comments: comments.length, images: images.length },
  });
}

/* ── RSS ──────────────────────────────────────────────────── */

export async function feed(ctx) {
  const s = ctx.settings;
  const { results } = await ctx.env.DB.prepare(
    `SELECT n.*, u.display_name, u.username FROM notes n JOIN users u ON u.id = n.user_id
     ORDER BY n.created_at DESC LIMIT 30`,
  ).all();

  const tz = Number(ctx.env.SITE_TZ_OFFSET || 8);
  const items = (results || []).map((n) => {
    const date = new Date(n.created_at + tz * 3600_000).toISOString().replace('Z', '+08:00');
    return `    <item>
      <title>${xmlEscape(n.display_name)}：${xmlEscape((n.content || '(图片)').slice(0, 40))}</title>
      <link>${ctx.url.origin}/#/n/${n.id}</link>
      <guid isPermaLink="false">memo-${n.id}</guid>
      <pubDate>${new Date(n.created_at).toUTCString()}</pubDate>
      <dc:creator>${xmlEscape(n.display_name)}</dc:creator>
      <description>${xmlEscape(n.content || '')}</description>
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xmlEscape(s.site_title)}</title>
    <link>${ctx.url.origin}/</link>
    <description>${xmlEscape(s.site_desc)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}
