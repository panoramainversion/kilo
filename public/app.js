/* ────────────────────────────────────────────────────────────
   memo v2 · 前端主程序
   ──────────────────────────────────────────────────────────── */

import { api, ApiError } from './api.js';
import {
  el, clear, icon, renderBody, relTime, fullTime, toast, openModal, closeModal,
  confirmModal, openLightbox, initLightbox, avatarEl, bytes, copyText, initSoftKeyboard,
  verifyBadge,
} from './ui.js';
import { nextVerse } from './verses.js';

const state = {
  site: null,
  me: null,
  notes: [],
  total: 0,
  offset: 0,
  loading: false,
  done: false,
  filter: { tag: '', q: '', user: '' },
  pending: [],          // 待发布的图片 [{key,w,h,t,thumb,busy}]
  flashId: 0,
  uploading: 0,
};

const view = () => document.getElementById('view');

function isTouchUi() {
  return window.matchMedia('(hover: none)').matches;
}

function themeAccentHex() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : '#b84200';
}

/* ── 主题 ─────────────────────────────────────────────────── */

const THEMES = ['auto', 'light', 'dark'];

function themeMode() {
  return localStorage.getItem('memo2-theme') || 'auto';
}

function applyTheme() {
  const mode = themeMode();
  const dark = mode === 'dark'
    || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const btn = document.getElementById('themeBtn');
  if (btn) {
    clear(btn);
    btn.append(icon(mode === 'auto' ? 'auto' : dark ? 'moon' : 'sun', 17));
    btn.title = mode === 'auto' ? '跟随系统' : dark ? '深色' : '浅色';
  }
  const meta = document.getElementById('themeColor');
  if (meta) {
    const c = dark ? (state.site?.bg_dark || '#333333') : (state.site?.bg_light || '#f4f1ec');
    meta.setAttribute('content', c);
  }
}

function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(themeMode()) + 1) % THEMES.length];
  localStorage.setItem('memo2-theme', next);
  applyTheme();
  toast(next === 'auto' ? '跟随系统' : next === 'dark' ? '深色' : '浅色');
}

function applySite(site) {
  state.site = site;
  const r = document.documentElement.style;
  const map = {
    '--site-bg-light': site.bg_light,
    '--site-fg-light': site.fg_light,
    '--site-accent-light': site.accent_light,
    '--site-bg-dark': site.bg_dark,
    '--site-fg-dark': site.fg_dark,
    '--site-accent-dark': site.accent_dark,
  };
  for (const [k, v] of Object.entries(map)) if (v) r.setProperty(k, v);
  document.title = site.site_title || 'memo';

  const t = document.getElementById('siteTitle');
  t.textContent = site.site_title || 'memo';
  t.hidden = false;
  document.getElementById('titleSkeleton').hidden = true;
  document.getElementById('siteDesc').textContent = site.site_desc || '';
  renderFootNote();
  try { localStorage.setItem('memo2-site', JSON.stringify(site)); } catch { /* ignore */ }
  applyTheme();
}

function renderFootNote() {
  const box = document.getElementById('footNote');
  if (!box) return;
  const text = (state.site?.footer_text || '').trim();
  clear(box);
  box.hidden = !text;
  if (text) box.append(renderBody(text));
}

/* ── 顶栏 ─────────────────────────────────────────────────── */

function renderHeader() {
  const slot = document.getElementById('meSlot');
  clear(slot);
  if (state.me) {
    slot.href = '#/me';
    slot.title = state.me.display_name;
    if (state.me.avatar) {
      slot.append(el('img', { src: state.me.avatar, alt: '' }));
    } else {
      slot.append(icon('user', 17));
    }
  } else {
    slot.href = '#/login';
    slot.title = '登录';
    slot.append(icon('user', 17));
  }
}

/* ── 图片网格 ─────────────────────────────────────────────── */

function imageGrid(images, full = false) {
  const list = images.slice(0, 9);
  const n = list.length;
  const cls = n === 1 ? 'n1' : n === 2 ? 'n2' : n === 3 ? 'n3' : n === 4 ? 'n4' : 'n5';
  const box = el('div', { class: 'imgs ' + cls });
  list.forEach((im, i) => {
    // 时间线/主页只拉缩略图；详情页和灯箱才用原图
    const img = el('img', {
      src: full ? im.url : (im.thumb || im.url),
      alt: '',
      loading: 'lazy',
      decoding: 'async',
    });
    if (im.w && im.h) { img.setAttribute('width', im.w); img.setAttribute('height', im.h); }
    box.append(el('button', {
      type: 'button',
      'aria-label': `查看第 ${i + 1} 张图`,
      onclick: () => openLightbox(list, i),
    }, img));
  });
  return box;
}

/* ── 评论 ─────────────────────────────────────────────────── */

function canDeleteComment(c) {
  return !!(state.me && (c.user.username === state.me.username || state.me.role === 'admin'));
}

function commentNode(c, onDeleted) {
  return el('div', { class: 'comment' },
    avatarEl(c.user, 'sm'),
    el('div', { class: 'comment-main' },
      el('div', { class: 'comment-head' },
        el('b', { text: c.user.display_name }),
        ...nameBadges(c.user),
        el('span', { text: relTime(c.created_at) }),
        onDeleted && canDeleteComment(c) ? el('button', {
          class: 'comment-del',
          text: '删除',
          onclick: async () => {
            if (!(await confirmModal('删掉这条评论？', '', '删除', true))) return;
            try {
              await api.deleteComment(c.id);
              onDeleted(c);
              toast('已删除');
            } catch (e) { toast(e.message); }
          },
        }) : null,
      ),
      el('div', { class: 'comment-body' }, renderBody(c.content)),
    ),
  );
}

function excerpt(text, max = 70) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function replyDialog(note, onAdded) {
  if (!state.me || !state.site?.comments_enabled) return;
  const ta = el('textarea', {
    class: 'textarea',
    rows: '4',
    maxlength: '1000',
    placeholder: isTouchUi() ? '回复…' : '回复…（Ctrl/⌘ + Enter 发送）',
  });
  const counter = el('span', { class: 'counter', text: '0 / 1000' });
  const sendBtn = el('button', { class: 'btn-primary', text: '发送', disabled: true });
  const sync = () => {
    counter.textContent = `${ta.value.length} / 1000`;
    sendBtn.disabled = !ta.value.trim();
  };
  ta.addEventListener('input', sync);
  const send = async () => {
    const content = ta.value.trim();
    if (!content || sendBtn.disabled) return;
    sendBtn.disabled = true;
    sendBtn.textContent = '发送中…';
    try {
      const { comment } = await api.addComment(note.id, { content });
      closeModal();
      onAdded(comment);
      toast('回复已发布');
    } catch (e) {
      toast(e.message);
      sendBtn.disabled = false;
      sendBtn.textContent = '发送';
    }
  };
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
  });
  sendBtn.addEventListener('click', send);
  openModal(({ close }) => el('div', {},
    el('h2', { class: 'modal-title', text: `回复 ${note.user.display_name}` }),
    note.content ? el('div', { class: 'reply-quote', text: excerpt(note.content) }) : null,
    ta,
    el('div', { class: 'reply-actions' },
      counter,
      el('button', { class: 'btn-ghost', text: '取消', onclick: close }),
      sendBtn,
    ),
  ), { focus: !isTouchUi(), top: true });
}

/* ── 条目卡片 ─────────────────────────────────────────────── */

function safeTitleColor(color) {
  return /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color : '';
}

function nameBadges(user) {
  if (!user) return [];
  const out = [];
  if (user.role === 'admin') out.push(verifyBadge('管理员', 15));
  if (user.title_on && user.title) {
    const color = safeTitleColor(user.title_color);
    out.push(el('span', {
      class: 'user-title',
      text: user.title,
      style: color ? `--tag-color:${color}` : null,
    }));
  }
  return out;
}

function noteCard(note, i, full = false) {
  const canEdit = state.me && (state.me.id === note.user.id || state.me.role === 'admin');
  const tools = canEdit ? el('div', { class: 'note-tools' },
    el('button', { class: 'tool-btn', title: '编辑', onclick: () => editNote(note) }, icon('pencil', 15)),
    el('button', {
      class: 'tool-btn' + (note.pinned ? ' on' : ''),
      title: note.pinned ? '取消置顶' : '置顶',
      onclick: async () => {
        try { await api.updateNote(note.id, { pinned: !note.pinned }); toast(note.pinned ? '已取消置顶' : '已置顶'); route(); } catch (e) { toast(e.message); }
      },
    }, icon('pin', 15)),
    el('button', {
      class: 'tool-btn danger',
      title: '删除',
      onclick: async () => {
        if (!(await confirmModal('删掉这条？', '删了就找不回来了。', '删除', true))) return;
        try {
          await api.deleteNote(note.id);
          toast('已删除');
          if (location.hash.startsWith('#/n/')) location.hash = '#/';
          else route();
        } catch (e) { toast(e.message); }
      },
    }, icon('trash', 15)),
  ) : null;

  const countBtn = el('button', {
    class: 'comment-count',
    title: '查看评论',
    onclick: () => { if (!location.hash.startsWith(`#/n/${note.id}`)) location.hash = `#/n/${note.id}`; },
  }, icon('comment', 15), `${note.comment_count || 0} 条评论`);

  const commentsBox = el('div', { class: 'comments' });
  const syncCount = () => {
    clear(countBtn);
    countBtn.append(icon('comment', 15), `${note.comment_count || 0} 条评论`);
  };
  const paintComments = () => {
    clear(commentsBox);
    const list = note.comments || [];
    const rest = Math.max(0, (note.comment_count || 0) - list.length);
    commentsBox.hidden = !list.length && rest <= 0;
    if (commentsBox.hidden) return;
    list.forEach((c) => commentsBox.append(commentNode(c, onDeleted)));
    if (rest > 0) {
      commentsBox.append(el('button', {
        class: 'comments-more',
        onclick: () => { location.hash = `#/n/${note.id}`; },
        text: `查看全部 ${note.comment_count} 条评论`,
      }));
    }
  };
  const onDeleted = (removed) => {
    note.comment_count = Math.max(0, (note.comment_count || 0) - 1);
    note.comments = (note.comments || []).filter((c) => c.id !== removed.id);
    syncCount();
    paintComments();
  };
  paintComments();

  const replyBtn = state.site?.comments_enabled ? el('button', {
    class: 'reply-btn',
    title: '回复',
    onclick: () => {
      if (!state.me) {
        toast('登录后才能回复');
        location.hash = '#/login';
        return;
      }
      replyDialog(note, (comment) => {
        note.comment_count = (note.comment_count || 0) + 1;
        const list = [...(note.comments || []), comment];
        note.comments = full ? list : list.slice(-3);
        syncCount();
        paintComments();
      });
    },
  }, icon('reply', 15), '回复') : null;

  return el('article', {
    class: 'note' + (state.flashId === note.id ? ' flash' : ''),
    style: `--i:${Math.min(i, 10)}`,
    'data-note-id': note.id,
  },
    el('header', { class: 'note-head' },
      avatarEl(note.user),
      el('div', { class: 'who' },
        el('a', { class: 'who-name', href: `#/u/${note.user.username}` },
          note.user.display_name,
          ...nameBadges(note.user),
        ),
        el('div', { class: 'who-meta' },
          el('a', { href: `#/n/${note.id}`, title: fullTime(note.created_at) }, relTime(note.created_at)),
          note.updated_at ? el('span', { text: ' · 已编辑' }) : null,
          note.pinned ? el('span', { class: 'pin-flag', style: 'margin-left:8px' }, icon('pin', 11), '置顶') : null,
        ),
      ),
      tools,
    ),
    note.content ? el('div', { class: 'note-body' }, renderBody(note.content)) : null,
    note.images && note.images.length ? imageGrid(note.images, full) : null,
    el('div', { class: 'note-foot' },
      countBtn,
      el('button', {
        onclick: () => { copyText(`${location.origin}/#/n/${note.id}`).then((ok) => toast(ok ? '链接已复制' : '复制失败')); },
        text: '分享',
      }),
      replyBtn,
    ),
    commentsBox,
  );
}

/* ── 编辑 ─────────────────────────────────────────────────── */

function editNote(note) {
  const ta = el('textarea', { class: 'textarea', rows: '6' });
  ta.value = note.content || '';
  openModal(({ close }) => el('div', {},
    el('h2', { class: 'modal-title', text: '编辑' }),
    el('p', { class: 'modal-sub', text: '图片暂不支持在这里改，删了重发更快。' }),
    ta,
    el('div', { class: 'modal-actions' },
      el('button', { class: 'btn-ghost', onclick: close, text: '取消' }),
      el('button', {
        class: 'btn-primary',
        text: '保存',
        onclick: async (e) => {
          const v = ta.value.trim();
          if (!v && !note.images.length) return toast('不能全空');
          e.target.disabled = true;
          try {
            await api.updateNote(note.id, { content: v });
            close();
            toast('已保存');
            route();
          } catch (err) {
            toast(err.message);
            e.target.disabled = false;
          }
        },
      }),
    ),
  ));
}

/* ── 时间线 ───────────────────────────────────────────────── */

function sentinel() {
  const s = el('div', { style: 'height:1px' });
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMore();
  }, { rootMargin: '600px' });
  io.observe(s);
  s._io = io;
  return s;
}

function dayStamp(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  return {
    key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
    label: `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`,
    name: diff === 0 ? '今天' : diff === 1 ? '昨天'
      : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()],
  };
}

function appendNotes(box, notes, start) {
  notes.forEach((n, i) => {
    const d = dayStamp(n.created_at);
    if (d.key !== box._dayKey) {
      const day = el('section', { class: 'day' },
        el('div', { class: 'day-side' },
          el('div', { class: 'day-label', text: d.label }),
          el('div', { class: 'day-num', text: d.name }),
        ),
        el('div', { class: 'day-notes' }),
      );
      box.append(day);
      box._dayKey = d.key;
      box._dayNotes = day.querySelector('.day-notes');
    }
    box._dayNotes.append(noteCard(n, start + i));
  });
}

async function loadMore() {
  if (state.loading || state.done) return;
  state.loading = true;
  const box = document.getElementById('stream');
  if (!box) { state.loading = false; return; }
  const tail = box.querySelector('.tail');
  if (tail) { clear(tail); tail.append(el('span', { class: 'dots' }, el('i'), el('i'), el('i'))); }
  try {
    const data = await api.notes({
      limit: 15,
      offset: state.offset,
      tag: state.filter.tag,
      q: state.filter.q,
      user: state.filter.user,
    });
    state.total = data.total;
    const batch = data.notes || [];
    state.offset += batch.length;
    if (!batch.length || state.offset >= data.total) state.done = true;

    if (tail) tail.remove();
    const start = state.notes.length;
    state.notes.push(...batch);
    appendNotes(box, batch, start);
    box.append(el('div', { class: 'tail', style: 'padding:20px 0;text-align:center' },
      state.done
        ? (state.notes.length ? el('span', { style: 'font-size:13px;color:var(--faint)', text: '到底了' }) : null)
        : el('span', { class: 'dots' }, el('i'), el('i'), el('i')),
    ));
    updateFootCount();
    state.flashId = 0;
  } catch (e) {
    toast(e.message);
    state.done = true;
  } finally {
    state.loading = false;
  }
}

function updateFootCount() {
  const c = document.getElementById('footCount');
  if (c) c.textContent = state.total ? `共 ${state.total} 条` : '';
}

async function renderTimeline() {
  state.notes = [];
  state.offset = 0;
  state.done = false;
  state.loading = false;
  const v = clear(view());

  if (state.filter.tag) {
    v.append(el('div', { class: 'section-head' },
      el('h2', { text: `#${state.filter.tag}` }),
      el('a', { class: 'hint', href: '#/', text: '清除筛选' }),
    ));
  } else if (state.filter.q) {
    v.append(el('div', { class: 'section-head' },
      el('h2', { text: `搜索「${state.filter.q}」` }),
      el('a', { class: 'hint', href: '#/', text: '清除' }),
    ));
  } else if (state.filter.user) {
    v.append(el('div', { class: 'section-head' },
      el('h2', { text: `@${state.filter.user}` }),
      el('a', { class: 'hint', href: '#/', text: '看全部' }),
    ));
  }

  const stream = el('div', { class: 'stream', id: 'stream' });
  v.append(stream);
  await loadMore();

  if (!state.notes.length) {
    stream.append(el('div', { class: 'state' },
      el('p', { class: 'state-main', text: state.filter.tag || state.filter.q ? '没有找到' : '这里还空着' }),
      el('p', {
        class: 'state-sub',
        text: state.filter.tag || state.filter.q ? '换个词试试。' : (state.me ? '点右下角的按钮，第一条就是你的。' : '第一句话往往最难写。'),
      }),
      !state.me && !state.site?.needs_setup
        ? el('div', { class: 'btn-row' },
          el('a', { class: 'btn-ghost', href: '#/login', text: '登录' }),
          el('a', { class: 'btn-ghost', href: '#/activate', text: '有邀请码' }),
        ) : null,
    ));
  } else if (!state.done) {
    stream.append(sentinel());
  }
}

/* ── 详情 ─────────────────────────────────────────────────── */

async function renderNote(id) {
  const v = clear(view());
  v.append(el('div', { class: 'state' }, el('span', { class: 'dots' }, el('i'), el('i'), el('i'))));
  try {
    const { note } = await api.note(id);
    clear(v);
    v.append(el('a', { class: 'foot-link', href: '#/', text: '← 回时间线' }));
    const wrap = el('div', { style: 'margin-top:14px' });
    const card = noteCard({ ...note, comment_count: note.comments.length }, 0, true);
    wrap.append(card);
    v.append(wrap);
    document.getElementById('footCount').textContent = '';
  } catch (e) {
    clear(v);
    v.append(el('div', { class: 'state' },
      el('p', { class: 'state-main', text: '打不开这条' }),
      el('p', { class: 'state-sub', text: e.message }),
      el('div', { class: 'btn-row' }, el('a', { class: 'btn-ghost', href: '#/', text: '回时间线' })),
    ));
  }
}

/* ── 个人页 ───────────────────────────────────────────────── */

async function renderProfile(name) {
  const v = clear(view());
  try {
    const { user } = await api.user(name);
    v.append(el('div', { class: 'profile' },
      avatarEl(user, 'lg'),
      el('div', { class: 'info' },
        el('h1', {}, user.display_name, ...nameBadges(user)),
        el('div', { class: 'handle', text: '@' + user.username }),
        user.bio ? el('p', { class: 'bio', text: user.bio }) : null,
        el('div', { class: 'nums', text: `${user.note_count} 条` }),
        state.me && state.me.id === user.id
          ? el('div', { class: 'btn-row', style: 'margin-top:12px' },
            el('a', { class: 'btn-ghost', href: '#/me', text: '编辑资料' })) : null,
      ),
    ));
    const stream = el('div', { class: 'stream', id: 'stream' });
    v.append(stream);
    state.notes = [];
    state.offset = 0;
    state.done = false;
    state.loading = false;
    state.filter = { tag: '', q: '', user: user.username };
    await loadMore();
    if (!state.notes.length) {
      stream.append(el('div', { class: 'state' }, el('p', { class: 'state-main', text: '还没写过东西' })));
    } else if (!state.done) {
      stream.append(sentinel());
    }
  } catch (e) {
    v.append(el('div', { class: 'state' }, el('p', { class: 'state-main', text: e.message })));
  }
}

/* ── 成员 ─────────────────────────────────────────────────── */

async function renderPeople() {
  const v = clear(view());
  v.append(el('h2', { class: 'page-title', text: '成员' }));
  try {
    const { users } = await api.users();
    const box = el('div', {});
    users.forEach((u) => {
      box.append(el('div', { class: 'user-row' },
        avatarEl(u),
        el('div', { class: 'grow' },
          el('a', { class: 'name', href: `#/u/${u.username}`, style: 'text-decoration:none;color:inherit' },
            u.display_name,
            ...nameBadges(u)),
          el('div', { class: 'meta', text: `@${u.username} · ${u.note_count} 条` }),
        ),
        el('a', { class: 'btn-ghost', href: `#/u/${u.username}`, text: '看看' }),
      ));
    });
    v.append(box);
  } catch (e) {
    v.append(el('div', { class: 'state' }, el('p', { class: 'state-main', text: e.message })));
  }
}

/* ── 登录 / 激活 / 初始化 ─────────────────────────────────── */

function authShell(title, sub, fields, onSubmit, extra, onReady) {
  const form = el('form', { class: 'card', style: 'max-width:420px' });
  const err = el('p', { class: 'modal-err' });
  form.append(el('h3', { text: title }), el('p', { class: 'sub', text: sub }));
  const inputs = {};
  fields.forEach((f) => {
    const input = el('input', {
      class: 'input' + (f.mono ? ' mono' : ''),
      type: f.type || 'text',
      placeholder: f.placeholder || '',
      autocomplete: f.autocomplete || 'off',
      maxlength: f.maxlength || '120',
    });
    if (f.value) input.value = f.value;
    inputs[f.name] = input;
    form.append(el('div', { class: 'field' },
      el('label', { text: f.label }),
      input,
      f.hint ? el('p', { class: 'sub', style: 'margin:5px 0 0;font-size:12.5px', text: f.hint }) : null,
    ));
  });
  form.append(err);
  const btn = el('button', { class: 'btn-primary', type: 'submit', text: '确定', style: 'width:100%;margin-top:6px' });
  form.append(btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    try {
      const values = {};
      for (const [k, node] of Object.entries(inputs)) values[k] = node.value.trim();
      await onSubmit(values);
    } catch (ex) {
      err.textContent = ex.message || '出错了';
    } finally {
      btn.disabled = false;
    }
  });
  if (onReady) onReady(inputs, form);
  const wrap = el('div', { style: 'padding-top:10px' }, form);
  if (extra) wrap.append(extra);
  return wrap;
}

async function renderLogin() {
  const v = clear(view());
  if (state.site?.needs_setup) return renderSetup();

  v.append(authShell('登录', '输入用户名和密码。', [
    { name: 'username', label: '用户名', autocomplete: 'username' },
    { name: 'password', label: '密码', type: 'password', autocomplete: 'current-password' },
  ], async ({ username, password }) => {
    await api.login({ username, password });
    await boot(true);
    toast('欢迎回来');
    location.hash = '#/';
  }, el('p', { style: 'text-align:center;margin-top:14px;font-size:13.5px;color:var(--muted)' },
    '还没有账号？', el('a', { href: '#/activate', style: 'color:var(--accent)' }, '用邀请码激活'),
  )));
}

async function renderSetup() {
  const v = clear(view());
  v.append(el('h2', { class: 'page-title', text: '第一次使用' }),
    el('p', { class: 'sub', style: 'color:var(--muted);font-size:14px;margin-top:-8px' },
      '先创建管理员账号。初始化令牌是部署时设的 SETUP_TOKEN。'));
  v.append(authShell('创建管理员', '这一步只做一次。', [
    { name: 'token', label: '初始化令牌', type: 'password', placeholder: 'SETUP_TOKEN' },
    { name: 'display_name', label: '显示名', placeholder: '张三（中文就行）' },
    {
      name: 'username',
      label: '登录名',
      placeholder: 'zhangsan',
      autocomplete: 'username',
      hint: '登录时用，只能用英文小写字母、数字、下划线，不能用中文。',
    },
    { name: 'password', label: '密码', type: 'password', autocomplete: 'new-password' },
  ], async (values) => {
    await api.setup(values);
    await boot(true);
    toast('建好了');
    location.hash = '#/admin';
  }, null, (inputs) => {
    // 显示名是纯英文时顺手填一下登录名，省得再想
    inputs.display_name.addEventListener('input', () => {
      if (inputs.username.dataset.touched) return;
      const slug = inputs.display_name.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
      inputs.username.value = slug.length >= 2 ? slug.slice(0, 20) : '';
    });
    inputs.username.addEventListener('input', () => { inputs.username.dataset.touched = '1'; });
  }));
}

async function renderActivate(code = '') {
  const v = clear(view());
  v.append(authShell('激活账号', '输入管理员给你的邀请码，自己设一个密码。', [
    { name: 'code', label: '邀请码', mono: true, value: code, maxlength: '8' },
    { name: 'password', label: '设置密码', type: 'password', autocomplete: 'new-password' },
    { name: 'password2', label: '再输一次', type: 'password', autocomplete: 'new-password' },
  ], async ({ code: c, password, password2 }) => {
    if (password !== password2) throw new Error('两次密码不一样');
    await api.activate({ code: c, password });
    await boot(true);
    toast('激活成功');
    location.hash = '#/me';
  }, el('p', { style: 'text-align:center;margin-top:14px;font-size:13.5px;color:var(--muted)' },
    '已经有密码了？', el('a', { href: '#/login', style: 'color:var(--accent)' }, '去登录'),
  )));
}

/* ── 我的资料 ─────────────────────────────────────────────── */

async function renderMe() {
  if (!state.me) { location.hash = '#/login'; return; }
  const v = clear(view());
  const me = state.me;

  const nameInput = el('input', { class: 'input', value: me.display_name, maxlength: '30' });
  const bioInput = el('textarea', { class: 'textarea', maxlength: '200' });
  bioInput.value = me.bio || '';

  const titleInput = el('input', {
    class: 'input',
    maxlength: '12',
    placeholder: '比如：夜行观察员',
    value: me.title || '',
  });
  const titleColor = el('input', {
    type: 'color',
    class: 'color-input',
    value: /^#[0-9a-f]{6}$/i.test(me.title_color || '') ? me.title_color : themeAccentHex(),
    'aria-label': '头衔颜色',
  });
  const titleOn = el('input', { type: 'checkbox' });
  titleOn.checked = !!me.title_on;
  const previewName = el('span', { text: me.display_name });
  const previewTitle = el('span', { class: 'user-title', text: me.title || '头衔' });
  const titlePreview = el('div', { class: 'title-preview' },
    el('span', { text: '预览' }),
    previewName,
    me.role === 'admin' ? verifyBadge('管理员', 15) : null,
    previewTitle,
  );
  const syncTitleEditor = () => {
    const color = /^#[0-9a-f]{6}$/i.test(titleColor.value) ? titleColor.value : '';
    if (color) previewTitle.style.setProperty('--tag-color', color);
    else previewTitle.style.removeProperty('--tag-color');
    previewTitle.textContent = titleInput.value.trim() || '头衔';
    previewTitle.classList.toggle('is-off', !titleOn.checked || !titleInput.value.trim());
  };
  nameInput.addEventListener('input', () => {
    previewName.textContent = nameInput.value.trim() || me.display_name;
  });
  titleInput.addEventListener('input', syncTitleEditor);
  titleColor.addEventListener('input', syncTitleEditor);
  titleOn.addEventListener('change', syncTitleEditor);
  syncTitleEditor();

  let avatarData = me.avatar && me.avatar.startsWith('data:') ? me.avatar : null;
  const avatarBox = el('div', { style: 'display:flex;align-items:center;gap:14px;margin-bottom:16px' });
  const paintAvatar = () => {
    clear(avatarBox);
    const node = avatarEl({ ...me, avatar: avatarData }, 'lg');
    node.removeAttribute('href');
    node.style.cursor = 'default';
    avatarBox.append(node,
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn-ghost', text: '换头像', onclick: () => pickAvatar() }),
        avatarData ? el('button', {
          class: 'btn-ghost',
          text: '去掉',
          onclick: () => { avatarData = null; paintAvatar(); },
        }) : null,
      ),
    );
  };
  paintAvatar();

  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
  async function pickAvatar() {
    fileInput.value = '';
    fileInput.click();
  }
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      avatarData = await avatarDataUrl(f);
      paintAvatar();
      toast('头像已就绪，记得点保存');
    } catch (e) { toast(e.message || '这张图读不出来'); }
  });

  const save = async (btn) => {
    if (titleOn.checked && !titleInput.value.trim()) {
      toast('先写一个头衔');
      titleInput.focus();
      return;
    }
    btn.disabled = true;
    try {
      const { user } = await api.updateProfile({
        display_name: nameInput.value.trim(),
        bio: bioInput.value.trim(),
        title: titleInput.value.trim(),
        title_color: titleColor.value,
        title_on: titleOn.checked,
        avatar_data: avatarData,
      });
      state.me = user;
      renderHeader();
      toast('已保存');
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
    }
  };

  v.append(el('h2', { class: 'page-title', text: '我的资料' }));
  v.append(el('div', { class: 'card' },
    avatarBox,
    el('div', { class: 'field' }, el('label', { text: '显示名' }), nameInput),
    el('div', { class: 'field' }, el('label', { text: '简介' }), bioInput),
    el('div', { class: 'field' },
      el('label', { text: '头衔' }),
      el('label', { class: 'switch' },
        titleOn,
        el('span', { class: 'switch-track', 'aria-hidden': 'true' }),
        el('span', { text: '在名字旁显示' }),
      ),
      el('div', { class: 'title-edit' }, titleInput, titleColor),
      titlePreview,
    ),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn-primary', text: '保存', onclick: (e) => save(e.target) }),
      el('a', { class: 'btn-ghost', href: `#/u/${me.username}`, text: '看我的主页' }),
      me.role === 'admin' ? el('a', { class: 'btn-ghost', href: '#/admin', text: '管理后台' }) : null,
    ),
  ));

  // 改密码
  const oldPw = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const newPw = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  v.append(el('div', { class: 'card' },
    el('h3', { text: '改密码' }),
    el('p', { class: 'sub', text: '改完其他设备会自动退出。' }),
    el('div', { class: 'field' }, el('label', { text: '当前密码' }), oldPw),
    el('div', { class: 'field' }, el('label', { text: '新密码（至少 6 位）' }), newPw),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn-primary',
        text: '改密码',
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            await api.changePassword({ old: oldPw.value, new: newPw.value });
            oldPw.value = ''; newPw.value = '';
            toast('密码已更新');
          } catch (err) { toast(err.message); } finally { e.target.disabled = false; }
        },
      }),
    ),
  ));

  // 退出
  v.append(el('div', { class: 'btn-row', style: 'margin-top:6px' },
    el('button', {
      class: 'btn-ghost',
      text: '退出登录',
      onclick: async () => {
        await api.logout().catch(() => {});
        state.me = null;
        renderHeader();
        renderDock();
        toast('已退出');
        location.hash = '#/';
        route();
      },
    }),
  ));

  v.append(fileInput);
}

/* ── 管理后台 ─────────────────────────────────────────────── */

async function renderAdmin() {
  if (!state.me || state.me.role !== 'admin') {
    const v = clear(view());
    v.append(el('div', { class: 'state' },
      el('p', { class: 'state-main', text: '只有管理员能进' }),
      el('div', { class: 'btn-row' }, el('a', { class: 'btn-ghost', href: '#/', text: '回首页' })),
    ));
    return;
  }
  const v = clear(view());
  v.append(el('h2', { class: 'page-title', text: '管理后台' }));

  const body = el('div', {});
  const tabs = el('div', { class: 'tabs' });
  const panes = {};
  const defs = [
    ['users', '用户'],
    ['site', '站点'],
    ['data', '数据'],
  ];
  defs.forEach(([key, label]) => {
    const b = el('button', { class: 'tab', text: label, onclick: () => show(key) });
    panes[key] = el('div', {});
    tabs.append(b);
    b._key = key;
  });

  function show(key) {
    for (const b of tabs.children) b.classList.toggle('on', b._key === key);
    for (const [k, node] of Object.entries(panes)) node.hidden = k !== key;
  }

  v.append(tabs, body);
  Object.values(panes).forEach((p) => { p.hidden = true; body.append(p); });

  await Promise.all([
    renderAdminUsers(panes.users),
    renderAdminSite(panes.site),
    renderAdminData(panes.data),
  ]);
  show('users');
}

async function renderAdminUsers(pane) {
  clear(pane);
  const data = await api.adminUsers().catch((e) => ({ error: e.message }));
  if (data.error) { pane.append(el('p', { class: 'sub', text: data.error })); return; }

  const maxInput = el('input', {
    class: 'input',
    type: 'number',
    min: '1',
    max: '50',
    value: String(data.max_users),
    style: 'width:96px',
  });

  pane.append(el('div', { class: 'card' },
    el('h3', { text: `账号 ${data.users.length} / ${data.max_users}` }),
    el('p', { class: 'sub', text: '含管理员。新建的人用邀请码自己设密码，管理员看不到别人的密码。' }),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn-primary',
        text: '添加用户',
        disabled: data.users.length >= data.max_users,
        onclick: () => addUserDialog(data.max_users),
      }),
    ),
    el('div', { class: 'field', style: 'margin:16px 0 0' },
      el('label', { text: '人数上限（1–50）' }),
      el('div', { class: 'btn-row' },
        maxInput,
        el('button', {
          class: 'btn-ghost',
          text: '保存上限',
          onclick: async (e) => {
            const n = Number.parseInt(maxInput.value, 10);
            if (!Number.isFinite(n) || n < 1 || n > 50) { toast('填 1 到 50 之间的数'); return; }
            if (n < data.users.length) { toast(`现在已经 ${data.users.length} 个人了，不能调到比这更小`); return; }
            e.target.disabled = true;
            try {
              await api.adminSaveSettings({ max_users: String(n) });
              applySite(await api.site());
              toast(`上限已改成 ${n}`);
              renderAdmin();
            } catch (err) {
              toast(err.message);
              e.target.disabled = false;
            }
          },
        }),
      ),
      el('p', { class: 'sub', style: 'margin:6px 0 0;font-size:12.5px', text: '想放宽就调大，最多 50。调小不能小于现有人数。' }),
    ),
  ));

  const list = el('div', { class: 'card' });
  data.users.forEach((u) => {
    list.append(el('div', { class: 'user-row' },
      avatarEl(u),
      el('div', { class: 'grow' },
        el('div', { class: 'name' },
          u.display_name,
          ...nameBadges(u),
          el('span', { class: 'badge' + (u.active ? '' : ' off'), style: 'margin-left:8px', text: u.active ? '正常' : '待激活' }),
        ),
        el('div', { class: 'meta', text: `@${u.username} · ${u.note_count} 条 · ${u.last_login_at ? '上次登录 ' + relTime(u.last_login_at) : '从未登录'}` }),
        u.pending_code ? el('div', { class: 'meta', style: 'margin-top:4px' },
          '邀请码 ',
          el('b', { style: 'font-family:var(--mono);color:var(--accent)', text: u.pending_code }),
          ' ',
          el('button', {
            class: 'foot-link',
            style: 'border:0;background:none;cursor:pointer;font-size:12.5px',
            text: '复制链接',
            onclick: () => copyText(`${location.origin}/#/activate?code=${u.pending_code}`)
              .then(() => toast('激活链接已复制')),
          }),
        ) : null,
      ),
      el('div', { class: 'btn-row' },
        u.id !== state.me.id ? el('button', {
          class: 'btn-ghost',
          text: '重置密码',
          onclick: async () => {
            if (!(await confirmModal('重置密码？', `清空 @${u.username} 的密码，生成新邀请码，对方要重新激活。`, '重置'))) return;
            try {
              const r = await api.adminResetUser(u.id);
              openModal(({ close }) => el('div', {},
                el('h2', { class: 'modal-title', text: '新的邀请码' }),
                el('p', { class: 'modal-sub', text: `给 @${r.username}，72 小时内有效。` }),
                el('div', { class: 'code-box', text: r.code }),
                el('div', { class: 'modal-actions' },
                  el('button', {
                    class: 'btn-ghost',
                    text: '复制链接',
                    onclick: () => copyText(r.activate_url).then(() => toast('已复制')),
                  }),
                  el('button', { class: 'btn-primary', text: '知道了', onclick: () => { close(); renderAdmin(); } }),
                ),
              ));
            } catch (e) { toast(e.message); }
          },
        }) : null,
        u.id !== state.me.id ? el('button', {
          class: 'btn-ghost danger',
          text: '删除',
          onclick: async () => {
            if (!(await confirmModal(`删除 @${u.username}？`, '他/她的所有条目、评论、图片都会一起删掉，不可恢复。', '删除', true))) return;
            try { await api.adminDeleteUser(u.id); toast('已删除'); renderAdmin(); } catch (e) { toast(e.message); }
          },
        }) : null,
      ),
    ));
  });
  pane.append(list);
}

function addUserDialog(max) {
  const nameInput = el('input', { class: 'input', placeholder: 'xiaoming', maxlength: '20' });
  const displayInput = el('input', { class: 'input', placeholder: '小明（中文就行）', maxlength: '30' });
  displayInput.addEventListener('input', () => {
    if (nameInput.dataset.touched) return;
    const slug = displayInput.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    nameInput.value = slug.length >= 2 ? slug.slice(0, 20) : '';
  });
  nameInput.addEventListener('input', () => { nameInput.dataset.touched = '1'; });
  const err = el('p', { class: 'modal-err' });
  openModal(({ close }) => el('div', {},
    el('h2', { class: 'modal-title', text: '添加用户' }),
    el('p', { class: 'modal-sub', text: `最多 ${max} 个账号。建好后把邀请码给对方，让他自己设密码。` }),
    el('div', { class: 'field' }, el('label', { text: '显示名' }), displayInput),
    el('div', { class: 'field' },
      el('label', { text: '登录名' }),
      nameInput,
      el('p', { class: 'sub', style: 'margin:5px 0 0;font-size:12.5px', text: '只能用英文小写字母、数字、下划线，不能用中文。' }),
    ),
    err,
    el('div', { class: 'modal-actions' },
      el('button', { class: 'btn-ghost', text: '取消', onclick: close }),
      el('button', {
        class: 'btn-primary',
        text: '创建',
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            const r = await api.adminCreateUser({
              username: nameInput.value.trim(),
              display_name: displayInput.value.trim() || nameInput.value.trim(),
            });
            close();
            openModal(({ close: c2 }) => el('div', {},
              el('h2', { class: 'modal-title', text: '建好了' }),
              el('p', { class: 'modal-sub', text: `把邀请码给 @${r.username}，72 小时内有效。` }),
              el('div', { class: 'code-box', text: r.code }),
              el('div', { class: 'modal-actions' },
                el('button', { class: 'btn-ghost', text: '复制链接', onclick: () => copyText(r.activate_url).then(() => toast('已复制')) }),
                el('button', { class: 'btn-primary', text: '好', onclick: () => { c2(); renderAdmin(); } }),
              ),
            ));
          } catch (ex) {
            err.textContent = ex.message;
            e.target.disabled = false;
          }
        },
      }),
    ),
  ));
}

async function renderAdminSite(pane) {
  clear(pane);
  const { settings } = await api.adminSettings().catch((e) => ({ error: e.message }));
  if (settings === undefined) { pane.append(el('p', { class: 'sub', text: '加载失败' })); return; }

  const text = {};
  const color = {};
  const toggle = {};

  const mkText = (key, label, placeholder, long) => {
    const node = long
      ? el('textarea', { class: 'textarea' })
      : el('input', { class: 'input' });
    node.value = settings[key] || '';
    node.placeholder = placeholder || '';
    text[key] = node;
    return el('div', { class: 'field' }, el('label', { text: label }), node);
  };

  const mkColor = (key, label) => {
    const picker = el('input', { type: 'color', value: settings[key] || '#000000' });
    const hex = el('input', { type: 'text', value: settings[key] || '#000000', maxlength: '7' });
    picker.addEventListener('input', () => { hex.value = picker.value; });
    hex.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) picker.value = hex.value; });
    color[key] = () => hex.value.trim();
    return el('div', { class: 'color-row' }, el('label', { text: label }), picker, hex);
  };

  const mkSwitch = (key, label, hint, disabled) => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = settings[key] === '1';
    if (disabled) cb.disabled = true;
    toggle[key] = cb;
    return el('div', { class: 'switch-row' },
      el('div', {}, el('div', { text: label }), hint ? el('div', { class: 'meta', style: 'font-size:12px;color:var(--muted)', text: hint }) : null),
      el('label', { class: 'switch' }, cb, el('span')),
    );
  };

  pane.append(el('div', { class: 'card' },
    el('h3', { text: '文字' }),
    el('p', { class: 'sub', text: '改完点保存，全站立即生效，不用重新部署。' }),
    mkText('site_title', '站点名', '碎碎念'),
    mkText('site_desc', '一句话介绍', '一个人的房间。想到什么写什么。'),
    mkText('footer_text', '页脚备注（可空，支持 [文字](链接)）', '© 2026 · [关于](https://example.com)'),
  ));

  pane.append(el('div', { class: 'card' },
    el('h3', { text: '颜色' }),
    el('p', { class: 'sub', text: '只需要挑底色、字色、主色三个，其余色阶自动推导。' }),
    el('div', { class: 'section-head', style: 'margin:6px 0 10px' }, el('h2', { text: '浅色' })),
    mkColor('bg_light', '底色'),
    mkColor('fg_light', '字色'),
    mkColor('accent_light', '主色'),
    el('div', { class: 'section-head', style: 'margin:18px 0 10px' }, el('h2', { text: '深色' })),
    mkColor('bg_dark', '底色'),
    mkColor('fg_dark', '字色'),
    mkColor('accent_dark', '主色'),
  ));

  // 图片开关、存储选择和上限联动：没有可用存储时全部置灰
  const imgReady = !!state.site?.images_ready;
  const avail = state.site?.storage_available || {};
  const activeStore = state.site?.image_storage || '';
  const storeLabels = { b2: 'Backblaze B2', kv: 'Workers KV', r2: 'Cloudflare R2' };

  const imgCb = el('input', { type: 'checkbox' });
  imgCb.checked = settings.images_enabled === '1';
  imgCb.disabled = !imgReady;
  toggle.images_enabled = imgCb;

  const storageSel = el('select', { class: 'input', style: 'width:100%;max-width:260px' });
  storageSel.append(el('option', { value: 'auto', text: '自动（B2 → KV → R2）' }));
  for (const name of ['b2', 'kv', 'r2']) {
    if (!avail[name]) continue;
    storageSel.append(el('option', { value: name, text: storeLabels[name] }));
  }
  const savedStore = ['auto', 'r2', 'b2', 'kv'].includes(settings.image_storage)
    && (settings.image_storage === 'auto' || avail[settings.image_storage])
    ? settings.image_storage
    : 'auto';
  storageSel.value = savedStore;
  storageSel.disabled = !imgReady;

  const maxImgInput = el('input', {
    class: 'input',
    id: 'maxImg',
    type: 'number',
    min: '1',
    max: '10',
    value: settings.max_image_mb || '3',
    style: 'width:110px',
  });

  const syncImgInputs = () => {
    maxImgInput.disabled = !(imgReady && imgCb.checked);
  };
  imgCb.addEventListener('change', syncImgInputs);
  syncImgInputs();

  pane.append(el('div', { class: 'card' },
    el('h3', { text: '开关' }),
    mkSwitch('comments_enabled', '允许评论', '关掉后所有人只能看不能评'),
    mkSwitch('allow_pin', '允许置顶', '每个人可以把自己的条目置顶'),
    el('div', { class: 'switch-row' },
      el('div', {},
        el('div', { text: '图片功能' }),
        el('div', {
          class: 'meta',
          style: 'font-size:12px;color:var(--muted)',
          text: imgReady ? '关掉后发帖框的图片按钮会消失，上传接口也会拒绝' : '配置 B2 / KV / R2 后才有图片功能',
        }),
      ),
      el('label', { class: 'switch' }, imgCb, el('span')),
    ),
  ));

  pane.append(el('div', { class: 'card' },
    el('h3', { text: '图片' }),
    el('p', {
      class: 'sub',
      style: imgReady ? '' : 'color:var(--accent)',
      text: imgReady
        ? `图片按当前存储写入${activeStore ? `：${storeLabels[activeStore]}` : ''}；读取会自动回退到其他已配置存储。`
        : '还没有可用的图片存储：配置 B2 / KV / R2 后才会有图片功能。',
    }),
    el('div', { class: 'field' },
      el('label', { text: '存储方式' }),
      storageSel,
      el('p', { class: 'sub', style: 'margin:6px 0 0', text: '自动会按 B2 → KV → R2 选第一个可用的；切换后新图写入新存储，旧图仍能读。' }),
    ),
    el('div', { class: 'field' },
      el('label', { text: '单张上限（MB）' }),
      maxImgInput,
      el('p', { class: 'sub', style: 'margin:6px 0 0', text: '上传前浏览器会先压到最长边 1280px 的 WebP，并另存一张 720px 缩略图，通常 100–300KB；KV 模式同样只存压缩后的二进制。' }),
    ),
  ));

  pane.append(el('div', { class: 'btn-row', style: 'margin-bottom:20px' },
    el('button', {
      class: 'btn-primary',
      text: '保存设置',
      onclick: async (e) => {
        e.target.disabled = true;
        const patch = {};
        for (const [k, node] of Object.entries(text)) patch[k] = node.value;
        for (const [k, get] of Object.entries(color)) patch[k] = get();
        for (const [k, cb] of Object.entries(toggle)) patch[k] = cb.checked ? '1' : '0';
        if (imgReady) patch.image_storage = storageSel.value;
        const maxImg = document.getElementById('maxImg');
        if (maxImg && !maxImg.disabled) patch.max_image_mb = maxImg.value;
        try {
          await api.adminSaveSettings(patch);
          applySite(await api.site());
          renderHeader();
          renderDock();
          toast('已保存');
        } catch (err) {
          toast(err.message);
        } finally {
          e.target.disabled = false;
        }
      },
    }),
    el('button', {
      class: 'btn-ghost',
      text: '恢复默认配色',
      onclick: () => {
        const d = {
          bg_light: '#f4f1ec', fg_light: '#33251d', accent_light: '#b84200',
          bg_dark: '#333333', fg_dark: '#f0e9e0', accent_dark: '#e7b063',
        };
        const inputs = pane.querySelectorAll('input[type="color"]');
        const keys = ['bg_light', 'fg_light', 'accent_light', 'bg_dark', 'fg_dark', 'accent_dark'];
        inputs.forEach((inp, i) => {
          const k = keys[i];
          if (!k) return;
          inp.value = d[k];
          const hex = inp.nextElementSibling;
          if (hex) hex.value = d[k];
        });
        toast('已填回默认值，记得保存');
      },
    }),
  ));
}

async function renderAdminData(pane) {
  clear(pane);
  const { stats } = await api.adminStats().catch(() => ({ stats: null }));
  if (stats) {
    pane.append(el('div', { class: 'card' },
      el('h3', { text: '家底' }),
      el('div', { class: 'stat-grid' },
        el('div', { class: 'stat' }, el('b', { text: String(stats.notes) }), el('span', { text: '条目' })),
        el('div', { class: 'stat' }, el('b', { text: String(stats.comments) }), el('span', { text: '评论' })),
        el('div', { class: 'stat' }, el('b', { text: String(stats.users) }), el('span', { text: '用户' })),
        el('div', { class: 'stat' }, el('b', { text: String(stats.images) }), el('span', { text: '图片' })),
        el('div', { class: 'stat' }, el('b', { text: bytes(stats.image_bytes) }), el('span', { text: '图片占用' })),
      ),
    ));
  }

  pane.append(el('div', { class: 'card' },
    el('h3', { text: '备份' }),
    el('p', { class: 'sub', text: '导出全部数据成一个 JSON：用户、条目、评论、配置、图片索引。图片本体在图片存储（B2 / KV / R2），见下面说明。' }),
    el('div', { class: 'btn-row' },
      el('a', { class: 'btn-primary', href: '/api/admin/backup', download: '', text: '下载备份 JSON' }),
    ),
  ));

  const file = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  const info = el('p', { class: 'sub', style: 'margin:10px 0 0' });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      const data = JSON.parse(text);
      const ok = await confirmModal(
        '恢复会覆盖现在所有数据',
        `备份里有 ${data.users?.length || 0} 个用户、${data.notes?.length || 0} 条笔记、${data.comments?.length || 0} 条评论。现在的内容会被全部删掉。`,
        '覆盖恢复', true,
      );
      if (!ok) return;
      data.confirm = 'RESTORE';
      const r = await api.restore(data);
      info.textContent = `恢复完成：${JSON.stringify(r.restored)}`;
      toast('已恢复，刷新一下');
      setTimeout(() => boot(true).then(route), 800);
    } catch (e) {
      info.textContent = '恢复失败：' + e.message;
    }
  });

  pane.append(el('div', { class: 'card' },
    el('h3', { text: '恢复' }),
    el('p', { class: 'sub', text: '选一个之前导出的 JSON。注意：图片文件不在 JSON 里，恢复后图片需要原来的图片存储里还在。' }),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn-ghost danger', text: '选择备份文件…', onclick: () => file.click() }),
    ),
    file,
    info,
    el('p', { class: 'sub', style: 'margin:14px 0 0;line-height:1.7' },
      '图片批量下载：B2 桶用 rclone / b2 CLI 同步；R2 用 ',
      el('code', { text: 'npx wrangler r2 object get kilo-images/<key> --file ./out/<key>' }),
      '。',
    ),
  ));
}

/* ── 发布条 ───────────────────────────────────────────────── */

const MAX_IMG = 9;
// 原图也压小一点：时间线看缩略图，点进单条再取这张原图
const MAX_SIDE = 1280;
const THUMB_SIDE = 720;
const IMG_QUALITY = 0.78;
const THUMB_QUALITY = 0.72;

function canvasBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}

async function compressImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bitmap) return { blob: file, w: 0, h: 0 };

  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);

  // 缩略图从同一张位图生成，避免二次解码
  const tScale = Math.min(1, THUMB_SIDE / Math.max(width, height));
  const tw = Math.max(1, Math.round(width * tScale));
  const th = Math.max(1, Math.round(height * tScale));
  const tCanvas = document.createElement('canvas');
  tCanvas.width = tw;
  tCanvas.height = th;
  tCanvas.getContext('2d').drawImage(bitmap, 0, 0, tw, th);
  if (bitmap.close) bitmap.close();

  const blob = await canvasBlob(canvas, IMG_QUALITY);
  if (!blob) return { blob: file, w, h };
  // 有些浏览器不支持 webp，会回退成 png，体积可能更大
  if (blob.type !== 'image/webp' && blob.size > file.size) return { blob: file, w, h };

  const thumbBlob = await canvasBlob(tCanvas, THUMB_QUALITY);
  return {
    blob,
    w,
    h,
    thumbBlob: thumbBlob && thumbBlob.type === 'image/webp' ? thumbBlob : null,
    tw,
    th,
  };
}

/** 头像压成 192×192 的方形 data URL，直接存数据库，不依赖 R2 */
async function avatarDataUrl(file) {
  if (!file.type.startsWith('image/')) throw new Error('只能选图片');
  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (bmp) {
    const s0 = Math.min(bmp.width, bmp.height);
    ctx.drawImage(bmp, (bmp.width - s0) / 2, (bmp.height - s0) / 2, s0, s0, 0, 0, size, size);
    if (bmp.close) bmp.close();
  } else {
    // 解不开就画个纯色块，总比报错强
    ctx.fillStyle = '#d9d2c8';
    ctx.fillRect(0, 0, size, size);
  }
  let url = canvas.toDataURL('image/webp', 0.82);
  if (!url.startsWith('data:image/webp')) {
    // 浏览器不支持 webp：铺白底再转 jpeg，体积更小
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    if (bmp) {
      // 上面已经画过了，这里重画一次
      const s0 = Math.min(bmp.width, bmp.height);
      ctx.drawImage(bmp, (bmp.width - s0) / 2, (bmp.height - s0) / 2, s0, s0, 0, 0, size, size);
    }
    url = canvas.toDataURL('image/jpeg', 0.85);
  }
  if (url.length > 130000) throw new Error('头像太大了，换一张小一点的');
  return url;
}

async function uploadFile(file) {
  if (!file.type.startsWith('image/')) throw new Error('只能传图片');
  const { blob, w, h, thumbBlob, tw, th } = await compressImage(file);
  const res = await api.upload(blob, w, h);
  if (thumbBlob) {
    try {
      const up = await api.uploadThumb(thumbBlob, tw, th, res.key);
      res.t = up.key;
    } catch (e) {
      // 缩略图只是省流量，失败不影响原图发布
      console.warn('缩略图上传失败', e);
    }
  }
  return res;
}

let composerKb = null;

function setComposerVerse() {
  const node = document.getElementById('composerTitle');
  if (!node) return;
  node.textContent = nextVerse();
}

function renderDock() {
  const dock = document.getElementById('dock');
  const pick = document.getElementById('pickBtn');
  const on = !!state.site?.images_enabled;
  pick.hidden = !on;
  pick.title = on ? '加图片' : (state.site?.images_ready ? '图片功能已关闭' : '图片存储未配置');
  const ta = document.getElementById('composer');
  ta.placeholder = isTouchUi()
    ? '写点什么…'
    : on
      ? '写点什么…（Ctrl/⌘ + Enter 发布，可直接粘贴图片）'
      : '写点什么…（Ctrl/⌘ + Enter 发布）';
  const draft = localStorage.getItem('memo2-draft') || '';
  if (!ta.value && draft) ta.value = draft;
  dock.hidden = !state.me;
  if (!state.me) { setComposerOpen(false); return; }
  updateCounter();
  paintThumbs();
}

function setComposerOpen(open) {
  const dock = document.getElementById('dock');
  const panel = document.getElementById('composerPanel');
  const fab = document.getElementById('composeBtn');
  const scrim = document.getElementById('composeScrim');
  if (!dock || !panel || !fab || (open && dock.hidden)) return;
  fab.classList.remove('tucked');
  if (open) {
    setComposerVerse();
    panel.hidden = false;
    if (scrim) scrim.hidden = false;
    fab.hidden = true;
    fab.setAttribute('aria-expanded', 'true');
    composerKb?.reset();
    autoGrow();
    // 触屏上只负责打开面板，等用户点输入框再弹键盘
    if (!isTouchUi()) {
      document.getElementById('composer')?.focus({ preventScroll: true });
      composerKb?.sync();
    }
  } else {
    if (panel.contains(document.activeElement) && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    panel.hidden = true;
    if (scrim) scrim.hidden = true;
    fab.hidden = false;
    fab.setAttribute('aria-expanded', 'false');
    panel.classList.remove('dragover');
    composerKb?.reset();
    if (!isTouchUi()) fab.focus({ preventScroll: true });
  }
}

function syncDraftMark() {
  const ta = document.getElementById('composer');
  const fab = document.getElementById('composeBtn');
  if (!ta || !fab) return;
  fab.classList.toggle('has-draft', !!(ta.value.trim() || state.pending.length));
}

function autoGrow() {
  const ta = document.getElementById('composer');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.34) + 'px';
}

function updateCounter() {
  const ta = document.getElementById('composer');
  const c = document.getElementById('counter');
  const n = ta.value.length;
  c.textContent = n ? `${n} / 5000` : '';
  c.classList.toggle('warn', n > 4800);
  const btn = document.getElementById('publishBtn');
  btn.disabled = !ta.value.trim() && !state.pending.some((p) => p.key);
  syncDraftMark();
}

function paintThumbs() {
  const box = document.getElementById('dockThumbs');
  clear(box);
  box.hidden = state.pending.length === 0;
  state.pending.forEach((p, i) => {
    const node = el('div', { class: 'thumb' + (p.busy ? ' busy' : '') },
      el('img', { src: p.thumb, alt: '' }),
      el('button', {
        class: 'rm',
        text: '✕',
        onclick: () => { state.pending.splice(i, 1); paintThumbs(); updateCounter(); },
      }),
    );
    box.append(node);
  });
  syncDraftMark();
}

async function addFiles(files) {
  if (!state.site?.images_enabled) {
    toast(state.site?.images_ready ? '图片功能已关闭，管理员可以在后台打开' : '图片存储未配置：检查 B2 / KV / R2');
    return;
  }
  const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  if (state.pending.length + list.length > MAX_IMG) {
    toast(`最多 ${MAX_IMG} 张`);
    return;
  }
  for (const f of list) {
    const thumb = URL.createObjectURL(f);
    const item = { thumb, busy: true, key: null };
    state.pending.push(item);
    paintThumbs();
    try {
      const up = await uploadFile(f);
      item.key = up.key;
      item.w = up.w;
      item.h = up.h;
      item.t = up.t || '';
      item.busy = false;
    } catch (e) {
      toast(e.message);
      state.pending = state.pending.filter((x) => x !== item);
      URL.revokeObjectURL(thumb);
    }
    paintThumbs();
    updateCounter();
  }
}

async function publish() {
  const ta = document.getElementById('composer');
  const btn = document.getElementById('publishBtn');
  const content = ta.value.trim();
  const images = state.pending.filter((p) => p.key).map((p) => ({ k: p.key, w: p.w, h: p.h, t: p.t || '' }));
  if (!content && !images.length) return;
  if (state.pending.some((p) => p.busy)) { toast('图片还在传，稍等一下'); return; }

  btn.disabled = true;
  btn.textContent = '发布中…';
  try {
    const { note } = await api.createNote({ content, images });
    ta.value = '';
    localStorage.removeItem('memo2-draft');
    state.pending.forEach((p) => URL.revokeObjectURL(p.thumb));
    state.pending = [];
    paintThumbs();
    autoGrow();
    updateCounter();
    state.flashId = note.id;
    toast('发出去了');
    setComposerOpen(false);
    if (location.hash && location.hash !== '#/') location.hash = '#/';
    else route();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.textContent = '发布';
    btn.disabled = false;
    updateCounter();
  }
}

function initDock() {
  const ta = document.getElementById('composer');
  const dock = document.getElementById('dock');
  const panel = document.getElementById('composerPanel');
  const picker = document.getElementById('filePicker');
  composerKb = initSoftKeyboard(panel);

  ta.addEventListener('input', () => {
    autoGrow();
    updateCounter();
    localStorage.setItem('memo2-draft', ta.value);
  });
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); publish(); }
  });
  ta.addEventListener('paste', (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const files = items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  document.getElementById('pickBtn').addEventListener('click', () => { picker.value = ''; picker.click(); });
  picker.addEventListener('change', () => addFiles(picker.files));
  document.getElementById('publishBtn').addEventListener('click', publish);

  document.getElementById('composeBtn').addEventListener('click', () => setComposerOpen(true));
  document.getElementById('composeClose').addEventListener('click', () => setComposerOpen(false));
  document.getElementById('composeScrim').addEventListener('click', () => setComposerOpen(false));

  ['dragenter', 'dragover'].forEach((ev) => dock.addEventListener(ev, (e) => {
    if (panel.hidden) return;
    e.preventDefault();
    panel.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((ev) => dock.addEventListener(ev, (e) => {
    if (panel.hidden) return;
    e.preventDefault();
    panel.classList.remove('dragover');
  }));
  dock.addEventListener('drop', (e) => {
    if (panel.hidden) return;
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) addFiles(files);
  });

  document.addEventListener('click', (e) => {
    if (!panel.hidden && !dock.contains(e.target)) setComposerOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) setComposerOpen(false);
  });

  // 页面一滚动就先收起按钮，停手 0.5 秒再露出来
  let fabTimer = 0;
  const showFab = () => document.getElementById('composeBtn').classList.remove('tucked');
  const hideFab = () => {
    if (panel.hidden) document.getElementById('composeBtn').classList.add('tucked');
  };
  window.addEventListener('scroll', () => {
    window.clearTimeout(fabTimer);
    hideFab();
    fabTimer = window.setTimeout(showFab, 500);
  }, { passive: true });
  window.addEventListener('resize', showFab);
}

/* ── 路由 ─────────────────────────────────────────────────── */

function parseHash() {
  const raw = (location.hash || '').replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const seg = pathPart.split('/').filter(Boolean);
  return { seg, q: new URLSearchParams(queryPart || '') };
}

let routeToken = 0;

export async function route() {
  const token = ++routeToken;
  const { seg, q } = parseHash();
  const v = view();
  window.scrollTo(0, 0);

  const head = seg[0] || '';
  try {
    // 一个人都还没有：直接进初始化，别让人先看空时间线
    if (state.site?.needs_setup && head !== 'login' && head !== 'activate') {
      await renderSetup();
      return;
    }
    if (!head) {
      state.filter = { tag: '', q: '', user: '' };
      await renderTimeline();
    } else if (head === 'tag') {
      state.filter = { tag: decodeURIComponent(seg[1] || ''), q: '', user: '' };
      await renderTimeline();
    } else if (head === 'search') {
      state.filter = { tag: '', q: q.get('q') || '', user: '' };
      await renderTimeline();
    } else if (head === 'n') {
      await renderNote(seg[1]);
    } else if (head === 'u') {
      await renderProfile(seg[1]);
    } else if (head === 'people') {
      await renderPeople();
    } else if (head === 'login') {
      await renderLogin();
    } else if (head === 'activate') {
      await renderActivate(q.get('code') || '');
    } else if (head === 'me') {
      await renderMe();
    } else if (head === 'admin') {
      await renderAdmin();
    } else {
      clear(v);
      v.append(el('div', { class: 'state' },
        el('p', { class: 'state-main', text: '这里什么都没有' }),
        el('div', { class: 'btn-row' }, el('a', { class: 'btn-ghost', href: '#/', text: '回首页' })),
      ));
    }
  } catch (e) {
    if (token !== routeToken) return;
    clear(v);
    v.append(el('div', { class: 'state' },
      el('p', { class: 'state-main', text: '页面出错了' }),
      el('p', { class: 'state-sub', text: e.message }),
    ));
  }
  updateFootCount();
}

/* ── 启动 ─────────────────────────────────────────────────── */

async function boot(refreshMe = false) {
  const jobs = [api.site()];
  if (refreshMe || !state.me) jobs.push(api.me().catch(() => ({ authed: false })));
  const [site, meRes] = await Promise.all(jobs);
  applySite(site);
  if (meRes) state.me = meRes.authed ? meRes.user : null;
  renderHeader();
  renderDock();
}

function initHeader() {
  const searchBar = document.getElementById('searchBar');
  const searchInput = document.getElementById('searchInput');
  const searchGo = document.getElementById('searchGo');
  const syncSearchGo = () => { searchGo.disabled = !searchInput.value.trim(); };
  const submitSearch = () => {
    const q = searchInput.value.trim();
    if (!q) { searchInput.focus(); return; }
    searchBar.hidden = true;
    searchInput.blur();
    const next = `#/search?q=${encodeURIComponent(q)}`;
    if (location.hash === next) route();
    else location.hash = next;
  };

  document.getElementById('searchBtn').append(icon('search', 17));
  document.getElementById('searchBtn').addEventListener('click', () => {
    const open = searchBar.hidden;
    searchBar.hidden = !open;
    if (open) {
      searchInput.focus();
      searchInput.select();
    }
  });
  searchGo.append(icon('arrow', 16));
  searchGo.addEventListener('click', submitSearch);
  searchInput.addEventListener('input', syncSearchGo);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitSearch();
    }
    if (e.key === 'Escape') {
      searchBar.hidden = true;
      searchInput.value = '';
      syncSearchGo();
      searchInput.blur();
    }
  });
  syncSearchGo();
  document.getElementById('themeBtn').addEventListener('click', cycleTheme);
  document.getElementById('pickBtn').append(icon('image', 17));
  document.getElementById('composeBtn').append(icon('pencil', 20));
  document.getElementById('composeClose').append(icon('x', 15));

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'n' && state.me) {
      e.preventDefault();
      setComposerOpen(true);
    }
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themeMode() === 'auto') applyTheme();
  });
}

async function main() {
  initHeader();
  initLightbox();
  initDock();
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.dataset.close !== undefined) closeModal();
  });
  await boot(true);
  window.addEventListener('hashchange', route);
  await route();
}

main().catch((e) => {
  console.error(e);
  const v = document.getElementById('view');
  if (v) {
    v.textContent = '';
    v.append(el('div', { class: 'state' },
      el('p', { class: 'state-main', text: '加载失败' }),
      el('p', { class: 'state-sub', text: e.message }),
    ));
  }
});
