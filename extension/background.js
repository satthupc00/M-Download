// M Download: gửi link tải từ trình duyệt sang app M Download đang chạy trên máy này.
const APP = 'http://127.0.0.1:47615';

async function post(path, body) {
  const r = await fetch(APP + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(2000),
  });
  if (!r.ok) throw new Error('app');
  return r.json();
}
async function isOn() { const { on = true } = await chrome.storage.local.get('on'); return on; }
async function cookieHeader(url) {
  try { return (await chrome.cookies.getAll({ url })).map((c) => `${c.name}=${c.value}`).join('; '); } catch { return ''; }
}
// Tên file trình duyệt đã xác định; nếu không có đuôi thì để app tự hỏi máy chủ
function baseName(p) { const n = String(p || '').split(/[\\/]/).pop(); return /\.[a-z0-9]{1,6}$/i.test(n) ? n : ''; }
function warn(on) {
  chrome.action.setBadgeBackgroundColor({ color: '#E5383B' });
  chrome.action.setBadgeText({ text: on ? '!' : '' });
  chrome.action.setTitle({ title: on ? 'M Download: chưa mở app M Download' : 'M Download' });
}

/* ---------- app có đang chạy không: kiểm tra định kỳ, tắt sẵn bảng tải của trình duyệt ---------- */
let alive = false;
function browserUi(show) { try { chrome.downloads.setUiOptions({ enabled: show }).catch(() => {}); } catch { /* trình duyệt cũ */ } }
async function setAlive(v) {
  alive = v;
  const on = await isOn();
  browserUi(!(on && v));                       // app chạy + công tắc bật -> ẩn bảng tải của trình duyệt
  chrome.storage.local.set({ alive: v });      // trang web đọc để biết có nên chặn cú bấm hay không
}
async function syncUi() {
  try { const r = await fetch(APP + '/ping', { signal: AbortSignal.timeout(1500) }); await setAlive(r.ok); } catch { await setAlive(false); }
}
chrome.alarms.create('ping', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'ping') syncUi(); });
chrome.runtime.onStartup.addListener(syncUi);
chrome.storage.onChanged.addListener((c) => { if (c.on) syncUi(); });
syncUi();

async function sendLink(url, extra = {}) {
  await post('/add', { url, cookie: await cookieHeader(url), ua: navigator.userAgent, ...extra });
  warn(false);
  if (!alive) setAlive(true);
}

/* ---------- 1. cú bấm vào link tải trong trang (chặn trước khi trình duyệt kịp tải) ---------- */
const passthrough = new Set();   // link để trình duyệt tự tải khi app không chạy
chrome.runtime.onMessage.addListener((m, sender) => {
  if (!m || m.type !== 'grab' || !/^https?:/.test(m.url || '')) return;
  sendLink(m.url, { name: baseName(m.name), referrer: m.referrer || (sender.tab && sender.tab.url) || '' })
    .catch(() => {               // app vừa tắt: trả lại cho trình duyệt tải như thường
      setAlive(false);
      passthrough.add(m.url);
      chrome.downloads.download({ url: m.url }).catch(() => passthrough.delete(m.url));
    });
});

/* ---------- 2. lượt tải không bắt được từ cú bấm (chuyển hướng, nút JavaScript…) ---------- */
chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url;
  if (passthrough.delete(item.url) || passthrough.delete(url)) return;
  if (item.state && item.state !== 'in_progress') return;
  if (!/^https?:/.test(url) || !(await isOn())) return;
  if (!alive) await syncUi();
  if (!alive) return;            // app không chạy: để trình duyệt tải và hiện bảng của nó
  chrome.downloads.cancel(item.id).then(() => chrome.downloads.erase({ id: item.id })).catch(() => {});
  try {
    await sendLink(url, { name: baseName(item.filename), size: item.totalBytes > 0 ? item.totalBytes : 0, mime: item.mime || '', referrer: item.referrer || '' });
  } catch {
    setAlive(false);
    passthrough.add(url);
    chrome.downloads.download({ url }).catch(() => passthrough.delete(url));
  }
});

/* ---------- ghi lại luồng video trang đang phát (m3u8, mpd) để tải bằng chuột phải ---------- */
const STREAM = /\.(m3u8|mpd)(\?|$)/i;
async function streamsOf(tabId) { const k = 's' + tabId; return (await chrome.storage.session.get(k))[k] || []; }
chrome.webRequest.onResponseStarted.addListener((d) => {
  if (d.tabId < 0) return;
  const ct = ((d.responseHeaders || []).find((h) => h.name.toLowerCase() === 'content-type') || {}).value || '';
  if (!STREAM.test(new URL(d.url).pathname + '?') && !/mpegurl|dash\+xml/i.test(ct)) return;
  const k = 's' + d.tabId;
  chrome.storage.session.get(k).then((v) => {
    const list = v[k] || [];
    if (list.includes(d.url)) return;
    list.push(d.url);
    chrome.storage.session.set({ [k]: list.slice(0, 30) });   // luồng đầu tiên thường là danh sách chính (có đủ chất lượng)
  });
}, { urls: ['http://*/*', 'https://*/*'], types: ['xmlhttprequest', 'media', 'other'] }, ['responseHeaders']);
chrome.tabs.onUpdated.addListener((tabId, c) => { if (c.url) chrome.storage.session.remove('s' + tabId); });
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove('s' + tabId));

// Gửi video sang app: link file thẳng -> tải như file; luồng đã ghi lại -> tải luồng; còn lại -> để app tự tìm video trên trang
const DIRECT = /\.(mp4|webm|mkv|mov|m4v|avi|flv|mp3|m4a|ogg|wav|flac|aac)(\?|$)/i;
async function sendVideo({ src = '', page = '', tabId = -1, title = '' }) {
  if (/^https?:/.test(src) && !STREAM.test(src) && DIRECT.test(new URL(src).pathname + '?')) return sendLink(src, { referrer: page });
  let url = page, kind = 'page';
  if (/^https?:/.test(src) && STREAM.test(new URL(src).pathname + '?')) { url = src; kind = 'stream'; }
  else if (tabId >= 0) { const s = await streamsOf(tabId); if (s.length) { url = s[0]; kind = 'stream'; } }
  if (!/^https?:/.test(url)) throw new Error('no-url');
  let cookies = [];
  try { cookies = (await chrome.cookies.getAll({ url: page || url })).concat(kind === 'stream' ? await chrome.cookies.getAll({ url }) : []); } catch { /* bỏ qua */ }
  await post('/video', { url, kind, title, page, referrer: page, ua: navigator.userAgent,
    cookies: cookies.map((c) => ({ domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate, name: c.name, value: c.value })) });
  warn(false);
  if (!alive) setAlive(true);
}

/* ---------- menu chuột phải ---------- */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'video', title: 'Tải video này bằng M Download', contexts: ['video', 'audio'] });
    chrome.contextMenus.create({ id: 'pagevideo', title: 'Tải video trên trang này bằng M Download', contexts: ['page', 'frame'] });
    chrome.contextMenus.create({ id: 'linkvideo', title: 'Tải video ở link này bằng M Download', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'link', title: 'Tải link này bằng M Download', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'image', title: 'Tải ảnh này bằng M Download', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'page', title: 'Mở trang này trong M Download (bắt ảnh, video)', contexts: ['page'] });
  });
});
async function handleMenu(info, tab) {
  const page = info.pageUrl || (tab && tab.url) || '', tabId = tab ? tab.id : -1, title = (tab && tab.title) || '';
  try {
    if (info.menuItemId === 'video') await sendVideo({ src: info.srcUrl || '', page, tabId, title });
    else if (info.menuItemId === 'pagevideo') await sendVideo({ page, tabId, title });
    else if (info.menuItemId === 'linkvideo') await sendVideo({ page: info.linkUrl, title: info.selectionText || '' });
    else if (info.menuItemId === 'link') await sendLink(info.linkUrl, { referrer: page });
    else if (info.menuItemId === 'image') await sendLink(info.srcUrl, { referrer: page });
    else if (info.menuItemId === 'page') { await post('/open', { url: page }); warn(false); }
  } catch { warn(true); }
}
chrome.contextMenus.onClicked.addListener(handleMenu);
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (!m || m.type !== 'video-tab') return;
  sendVideo({ page: m.url, tabId: m.tabId, title: m.title }).then(() => reply({ ok: true }), () => reply({ ok: false }));
  return true;
});
