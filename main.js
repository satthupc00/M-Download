const { app, BrowserWindow, ipcMain, session, shell, dialog, Menu, net } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

const PARTITION = 'persist:browse';
const HEADER_H = 58;
const MAX_PARALLEL = 4;

let win = null;
let viewId = -1;          // webContents id của trình duyệt trong app
let pageUrl = '';         // trang đang xem (dùng làm Referer khi tải)
let ses = null;

/* ---------- cài đặt ---------- */
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { saveDir: '', minSize: 300, hideSmall: true, videoQuality: '1080', ytUpdated: 0, bounds: null, done: [] };
function loadSettings() {
  try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch { /* lần đầu mở */ }
  if (!settings.saveDir) settings.saveDir = path.join(app.getPath('downloads'), 'M-Download');
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch { /* bỏ qua */ }
  }, 300);
}

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

/* ---------- phân loại link ---------- */
const FILE_EXT = /\.(zip|rar|7z|tar|gz|pdf|psd|psb|clip|ai|eps|exe|msi|apk|iso|epub|cbz|cbr|docx?|xlsx?|pptx?|ttf|otf|blend|fbx|obj|spine|skel|atlas|torrent)$/i;
const MEDIA_EXT = /\.(mp4|webm|mkv|mov|m4v|avi|flv|mp3|m4a|ogg|wav|flac|aac)$/i;
function urlPathname(u) { try { return new URL(u).pathname; } catch { return ''; } }
function classify(d) {
  const h = {};
  for (const k in d.responseHeaders || {}) h[k.toLowerCase()] = String(d.responseHeaders[k][0] || '');
  const ct = (h['content-type'] || '').split(';')[0].trim().toLowerCase();
  const p = urlPathname(d.url);
  const size = parseInt(h['content-length'] || '0', 10) || 0;
  let type = null;
  try { if (/(^|\.)googlevideo\.com$/.test(new URL(d.url).hostname)) return null; } catch { return null; }  // mảnh video YouTube
  if (ct === 'video/mp2t' || /\.(ts|m4s)$/i.test(p)) return null;          // mảnh luồng, bỏ qua
  if (/mpegurl|dash\+xml/.test(ct) || /\.(m3u8|mpd)$/i.test(p)) type = 'stream';
  else if (ct.startsWith('video/') || ct.startsWith('audio/') || MEDIA_EXT.test(p)) type = 'vid';
  else if (d.resourceType === 'image' || ct.startsWith('image/')) type = 'img';
  else if (/attachment/i.test(h['content-disposition'] || '') || FILE_EXT.test(p)) type = 'file';
  if (!type) return null;
  if (type === 'img' && (ct === 'image/svg+xml' || /\.(svg|ico)$/i.test(p))) return null;
  return { url: d.url, type, size, mime: ct };
}

/* ---------- tải file ---------- */
const batches = [];        // {id,title,dir,isChapter,items:[{url,name,dest,state,got,total}],state,referer,ctrl:Set}
let nextId = 1;
let running = 0;
let dirty = false;
const referers = new Map();

const BAD = /[<>:"/\\|?*\u0000-\u001f]/g;
function cleanName(s, fallback) {
  s = String(s || '').replace(BAD, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = '_' + s;
  return s.slice(0, 120) || fallback;
}
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif',
  'image/bmp': '.bmp', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'application/zip': '.zip', 'application/pdf': '.pdf' };
function extOf(url, mime) {
  const m = /\.([a-z0-9]{2,5})$/i.exec(urlPathname(url));
  if (m) return '.' + m[1].toLowerCase();
  return MIME_EXT[mime] || '';
}
function uniquePath(p) {
  if (!fs.existsSync(p) && !fs.existsSync(p + '.part')) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 2; ; i++) {
    const q = path.join(dir, `${name} (${i})${ext}`);
    if (!fs.existsSync(q) && !fs.existsSync(q + '.part')) return q;
  }
}
function uniqueDir(p) {
  const used = (d) => fs.existsSync(d) && fs.readdirSync(d).length > 0;
  if (!used(p)) return p;
  for (let i = 2; ; i++) if (!used(`${p} (${i})`)) return `${p} (${i})`;
}

function summary(b) {
  const done = b.items.filter((i) => i.state === 'done').length;
  const failed = b.items.filter((i) => i.state === 'error').length;
  return {
    id: b.id, title: b.title, dir: b.dir, isChapter: b.isChapter, state: b.state, count: b.items.length, done, failed,
    got: b.items.reduce((s, i) => s + i.got, 0), total: b.items.reduce((s, i) => s + (i.total || 0), 0),
    speed: b.speed || 0, note: b.note || '', kind: b.kind || 'file', file: b.items.length === 1 ? b.items[0].dest : b.dir,
  };
}
function pushState() {
  dirty = false;
  send('downloads', { active: batches.map(summary), done: settings.done });
}
setInterval(() => {
  for (const b of batches) {
    const got = b.items.reduce((s, i) => s + i.got, 0);
    b.speed = b.state === 'running' ? Math.max(0, (got - (b.lastGot ?? got)) * 2) : 0;
    b.lastGot = got;
    if (b.state === 'running') dirty = true;
  }
  if (dirty) pushState();
}, 500);

function finishIfDone(b) {
  if (b.state !== 'running') return;
  if (b.items.some((i) => i.state === 'queued' || i.state === 'running')) return;
  const failed = b.items.filter((i) => i.state === 'error').length;
  if (failed) { b.state = 'error'; return; }
  batches.splice(batches.indexOf(b), 1);
  settings.done.unshift({ id: b.id, title: b.title, count: b.items.length, isChapter: b.isChapter,
    bytes: b.items.reduce((s, i) => s + i.got, 0), file: b.items.length === 1 ? b.items[0].dest : b.dir, at: Date.now() });
  settings.done = settings.done.slice(0, 60);
  saveSettings();
}

async function runItem(b, it) {
  const part = it.dest + '.part';
  const ctrl = new AbortController();
  b.ctrl.add(ctrl);
  try {
    let have = 0;
    try { have = fs.statSync(part).size; } catch { /* chưa có */ }
    referers.set(it.url, it.ref || b.referer);
    const res = await ses.fetch(it.url, { signal: ctrl.signal, headers: have ? { Range: `bytes=${have}-` } : {} });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const append = have > 0 && res.status === 206;
    if (!append) have = 0;
    const len = parseInt(res.headers.get('content-length') || '0', 10) || 0;
    it.got = have;
    it.total = len ? len + have : 0;
    if (it.needExt) {
      const ext = MIME_EXT[(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()];
      if (ext) it.finalDest = it.dest + ext;
    }
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(part, { flags: append ? 'a' : 'w' });
      const src = Readable.fromWeb(res.body);
      src.on('data', (c) => { it.got += c.length; });
      src.on('error', (e) => { out.destroy(); reject(e); }); out.on('error', reject); out.on('finish', resolve);
      src.pipe(out);
    });
    const final = it.finalDest || it.dest;
    fs.renameSync(part, final);
    it.dest = final;
    it.state = 'done';
  } catch (e) {
    if (it.state === 'running') it.state = ctrl.signal.aborted ? 'queued' : 'error';
  } finally {
    b.ctrl.delete(ctrl);
    running--;
    finishIfDone(b);
    dirty = true;
    pump();
  }
}
function pump() {
  for (const b of batches) {
    if (b.state !== 'running') continue;
    if (b.kind === 'ytdl') { if (!b.proc && !b.starting && b.items[0].state === 'queued') startYtdl(b); continue; }
    for (const it of b.items) {
      if (running >= MAX_PARALLEL) return;
      if (it.state !== 'queued') continue;
      it.state = 'running';
      running++;
      runItem(b, it);
    }
  }
}

/* ---------- tải video bằng yt-dlp (YouTube, video dạng luồng…) ---------- */
const isWin = process.platform === 'win32';
const toolsDir = () => path.join(app.getPath('userData'), 'tools');
const ytPath = () => path.join(toolsDir(), isWin ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux');
const ffPath = () => path.join(toolsDir(), 'ffmpeg.exe');
const YT_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const FF_URL = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

async function fetchToFile(url, dest, onProgress) {
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
  const total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
  let got = 0;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest + '.tmp');
    const src = Readable.fromWeb(res.body);
    src.on('data', (c) => { got += c.length; if (total) onProgress(Math.round((got / total) * 100)); });
    src.on('error', (e) => { out.destroy(); reject(e); }); out.on('error', reject); out.on('finish', resolve);
    src.pipe(out);
  });
  fs.renameSync(dest + '.tmp', dest);
}
function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findFile(p, name); if (r) return r; } else if (e.name.toLowerCase() === name) return p;
  }
  return null;
}
let toolsJob = null;
function ensureTools(onNote) {
  if (!toolsJob) {
    toolsJob = (async () => {
      fs.mkdirSync(toolsDir(), { recursive: true });
      if (!fs.existsSync(ytPath())) {
        await fetchToFile(YT_URL + path.basename(ytPath()), ytPath(), (p) => onNote(`Đang tải công cụ video (chỉ lần đầu)… ${p}%`));
        if (!isWin) fs.chmodSync(ytPath(), 0o755);
        settings.ytUpdated = Date.now(); saveSettings();
      }
      if (isWin && !fs.existsSync(ffPath())) {
        try {   // ffmpeg để ghép hình + tiếng (cần cho 1080p trở lên)
          const zip = path.join(toolsDir(), 'ffmpeg.zip'), tmp = path.join(toolsDir(), 'ffmpeg-tmp');
          await fetchToFile(FF_URL, zip, (p) => onNote(`Đang tải bộ ghép video (chỉ lần đầu)… ${p}%`));
          onNote('Đang giải nén bộ ghép video…');
          fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
          await new Promise((res, rej) => execFile('tar', ['-xf', zip, '-C', tmp], { windowsHide: true }, (e) => (e ? rej(e) : res())));
          const exe = findFile(tmp, 'ffmpeg.exe');
          if (exe) fs.copyFileSync(exe, ffPath());
          fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(zip, { force: true });
        } catch { /* không có ffmpeg: vẫn tải được nhưng chất lượng thấp hơn */ }
      }
      return { yt: ytPath(), ff: isWin ? (fs.existsSync(ffPath()) ? toolsDir() : null) : 'system' };
    })().finally(() => { toolsJob = null; });
  }
  return toolsJob;
}
function updateYtdlp() {
  if (!fs.existsSync(ytPath()) || Date.now() - (settings.ytUpdated || 0) < 3 * 864e5) return;
  settings.ytUpdated = Date.now(); saveSettings();
  execFile(ytPath(), ['-U'], { windowsHide: true }, () => {});
}
function killProc(b) {
  if (!b.proc) return;
  if (isWin) execFile('taskkill', ['/pid', String(b.proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else b.proc.kill();
}
function ytError(text) {
  if (/Sign in|age|confirm you.re not a bot|login/i.test(text)) return 'Video cần đăng nhập hoặc bị giới hạn, không tải được';
  if (/Unsupported URL/i.test(text)) return 'Trang này chưa được hỗ trợ tải video';
  if (/Private video|unavailable|removed/i.test(text)) return 'Video không còn hoặc ở chế độ riêng tư';
  if (/DRM/i.test(text)) return 'Video có khoá bản quyền, không tải được';
  return 'Tải video lỗi · bấm để thử lại';
}
async function startYtdl(b) {
  const it = b.items[0];
  b.starting = true; it.state = 'running'; b.note = 'Đang chuẩn bị…'; dirty = true;
  try {
    const t = await ensureTools((n) => { b.note = n; dirty = true; });
    if (b.state !== 'running') { it.state = 'queued'; return; }
    b.note = 'Đang lấy thông tin video…'; dirty = true;
    const q = b.quality, h = /^\d+$/.test(q) ? `[height<=${q}]` : '';
    const fmt = q === 'audio' ? 'ba[ext=m4a]/ba/b' : t.ff ? `bv*${h}+ba/b${h}/b` : `b${h}/b`;
    const name = b.stream ? b.title.replace(/%/g, '%%') + '.%(ext)s' : '%(title).120s.%(ext)s';
    const args = ['-f', fmt, '-o', path.join(b.dir, name), '--no-playlist', '--newline', '--progress', '--no-warnings', '--windows-filenames',
      '--no-mtime', '--encoding', 'utf-8', '--print', 'after_move:MDLFILE|%(filepath)s',
      '--progress-template', 'download:MDL|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s'];
    if (q !== 'audio') args.push('--merge-output-format', 'mp4');
    if (t.ff && t.ff !== 'system') args.push('--ffmpeg-location', t.ff);
    if (b.stream && b.referer) args.push('--referer', b.referer);
    args.push(it.url);
    const proc = spawn(t.yt, args, { windowsHide: true });
    b.proc = proc;
    let buf = '', err = '';
    proc.stdout.on('data', (c) => {
      buf += c.toString('utf8');
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const l of lines) {
        if (l.startsWith('MDL|')) {
          const [, g, tot, est] = l.split('|');
          it.got = parseInt(g, 10) || 0; it.total = parseInt(tot, 10) || parseInt(est, 10) || 0; b.note = '';
        } else if (l.startsWith('MDLFILE|')) { it.dest = l.slice(8).trim(); b.title = path.basename(it.dest); }
      }
    });
    proc.stderr.on('data', (c) => { err = (err + c.toString('utf8')).slice(-2000); });
    proc.on('error', () => { err = err || 'spawn'; });
    proc.on('close', (code) => {
      b.proc = null;
      if (b.state === 'running') {
        if (code === 0) { it.state = 'done'; try { it.got = fs.statSync(it.dest).size; } catch { /* giữ số cũ */ } b.note = ''; }
        else { it.state = 'error'; b.note = ytError(err); }
      } else it.state = 'queued';
      finishIfDone(b); dirty = true; pump();
    });
  } catch {
    it.state = 'error'; b.note = 'Không tải được công cụ video, kiểm tra mạng rồi thử lại';
    finishIfDone(b);
  } finally { b.starting = false; dirty = true; }
}

function startDownload(req) {
  // req: {title, pageUrl, items:[{url,type,mime}]}
  const root = settings.saveDir;
  const out = [];
  const imgs = req.items.filter((i) => i.type === 'img');
  const videos = req.items.filter((i) => i.type === 'ytdl' || i.type === 'stream');
  const others = req.items.filter((i) => i.type === 'vid' || i.type === 'file');
  if (imgs.length) {
    const title = cleanName(req.title, 'Trang không tên');
    const dir = uniqueDir(path.join(root, title));
    fs.mkdirSync(dir, { recursive: true });
    const pad = Math.max(3, String(imgs.length).length);
    out.push({
      id: nextId++, title: path.basename(dir), dir, isChapter: true, state: 'running', referer: req.pageUrl, ctrl: new Set(),
      items: imgs.map((i, n) => {
        const ext = extOf(i.url, i.mime);
        return { url: i.url, ref: i.ref, dest: path.join(dir, String(n + 1).padStart(pad, '0') + ext), needExt: !ext, state: 'queued', got: 0, total: 0 };
      }),
    });
  }
  for (const i of others) {
    fs.mkdirSync(root, { recursive: true });
    let name = '';
    try { name = decodeURIComponent(path.basename(urlPathname(i.url))); } catch { name = path.basename(urlPathname(i.url)); }
    name = cleanName(i.name || name, 'file');
    if (!path.extname(name)) name += extOf(i.url, i.mime);
    const dest = uniquePath(path.join(root, name));
    out.push({ id: nextId++, title: path.basename(dest), dir: root, isChapter: false, state: 'running', referer: req.pageUrl, ctrl: new Set(),
      items: [{ url: i.url, dest, state: 'queued', got: 0, total: 0 }] });
  }
  for (const i of videos) {
    fs.mkdirSync(root, { recursive: true });
    out.push({ id: nextId++, kind: 'ytdl', title: cleanName(req.title, 'Video'), dir: root, isChapter: false, state: 'running', referer: req.pageUrl,
      ctrl: new Set(), stream: i.type === 'stream', quality: settings.videoQuality,
      items: [{ url: i.url, dest: root, state: 'queued', got: 0, total: 0 }] });
  }
  batches.push(...out);
  pushState();
  pump();
  return out.length;
}

function batchAction({ id, action }) {
  const b = batches.find((x) => x.id === id);
  if (!b) return;
  if (action === 'pause' && b.state === 'running') {
    b.state = 'paused';
    for (const c of b.ctrl) c.abort();
    killProc(b);
  } else if (action === 'resume' && b.state === 'paused') {
    b.state = 'running';
  } else if (action === 'retry' && b.state === 'error') {
    for (const it of b.items) if (it.state === 'error') it.state = 'queued';
    b.note = '';
    b.state = 'running';
  } else if (action === 'cancel') {
    b.state = 'cancelled';
    for (const c of b.ctrl) c.abort();
    killProc(b);
    batches.splice(batches.indexOf(b), 1);
    setTimeout(() => {
      for (const it of b.items) if (it.state !== 'done') fs.rm(it.dest + '.part', { force: true }, () => {});
    }, 400);
  }
  pushState();
  pump();
}

/* ---------- cập nhật ---------- */
let updater = null;
let updState = { state: 'idle' };
function setUpd(s) { updState = s; send('update', s); }
function setupUpdater() {
  if (!app.isPackaged) { setUpd({ state: 'dev' }); return; }
  updater = require('electron-updater').autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => setUpd({ state: 'checking' }));
  updater.on('update-available', (i) => setUpd({ state: 'available', version: i.version }));
  updater.on('update-not-available', () => setUpd({ state: 'latest' }));
  updater.on('download-progress', (p) => setUpd({ state: 'downloading', percent: Math.round(p.percent), version: updState.version }));
  updater.on('update-downloaded', (i) => setUpd({ state: 'ready', version: i.version }));
  updater.on('error', () => setUpd({ state: 'error' }));
  updater.checkForUpdates().catch(() => {});
}
function updateAction() {
  if (!updater) return;
  if (updState.state === 'available') updater.downloadUpdate().catch(() => setUpd({ state: 'error' }));
  else if (updState.state === 'ready') updater.quitAndInstall();
  else if (updState.state !== 'checking' && updState.state !== 'downloading') updater.checkForUpdates().catch(() => {});
}

/* ---------- cửa sổ ---------- */
function shortcut(input) {
  if (input.type !== 'keyDown') return null;
  const k = input.key.toLowerCase();
  if (input.control && k === 'l') return 'focus-address';
  if (input.control && k === 'j') return 'open-folder';
  if (k === 'f5' || (input.control && k === 'r')) return 'reload';
  if (input.alt && k === 'arrowleft') return 'back';
  if (input.alt && k === 'arrowright') return 'forward';
  return null;
}
function hookShortcuts(wc) {
  wc.on('before-input-event', (e, input) => {
    const s = shortcut(input);
    if (s) { e.preventDefault(); send('shortcut', s); }
  });
}

function createWindow() {
  ses = session.fromPartition(PARTITION);

  // Gắn Referer cho ảnh xem trước và file tải (nhiều trang chặn tải nếu thiếu)
  ses.webRequest.onBeforeSendHeaders((d, cb) => {
    const h = d.requestHeaders;
    if (d.webContentsId !== viewId && /^https?:/.test(d.url) && !h.Referer && !h.referer) {
      const ref = referers.get(d.url) || pageUrl;
      if (ref) h.Referer = ref;
    }
    cb({ requestHeaders: h });
  });
  // Ghi lại link trang web tải về (chỉ ghi, không tải)
  ses.webRequest.onCompleted((d) => {
    if (d.webContentsId !== viewId || d.statusCode >= 400 || !/^https?:/.test(d.url)) return;
    const c = classify(d);
    if (c) send('captured', c);
  });
  // Trang web tự bật tải file -> chặn lại, chỉ đưa vào danh sách
  ses.on('will-download', (e, item) => {
    e.preventDefault();
    send('captured', { url: item.getURL(), type: 'file', size: item.getTotalBytes(), mime: item.getMimeType(), name: item.getFilename(), wanted: true });
  });

  const b = settings.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 780, x: b.x, y: b.y, minWidth: 860, minHeight: 520,
    title: 'M-Download', backgroundColor: '#1F2126', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1F2126', symbolColor: '#FFFFFF', height: HEADER_H },
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), partition: PARTITION, webviewTag: true, contextIsolation: true, nodeIntegration: false },
  });
  if (b.max) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  hookShortcuts(win.webContents);

  const keep = () => {
    if (win.isMinimized()) return;
    settings.bounds = { ...(win.isMaximized() ? settings.bounds : win.getBounds()), max: win.isMaximized() };
    saveSettings();
  };
  win.on('resize', keep); win.on('move', keep);

  win.webContents.on('will-attach-webview', (_e, prefs) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
  });
  win.webContents.on('did-attach-webview', (_e, wc) => {
    viewId = wc.id;
    hookShortcuts(wc);
    // Không cho trang tự mở cửa sổ mới (quảng cáo); báo để người dùng tự quyết định
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) send('popup', url);
      return { action: 'deny' };
    });
  });
  win.on('closed', () => { win = null; });
}

/* ---------- IPC ---------- */
ipcMain.handle('init', () => {
  let whatsnew = null;
  try { whatsnew = JSON.parse(fs.readFileSync(path.join(__dirname, 'whatsnew.json'), 'utf8')); } catch { /* thiếu file */ }
  setTimeout(() => { send('update', updState); pushState(); }, 0);
  return { version: app.getVersion(), settings: { saveDir: settings.saveDir, minSize: settings.minSize, hideSmall: settings.hideSmall, videoQuality: settings.videoQuality }, whatsnew };
});
ipcMain.on('set-page', (_e, url) => { pageUrl = String(url || ''); });
ipcMain.handle('download', (_e, req) => startDownload(req));
ipcMain.on('batch-action', (_e, a) => batchAction(a));
ipcMain.on('clear-done', () => { settings.done = []; saveSettings(); pushState(); });
ipcMain.on('open-path', (_e, p) => {
  if (typeof p !== 'string' || !fs.existsSync(p)) return;
  if (fs.statSync(p).isDirectory()) shell.openPath(p); else shell.showItemInFolder(p);
});
ipcMain.on('open-save-dir', () => { fs.mkdirSync(settings.saveDir, { recursive: true }); shell.openPath(settings.saveDir); });
ipcMain.handle('pick-save-dir', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Chọn thư mục lưu', defaultPath: settings.saveDir, properties: ['openDirectory', 'createDirectory'] });
  if (!r.canceled && r.filePaths[0]) { settings.saveDir = r.filePaths[0]; saveSettings(); }
  return settings.saveDir;
});
ipcMain.on('set-setting', (_e, { key, value }) => {
  if (key === 'minSize') settings.minSize = Math.max(0, Math.min(4000, Number(value) || 0));
  else if (key === 'hideSmall') settings.hideSmall = !!value;
  else if (key === 'videoQuality' && ['best', '2160', '1080', '720', '480', 'audio'].includes(value)) settings.videoQuality = value;
  else return;
  saveSettings();
});
ipcMain.on('update-action', updateAction);
ipcMain.on('set-referers', (_e, list) => { if (Array.isArray(list)) for (const [u, r] of list) referers.set(String(u), String(r)); });
// Đọc mã trang con (dùng phiên đăng nhập của trình duyệt trong app)
ipcMain.handle('fetch-html', async (_e, { url, referer }) => {
  try {
    if (!/^https?:/.test(url)) return { ok: false };
    if (referer) referers.set(url, referer);
    const res = await ses.fetch(url);
    if (!res.ok) return { ok: false, status: res.status };
    if (!/html|xml|text/i.test(res.headers.get('content-type') || 'text/html')) return { ok: false };
    return { ok: true, url: res.url || url, text: (await res.text()).slice(0, 4e6) };
  } catch { return { ok: false }; }
});

/* ---------- khởi động ---------- */
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    loadSettings();
    createWindow();
    win.webContents.once('did-finish-load', setupUpdater);
    setTimeout(updateYtdlp, 8000);
  });
  app.on('window-all-closed', () => app.quit());
}
