const APP = 'http://127.0.0.1:47615';
const $ = (s) => document.querySelector(s);
function status(ok, text) { $('#status').className = 'status ' + (ok ? 'ok' : 'bad'); $('#statusText').textContent = text; }

chrome.storage.local.get('on').then(({ on = true }) => { $('#on').checked = on; });
$('#on').onchange = (e) => chrome.storage.local.set({ on: e.target.checked });

async function check() {
  try {
    const r = await fetch(APP + '/ping', { signal: AbortSignal.timeout(1500) });
    const d = await r.json();
    status(true, 'Đã nối với M Download v' + d.version);
    chrome.action.setBadgeText({ text: '' });
  } catch { status(false, 'Chưa mở app M Download'); }
}
check();

$('#video').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || '')) { status(false, 'Trang này không có video để tải'); return; }
  const r = await chrome.runtime.sendMessage({ type: 'video-tab', url: tab.url, tabId: tab.id, title: tab.title }).catch(() => null);
  if (r && r.ok) window.close(); else status(false, 'Chưa mở app M Download');
};

$('#open').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || '')) { status(false, 'Trang này không mở được trong app'); return; }
  try {
    const r = await fetch(APP + '/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: tab.url }), signal: AbortSignal.timeout(2000) });
    if (!r.ok) throw 0;
    window.close();
  } catch { status(false, 'Chưa mở app M Download'); }
};
