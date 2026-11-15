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
// Tên file trình duyệt đã xác định; nếu không có đuôi thì để app tự lấy tên từ link
function baseName(p) { const n = String(p || '').split(/[\\/]/).pop(); return /\.[a-z0-9]{1,6}$/i.test(n) ? n : ''; }
function warn(on) {
  chrome.action.setBadgeBackgroundColor({ color: '#E5383B' });
  chrome.action.setBadgeText({ text: on ? '!' : '' });
  chrome.action.setTitle({ title: on ? 'M Download: chưa mở app M Download' : 'M Download' });
}
// Ẩn / hiện bảng tải của chính trình duyệt
function browserUi(show) { try { chrome.downloads.setUiOptions({ enabled: show }).catch(() => {}); } catch { /* trình duyệt cũ */ } }
async function syncUi() {
  if (!(await isOn())) return browserUi(true);
  try { const r = await fetch(APP + '/ping', { signal: AbortSignal.timeout(1500) }); browserUi(!r.ok); } catch { browserUi(true); }
}
chrome.runtime.onStartup.addListener(syncUi);
chrome.storage.onChanged.addListener((c) => { if (c.on) syncUi(); });
syncUi();

async function sendLink(url, extra = {}) {
  await post('/add', { url, cookie: await cookieHeader(url), ua: navigator.userAgent, ...extra });
  warn(false);
}

// Trình duyệt bắt đầu tải một file -> chuyển sang app; app không chạy thì để trình duyệt tải như thường
chrome.downloads.onCreated.addListener(async (created) => {
  if (created.state && created.state !== 'in_progress') return;
  if (!(await isOn())) return;
  await new Promise((r) => setTimeout(r, 300));          // chờ trình duyệt xác định tên file
  const [item = created] = await chrome.downloads.search({ id: created.id });
  const url = item.finalUrl || item.url;
  if (!/^https?:/.test(url)) return;
  try {
    await sendLink(url, { name: baseName(item.filename), size: item.fileSize > 0 ? item.fileSize : item.totalBytes > 0 ? item.totalBytes : 0, mime: item.mime || '', referrer: item.referrer || '' });
    await chrome.downloads.cancel(item.id).catch(() => {});
    chrome.downloads.erase({ id: item.id });
    browserUi(false);
  } catch { browserUi(true); /* app chưa mở: để trình duyệt tải và hiện bảng của nó */ }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'link', title: 'Tải link này bằng M Download', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'media', title: 'Tải ảnh / video này bằng M Download', contexts: ['image', 'video', 'audio'] });
  chrome.contextMenus.create({ id: 'page', title: 'Mở trang này trong M Download (bắt ảnh, video)', contexts: ['page'] });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'link') await sendLink(info.linkUrl, { referrer: info.pageUrl || '' });
    else if (info.menuItemId === 'media') await sendLink(info.srcUrl, { referrer: info.pageUrl || '' });
    else if (info.menuItemId === 'page') { await post('/open', { url: info.pageUrl || (tab && tab.url) }); warn(false); }
  } catch { warn(true); }
});
