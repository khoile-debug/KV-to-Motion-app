// Gán vai trò cho các dòng chữ (headline, giá, ngày giờ, CTA, điều kiện, thương hiệu) + đoán ngành hàng/sắc thái.

// \b không hoạt động với chữ có dấu → dùng ranh giới Unicode tự định nghĩa.
const B0 = '(?<![\\p{L}\\p{N}])', B1 = '(?![\\p{L}\\p{N}])';
const rx = (src) => new RegExp(src.replaceAll('\\b<', B0).replaceAll('\\b>', B1), 'iu');
export const RX = {
  price: rx(String.raw`(\d{1,3}(?:[.,\s]\d{3})+|\d+(?:[.,]\d+)?)\s?(?:đ|₫|vnđ|vnd|k|nghìn|ngàn|triệu|tr|usd|\$)\b>|-?\d{1,2}\s?%|\b<(?:đồng giá|chỉ từ|chỉ còn|giá)\s+\d`),
  date: rx(String.raw`\b<\d{1,2}\s?[\/.\-]\s?\d{1,2}(?:\s?[\/.\-]\s?\d{2,4})?\b>|\b<\d{1,2}\s?(?:h|giờ|:)\s?\d{0,2}\b>|\b<(?:từ ngày|đến ngày|ngày\s+\d|tháng\s+\d|thứ\s?[2-7]|chủ nhật|cuối tuần|duy nhất hôm nay|hôm nay|đến hết|mở bán)\b>`),
  cta: rx(String.raw`\b<(?:mua ngay|đặt (?:hàng|ngay|bàn|lịch|mua|trước)|đăng ký|liên hệ|gọi ngay|khám phá|tìm hiểu|xem ngay|nhận (?:ngay|ưu đãi|quà)|săn (?:ngay|deal)|inbox|hotline|ghé|tải app|order|shop now|buy now|learn more|sign up|book now|đến ngay|trải nghiệm|mua sắm ngay|đặt trước ngay)\b>`),
  terms: rx(String.raw`\b<(?:áp dụng|điều kiện|không áp dụng|số lượng có hạn|chi tiết tại|tối đa|tối thiểu|mỗi khách)\b>|^\*`),
};

const INDUSTRY = [
  ['food', /(cà phê|coffee|trà|tea|bánh|pizza|gà|burger|món|ăn|uống|nhà hàng|buffet|food|drink|bún|phở|lẩu|trà sữa)/i],
  ['cosmetics', /(serum|kem|son|skincare|da|dưỡng|mỹ phẩm|beauty|làm đẹp|nước hoa|perfume)/i],
  ['fashion', /(thời trang|fashion|áo|quần|giày|túi|váy|collection|bst)/i],
  ['tech', /(điện thoại|laptop|phone|tech|công nghệ|app|smart|5g|ai\b|wifi|internet|máy)/i],
  ['finance', /(ngân hàng|bank|thẻ|card|lãi suất|vay|bảo hiểm|tài chính|hoàn tiền|cashback)/i],
  ['real-estate', /(căn hộ|dự án|bất động sản|nhà phố|biệt thự|chung cư|residence)/i],
  ['healthcare', /(sức khỏe|phòng khám|bệnh viện|vitamin|thuốc|health|nha khoa)/i],
  ['education', /(khóa học|học|tuyển sinh|education|course|trường|ielts)/i],
  ['tet', /(tết|xuân|lì xì|năm mới|new year|trung thu|noel|giáng sinh)/i],
  ['sale', /(sale|giảm|khuyến mãi|ưu đãi|deal|flash|voucher|freeship|mua 1 tặng 1|black friday|\d+\.\d+)/i],
  ['luxury', /(luxury|premium|cao cấp|thượng lưu|limited|signature|đẳng cấp)/i],
];

export const MOOD_BY_INDUSTRY = {
  food: ['warm', 'playful', 'food'], cosmetics: ['elegant', 'beauty', 'calm'], fashion: ['fashion', 'energetic'],
  tech: ['tech', 'corporate', 'energetic'], finance: ['corporate', 'trust', 'finance'], 'real-estate': ['luxury', 'premium', 'real-estate'],
  healthcare: ['calm', 'healthcare', 'trust'], education: ['corporate', 'education'], tet: ['festive', 'tet', 'warm'],
  sale: ['sale', 'energetic'], luxury: ['luxury', 'premium', 'elegant'],
};

export function detectIndustry(text) {
  const out = [];
  for (const [k, rx] of INDUSTRY) if (rx.test(text)) out.push(k);
  return out;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * lines: [{text,bbox,size,conf}] ; brief: user-approved fields.
 * Returns elements with roles + `facts` (approved content to be preserved verbatim).
 */
export function classify(lines, brief = {}, imgSize = { width: 1, height: 1 }) {
  // low-confidence OCR is never used as approved content
  const els = lines.filter((l) => (l.conf ?? 100) >= 62).map((l, i) => ({ id: `t${i}`, ...l, role: 'body' }));
  const brandN = norm(brief.brand);
  const squash = (s) => norm(s).replace(/[^\p{L}\p{N}]/gu, '');
  const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const isBrand = (t) => brandN && (norm(t).includes(brandN) || (squash(t).length <= squash(brandN).length + 2 && lev(squash(t), squash(brandN)) <= Math.max(1, Math.floor(squash(brandN).length / 5))));
  for (const e of els) {
    const t = e.text;
    if (isBrand(t)) e.role = 'brand';
    else if (RX.cta.test(t)) e.role = 'cta';
    else if (RX.price.test(t)) e.role = 'price';
    else if (RX.terms.test(t) && e.size < 0.5 * Math.max(...els.map((x) => x.size))) e.role = 'terms';
    else if (RX.date.test(t)) e.role = 'datetime';
  }
  // Headline = biggest remaining text (by glyph height) with at least 2 letters
  const rest = els.filter((e) => e.role === 'body' && /\p{L}{2,}/u.test(e.text)).sort((a, b) => b.size - a.size);
  if (rest.length) {
    rest[0].role = 'headline';
    // merge adjacent lines of similar size directly under the headline (multi-line headlines)
    for (const e of rest.slice(1)) {
      const h = rest[0];
      if (Math.abs(e.size - h.size) < h.size * 0.4 && Math.abs(e.bbox.y - (h.bbox.y + h.bbox.h)) < h.size * 1.5) e.role = 'headline';
    }
  }
  // Tiny text near the edges is likely a fine print
  for (const e of els) if (e.role === 'body' && e.size < imgSize.height * 0.018) e.role = 'terms';

  const pick = (role) => els.filter((e) => e.role === role).sort((a, b) => a.bbox.y - b.bbox.y);
  const joinText = (arr) => [...arr].sort((a, b) => (Math.abs(a.bbox.y - b.bbox.y) < Math.min(a.bbox.h, b.bbox.h) * 0.5 ? a.bbox.x - b.bbox.x : a.bbox.y - b.bbox.y)).map((e) => e.text).join(' ').trim();

  // Approved facts: brief overrides OCR (brief is what the client approved).
  const facts = {
    brand: brief.brand?.trim() || joinText(pick('brand')) || '',
    headline: brief.headline?.trim() || joinText(pick('headline')) || '',
    product: brief.product?.trim() || '',
    price: brief.offer?.trim() || joinText(pick('price')) || '',
    datetime: brief.datetime?.trim() || joinText(pick('datetime')) || '',
    cta: brief.cta?.trim() || joinText(pick('cta')) || '',
    terms: brief.terms?.trim() || joinText(pick('terms')) || '',
  };
  const allText = [facts.brand, facts.headline, facts.product, facts.price, facts.datetime, facts.cta, brief.notes, ...lines.map((l) => l.text)].join(' ');
  const industry = detectIndustry(allText);
  return { elements: els, facts, industry };
}

/** Is there enough approved info to write an accurate voice-over? */
export function scriptSufficiency(facts) {
  const items = [
    facts.headline && facts.headline.split(/\s+/).length >= 2,
    !!facts.product,
    !!facts.price,
    !!facts.datetime,
    !!facts.cta,
    !!facts.brand,
  ].filter(Boolean).length;
  return { enough: items >= 2 && !!(facts.headline || facts.product || facts.price), items };
}
