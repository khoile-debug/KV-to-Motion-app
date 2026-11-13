// TTS có thể thay nhà cung cấp qua cấu hình (config/local.json → tts.provider) hoặc biến môi trường KV_TTS_PROVIDER.
// Mọi provider trả về WAV 44.1kHz stereo đã chuẩn hóa tại outPath.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cfg from '../config.js';
import { run } from '../util.js';
import { toSpoken } from '../audio/spoken.js';

const key = (pc, envName) => process.env[pc?.[envName] || ''] || pc?.apiKey || '';

async function toWav(input, out, speed = 1) {
  const af = ['loudnorm=I=-16:TP=-1.5:LRA=11', 'aresample=44100'];
  if (speed && Math.abs(speed - 1) > 0.01) af.unshift(`atempo=${Math.min(2, Math.max(0.5, speed))}`);
  // trim leading/trailing silence so alignment is exact
  af.unshift('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02', 'areverse', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05', 'areverse');
  await run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-af', af.join(','), '-ac', '2', '-ar', '44100', out]);
}

async function httpJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r;
}

export const PROVIDERS = {
  espeak: {
    label: 'eSpeak NG (offline, có tiếng Việt)',
    voices: ['vi', 'vi-vn-x-central', 'vi-vn-x-south', 'en-us'],
    available: async () => { try { await run(cfg.tts.providers.espeak?.binary || 'espeak-ng', ['--version']); return true; } catch { return false; } },
    async synth(text, voice, tmp) {
      const pc = cfg.tts.providers.espeak || {};
      await run(pc.binary || 'espeak-ng', ['-v', voice || 'vi', '-s', String(pc.wpm || 150), '-p', '45', '-w', tmp + '.wav', text]);
      return tmp + '.wav';
    },
  },
  google: {
    label: 'Google Cloud Text-to-Speech',
    voices: ['vi-VN-Neural2-A', 'vi-VN-Neural2-D', 'vi-VN-Wavenet-A', 'vi-VN-Wavenet-B', 'vi-VN-Wavenet-C', 'vi-VN-Wavenet-D', 'vi-VN-Standard-A'],
    available: async () => !!key(cfg.tts.providers.google, 'apiKeyEnv'),
    async synth(text, voice, tmp) {
      const pc = cfg.tts.providers.google;
      const r = await httpJson(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key(pc, 'apiKeyEnv'))}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { text }, voice: { languageCode: pc.languageCode || 'vi-VN', name: voice || 'vi-VN-Neural2-A' }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 44100 } }),
      });
      const j = await r.json();
      fs.writeFileSync(tmp + '.wav', Buffer.from(j.audioContent, 'base64'));
      return tmp + '.wav';
    },
  },
  openai: {
    label: 'OpenAI TTS',
    voices: ['alloy', 'nova', 'shimmer', 'echo', 'onyx', 'fable', 'coral', 'sage'],
    available: async () => !!key(cfg.tts.providers.openai, 'apiKeyEnv'),
    async synth(text, voice, tmp) {
      const pc = cfg.tts.providers.openai;
      const r = await httpJson('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key(pc, 'apiKeyEnv')}` },
        body: JSON.stringify({ model: pc.model || 'gpt-4o-mini-tts', voice: voice || 'nova', input: text, response_format: 'wav' }),
      });
      fs.writeFileSync(tmp + '.wav', Buffer.from(await r.arrayBuffer()));
      return tmp + '.wav';
    },
  },
  elevenlabs: {
    label: 'ElevenLabs (multilingual)',
    voices: ['21m00Tcm4TlvDq8ikWAM', 'EXAVITQu4vr4xnSDxMaL', 'pNInz6obpgDQGcFmaJgB'],
    available: async () => !!key(cfg.tts.providers.elevenlabs, 'apiKeyEnv'),
    async synth(text, voice, tmp) {
      const pc = cfg.tts.providers.elevenlabs;
      const r = await httpJson(`https://api.elevenlabs.io/v1/text-to-speech/${voice || '21m00Tcm4TlvDq8ikWAM'}?output_format=mp3_44100_128`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'xi-api-key': key(pc, 'apiKeyEnv') },
        body: JSON.stringify({ text, model_id: pc.model || 'eleven_multilingual_v2' }),
      });
      fs.writeFileSync(tmp + '.mp3', Buffer.from(await r.arrayBuffer()));
      return tmp + '.mp3';
    },
  },
  fpt: {
    label: 'FPT.AI TTS (tiếng Việt)',
    voices: ['banmai', 'lannhi', 'leminh', 'myan', 'thuminh', 'giahuy', 'linhsan'],
    available: async () => !!key(cfg.tts.providers.fpt, 'apiKeyEnv'),
    async synth(text, voice, tmp) {
      const pc = cfg.tts.providers.fpt;
      const r = await httpJson('https://api.fpt.ai/hmi/tts/v5', { method: 'POST', headers: { 'api-key': key(pc, 'apiKeyEnv'), voice: voice || 'banmai', speed: '0' }, body: text });
      const j = await r.json();
      const url = j.async;
      if (!url) throw new Error('FPT.AI không trả về link audio: ' + JSON.stringify(j));
      for (let i = 0; i < 30; i++) { // the file becomes available after a few seconds
        const a = await fetch(url);
        if (a.ok && Number(a.headers.get('content-length') || 1) > 0) { fs.writeFileSync(tmp + '.mp3', Buffer.from(await a.arrayBuffer())); return tmp + '.mp3'; }
        await new Promise((res) => setTimeout(res, 1000));
      }
      throw new Error('FPT.AI: hết thời gian chờ file audio');
    },
  },
  azure: {
    label: 'Azure Speech',
    voices: ['vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural'],
    available: async () => !!key(cfg.tts.providers.azure, 'apiKeyEnv'),
    async synth(text, voice, tmp) {
      const pc = cfg.tts.providers.azure;
      const region = process.env[pc.regionEnv] || pc.region || 'southeastasia';
      const v = voice || 'vi-VN-HoaiMyNeural';
      const ssml = `<speak version="1.0" xml:lang="vi-VN"><voice name="${v}">${text.replace(/[<&>]/g, ' ')}</voice></speak>`;
      const r = await httpJson(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key(pc, 'apiKeyEnv'), 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm' }, body: ssml,
      });
      fs.writeFileSync(tmp + '.wav', Buffer.from(await r.arrayBuffer()));
      return tmp + '.wav';
    },
  },
  command: {
    label: 'Lệnh tùy chỉnh (vd. Piper offline)',
    get voices() { return cfg.tts.providers.command?.voices || ['default']; },
    available: async () => {
      const bin = (cfg.tts.providers.command?.cmd || '').split(/\s+/)[0];
      if (!bin) return false;
      try { await run('sh', ['-c', `command -v ${bin}`]); return true; } catch { return false; }
    },
    async synth(text, voice, tmp) {
      const pc = cfg.tts.providers.command;
      const out = tmp + '.wav';
      const cmd = pc.cmd.replaceAll('{out}', JSON.stringify(out)).replaceAll('{voice}', voice || 'default').replaceAll('{text}', JSON.stringify(text));
      await run('sh', ['-c', cmd], { input: pc.stdin ? text : undefined });
      return out;
    },
  },
};

export async function providerStatus() {
  const out = [];
  for (const [id, p] of Object.entries(PROVIDERS)) out.push({ id, label: p.label, voices: p.voices, available: await p.available() });
  return out;
}

/** Synthesize one line → normalized WAV at outPath. Returns duration (s). */
export async function synthesize({ text, provider, voice, speed = 1 }, outPath) {
  const p = PROVIDERS[provider || cfg.tts.provider];
  if (!p) throw new Error(`TTS provider không tồn tại: ${provider}`);
  const tmp = path.join(os.tmpdir(), `kvtts_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const raw = await p.synth(toSpoken(text), voice, tmp);
  await toWav(raw, outPath, speed);
  fs.rmSync(raw, { force: true });
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outPath]);
  return Number(stdout.trim());
}
