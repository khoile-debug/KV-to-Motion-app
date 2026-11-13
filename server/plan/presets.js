// Thư viện preset chuyển động. "in" = vào cảnh (fromVars → trạng thái gốc), "loop" = chuyển động giữ nhịp.
// Mọi preset đều kết thúc đúng vị trí/kích thước gốc của lớp → khung cuối giữ nguyên KV đã duyệt.

export const IN_PRESETS = {
  none:          { label: 'Không (hiện sẵn)' },
  fade:          { label: 'Mờ dần vào' },
  'fade-up':     { label: 'Mờ + trồi lên' },
  'slide-left':  { label: 'Trượt từ trái' },
  'slide-right': { label: 'Trượt từ phải' },
  'slide-top':   { label: 'Trượt từ trên' },
  'slide-bottom':{ label: 'Trượt từ dưới' },
  'zoom-in':     { label: 'Phóng to vào' },
  'zoom-out':    { label: 'Thu nhỏ vào' },
  pop:           { label: 'Bật nảy (pop)' },
  'blur-in':     { label: 'Nhòe → nét' },
  'wipe-left':   { label: 'Quét lộ trái→phải' },
  'wipe-right':  { label: 'Quét lộ phải→trái' },
  'wipe-up':     { label: 'Quét lộ dưới→trên' },
  'wipe-down':   { label: 'Quét lộ trên→dưới' },
  'rotate-in':   { label: 'Xoay vào' },
  drop:          { label: 'Rơi xuống (nảy)' },
};

export const LOOP_PRESETS = {
  none:     { label: 'Không' },
  float:    { label: 'Lơ lửng' },
  pulse:    { label: 'Nhịp đập' },
  breathe:  { label: 'Thở nhẹ' },
  kenburns: { label: 'Ken Burns (nền)' },
  sway:     { label: 'Đung đưa' },
  shine:    { label: 'Vệt sáng lướt' },
};

export const EASES = ['none', 'power1.out', 'power2.out', 'power3.out', 'power4.out', 'power2.in', 'power2.inOut', 'sine.inOut', 'expo.out', 'back.out(1.7)', 'back.out(1.2)', 'elastic.out(1,0.5)', 'bounce.out'];

// Presets that change shape/colour are not allowed on locked brand assets (logo): uniform transforms only.
export const LOGO_SAFE_IN = ['none', 'fade', 'fade-up', 'slide-left', 'slide-right', 'slide-top', 'slide-bottom', 'zoom-in', 'zoom-out', 'pop', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down'];

/** GSAP "from" vars for an in-preset, given the layer box and canvas. */
export function inFromVars(preset, box, canvas, distance = 'auto') {
  const W = canvas.width, H = canvas.height;
  const d = (axisLen, offscreen) => (distance === 'auto' ? offscreen : Number(distance) * axisLen);
  switch (preset) {
    case 'fade': return { opacity: 0 };
    case 'fade-up': return { opacity: 0, y: Math.round(0.05 * H) };
    case 'slide-left': return { x: -Math.round(d(W, box.x + box.w + 0.02 * W)), opacity: distance === 'auto' ? 1 : 0 };
    case 'slide-right': return { x: Math.round(d(W, W - box.x + 0.02 * W)), opacity: distance === 'auto' ? 1 : 0 };
    case 'slide-top': return { y: -Math.round(d(H, box.y + box.h + 0.02 * H)), opacity: distance === 'auto' ? 1 : 0 };
    case 'slide-bottom': return { y: Math.round(d(H, H - box.y + 0.02 * H)), opacity: distance === 'auto' ? 1 : 0 };
    case 'zoom-in': return { scale: 0.6, opacity: 0 };
    case 'zoom-out': return { scale: 1.35, opacity: 0 };
    case 'pop': return { scale: 0, opacity: 0 };
    case 'blur-in': return { opacity: 0, filter: 'blur(24px)', scale: 1.04 };
    case 'wipe-left': return { clipPath: 'inset(0% 100% 0% 0%)' };
    case 'wipe-right': return { clipPath: 'inset(0% 0% 0% 100%)' };
    case 'wipe-up': return { clipPath: 'inset(100% 0% 0% 0%)' };
    case 'wipe-down': return { clipPath: 'inset(0% 0% 100% 0%)' };
    case 'rotate-in': return { rotation: -14, scale: 0.8, opacity: 0 };
    case 'drop': return { y: -Math.round(0.35 * H), opacity: 0 };
    default: return null;
  }
}

export function inToVars(preset) {
  const v = { x: 0, y: 0, scale: 1, opacity: 1, rotation: 0 };
  if (preset === 'blur-in') v.filter = 'blur(0px)';
  if (preset?.startsWith('wipe-')) v.clipPath = 'inset(0% 0% 0% 0%)';
  return v;
}

export const DEFAULT_EASE = {
  pop: 'back.out(1.7)', drop: 'bounce.out', 'zoom-out': 'power3.out', 'blur-in': 'power2.out',
  'rotate-in': 'back.out(1.2)',
};

/** Slide preset name from a template motion direction ("from" side). */
export const slideFrom = (from) => ({ left: 'slide-left', right: 'slide-right', top: 'slide-top', up: 'slide-top', bottom: 'slide-bottom', down: 'slide-bottom' }[from] || 'fade');

export const FONTS = {
  'Be Vietnam Pro': { pkg: 'be-vietnam-pro', weights: [400, 500, 600, 700, 800, 900] },
  Montserrat: { pkg: 'montserrat', weights: [400, 500, 600, 700, 800, 900] },
  'Playfair Display': { pkg: 'playfair-display', weights: [400, 500, 600, 700, 800, 900] },
  Oswald: { pkg: 'oswald', weights: [400, 500, 600, 700] },
  Roboto: { pkg: 'roboto', weights: [400, 500, 700, 900] },
  'Dancing Script': { pkg: 'dancing-script', weights: [400, 500, 600, 700] },
  Lobster: { pkg: 'lobster', weights: [400] },
};
