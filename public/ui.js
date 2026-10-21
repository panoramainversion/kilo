/* ────────────────────────────────────────────────────────────
   memo v2 · 前端小工具：DOM、图标、正文渲染、提示、大图
   ──────────────────────────────────────────────────────────── */

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style') n.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(4)) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* ── 图标 ─────────────────────────────────────────────────── */

const PATHS = {
  search: '<circle cx="11" cy="11" r="6.6"/><path d="m16.2 16.2 4.4 4.4"/>',
  sun: '<circle cx="12" cy="12" r="4.1"/><path d="M12 2.6v2.2M12 19.2v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.4 19.6 6 18M18 6l1.6-1.6"/>',
  moon: '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z"/>',
  auto: '<circle cx="12" cy="12" r="8.4"/><path d="M12 3.6v16.8" /><path d="M12 3.6a8.4 8.4 0 0 1 0 16.8Z" fill="currentColor" stroke="none"/>',
  user: '<circle cx="12" cy="8.2" r="3.6"/><path d="M4.8 20c1.1-3.5 3.9-5.3 7.2-5.3s6.1 1.8 7.2 5.3"/>',
  pencil: '<path d="M4.5 19.5h3.2L18 9.2a1.8 1.8 0 0 0 0-2.5l-1.2-1.2a1.8 1.8 0 0 0-2.5 0L4.5 15.3v4.2Z"/>',
  pin: '<path d="M9 3.8h6l-1 5 3 3.2H7l3-3.2-1-5Z"/><path d="M12 12v8"/>',
  trash: '<path d="M4.6 6.8h14.8"/><path d="M9.2 6.8V4.6h5.6v2.2"/><path d="M6.6 6.8 7.6 20h8.8l1-13.2"/>',
  comment: '<path d="M20 12.4c0 3.7-3.6 6.6-8 6.6a9.6 9.6 0 0 1-2.6-.35L5 20.4l1-3.3A6.3 6.3 0 0 1 4 12.4c0-3.7 3.6-6.6 8-6.6s8 2.9 8 6.6Z"/>',
  reply: '<path d="M9.6 7.4 4.8 12l4.8 4.6"/><path d="M5.2 12h8.4a5 5 0 0 1 5 5v1.2"/>',
  image: '<rect x="3.6" y="5" width="16.8" height="14" rx="2.4"/><circle cx="9" cy="10.2" r="1.5"/><path d="m4.4 17.4 4.6-4.2 3.4 3 3-2.6 4.2 3.8"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  arrow: '<path d="M5 12h13"/><path d="m12.5 5.8 6.2 6.2-6.2 6.2"/>',
  logout: '<path d="M15 4.6H6.6a2 2 0 0 0-2 2v10.8a2 2 0 0 0 2 2H15"/><path d="M18.4 12H9.6"/><path d="m15.4 8.6 3.4 3.4-3.4 3.4"/>',
  settings: '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.2a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.6 1v.3a1.8 1.8 0 1 1-3.6 0v-.2a1.5 1.5 0 0 0-2.6-1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1-2.6H4.4a1.8 1.8 0 1 1 0-3.6h.2a1.5 1.5 0 0 0 1-2.6l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 2.6-1V4.4a1.8 1.8 0 1 1 3.6 0v.2a1.5 1.5 0 0 0 2.6 1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1 2.6h.3a1.8 1.8 0 1 1 0 3.6h-.2"/>',
  plus: '<path d="M12 5.4v13.2M5.4 12h13.2"/>',
  palette: '<path d="M12 3.4a8.6 8.6 0 1 0 0 17.2h1.1a1.7 1.7 0 0 0 1.3-2.8 1.7 1.7 0 0 1 1.3-2.8H18a2.9 2.9 0 0 0 2.9-2.9 8.6 8.6 0 0 0-8.9-8.7Z"/><circle cx="7.7" cy="10.8" r=".9" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.4" r=".9" fill="currentColor" stroke="none"/><circle cx="14.3" cy="7.6" r=".9" fill="currentColor" stroke="none"/><circle cx="17" cy="10.8" r=".9" fill="currentColor" stroke="none"/>',
  shuffle: '<path d="M4 7h3.2l3.1 3.9"/><path d="M12.6 13.1l2.2 2.9H20"/><path d="m17.2 5.8 2.8 3.2-2.8 3.2"/><path d="M4 17h3.2l2.4-3"/><path d="m17.2 13.8 2.8 3.2-2.8 3.2"/>',
};

export function icon(name, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = PATHS[name] || '';
  return svg;
}

/** 管理员认证标：蓝色圆底 + 白勾，只露图标，文字留给 title / aria */
export function verifyBadge(label = '管理员', size = 15) {
  const wrap = el('span', {
    class: 'verify-badge',
    title: label,
    role: 'img',
    'aria-label': label,
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="12" cy="12" r="9.2" fill="#1d9bf0"/>'
    + '<path d="m7.5 12.3 2.8 2.8 6.3-6.5" fill="none" stroke="#fff" stroke-width="2.1" '
    + 'stroke-linecap="round" stroke-linejoin="round"/>';
  wrap.append(svg);
  return wrap;
}

/* ── 正文渲染（Markdown 子集，全部走 DOM，不拼 HTML）───────── */

const INLINE = /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|#[^\s#<>]{1,30}|https?:\/\/[^\s<>"）】]+)/g;

function inline(text, out) {
  let last = 0;
  let m;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
    const tok = m[0];
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(tok);
    if (link) {
      out.push(el('a', {
        href: link[2],
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
        text: link[1],
      }));
    } else if (tok.startsWith('**')) {
      out.push(el('strong', { text: tok.slice(2, -2) }));
    } else if (tok.startsWith('`')) {
      out.push(el('code', { text: tok.slice(1, -1) }));
    } else if (tok.startsWith('*')) {
      out.push(el('em', { text: tok.slice(1, -1) }));
    } else if (tok.startsWith('#')) {
      const tag = tok.slice(1);
      out.push(el('a', { class: 'tag', href: `#/tag/${encodeURIComponent(tag)}`, text: '#' + tag }));
    } else {
      out.push(el('a', { href: tok, target: '_blank', rel: 'noopener noreferrer nofollow', text: tok }));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
}

export function renderBody(text) {
  const frag = document.createDocumentFragment();
  const lines = String(text || '').split('\n');
  let para = null;
  let list = null;

  const reset = () => { para = null; list = null; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    if (!line.trim()) { reset(); continue; }

    if (/^>\s?/.test(line)) {
      const quote = el('blockquote');
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      i--;
      const parts = [];
      inline(buf.join('\n'), parts);
      quote.append(...parts);
      quote.style.whiteSpace = 'pre-wrap';
      frag.append(quote);
      reset();
      continue;
    }

    const lm = /^[-*]\s+(.*)$/.exec(line);
    if (lm) {
      if (!list) { list = el('ul'); frag.append(list); }
      const parts = [];
      inline(lm[1], parts);
      list.append(el('li', {}, ...parts));
      para = null;
      continue;
    }

    const parts = [];
    inline(line, parts);
    if (!para) {
      para = el('p');
      frag.append(para);
      para.append(...parts);
    } else {
      para.append(el('br'), ...parts);
    }
    list = null;
  }

  return frag;
}

/* ── 时间 ─────────────────────────────────────────────────── */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relTime(ms) {
  const d = Date.now() - ms;
  if (d < 0) return '刚刚';
  if (d < MIN) return '刚刚';
  if (d < HOUR) return Math.floor(d / MIN) + ' 分钟前';
  if (d < DAY) return Math.floor(d / HOUR) + ' 小时前';
  if (d < 7 * DAY) return Math.floor(d / DAY) + ' 天前';
  const t = new Date(ms);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export function fullTime(ms) {
  const t = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/* ── 软键盘避让 ───────────────────────────────────────────── */

const kbPanels = new Map(); // 元素 → 当前上移的像素
let kbWatching = false;
let kbRaf = 0;

function kbGeom(panel) {
  const parent = panel.offsetParent;
  const parentTop = parent ? parent.getBoundingClientRect().top : 0;
  return { top: parentTop + panel.offsetTop, height: panel.offsetHeight };
}

function kbApply(panel, lift) {
  const prev = kbPanels.get(panel) || 0;
  const next = Math.max(0, Math.round(lift));
  if (prev === next) return;
  kbPanels.set(panel, next);
  panel.style.transform = next ? `translateY(-${next}px)` : '';
}

function kbSync() {
  kbRaf = 0;
  if (!kbPanels.size) return;
  const vv = window.visualViewport;
  const layoutH = window.innerHeight;
  const visibleBottom = vv ? Math.min(layoutH, vv.offsetTop + vv.height) : layoutH;
  const covered = layoutH - visibleBottom;
  for (const panel of kbPanels.keys()) {
    if (!panel.isConnected || panel.hidden) { kbApply(panel, 0); continue; }
    const active = document.activeElement;
    const editing = !!active && panel.contains(active)
      && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
    // 不到 80px 的变化多半只是地址栏伸缩，不应跟着动
    if (!editing || covered < 80) { kbApply(panel, 0); continue; }
    const { top, height } = kbGeom(panel);
    const need = top + height - (visibleBottom - 14);
    const max = Math.max(0, top - 8);
    kbApply(panel, Math.min(Math.max(0, need), max));
  }
}

function kbSchedule() {
  if (kbRaf) return;
  kbRaf = requestAnimationFrame(kbSync);
}

function kbWatch() {
  if (kbWatching) return;
  kbWatching = true;
  window.addEventListener('resize', kbSchedule);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', kbSchedule);
    window.visualViewport.addEventListener('scroll', kbSchedule);
  }
  document.addEventListener('focusin', () => {
    kbSchedule();
    setTimeout(kbSchedule, 180);
    setTimeout(kbSchedule, 420);
  });
  document.addEventListener('focusout', () => {
    setTimeout(kbSchedule, 120);
    setTimeout(kbSchedule, 320);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) kbSchedule();
  });
}

export function initSoftKeyboard(panel) {
  if (!panel) return { sync: kbSchedule, reset: () => {} };
  if (!kbPanels.has(panel)) kbPanels.set(panel, 0);
  panel.classList.add('kb-smooth');
  kbWatch();
  if (window.ResizeObserver) new ResizeObserver(kbSchedule).observe(panel);
  return {
    sync: kbSchedule,
    reset: () => kbApply(panel, 0),
  };
}

/* ── 提示 / 弹层 ──────────────────────────────────────────── */

let toastTimer = null;
export function toast(msg, ms = 2200) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = msg;
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.classList.remove('show');
    setTimeout(() => { box.hidden = true; }, 250);
  }, ms);
}

let modalCloser = null;
let modalReturnFocus = null;
let modalKb = null;
export function openModal(build, opts = {}) {
  const { focus = true, top = false } = opts;
  const wrap = document.getElementById('modal');
  const card = document.getElementById('modalCard');
  if (!modalKb) modalKb = initSoftKeyboard(card);
  if (wrap.hidden) modalReturnFocus = document.activeElement;
  if (modalCloser) document.removeEventListener('keydown', modalCloser);
  clear(card);
  const api = { close: closeModal, card };
  const node = build(api);
  if (node) card.append(node);
  wrap.hidden = false;
  wrap.classList.toggle('modal-top', !!top);
  modalKb.reset();
  const first = card.querySelector('input, textarea, button');
  if (focus && first) setTimeout(() => { if (!wrap.hidden) first.focus(); }, 60);
  if (!focus) modalKb?.sync();
  modalCloser = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', modalCloser);
}

export function closeModal() {
  const wrap = document.getElementById('modal');
  if (!wrap || wrap.hidden) return;
  const card = document.getElementById('modalCard');
  if (card.contains(document.activeElement) && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  wrap.hidden = true;
  wrap.classList.remove('modal-top');
  modalKb?.reset();
  if (modalCloser) document.removeEventListener('keydown', modalCloser);
  modalCloser = null;
  const back = modalReturnFocus;
  modalReturnFocus = null;
  if (back && document.contains(back) && typeof back.focus === 'function') back.focus({ preventScroll: true });
}

export function confirmModal(title, sub, okText = '确定', danger = false) {
  return new Promise((resolve) => {
    openModal(({ close }) => el('div', {},
      el('h2', { class: 'modal-title', text: title }),
      sub ? el('p', { class: 'modal-sub', text: sub }) : null,
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn-ghost', onclick: () => { close(); resolve(false); }, text: '取消' }),
        el('button', {
          class: danger ? 'btn-primary danger' : 'btn-primary',
          onclick: () => { close(); resolve(true); },
          text: okText,
        }),
      ),
    ));
  });
}

/* ── 大图 ─────────────────────────────────────────────────── */

let lbState = null;

export function openLightbox(images, index = 0) {
  lbState = { images, index };
  renderLightbox();
  const box = document.getElementById('lightbox');
  box.hidden = false;
  document.addEventListener('keydown', lbKey);
}

function renderLightbox() {
  if (!lbState) return;
  const { images, index } = lbState;
  const img = document.getElementById('lbImg');
  img.src = images[index].url;
  img.alt = '';
  document.getElementById('lbCount').textContent = images.length > 1 ? `${index + 1} / ${images.length}` : '';
  document.getElementById('lbPrev').hidden = images.length < 2;
  document.getElementById('lbNext').hidden = images.length < 2;
}

function lbKey(e) {
  if (!lbState) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') stepLightbox(-1);
  if (e.key === 'ArrowRight') stepLightbox(1);
}

function stepLightbox(d) {
  if (!lbState) return;
  const n = lbState.images.length;
  lbState.index = (lbState.index + d + n) % n;
  renderLightbox();
}

export function closeLightbox() {
  document.getElementById('lightbox').hidden = true;
  document.removeEventListener('keydown', lbKey);
  lbState = null;
}

export function initLightbox() {
  document.getElementById('lbClose').addEventListener('click', closeLightbox);
  document.getElementById('lbPrev').addEventListener('click', () => stepLightbox(-1));
  document.getElementById('lbNext').addEventListener('click', () => stepLightbox(1));
  document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox') closeLightbox();
  });
}

/* ── 头像 ─────────────────────────────────────────────────── */

export function avatarEl(user, size = '') {
  const cls = 'avatar' + (size ? ' ' + size : '');
  const a = el('a', { class: cls, href: `#/u/${user.username}`, title: user.display_name });
  if (user.avatar) {
    a.append(el('img', { src: user.avatar, alt: '', loading: 'lazy', decoding: 'async' }));
  } else {
    a.textContent = (user.display_name || user.username || '?').trim().slice(0, 1).toUpperCase();
  }
  return a;
}

/* ── 其它 ─────────────────────────────────────────────────── */

export function bytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  const ta = el('textarea', { style: 'position:fixed;left:-9999px' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return Promise.resolve(ok);
}
