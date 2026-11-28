/* M Download · phần điều khiển giao diện */
document.documentElement.classList.add('electron');
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const view = $('#view');

const state = {
  items: new Map(),      // url -> {url,type,size,mime,w,h,dom,seq,name}
  sel: new Set(),
  type: 'all',
  hideSmall: true,
  minSize: 300,
  videoQuality: '1080',
  showDone: true,
  saveDir: '',
  title: '',
  pageKey: '',
  ready: false,
  seq: 0,
  lastClick: null,
  upd: { state: 'idle' },
  version: '',
  whatsnew: null,
};

/* ---------- tiện ích ---------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmtSize(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 1 : 0).replace('.', ',') : n) + ' ' + u[i];
}
function fileName(url) {
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean).pop() || new URL(url).hostname;
    return decodeURIComponent(p);
  } catch { return url; }
}
function toast(text, action, ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(text)}</span>`;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.run(); close(); };
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
  setTimeout(close, action ? Math.max(ms, 7000) : ms);
}

/* ---------- trình duyệt ---------- */
const VIDEO_PAGE = /^https?:\/\/((www|m|music)\.)?youtube\.com\/(watch\?|shorts\/|live\/)|^https?:\/\/youtu\.be\/./i;
function normalize(text) {
  text = text.trim();
  if (!text) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  if (/^[^\s]+\.[^\s]{2,}$/.test(text) || /^localhost(:\d+)?(\/|$)/.test(text)) return 'https://' + text;
  return 'https://www.google.com/search?q=' + encodeURIComponent(text);
}
function go(text) {
  const url = normalize(text);
  if (!url) return;
  $('#start').hidden = true;
  view.hidden = false;
  if (state.ready) view.loadURL(url).catch(() => {});
  else view.src = url;
}
$('#addrForm').onsubmit = (e) => { e.preventDefault(); go($('#addr').value); $('#addr').blur(); };
$('#addr').onfocus = () => $('#addr').select();
$('#back').onclick = () => state.ready && view.goBack();
$('#fwd').onclick = () => state.ready && view.goForward();
$('#reload').onclick = () => state.ready && view.reload();

function navState() {
  if (!state.ready) return;
  $('#back').disabled = !view.canGoBack();
  $('#fwd').disabled = !view.canGoForward();
}
function onNavigate(url, inPage) {
  if (document.activeElement !== $('#addr')) $('#addr').value = url;
  api.setPage(url);
  const key = url.split('#')[0];
  if (key !== state.pageKey) { stopDeep(); clearCaptured(); }
  state.pageKey = key;
  if (VIDEO_PAGE.test(url)) addItem({ url, type: 'ytdl', dom: -1, name: state.title || 'Video của trang này' });
  navState();
}
view.addEventListener('dom-ready', () => { state.ready = true; navState(); });
view.addEventListener('did-navigate', (e) => onNavigate(e.url, false));
view.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) onNavigate(e.url, true); });
view.addEventListener('page-title-updated', (e) => {
  state.title = e.title;
  for (const it of state.items.values()) if (it.type === 'ytdl') { it.name = e.title; queueRender(); }
});
view.addEventListener('did-start-loading', () => { $('#loadbar').classList.add('on'); });
view.addEventListener('did-stop-loading', () => { $('#loadbar').classList.remove('on'); navState(); scan(); });
view.addEventListener('did-fail-load', (e) => {
  if (e.isMainFrame && e.errorCode !== -3) toast('Không mở được trang: ' + (e.errorDescription || 'lỗi mạng'));
});

/* ---------- quét link trong trang (chạy ngầm, không sửa gì trên trang) ---------- */
const SCAN = `(() => {
  const out = [], seen = new Set();
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return ''; } };
  const add = (u, type, w, h) => {
    u = abs(u);
    if (!/^https?:/.test(u) || seen.has(u) || out.length > 3000) return;
    seen.add(u); out.push({ url: u, type, w: w || 0, h: h || 0 });
  };
  const LAZY = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-url', 'data-cdn', 'data-echo'];
  document.querySelectorAll('img').forEach((i) => {
    const cur = i.currentSrc || i.src;
    let lazy = '';
    for (const a of LAZY) { const v = i.getAttribute(a); if (v && !v.startsWith('data:')) { lazy = v.trim(); break; } }
    if (lazy && abs(lazy) !== cur) add(lazy, 'img');
    if (cur && !cur.startsWith('data:')) add(cur, 'img', i.naturalWidth, i.naturalHeight);
  });
  document.querySelectorAll('video, audio, video source, audio source').forEach((v) => {
    const s = v.currentSrc || v.src; if (s && !s.startsWith('blob:')) add(s, 'vid');
  });
  const F = /\\.(zip|rar|7z|pdf|psd|psb|clip|exe|msi|apk|iso|epub|cbz|cbr|docx?|xlsx?|pptx?|ttf|otf|blend|fbx|torrent)$/i;
  const M = /\\.(mp4|webm|mkv|mov|m4v|mp3|m4a|flac|wav)$/i;
  const P = /\\.(jpe?g|png|webp|gif|avif|bmp)$/i;
  document.querySelectorAll('a[href]').forEach((a) => {
    let p = ''; try { p = new URL(a.href).pathname; } catch { return; }
    if (F.test(p)) add(a.href, 'file'); else if (M.test(p)) add(a.href, 'vid'); else if (P.test(p)) add(a.href, 'img');
  });
  return { title: document.title, items: out };
})()`;
let scanning = false;
async function scan() {
  if (!state.ready || view.hidden || scanning) return;
  scanning = true;
  try {
    const key = state.pageKey;
    const r = await view.executeJavaScript(SCAN);
    if (r && key === state.pageKey) {
      if (r.title) state.title = r.title;
      r.items.forEach((it, i) => addItem({ ...it, dom: i }));
    }
  } catch { /* trang đang chuyển */ }
  scanning = false;
}
setInterval(scan, 1500);

/* ---------- danh sách bắt được ---------- */
const els = new Map();
function addItem(it) {
  let cur = state.items.get(it.url);
  if (!cur) {
    cur = { url: it.url, type: it.type, size: 0, mime: '', w: 0, h: 0, dom: undefined, seq: state.seq++, name: it.name || fileName(it.url) };
    state.items.set(it.url, cur);
  }
  if (it.size) cur.size = it.size;
  if (it.mime) cur.mime = it.mime;
  if (it.w && it.h) { cur.w = it.w; cur.h = it.h; }
  if (it.dom !== undefined) cur.dom = it.dom;
  if (it.name) cur.name = it.name;
  if (it.ref) cur.ref = it.ref;
  if (it.type === 'stream' || (cur.type === 'img' && it.type !== 'img')) cur.type = it.type;
  if (it.wanted) askDownload(cur);
  queueRender();
}
function clearCaptured() {
  state.items.clear(); state.sel.clear(); els.clear(); state.lastClick = null;
  $('#list').textContent = '';
  queueRender();
}
function isSmall(it) {
  if (it.type !== 'img') return false;
  if (it.w && it.h) return Math.min(it.w, it.h) < state.minSize;
  return it.size > 0 && it.size < 8192;
}
function shown() {
  const t = state.type;
  return [...state.items.values()]
    .filter((d) => (t === 'all' || d.type === t || (t === 'vid' && (d.type === 'stream' || d.type === 'ytdl'))) && !(state.hideSmall && isSmall(d)))
    .sort((a, b) => (a.dom ?? 1e9) - (b.dom ?? 1e9) || a.seq - b.seq);
}
const LABEL = { vid: 'VIDEO', file: 'FILE', stream: 'LUỒNG', img: 'ẢNH', ytdl: 'VIDEO' };
const QUALITY = { best: 'cao nhất', 2160: 'tối đa 4K', 1080: 'tối đa 1080p', 720: 'tối đa 720p', 480: 'tối đa 480p', audio: 'chỉ âm thanh' };
function info(it) {
  if (it.type === 'stream') return 'Video dạng luồng · ' + QUALITY[state.videoQuality];
  if (it.type === 'ytdl') return 'Video của trang này · ' + QUALITY[state.videoQuality];
  const parts = [];
  if (it.w && it.h) parts.push(`${it.w}×${it.h}`);
  else if (it.type !== 'img') parts.push((/\.([a-z0-9]{2,5})$/i.exec(it.name) || [, LABEL[it.type]])[1].toUpperCase());
  if (it.size) parts.push(fmtSize(it.size));
  return parts.join(' · ') || 'Chưa rõ kích thước';
}
function makeEl(it) {
  const el = document.createElement('div');
  el.className = 'item';
  el.innerHTML = `<input type="checkbox" tabindex="-1"><div class="thumb ${it.type}"></div><div class="meta"><b></b><span></span></div>`;
  el.title = it.url;
  const th = el.querySelector('.thumb');
  if (it.type === 'img') {
    const img = new Image();
    img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.onload = () => { if (!it.w) { it.w = img.naturalWidth; it.h = img.naturalHeight; queueRender(); } };
    img.onerror = () => { th.textContent = LABEL.img; };
    img.src = it.url;
    th.appendChild(img);
  } else th.textContent = LABEL[it.type];
  el.onclick = (e) => toggle(it.url, e.shiftKey);
  return el;
}
function toggle(url, range) {
  const it = state.items.get(url);
  if (!it) return;
  const list = shown().map((d) => d.url);
  const on = !state.sel.has(url);
  const a = list.indexOf(state.lastClick), b = list.indexOf(url);
  if (range && a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) on ? state.sel.add(list[i]) : state.sel.delete(list[i]);
  else on ? state.sel.add(url) : state.sel.delete(url);
  state.lastClick = url;
  render();
}
let renderTimer = null;
function queueRender() { if (!renderTimer) renderTimer = setTimeout(render, 120); }
function render() {
  clearTimeout(renderTimer); renderTimer = null;
  const v = shown();
  const list = $('#list');
  const keep = new Set(v.map((d) => d.url));
  for (const [url, el] of els) if (!keep.has(url)) { el.remove(); els.delete(url); }
  let prev = null;
  for (const it of v) {
    let el = els.get(it.url);
    if (!el) { el = makeEl(it); els.set(it.url, el); }
    const on = state.sel.has(it.url);
    el.classList.toggle('sel', on);
    const cb = el.firstChild;
    cb.checked = on;
    const th = el.children[1];
    if (!th.classList.contains(it.type)) { th.className = 'thumb ' + it.type; if (it.type !== 'img') th.textContent = LABEL[it.type]; }
    const [b, s] = el.querySelectorAll('.meta > *');
    if (b.textContent !== it.name) b.textContent = it.name;
    const t = info(it);
    if (s.textContent !== t) s.textContent = t;
    const want = prev ? prev.nextSibling : list.firstChild;
    if (el !== want) list.insertBefore(el, want);
    prev = el;
  }
  const pick = v;
  const n = pick.filter((d) => state.sel.has(d.url)).length;
  $('#nCap').textContent = v.length;
  $('#selInfo').textContent = 'Đã chọn ' + n;
  $('#dl').disabled = !n;
  $('#dlText').textContent = n ? `Tải ${n} mục đã chọn` : 'Tải mục đã chọn';
  $('#all').checked = pick.length > 0 && n === pick.length;
  $('#all').disabled = !pick.length;
  $('#clearCap').disabled = !state.items.size;
  $('#fInfo').textContent = state.pageKey ? `Đã bắt ${state.items.size} link ở trang này` : 'Chưa mở trang nào';
  ink();
}
$('#all').onchange = (e) => {
  shown().forEach((d) => { e.target.checked ? state.sel.add(d.url) : state.sel.delete(d.url); });
  render();
};
$$('#chips .chip[data-t]').forEach((c) => c.onclick = () => {
  $$('#chips .chip[data-t]').forEach((x) => x.classList.remove('on'));
  c.classList.add('on'); state.type = c.dataset.t; render();
});
function syncSmall() {
  $('#hideSmall').classList.toggle('on', state.hideSmall);
  $('#hideSmall').textContent = `Ẩn ảnh nhỏ < ${state.minSize}px`;
}
$('#hideSmall').onclick = () => { state.hideSmall = !state.hideSmall; api.setSetting('hideSmall', state.hideSmall); syncSmall(); render(); };
$('#clearCap').onclick = clearCaptured;

$('#dl').onclick = async () => {
  const items = shown().filter((d) => state.sel.has(d.url))
    .map((d) => ({ url: d.url, type: d.type, mime: d.mime, ref: d.ref, name: d.type === 'img' ? '' : d.name }));
  if (!items.length) return;
  const page = view.hidden ? '' : view.getURL();
  await api.download({ title: state.title || fileName(page), pageUrl: page, items });
  items.forEach((i) => state.sel.delete(i.url));
  render();
  showTab('run');
  toast(`Bắt đầu tải ${items.length} mục`);
};

/* ---------- quét trang con (cấp 2, 3): mở ngầm từng trang ảnh để lấy ảnh lớn ---------- */
const deep = { run: 0, busy: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IMG_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const LAZY = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-url', 'data-cdn', 'data-echo'];
function absUrl(u, base) { try { const x = new URL(u, base); x.hash = ''; return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } }
// Link bọc ảnh thu nhỏ trong một trang -> danh sách trang con theo đúng thứ tự
function thumbLinks(doc, base) {
  const host = new URL(base).hostname, self = absUrl(base, base);
  const out = [], seen = new Set();
  doc.querySelectorAll('a[href]').forEach((a) => {
    if (!a.querySelector('img, [style*="url("]')) return;
    const u = absUrl(a.getAttribute('href'), base);
    if (!u || u === self || seen.has(u) || new URL(u).hostname !== host) return;
    seen.add(u); out.push(u);
  });
  return out;
}
// giữ nhóm link cùng kiểu đông nhất (bỏ logo, banner, link lẻ)
function mainGroup(out) {
  const kind = (u) => { const p = new URL(u).pathname.split('/').filter(Boolean); return IMG_EXT.test(u) ? 'img' : p.length + ':' + (p[0] || ''); };
  const groups = new Map();
  out.forEach((u) => groups.set(kind(u), (groups.get(kind(u)) || 0) + 1));
  const best = [...groups].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 3 ? out.filter((u) => kind(u) === best[0]) : out;
}
// Các trang 2, 3… của cùng một gallery
function pageLinks(doc, base) {
  const b = new URL(base), found = new Map();
  doc.querySelectorAll('a[href]').forEach((a) => {
    let u; try { u = new URL(a.getAttribute('href'), base); } catch { return; }
    if (u.origin !== b.origin || u.pathname !== b.pathname) return;
    for (const k of ['p', 'page', 'pg', 'trang']) {
      const n = u.searchParams.get(k);
      if (n && /^\d+$/.test(n)) { const f = found.get(k) || { max: 0, zero: false }; f.max = Math.max(f.max, +n); f.zero = f.zero || +n === 0; found.set(k, f); }
    }
  });
  const out = [];
  for (const [k, f] of found) {
    const cur = b.searchParams.get(k);
    if (cur) { const u = new URL(base); u.hash = ''; u.searchParams.delete(k); out.push({ n: -1, url: u.href }); }   // trang đầu (không có số trang)
    for (let n = f.zero ? 0 : 1; n <= Math.min(f.max, 80); n++) {
      if (String(n) === cur) continue;
      const u = new URL(base); u.hash = ''; u.searchParams.set(k, n); out.push({ n, url: u.href });
    }
    break;
  }
  return out;
}
// Ảnh chính của một trang con
function mainImage(doc, base) {
  let best = null;
  doc.querySelectorAll('img').forEach((img, i) => {
    let src = '';
    for (const a of LAZY) { const v = img.getAttribute(a); if (v && !v.startsWith('data:')) { src = v.trim(); break; } }
    src = absUrl(src || img.getAttribute('src') || '', base);
    if (!src) return;
    const style = img.getAttribute('style') || '';
    const w = parseInt(img.getAttribute('width') || (/width:\s*(\d+)px/.exec(style) || [])[1] || 0, 10) || 0;
    const h = parseInt(img.getAttribute('height') || (/height:\s*(\d+)px/.exec(style) || [])[1] || 0, 10) || 0;
    let score = (w * h) / 1000 - i * 0.01;
    if (/(^|[-_ ])(img|image|pic|page|comic|manga|chapter|main|content|full|reader)/i.test((img.id || '') + ' ' + (img.className || ''))) score += 1000;
    if (/logo|icon|avatar|banner|sprite|button|thumb|\/ads?[\/_.-]|\.svg(\?|$)/i.test(src)) score -= 2000;
    if (w && h && Math.min(w, h) < 200) score -= 2000;
    if (!best || score > best.score) best = { url: src, w, h, score };
  });
  return best && best.score > -1000 ? best : null;
}
function setDeepUi(text) {
  $('#deep').classList.toggle('busy', deep.busy);
  $('#deepText').textContent = deep.busy ? text : 'Quét trang con';
}
function stopDeep() { deep.run++; deep.busy = false; setDeepUi(); }
async function startDeep() {
  if (!state.ready || view.hidden) { toast('Hãy mở một trang web trước'); return; }
  const run = ++deep.run, base = view.getURL(), parser = new DOMParser();
  const alive = () => run === deep.run;
  deep.busy = true; setDeepUi('Đang đọc trang…');
  try {
    const html = await view.executeJavaScript('document.documentElement.outerHTML');
    const doc = parser.parseFromString(html, 'text/html');
    let subs = [];
    const seen = new Set();
    const take = (d, b) => thumbLinks(d, b).forEach((u) => { if (!seen.has(u) && subs.length < 3000) { seen.add(u); subs.push(u); } });
    const pages = pageLinks(doc, base);
    const curN = (() => { for (const k of ['p', 'page', 'pg', 'trang']) { const v = new URL(base).searchParams.get(k); if (v) return +v; } return -1; })();
    // gom link theo đúng thứ tự trang: các trang trước, trang hiện tại, các trang sau
    const before = pages.filter((p) => curN >= 0 && p.n < curN), after = pages.filter((p) => !(curN >= 0 && p.n < curN));
    const readPages = async (list) => {
      for (const p of list) {
        if (!alive()) return;
        setDeepUi('Dừng · đang đọc các trang của gallery');
        const r = await api.fetchHtml(p.url, base);
        if (r.ok) take(parser.parseFromString(r.text, 'text/html'), r.url);
        await sleep(350);
      }
    };
    await readPages(before);
    take(doc, base);
    await readPages(after);
    if (!alive()) return;
    subs = mainGroup(subs);
    if (!subs.length) { toast('Không thấy trang con nào có ảnh thu nhỏ ở trang này'); return; }

    const count = new Map();   // ảnh xuất hiện ở nhiều trang con = ảnh giao diện, bỏ
    let done = 0, found = 0, failed = 0, next = 0;
    const worker = async () => {
      while (alive() && next < subs.length) {
        const idx = next++, u = subs[idx];
        if (IMG_EXT.test(new URL(u).pathname)) { addItem({ url: u, type: 'img', dom: 100000 + idx, ref: base }); found++; }
        else {
          const r = await api.fetchHtml(u, base);
          if (!alive()) return;
          const m = r.ok ? mainImage(parser.parseFromString(r.text, 'text/html'), r.url) : null;
          if (m) {
            const c = (count.get(m.url) || 0) + 1; count.set(m.url, c);
            if (c === 1) { api.setReferers([[m.url, r.url]]); addItem({ url: m.url, type: 'img', w: m.w, h: m.h, dom: 100000 + idx, ref: r.url }); found++; }
            else if (c === 2) { state.items.delete(m.url); state.sel.delete(m.url); found--; queueRender(); }
          } else failed++;
          await sleep(300);
        }
        done++;
        setDeepUi(`Dừng · ${done}/${subs.length} trang`);
      }
    };
    await Promise.all([worker(), worker()]);
    if (alive()) toast(`Quét xong: lấy được ${found} ảnh từ ${subs.length} trang con` + (failed ? `, ${failed} trang không đọc được` : ''));
  } catch { if (alive()) toast('Không quét được trang này'); }
  finally { if (alive()) { deep.busy = false; setDeepUi(); } }
}
$('#deep').onclick = () => { if (deep.busy) { stopDeep(); toast('Đã dừng quét'); } else startDeep(); };

/* ---------- đang tải / đã xong ---------- */
const ICON = {
  pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>',
  retry: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
};
function eta(b) {
  if (!b.speed || !b.total) return '';
  const s = Math.round((b.total - b.got) / b.speed);
  return s > 90 ? ` · còn ${Math.round(s / 60)} phút` : ` · còn ${s} giây`;
}
function runText(b) {
  const multi = b.count > 1;
  const prog = multi ? `${b.done}/${b.count} ảnh · ${fmtSize(b.got) || '0 B'}`
    : (b.total ? `${fmtSize(b.got) || '0 B'} / ${fmtSize(b.total)}` : fmtSize(b.got) || 'Đang kết nối…');
  if (b.note && (b.state === 'error' || b.state === 'running')) return [b.state === 'error' ? 'err' : '', b.note];
  if (b.state === 'paused') return ['warn', 'Tạm dừng · ' + prog];
  if (b.state === 'error') return ['err', multi ? `Lỗi ${b.failed} ảnh · đã xong ${b.done}/${b.count}` : 'Tải lỗi · bấm để thử lại'];
  return ['', prog + (b.speed ? ` · ${fmtSize(b.speed)}/s` : '') + (multi ? '' : eta(b))];
}
const runEls = new Map();
function renderDownloads({ active, done }) {
  const list = $('#runList');
  const ids = new Set(active.map((b) => b.id));
  for (const [id, el] of runEls) if (!ids.has(id)) { el.remove(); runEls.delete(id); }
  for (const b of active) {
    let el = runEls.get(b.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `<div class="thumb ${b.isChapter ? 'ch' : 'file'}"></div><div class="meta"><b></b><span></span><div class="bar"><u></u></div></div>
        <button class="ibtn" data-a="main"></button><button class="ibtn" data-a="cancel" title="Huỷ" aria-label="Huỷ">${ICON.x}</button>`;
      el.title = b.file;
      el.querySelector('[data-a=cancel]').onclick = () => api.batchAction(b.id, 'cancel');
      el.querySelector('[data-a=main]').onclick = () => api.batchAction(b.id, el.dataset.act);
      runEls.set(b.id, el);
      list.appendChild(el);
    }
    el.querySelector('.thumb').textContent = b.isChapter ? b.count : (/\.([a-z0-9]{2,4})$/i.exec(b.title) || [, 'FILE'])[1].toUpperCase();
    el.querySelector('b').textContent = b.title;
    const [cls, text] = runText(b);
    const s = el.querySelector('.meta span');
    s.className = cls; s.textContent = text;
    s.title = b.detail || '';
    const frac = b.count > 1 ? b.done / b.count : (b.total ? b.got / b.total : 0);
    el.querySelector('u').style.transform = `scaleX(${Math.min(1, frac)})`;
    const act = b.state === 'paused' ? 'resume' : b.state === 'error' ? 'retry' : 'pause';
    if (el.dataset.act !== act) {
      el.dataset.act = act;
      const m = el.querySelector('[data-a=main]');
      m.innerHTML = act === 'pause' ? ICON.pause : act === 'resume' ? ICON.play : ICON.retry;
      m.title = act === 'pause' ? 'Tạm dừng' : act === 'resume' ? 'Tiếp tục' : 'Tải lại mục lỗi';
      m.setAttribute('aria-label', m.title);
    }
  }
  $('#nRun').textContent = active.length;
  updateProgress(active);

  const fin = $('#finList');
  const sig = done.map((d) => d.id + ':' + d.at).join(',');
  if (fin.dataset.sig !== sig) {
    if (fin.dataset.sig !== undefined && done.length && !(fin.dataset.sig || '').includes(done[0].id + ':' + done[0].at)) {
      if (done[0].popup) { /* đã có bảng riêng */ }
      else if (state.showDone || watch.id === done[0].id) showDone(done[0]);
      else toast('Tải xong: ' + done[0].title, { label: 'Mở thư mục', run: () => api.openPath(done[0].file) });
    }
    fin.dataset.sig = sig;
    fin.textContent = '';
    for (const d of done) {
      const el = document.createElement('div');
      el.className = 'item';
      el.title = d.file;
      el.innerHTML = `<div class="thumb ${d.isChapter ? 'ch' : 'file'}">${d.isChapter ? d.count : esc((/\.([a-z0-9]{2,4})$/i.exec(d.title) || [, 'FILE'])[1].toUpperCase())}</div>
        <div class="meta"><b>${esc(d.title)}</b><span class="done">Xong${d.isChapter ? ` · ${d.count} ảnh` : ''}${d.bytes ? ' · ' + fmtSize(d.bytes) : ''}</span></div>
        <button class="ibtn" title="Mở thư mục" aria-label="Mở thư mục">${ICON.folder}</button>`;
      el.querySelector('button').onclick = () => api.openPath(d.file);
      fin.appendChild(el);
    }
    $('#nFin').textContent = done.length;
    $('#clearDone').disabled = !done.length;
  }
  // mục đang theo dõi bị huỷ -> đóng bảng tiến trình
  if (watch.id !== null && watch.shown && $('#pDone').hidden && !active.some((b) => b.id === watch.id)) { $('#progDialog').hidden = true; watch.id = null; }
  ink();
}
$('#clearDone').onclick = () => api.clearDone();

/* ---------- tab ---------- */
function ink() {
  const t = $('.tab.on'), k = $('#ink');
  k.style.left = t.offsetLeft + 'px'; k.style.width = t.offsetWidth + 'px';
}
function showTab(id) {
  $$('.tab').forEach((x) => x.classList.toggle('on', x.dataset.p === id));
  $$('.pane').forEach((p) => p.classList.toggle('on', p.id === id));
  ink();
}
$$('.tab').forEach((t) => t.onclick = () => showTab(t.dataset.p));
addEventListener('resize', ink);

/* ---------- thư mục lưu ---------- */
function syncDir() {
  $('#fDir').textContent = 'Lưu vào: ' + state.saveDir;
  $('#sDir').textContent = state.saveDir;
  $('#sDir').title = state.saveDir;
}
async function pickDir() { state.saveDir = await api.pickSaveDir(); syncDir(); }
$('#pickDir').onclick = pickDir;
$('#sPick').onclick = pickDir;
$('#openDir').onclick = () => api.openSaveDir();
$('#fDir').onclick = () => api.openSaveDir();

/* ---------- hộp thoại ---------- */
function openModal(id) { $(id).hidden = false; const f = $(id + ' [data-close]'); if (f) f.focus(); }
function closeModals() { $$('.modal').forEach((m) => { m.hidden = true; }); }
$$('.modal').forEach((m) => {
  m.addEventListener('mousedown', (e) => { if (e.target === m) closeModal(m); });
  m.querySelector('[data-close]').onclick = () => closeModal(m);
});
function closeModal(m) {
  if (m.hidden) return;
  m.hidden = true;
  if (m.id === 'dlDialog') askLater();
  if (m.id === 'progDialog') watch.id = null;
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal').forEach(closeModal); });

/* ---------- bảng tải file: hiện khi bấm link tải trực tiếp (exe, zip…) ---------- */
const ask = { queue: [], cur: null, plan: null, dir: '' };
function askDownload(it) {
  if (ask.cur === it || ask.queue.includes(it)) return;
  ask.queue.push(it);
  if (!ask.cur) nextAsk();
}
async function nextAsk() {
  const it = ask.cur = ask.queue.shift() || null;
  if (!it) { $('#dlDialog').hidden = true; return; }
  ask.plan = await api.filePlan(it.name);
  ask.dir = ask.plan.dir;
  $('#dName').value = it.name;
  $('#dUrl').textContent = it.url; $('#dUrl').title = it.url;
  $('#dSize').textContent = fmtSize(it.size) || 'Chưa rõ kích thước';
  $('#dCat').textContent = ask.plan.label;
  $('#dDir').textContent = ask.dir; $('#dDir').title = ask.dir;
  $('#dRememberText').textContent = `Luôn lưu loại "${ask.plan.label}" vào thư mục này`;
  $('#dRemember').checked = false;
  $('#progDialog').hidden = true;
  $('#dlDialog').hidden = false;
  $('#dGo').focus();
}
function askLater() { if (ask.cur) { ask.cur = null; nextAsk(); } }
function dropAsked() { const it = ask.cur; if (it) { state.items.delete(it.url); state.sel.delete(it.url); queueRender(); } }
$('#dPick').onclick = async () => {
  const p = await api.pickDir(ask.dir);
  if (p) { ask.dir = p; $('#dDir').textContent = p; $('#dDir').title = p; $('#dRemember').checked = true; }
};
$('#dLater').onclick = () => { $('#dlDialog').hidden = true; showTab('cap'); askLater(); };
$('#dCancel').onclick = () => { dropAsked(); $('#dlDialog').hidden = true; askLater(); };
$('#dName').onkeydown = (e) => { if (e.key === 'Enter') $('#dGo').click(); };
$('#dGo').onclick = async () => {
  const it = ask.cur;
  if (!it) return;
  if ($('#dRemember').checked) renderCats(await api.setTypeDir(ask.plan.cat, ask.dir));
  const name = $('#dName').value.trim() || it.name;
  const ids = await api.download({ title: state.title, pageUrl: view.hidden ? '' : view.getURL(),
    items: [{ url: it.url, type: 'file', mime: it.mime, name, dir: ask.dir, ref: it.ref }] });
  dropAsked();
  $('#dlDialog').hidden = true;
  ask.cur = null;
  if (ask.queue.length) nextAsk(); else { watch.id = ids[0]; watch.shown = false; }
};

/* ---------- bảng tiến trình và bảng tải xong ---------- */
const watch = { id: null, shown: false, done: null };
function progMode(done) {
  $('#progDialog .dialog').classList.toggle('done', done);
  $('#pRun').hidden = done; $('#pDone').hidden = !done;
  $('#pTitle').textContent = done ? 'Tải xong' : 'Đang tải';
}
function updateProgress(active) {
  if (watch.id === null) return;
  const b = active.find((x) => x.id === watch.id);
  if (!b) return;
  if (!watch.shown) { watch.shown = true; watch.done = null; progMode(false); $('#progDialog').hidden = false; $('#pHide').focus(); }
  const [cls, text] = runText(b);
  $('#pName').textContent = b.title;
  $('#pInfo').textContent = text; $('#pInfo').parentNode.className = 'pinfo ' + cls;
  const frac = b.count > 1 ? b.done / b.count : (b.total ? b.got / b.total : 0);
  $('#pBar').style.transform = `scaleX(${Math.min(1, frac)})`;
  $('#pPct').textContent = frac ? Math.floor(frac * 100) + '%' : '';
  $('#pPath').textContent = b.file; $('#pPath').title = b.file;
  const act = b.state === 'paused' ? 'resume' : b.state === 'error' ? 'retry' : 'pause';
  $('#pPause').dataset.act = act;
  $('#pPause').textContent = act === 'pause' ? 'Tạm dừng' : act === 'resume' ? 'Tiếp tục' : 'Tải lại';
}
function showDone(d) {
  if (!$('#dlDialog').hidden) return;   // đang hỏi file khác thì không chen ngang
  watch.id = d.id; watch.shown = true; watch.done = d;
  progMode(true);
  $('#pName').textContent = d.title;
  $('#pBar').style.transform = 'scaleX(1)';
  $('#pInfo').textContent = 'Đã tải xong' + (d.isChapter ? ` · ${d.count} ảnh` : '') + (d.bytes ? ' · ' + fmtSize(d.bytes) : '');
  $('#pInfo').parentNode.className = 'pinfo';
  $('#pPct').textContent = '';
  $('#pPath').textContent = d.file; $('#pPath').title = d.file;
  $('#pOpen').hidden = d.isChapter;
  $('#progDialog').hidden = false;
  (d.isChapter ? $('#pFolder') : $('#pOpen')).focus();
}
const hideProg = () => closeModal($('#progDialog'));
$('#pHide').onclick = hideProg;
$('#pClose').onclick = hideProg;
$('#pPause').onclick = () => { if (watch.id !== null) api.batchAction(watch.id, $('#pPause').dataset.act); };
$('#pCancel').onclick = () => { if (watch.id !== null) api.batchAction(watch.id, 'cancel'); hideProg(); };
$('#pFolder').onclick = () => { if (watch.done) api.openPath(watch.done.file); hideProg(); };
$('#pOpen').onclick = () => { if (watch.done) api.openFile(watch.done.file); hideProg(); };

/* ---------- cài đặt: thư mục theo loại, chạy cùng Windows ---------- */
function renderCats(cats) {
  const box = $('#sCats');
  box.textContent = '';
  for (const c of cats) {
    const row = document.createElement('div');
    row.className = 'catrow';
    row.innerHTML = `<b>${esc(c.label)}</b><span class="path" title="${esc(c.dir)}">${esc(c.dir || 'Theo thư mục lưu')}</span><button class="second">Đổi…</button>` +
      (c.dir ? '<button class="second" title="Dùng lại thư mục lưu chung">Bỏ</button>' : '');
    const [pick, reset] = row.querySelectorAll('button');
    pick.onclick = async () => { const p = await api.pickDir(c.dir || state.saveDir); if (p) renderCats(await api.setTypeDir(c.cat, p)); };
    if (reset) reset.onclick = async () => renderCats(await api.setTypeDir(c.cat, null));
    box.appendChild(row);
  }
}
$('#sAuto').onchange = async (e) => { e.target.checked = await api.setAutoStart(e.target.checked); };
$('#sDone').onchange = (e) => { state.showDone = e.target.checked; api.setSetting('showDone', state.showDone); };
$('#settingsBtn').onclick = () => openModal('#settings');
$('#sMin').onchange = (e) => {
  state.minSize = Math.max(0, Math.min(4000, Number(e.target.value) || 0));
  e.target.value = state.minSize;
  api.setSetting('minSize', state.minSize); syncSmall(); render();
};
$('#sQuality').onchange = (e) => { state.videoQuality = e.target.value; api.setSetting('videoQuality', state.videoQuality); render(); };
function fmtDate(d) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; }
function showWhatsNew() {
  const w = state.whatsnew || { version: state.version };
  $('#wVer').textContent = `v${w.version}` + (w.date ? ' · ' + fmtDate(w.date) : '');
  const sec = (title, arr) => (arr && arr.length ? `<h3>${title}</h3><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  let html = sec('Mới', w.new) + sec('Cải thiện', w.improved) + sec('Sửa lỗi', w.fixed);
  const u = state.upd;
  if (['available', 'downloading', 'ready'].includes(u.state)) html += `<div class="newver"><span>Có bản mới v${esc(u.version || '')}</span><button class="second" id="wUpd">Cập nhật</button></div>`;
  $('#wBody').innerHTML = html;
  const b = $('#wUpd'); if (b) b.onclick = () => api.updateAction();
  $('#settings').hidden = true;
  openModal('#whatsnew');
}
$('#sNew').onclick = showWhatsNew;

/* ---------- cập nhật ---------- */
const UPD_TEXT = {
  idle: '', dev: 'Bản chạy thử, không kiểm tra cập nhật', checking: 'Đang kiểm tra…', latest: 'Đã là bản mới nhất',
  error: 'Không kiểm tra được, thử lại sau',
};
function renderUpdate(u) {
  const before = state.upd.state;
  state.upd = u;
  let text = UPD_TEXT[u.state] || '';
  if (u.state === 'available') text = `Có bản mới v${u.version}, bấm để tải`;
  if (u.state === 'downloading') text = `Đang tải bản mới… ${u.percent || 0}%`;
  if (u.state === 'ready') text = `Bản v${u.version} đã sẵn sàng, bấm để cài và mở lại`;
  const btn = $('#updBtn');
  btn.className = 'ibtn upd ' + (u.state === 'downloading' ? 'checking' : u.state);
  btn.title = 'Kiểm tra cập nhật' + (text ? ' · ' + text : '');
  $('#latest').hidden = u.state !== 'latest';
  $('#sUpdInfo').textContent = text;
  $('#sUpd').textContent = u.state === 'available' ? 'Tải bản mới' : u.state === 'ready' ? 'Cài và mở lại' : 'Kiểm tra cập nhật';
  $('#sUpd').disabled = u.state === 'dev' || u.state === 'checking' || u.state === 'downloading';
  if (u.state !== before) {
    if (u.state === 'available') toast(`Có bản mới v${u.version}`, { label: 'Cập nhật', run: () => api.updateAction() });
    if (u.state === 'ready') toast(`Bản v${u.version} đã tải xong`, { label: 'Cài và mở lại', run: () => api.updateAction() });
    if (u.state === 'latest' && before === 'checking' && userChecked) toast('Bạn đang dùng bản mới nhất');
    if (u.state === 'error' && userChecked) toast(UPD_TEXT.error);
  }
}
let userChecked = false;
function clickUpdate() {
  if (state.upd.state === 'dev') { toast(UPD_TEXT.dev); return; }
  userChecked = true;
  api.updateAction();
}
$('#updBtn').onclick = clickUpdate;
$('#sUpd').onclick = clickUpdate;

/* ---------- nối với phần lõi ---------- */
api.onCaptured(addItem);
api.onDownloads(renderDownloads);
api.onOpenUrl((url) => { document.querySelectorAll('.modal').forEach(closeModal); go(url); });
$('#sExt').onclick = async () => { await api.copyExtensionDir(); toast('Đã copy đường dẫn thư mục extension'); };
api.onUpdate(renderUpdate);
api.onPopup((url) => {
  let host = url; try { host = new URL(url).hostname; } catch { /* giữ nguyên */ }
  toast('Trang muốn mở trang khác: ' + host, { label: 'Mở', run: () => go(url) });
});
api.onShortcut((s) => {
  if (s === 'focus-address') { $('#addr').focus(); $('#addr').select(); }
  else if (s === 'open-folder') api.openSaveDir();
  else if (s === 'reload') $('#reload').click();
  else if (s === 'back') $('#back').click();
  else if (s === 'forward') $('#fwd').click();
});

(async function init() {
  const r = await api.init();
  state.version = r.version; state.whatsnew = r.whatsnew;
  state.saveDir = r.settings.saveDir; state.minSize = r.settings.minSize; state.hideSmall = r.settings.hideSmall;
  $('#sVer').textContent = 'M Download v' + r.version;
  $('#sMin').value = state.minSize;
  state.showDone = r.settings.showDone; $('#sDone').checked = state.showDone;
  $('#sAuto').checked = r.settings.autoStart;
  renderCats(r.cats);
  state.videoQuality = r.settings.videoQuality || '1080';
  $('#sQuality').value = state.videoQuality;
  syncDir(); syncSmall(); render();
  $('#addr').focus();
})();
