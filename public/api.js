/* ────────────────────────────────────────────────────────────
   memo v2 · 前端 API 封装
   ──────────────────────────────────────────────────────────── */

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || {};
  }
}

async function request(path, { method = 'GET', body, raw, headers } = {}) {
  const init = { method, credentials: 'same-origin', headers: { ...(headers || {}) } };
  if (raw !== undefined) {
    init.body = raw;
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { data = await res.json(); } catch { data = null; }
  }
  if (!res.ok) {
    throw new ApiError((data && data.error) || `请求失败（${res.status}）`, res.status, data);
  }
  return data;
}

export const api = {
  site: () => request('/api/site'),
  me: () => request('/api/me'),
  setup: (body) => request('/api/setup', { method: 'POST', body }),
  login: (body) => request('/api/login', { method: 'POST', body }),
  logout: () => request('/api/logout', { method: 'POST' }),
  activate: (body) => request('/api/activate', { method: 'POST', body }),
  changePassword: (body) => request('/api/me/password', { method: 'POST', body }),
  updateProfile: (body) => request('/api/me', { method: 'PATCH', body }),

  users: () => request('/api/users'),
  user: (name) => request(`/api/users/${encodeURIComponent(name)}`),

  notes: (params = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    const s = q.toString();
    return request('/api/notes' + (s ? '?' + s : ''));
  },
  note: (id) => request(`/api/notes/${id}`),
  createNote: (body) => request('/api/notes', { method: 'POST', body }),
  updateNote: (id, body) => request(`/api/notes/${id}`, { method: 'PATCH', body }),
  deleteNote: (id) => request(`/api/notes/${id}`, { method: 'DELETE' }),

  addComment: (id, body) => request(`/api/notes/${id}/comments`, { method: 'POST', body }),
  deleteComment: (id) => request(`/api/comments/${id}`, { method: 'DELETE' }),

  upload: (blob, w, h) => request(`/api/upload?w=${w || 0}&h=${h || 0}`, {
    method: 'POST',
    raw: blob,
    headers: { 'content-type': blob.type || 'application/octet-stream' },
  }),

  adminUsers: () => request('/api/admin/users'),
  adminCreateUser: (body) => request('/api/admin/users', { method: 'POST', body }),
  adminResetUser: (id) => request(`/api/admin/users/${id}/reset`, { method: 'POST' }),
  adminDeleteUser: (id) => request(`/api/admin/users/${id}`, { method: 'DELETE' }),
  adminSettings: () => request('/api/admin/settings'),
  adminSaveSettings: (body) => request('/api/admin/settings', { method: 'PATCH', body }),
  adminStats: () => request('/api/admin/stats'),
  restore: (body) => request('/api/admin/restore', { method: 'POST', body }),
};

export { ApiError };
