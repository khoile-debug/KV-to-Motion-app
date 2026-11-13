// Chuyển văn bản hiển thị (giữ nguyên văn) sang dạng đọc cho TTS tiếng Việt: giá, %, ngày giờ, ký hiệu.
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function read3(n, full) {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  const out = [];
  if (h || full) out.push(DIGITS[h], 'trăm');
  if (t === 0 && u === 0) return out.join(' ');
  if (t === 0) { if (h || full) out.push('lẻ'); out.push(DIGITS[u]); }
  else if (t === 1) { out.push('mười'); if (u) out.push(u === 5 ? 'lăm' : DIGITS[u]); }
  else { out.push(DIGITS[t], 'mươi'); if (u === 1) out.push('mốt'); else if (u === 4) out.push('tư'); else if (u === 5) out.push('lăm'); else if (u) out.push(DIGITS[u]); }
  return out.join(' ');
}

export function numberToVi(n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return '';
  if (n === 0) return 'không';
  const units = ['', 'nghìn', 'triệu', 'tỷ'];
  const groups = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const out = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    out.push(read3(groups[i], i < groups.length - 1), units[i]);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

const parseNum = (s) => Number(String(s).replace(/[.,\s](?=\d{3}\b)/g, '').replace(',', '.'));

export function toSpoken(text) {
  // ALL-CAPS display copy is read letter-by-letter by some engines → speak it in lower case
  const letters = text.match(/\p{L}/gu) || [];
  const upper = letters.filter((c) => c !== c.toLowerCase()).length;
  if (letters.length && upper / letters.length > 0.6) text = text.toLocaleLowerCase('vi');
  let s = ` ${text} `;
  s = s.replace(/(\d+(?:[.,\s]\d{3})*)\s?(?:đ|₫|vnđ|vnd)(?![\p{L}])/giu, (_, n) => `${numberToVi(parseNum(n))} đồng`);
  s = s.replace(/(\d+(?:[.,]\d+)?)\s?tr(?:iệu)?\b/giu, (_, n) => { const v = parseNum(n); return Number.isInteger(v) ? `${numberToVi(v)} triệu` : `${numberToVi(Math.floor(v))} phẩy ${numberToVi(String(n).split(/[.,]/)[1])} triệu`; });
  s = s.replace(/(\d+)\s?k\b/giu, (_, n) => `${numberToVi(n)} nghìn`);
  s = s.replace(/(giảm\s*)?-\s?(\d{1,3})\s?%/giu, (_, g, n) => `${g ? g : 'giảm '}${numberToVi(n)} phần trăm`);
  s = s.replace(/(\d{1,3})\s?%/g, (_, n) => `${numberToVi(n)} phần trăm`);
  s = s.replace(/\b(\d{1,2})\s?[hg:]\s?(\d{2})\b/g, (_, h, m) => `${numberToVi(h)} giờ ${numberToVi(m)}`);
  s = s.replace(/\b(\d{1,2})\s?(?:h|giờ)\b/g, (_, h) => `${numberToVi(h)} giờ`);
  s = s.replace(/\b(\d{1,2})\s?[\/.\-]\s?(\d{1,2})\s?[\/.\-]\s?(\d{4})\b/g, (_, d, m, y) => `ngày ${numberToVi(d)} tháng ${numberToVi(m)} năm ${numberToVi(y)}`);
  s = s.replace(/\b(\d{1,2})\s?[\/.\-]\s?(\d{1,2})\b/g, (_, d, m) => `${numberToVi(d)} tháng ${numberToVi(m)}`);
  s = s.replace(/\b(\d+(?:[.,]\d{3})+)\b/g, (_, n) => numberToVi(parseNum(n)));
  s = s.replace(/\b\d+\b/g, (n) => numberToVi(n));
  s = s.replace(/&/g, ' và ').replace(/\+/g, ' cộng ').replace(/[*#_~|<>]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}
