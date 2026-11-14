// In ra mô tả bản phát hành từ whatsnew.json (dùng cho GitHub Release)
const w = require('../whatsnew.json');
const sec = (t, a) => (a && a.length ? `### ${t}\n${a.map((x) => `- ${x}`).join('\n')}\n\n` : '');
process.stdout.write(sec('Mới', w.new) + sec('Cải thiện', w.improved) + sec('Sửa lỗi', w.fixed));
