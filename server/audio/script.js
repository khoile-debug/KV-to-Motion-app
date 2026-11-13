// Viết lời thoại ngắn từ nội dung đã duyệt. Bắt buộc giữ nguyên văn thương hiệu, giá, ngày giờ, điều kiện.
import { claudeWriteScript, claudeReady } from '../analyze/claude.js';
import { scriptSufficiency } from '../analyze/classify.js';
import { visionProvider } from '../config.js';

const end = (s) => (/[.!?…]$/.test(s.trim()) ? s.trim() : s.trim() + '.');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const tidy = (s) => s.replace(/\s+/g, ' ').trim();

/** Rule-based Vietnamese copy built only from approved facts (never invents info). */
export function ruleScript(facts) {
  const lines = [];
  const brand = tidy(facts.brand || '');
  const head = tidy(facts.headline || '');
  if (head) {
    const withBrand = brand && !head.toLowerCase().includes(brand.toLowerCase()) && head.split(' ').length <= 6;
    lines.push({ anchor: 'headline', text: end(cap(withBrand ? `${brand}: ${head}` : head)) });
  } else if (facts.product) lines.push({ anchor: 'product', text: end(cap(brand ? `${brand} ${facts.product}` : facts.product)) });
  if (facts.price) {
    const p = tidy(facts.price);
    const already = /(chỉ|giá|giảm|ưu đãi|sale|off|từ|còn|đồng giá|tặng)/i.test(p);
    lines.push({ anchor: 'price', text: end(cap(already ? p : `Giá chỉ ${p}`)) });
  }
  if (facts.datetime) {
    const d = tidy(facts.datetime);
    lines.push({ anchor: 'datetime', text: end(cap(/^(từ|đến|áp dụng|duy nhất|chỉ|ngày|hôm|thứ|cuối|mở bán|khai trương|ra mắt|bắt đầu|hạn)/i.test(d) ? d : `Áp dụng ${d}`)) });
  }
  if (facts.cta) {
    const c = tidy(facts.cta).replace(/[!.]+$/, '');
    const withBrand = brand && !lines.some((l) => l.text.includes(brand)) && !c.toLowerCase().includes(brand.toLowerCase());
    lines.push({ anchor: 'cta', text: cap(withBrand ? `${c} tại ${brand}!` : `${c}!`) });
  } else if (brand && !lines.some((l) => l.text.includes(brand))) lines.push({ anchor: 'brand', text: end(brand) });
  return lines;
}

/** Every number / price / date that appears in the script must come verbatim from the approved facts. */
export function validateScript(lines, facts) {
  const approved = Object.values(facts).filter(Boolean).join(' | ');
  const issues = [];
  for (const l of lines) {
    for (const m of l.text.match(/\d[\d.,:\/\-%]*\s?(?:đ|₫|k|tr|triệu|vnđ|vnd|h|%)?/giu) || []) {
      const token = m.trim().replace(/[.,]$/, '');
      if (!approved.includes(token)) issues.push(`"${token}" không có trong nội dung đã duyệt`);
    }
  }
  if (facts.brand && !lines.some((l) => l.text.includes(facts.brand.trim()))) issues.push(`thiếu tên thương hiệu "${facts.brand}" đúng nguyên văn`);
  return issues;
}

/** Returns { lines:[{anchor,text}], enough, source, issues } */
export async function writeScript(facts, brief, duration, log = () => {}) {
  const suff = scriptSufficiency(facts);
  if (!suff.enough) return { lines: [], enough: false, source: 'none', issues: ['KV/brief quá ít thông tin để viết lời thoại chính xác — preview chỉ có nhạc, hãy nhập lời thoại.'] };
  if (visionProvider() === 'claude' && claudeReady()) {
    try {
      const lines = await claudeWriteScript(facts, brief, duration);
      const issues = validateScript(lines, facts);
      if (!issues.length) return { lines, enough: true, source: 'claude', issues: [] };
      log(`Lời thoại từ mô hình vi phạm nội dung đã duyệt (${issues.join('; ')}) → dùng lời thoại theo quy tắc.`);
    } catch (e) { log('Không viết được lời thoại bằng mô hình: ' + e.message); }
  }
  const lines = ruleScript(facts);
  return { lines, enough: true, source: 'rules', issues: validateScript(lines, facts) };
}
