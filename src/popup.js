/* M Download · bảng tải nhỏ (hỏi nơi lưu -> tiến trình -> tải xong) */
const $ = (s) => document.querySelector(s);
function fmtSize(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 1 : 0).replace('.', ',') : n) + ' ' + u[i];
}
function eta(b) {
  if (!b.speed || !b.total) return '';
  const s = Math.round((b.total - b.got) / b.speed);
  return s > 90 ? ` · còn ${Math.round(s / 60)} phút` : ` · còn ${s} giây`;
}
const st = { info: null, plan: null, dir: '', id: null, done: null, showDone: true, seen: false, video: false };
const title = (t) => { $('#ptitle').textContent = '· ' + t; };

function showAsk() {
  const it = st.info;
  title(st.video ? 'Tải video' : 'Tải file');
  document.querySelectorAll('.fileRow').forEach((e) => { e.hidden = st.video; });
  document.querySelectorAll('.vidRow').forEach((e) => { e.hidden = !st.video; });
  if (st.video) {
    $('label[for=dName]').textContent = 'Tên video';
    $('#dKind').textContent = it.type === 'stream' ? 'Video dạng luồng' : 'Video trên trang';
    $('#dName').placeholder = 'Tự lấy tên video';
  }
  $('#dName').value = it.name;
  $('#dUrl').textContent = it.url; $('#dUrl').title = it.url;
  $('#dSize').textContent = fmtSize(it.size) || 'Chưa rõ kích thước';
  $('#dCat').textContent = st.plan.label;
  $('#dDir').textContent = st.dir; $('#dDir').title = st.dir;
  $('#dRememberText').textContent = `Luôn lưu ${st.video ? 'video' : `loại "${st.plan.label}"`} vào thư mục này`;
  $('#ask').hidden = false;
  $('#dGo').focus();
}
$('#dPick').onclick = async () => {
  const p = await api.pickDir(st.dir);
  if (p) { st.dir = p; $('#dDir').textContent = p; $('#dDir').title = p; $('#dRemember').checked = true; }
};
$('#dCancel').onclick = () => window.close();
$('#dLater').onclick = () => { api.popupLater(); window.close(); };
$('#dName').onkeydown = (e) => { if (e.key === 'Enter') $('#dGo').click(); };
$('#dGo').onclick = async () => {
  const it = st.info;
  $('#dGo').disabled = true;
  if ($('#dRemember').checked) await api.setTypeDir(st.plan.cat, st.dir);
  const name = $('#dName').value.trim();
  const item = st.video
    ? { url: it.url, type: it.type, name: it.type === 'stream' ? name || it.name : name === it.name ? '' : name, dir: st.dir, ref: it.ref, quality: $('#dQuality').value }
    : { url: it.url, type: 'file', mime: it.mime, name: name || it.name, dir: st.dir, ref: it.ref };
  if (st.video) api.setSetting('videoQuality', item.quality);
  const ids = await api.download({ title: it.name, pageUrl: it.ref || '', items: [item] });
  st.id = ids[0];
  $('#ask').hidden = true;
  showProg(false);
};

function showProg(done) {
  title(done ? 'Tải xong' : 'Đang tải');
  $('#prog').hidden = false;
  $('#prog').classList.toggle('done', done);
  $('#pRun').hidden = done; $('#pDone').hidden = !done;
}
function showDone(d) {
  st.done = d;
  showProg(true);
  $('#pName').textContent = d.title;
  $('#pBar').style.transform = 'scaleX(1)';
  $('#pInfo').textContent = 'Đã tải xong' + (d.bytes ? ' · ' + fmtSize(d.bytes) : '');
  $('#pInfo').parentNode.className = 'pinfo';
  $('#pPct').textContent = '';
  $('#pPath').textContent = d.file; $('#pPath').title = d.file;
  $('#pOpen').focus();
}
api.onDownloads(({ active, done }) => {
  if (st.id === null || st.done) return;
  const b = active.find((x) => x.id === st.id);
  if (b) {
    st.seen = true;
    $('#pName').textContent = b.title;
    let cls = '', text;
    const prog = b.total ? `${fmtSize(b.got) || '0 B'} / ${fmtSize(b.total)}` : fmtSize(b.got) || 'Đang kết nối…';
    if (b.state === 'error') { cls = 'err'; text = b.note || 'Tải lỗi · bấm Tải lại để thử lại'; }
    else if (b.state === 'paused') { cls = 'warn'; text = 'Tạm dừng · ' + prog; }
    else text = b.note || prog + (b.speed ? ` · ${fmtSize(b.speed)}/s` : '') + eta(b);
    $('#pInfo').textContent = text; $('#pInfo').parentNode.className = 'pinfo ' + cls;
    const frac = b.total ? b.got / b.total : 0;
    $('#pBar').style.transform = `scaleX(${Math.min(1, frac)})`;
    $('#pPct').textContent = frac ? Math.floor(frac * 100) + '%' : '';
    $('#pPath').textContent = b.file; $('#pPath').title = b.file;
    const act = b.state === 'paused' ? 'resume' : b.state === 'error' ? 'retry' : 'pause';
    $('#pPause').dataset.act = act;
    $('#pPause').textContent = act === 'pause' ? 'Tạm dừng' : act === 'resume' ? 'Tiếp tục' : 'Tải lại';
    return;
  }
  const d = done.find((x) => x.id === st.id);
  if (d) { if (st.showDone) showDone(d); else window.close(); } else if (st.seen) window.close();   // bị huỷ
});
$('#pHide').onclick = () => window.close();
$('#pClose').onclick = () => window.close();
$('#pPause').onclick = () => api.batchAction(st.id, $('#pPause').dataset.act);
$('#pCancel').onclick = () => { api.batchAction(st.id, 'cancel'); window.close(); };
$('#pFolder').onclick = () => { api.openPath(st.done.file); window.close(); };
$('#pOpen').onclick = () => { api.openFile(st.done.file); window.close(); };
addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

(async function init() {
  const p = await api.popupInit();
  if (!p) { window.close(); return; }
  st.showDone = p.showDone;
  if (p.mode === 'done') { st.id = p.done.id; showDone(p.done); return; }
  st.info = p.info; st.plan = p.plan; st.dir = p.plan.dir;
  st.video = p.mode === 'video';
  if (st.video) $('#dQuality').value = p.quality || '1080';
  showAsk();
})();
