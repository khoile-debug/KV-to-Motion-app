// Mô hình đọc ảnh (Claude) — phân tích KV, mẫu chuyển động và viết lời thoại.
// Chỉ dùng khi có ANTHROPIC_API_KEY (hoặc vision.provider = "claude"); mọi lỗi đều rơi về heuristic.
import fs from 'node:fs';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import cfg from '../config.js';

let client = null;
const getClient = () => (client ||= new Anthropic());

async function imageBlock(file, maxSide = 1568) {
  const buf = await sharp(file).flatten({ background: '#ffffff' }).resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } };
}

async function parse(content, schema, maxTokens = 8000) {
  const response = await getClient().messages.parse({
    model: cfg.vision.model,
    max_tokens: maxTokens,
    output_config: { effort: cfg.vision.effort || 'medium', format: zodOutputFormat(schema) },
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Mô hình từ chối yêu cầu: ' + (response.stop_details?.explanation || ''));
  if (!response.parsed_output) throw new Error('Không đọc được JSON từ mô hình');
  return response.parsed_output;
}

const Box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const KVSchema = z.object({
  industry: z.array(z.string()),
  mood: z.array(z.string()),
  focal: z.object({ x: z.number(), y: z.number() }),
  elements: z.array(z.object({
    role: z.enum(['brand', 'logo', 'headline', 'subheadline', 'product', 'price', 'datetime', 'cta', 'terms', 'subject', 'body']),
    text: z.string(),
    bbox: Box,
    importance: z.number(),
  })),
  facts: z.object({
    brand: z.string(), headline: z.string(), product: z.string(), price: z.string(),
    datetime: z.string(), cta: z.string(), terms: z.string(),
  }),
  enough_for_voiceover: z.boolean(),
  motion_style: z.enum(['energetic', 'playful', 'calm', 'luxury', 'corporate', 'festive']),
  rationale: z.string(),
});

export async function claudeAnalyzeKV(file, brief, ocrLines, size) {
  const prompt = `Bạn là motion designer cho quảng cáo tại Việt Nam. Phân tích Key Visual (KV) đính kèm (kích thước ${size.width}x${size.height}px).
Brief (nội dung đã duyệt, có thể trống): ${JSON.stringify(brief || {})}
Kết quả OCR tham khảo (có thể sai dấu): ${JSON.stringify(ocrLines.map((l) => ({ text: l.text, bbox: l.bbox })))}

Yêu cầu:
- elements: liệt kê các thành phần nhìn thấy (logo, chủ thể/sản phẩm, headline, giá, ngày giờ, CTA, điều kiện). bbox chuẩn hóa 0..1 theo chiều rộng/cao ảnh. text phải chép NGUYÊN VĂN như trên ảnh (đúng dấu, đúng định dạng số).
- facts: nội dung đã duyệt. Ưu tiên brief nếu có; nếu không, chép nguyên văn từ ảnh. Không tự bịa, không đổi định dạng giá/ngày. Để chuỗi rỗng khi không có.
- focal: điểm nhấn thị giác chính (0..1).
- enough_for_voiceover: true chỉ khi KV/brief đủ thông tin để viết lời thoại chính xác (ít nhất thông điệp chính + một thông tin cụ thể như giá, ngày hoặc CTA).
- motion_style: phong cách chuyển động phù hợp với ngành hàng và sắc thái.`;
  const out = await parse([await imageBlock(file), { type: 'text', text: prompt }], KVSchema);
  return out;
}

const ScriptSchema = z.object({
  lines: z.array(z.object({ text: z.string(), anchor: z.enum(['intro', 'headline', 'product', 'price', 'datetime', 'cta', 'brand', 'terms']) })),
});

export async function claudeWriteScript(facts, brief, duration) {
  const maxWords = Math.round((duration - 1.8) * 2.6);
  const prompt = `Viết lời thoại (voice-over) tiếng Việt ngắn cho video quảng cáo ${duration.toFixed(1)} giây, tối đa ${maxWords} từ, 2-4 câu ngắn.
Nội dung đã duyệt (BẮT BUỘC giữ nguyên văn tên thương hiệu, giá, ngày giờ, điều kiện ưu đãi; không thêm thông tin không có trong đây):
${JSON.stringify(facts)}
Tone/ghi chú: ${brief?.tone || ''} ${brief?.notes || ''}
Mỗi câu gắn với thành phần xuất hiện trên hình (anchor) để canh thời điểm đọc.`;
  const out = await parse([{ type: 'text', text: prompt }], ScriptSchema, 2000);
  return out.lines;
}

const TemplateSchema = z.object({
  events: z.array(z.object({
    target: z.enum(['background', 'subject', 'logo', 'text', 'cta', 'price', 'other']),
    start: z.number(), duration: z.number(),
    motion: z.enum(['fade', 'slide', 'zoom-in', 'zoom-out', 'pop', 'wipe', 'blur-in', 'rotate-in', 'drop']),
    direction: z.enum(['left', 'right', 'up', 'down', 'none']),
    ease: z.enum(['linear', 'ease-out', 'ease-in', 'ease-in-out', 'back', 'bounce']),
  })),
  camera: z.enum(['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down']),
  transitions: z.array(z.object({ at: z.number(), type: z.string() })),
  final_hold: z.number(),
  per_layer_motion: z.boolean(),
  summary: z.string(),
});

export async function claudeAnalyzeTemplate(frames, heuristic) {
  const content = [];
  for (const f of frames) {
    content.push({ type: 'text', text: `Khung hình t=${f.t.toFixed(2)}s` });
    content.push(await imageBlock(f.file, 640));
  }
  content.push({ type: 'text', text: `Đây là các khung hình tham chiếu từ video mẫu chuyển động (thời lượng ${heuristic.duration.toFixed(2)}s).
Phân tích thứ tự xuất hiện, thời điểm, hướng chuyển động, tốc độ/easing, chuyển cảnh và thời gian giữ khung cuối.
Kết quả đo tự động (tham khảo, có thể thiếu): ${JSON.stringify({ events: heuristic.events.map((e) => ({ t0: e.t0, t1: e.t1, bbox: e.bbox, motion: e.motion })), hold: heuristic.hold, cuts: heuristic.cuts })}` });
  return parse(content, TemplateSchema, 4000);
}

export const claudeReady = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
