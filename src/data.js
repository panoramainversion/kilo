/* ────────────────────────────────────────────────────────────
   memo v2 · 数据访问层（D1）
   ──────────────────────────────────────────────────────────── */

import { nowMs } from './lib.js';

/* ── 站点配置 ─────────────────────────────────────────────── */

export const DEFAULT_SETTINGS = {
  site_title: 'kilo',
  site_desc: '一个人的房间。想到什么写什么。',
  footer_text: '',
  // 配色：浅色 / 深色各一组，前端拿到后写成 CSS 变量
  bg_light: '#f4f1ec',
  fg_light: '#33251d',
  accent_light: '#b84200',
  bg_dark: '#333333',
  fg_dark: '#f0e9e0',
  accent_dark: '#e7b063',
  comments_enabled: '1',
  allow_pin: '1',
  images_enabled: '1',
  image_storage: 'auto',
  max_users: '8',
  max_image_mb: '3',
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT k, v FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const row of results || []) out[row.k] = row.v;
  return out;
}

/** 只接受已知 key；颜色必须是 #rrggbb；返回实际写入的条数 */
export async function saveSettings(env, patch) {
  const stmts = [];
  for (const [k, raw] of Object.entries(patch || {})) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    let v = String(raw ?? '').trim();
    if (k.endsWith('_light') || k.endsWith('_dark')) {
      if (k === 'comments_enabled' || k === 'allow_pin') { /* 不会走到这里 */ }
      if (!HEX.test(v)) continue;
    }
    if (k === 'comments_enabled' || k === 'allow_pin' || k === 'images_enabled') {
      v = (v === '1' || v === 'true' || v === 'on') ? '1' : '0';
    }
    if (k === 'image_storage') {
      v = v.toLowerCase();
      if (!['auto', 'r2', 'b2', 'kv'].includes(v)) continue;
    }
    if (k === 'site_title') v = v.slice(0, 40) || DEFAULT_SETTINGS.site_title;
    if (k === 'site_desc') v = v.slice(0, 200);
    if (k === 'footer_text') v = v.slice(0, 120);
    if (k === 'max_users') {
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 50) continue;
      v = String(n);
    }
    if (k === 'max_image_mb') {
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 10) continue;
      v = String(n);
    }
    stmts.push(
      env.DB.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
        .bind(k, v),
    );
  }
  if (!stmts.length) return 0;
  await env.DB.batch(stmts);
  return stmts.length;
}

/* ── 用户 ─────────────────────────────────────────────────── */

export function avatarOf(row) {
  if (!row) return null;
  if (row.avatar_data) return row.avatar_data;
  if (row.avatar_key) return `/i/${row.avatar_key}`;
  return null;
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    bio: row.bio || '',
    avatar: avatarOf(row),
    role: row.role,
    title: row.title || '',
    title_color: row.title_color || '',
    title_on: !!row.title_on,
    created_at: row.created_at,
  };
}

export async function getUserById(env, id) {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function getUserByName(env, username) {
  return env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(String(username).toLowerCase()).first();
}

export async function countUsers(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  return row ? row.n : 0;
}

export async function listUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT u.*,
            (SELECT COUNT(*) FROM notes n WHERE n.user_id = u.id) AS note_count,
            (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) AS comment_count,
            (SELECT code FROM invites i WHERE i.user_id = u.id AND i.used_at IS NULL ORDER BY i.created_at DESC LIMIT 1) AS pending_code
     FROM users u ORDER BY u.id`,
  ).all();
  return results || [];
}

export async function createUser(env, { username, display_name, role = 'user' }) {
  const name = String(username).trim().toLowerCase();
  const display = String(display_name || '').trim() || name;
  const r = await env.DB.prepare(
    'INSERT INTO users (username, display_name, role, created_at) VALUES (?, ?, ?, ?)',
  ).bind(name, display.slice(0, 30), role === 'admin' ? 'admin' : 'user', nowMs()).run();
  return r.meta.last_row_id;
}

/* ── 邀请码 ───────────────────────────────────────────────── */

export async function createInvite(env, userId, code, ttlHours = 72) {
  const t = nowMs();
  await env.DB.prepare(
    'INSERT INTO invites (code, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).bind(code, userId, t, t + ttlHours * 3600_000).run();
  return code;
}

export async function findInvite(env, code) {
  return env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind(String(code).toUpperCase().trim()).first();
}

/* ── 笔记 ─────────────────────────────────────────────────── */

export function parseImages(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.k === 'string')
      .slice(0, 9)
      .map((x) => {
        const t = typeof x.t === 'string' && x.t.startsWith('i/') ? x.t : '';
        return {
          k: x.k,
          w: Number(x.w) || 0,
          h: Number(x.h) || 0,
          ...(t ? { t } : {}),
          url: `/i/${x.k}`,
          thumb: t ? `/i/${t}` : '',
        };
      });
  } catch {
    return [];
  }
}

export function noteToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    content: row.content,
    images: parseImages(row.images),
    created_at: row.created_at,
    updated_at: row.updated_at || null,
    pinned: !!row.pinned,
    comment_count: row.comment_count || 0,
    user: {
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar: avatarOf(row),
      role: row.role,
      title: row.title || '',
      title_color: row.title_color || '',
      title_on: !!row.title_on,
    },
  };
}

const NOTE_SELECT = `
  SELECT n.id, n.user_id, n.content, n.images, n.created_at, n.updated_at, n.pinned,
         u.username, u.display_name, u.avatar_key, u.avatar_data, u.role,
         u.title, u.title_color, u.title_on,
         (SELECT COUNT(*) FROM comments c WHERE c.note_id = n.id) AS comment_count
  FROM notes n JOIN users u ON u.id = n.user_id`;

export async function listNotes(env, { limit = 20, offset = 0, tag = '', q = '', userId = 0, withComments = true } = {}) {
  const where = [];
  const args = [];
  if (tag) {
    where.push('n.content LIKE ?');
    args.push('%#' + tag + '%');
  }
  if (q) {
    where.push('n.content LIKE ?');
    args.push('%' + q + '%');
  }
  if (userId) {
    where.push('n.user_id = ?');
    args.push(userId);
  }
  const sql = `${NOTE_SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''}
    ORDER BY n.pinned DESC, n.created_at DESC LIMIT ? OFFSET ?`;
  const { results } = await env.DB.prepare(sql).bind(...args, limit, offset).all();

  const rows = results || [];
  if (withComments && rows.length) {
    const ids = rows.map((r) => r.id);
    const { results: cs } = await env.DB.prepare(
      `SELECT c.id, c.note_id, c.content, c.created_at,
              u.username, u.display_name, u.avatar_key, u.avatar_data,
              u.role, u.title, u.title_color, u.title_on
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.note_id IN (${ids.map(() => '?').join(',')})
       ORDER BY c.created_at ASC`,
    ).bind(...ids).all();
    const byNote = new Map();
    for (const c of cs || []) {
      if (!byNote.has(c.note_id)) byNote.set(c.note_id, []);
      byNote.get(c.note_id).push({
        id: c.id,
        content: c.content,
        created_at: c.created_at,
        user: {
          username: c.username,
          display_name: c.display_name,
          avatar: avatarOf(c),
          role: c.role,
          title: c.title || '',
          title_color: c.title_color || '',
          title_on: !!c.title_on,
        },
      });
    }
    for (const r of rows) r._comments = byNote.get(r.id) || [];
  }

  return rows.map((r) => ({ ...noteToJson(r), comments: (r._comments || []).slice(-3) }));
}

export async function countNotes(env, { tag = '', q = '', userId = 0 } = {}) {
  const where = [];
  const args = [];
  if (tag) { where.push('content LIKE ?'); args.push('%#' + tag + '%'); }
  if (q) { where.push('content LIKE ?'); args.push('%' + q + '%'); }
  if (userId) { where.push('user_id = ?'); args.push(userId); }
  const sql = `SELECT COUNT(*) AS n FROM notes${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
  const row = await env.DB.prepare(sql).bind(...args).first();
  return row ? row.n : 0;
}

export async function getNote(env, id) {
  const row = await env.DB.prepare(`${NOTE_SELECT} WHERE n.id = ?`).bind(id).first();
  if (!row) return null;
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.content, c.created_at,
            u.username, u.display_name, u.avatar_key, u.avatar_data,
            u.role, u.title, u.title_color, u.title_on
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.note_id = ? ORDER BY c.created_at ASC`,
  ).bind(id).all();
  return {
    ...noteToJson(row),
    comments: (results || []).map((c) => ({
      id: c.id,
      content: c.content,
      created_at: c.created_at,
      user: {
        username: c.username,
        display_name: c.display_name,
        avatar: avatarOf(c),
        role: c.role,
        title: c.title || '',
        title_color: c.title_color || '',
        title_on: !!c.title_on,
      },
    })),
  };
}

/* ── 统计 ─────────────────────────────────────────────────── */

export async function stats(env) {
  const [notes, comments, users, imgs] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM notes').first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM comments').first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM users').first(),
    env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM images').first(),
  ]);
  return {
    notes: notes?.n || 0,
    comments: comments?.n || 0,
    users: users?.n || 0,
    images: imgs?.n || 0,
    image_bytes: imgs?.bytes || 0,
  };
}
