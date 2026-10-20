/* ────────────────────────────────────────────────────────────
   memo v2 · 入口与路由
   Workers + D1 + R2
   ──────────────────────────────────────────────────────────── */

import * as api from './api.js';
import { fail, json, readSession } from './lib.js';
import { getSettings, getUserById } from './data.js';
import { serveImage } from './images.js';

/** [method, 正则, 处理函数, 参数名] */
const ROUTES = [
  ['POST', /^\/api\/setup$/, api.setup],
  ['POST', /^\/api\/login$/, api.login],
  ['POST', /^\/api\/logout$/, api.logout],
  ['POST', /^\/api\/activate$/, api.activate],
  ['GET', /^\/api\/me$/, api.me],
  ['POST', /^\/api\/me\/password$/, api.changePassword],
  ['PATCH', /^\/api\/me$/, api.updateProfile],

  ['GET', /^\/api\/site$/, api.getSite],
  ['GET', /^\/api\/users$/, api.users],
  ['GET', /^\/api\/users\/([\w-]{2,20})$/, api.userDetail, ['name']],

  ['GET', /^\/api\/notes$/, api.notes],
  ['POST', /^\/api\/notes$/, api.createNote],
  ['GET', /^\/api\/notes\/(\d+)$/, api.noteDetail, ['id']],
  ['PATCH', /^\/api\/notes\/(\d+)$/, api.updateNote, ['id']],
  ['DELETE', /^\/api\/notes\/(\d+)$/, api.deleteNote, ['id']],
  ['POST', /^\/api\/notes\/(\d+)\/comments$/, api.addComment, ['id']],

  ['DELETE', /^\/api\/comments\/(\d+)$/, api.deleteComment, ['id']],

  ['POST', /^\/api\/upload$/, api.upload],

  ['GET', /^\/api\/admin\/users$/, api.adminUsers],
  ['POST', /^\/api\/admin\/users$/, api.adminCreateUser],
  ['POST', /^\/api\/admin\/users\/(\d+)\/reset$/, api.adminResetUser, ['id']],
  ['DELETE', /^\/api\/admin\/users\/(\d+)$/, api.adminDeleteUser, ['id']],
  ['GET', /^\/api\/admin\/settings$/, api.adminGetSettings],
  ['PATCH', /^\/api\/admin\/settings$/, api.adminPatchSettings],
  ['GET', /^\/api\/admin\/stats$/, api.adminStats],
  ['GET', /^\/api\/admin\/backup$/, api.backup],
  ['POST', /^\/api\/admin\/restore$/, api.restore],
];

async function currentUser(env, request) {
  const payload = await readSession(env, request);
  if (!payload) return null;
  const user = await getUserById(env, payload.u);
  if (!user) return null;
  // 改过密码 / 被重置过，旧会话直接作废
  if ((user.session_ver || 1) !== payload.v) return null;
  return user;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 图片：/i/i/202610/xxxx.webp
    if (path.startsWith('/i/')) {
      return serveImage(env, request, path.slice(3), ctx);
    }

    if (path === '/feed.xml') {
      const context = { request, env, ctx, url, method: request.method, settings: await getSettings(env), me: null };
      return api.feed(context);
    }

    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    const me = await currentUser(env, request);
    const settings = await getSettings(env);
    const context = { request, env, ctx, url, method: request.method, settings, me };

    let pathMatched = false;
    for (const [method, re, handler, names] of ROUTES) {
      const m = re.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (method !== request.method) continue;
      try {
        const args = (names || []).map((_, i) => m[i + 1]);
        return await handler(context, ...args);
      } catch (err) {
        console.error('[memo2]', path, err && err.stack ? err.stack : err);
        return fail('服务器出错了，稍后再试', 500);
      }
    }

    if (pathMatched) return fail('Method not allowed', 405);
    return fail('Not found', 404);
  },
};
