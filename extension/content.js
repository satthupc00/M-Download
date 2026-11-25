// M Download: bắt cú bấm vào link tải file trước khi trình duyệt kịp tải (không thay đổi gì trên trang)
(() => {
  const EXT = /\.(zip|rar|7z|tar|gz|bz2|xz|exe|msi|apk|iso|dmg|bin|psd|psb|clip|ai|eps|blend|fbx|obj|spine|skel|atlas|epub|cbz|cbr|docx?|xlsx?|pptx?|ttf|otf|torrent)$/i;
  let ready = false;
  const st = { on: true, alive: false };
  const load = () => chrome.storage.local.get(['on', 'alive']).then((v) => { st.on = v.on !== false; st.alive = !!v.alive; ready = true; }).catch(() => {});
  load();
  chrome.storage.onChanged.addListener((c) => {
    if (c.on) st.on = c.on.newValue !== false;
    if (c.alive) st.alive = !!c.alive.newValue;
  });

  function linkOf(e) {
    for (const el of e.composedPath ? e.composedPath() : []) if (el && el.tagName === 'A' && el.href) return el;
    return null;
  }
  addEventListener('click', (e) => {
    if (!ready || !st.on || !st.alive) return;
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = linkOf(e);
    if (!a) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    const named = a.hasAttribute('download');
    if (!EXT.test(u.pathname) && !(named && EXT.test(a.getAttribute('download') || ''))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    chrome.runtime.sendMessage({ type: 'grab', url: u.href, name: a.getAttribute('download') || '', referrer: location.href }).catch(() => {
      location.href = u.href;    // extension vừa được nạp lại: để trình duyệt tự xử lý
    });
  }, true);
})();
