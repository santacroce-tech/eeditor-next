// What a screen plays: the sound a frame carries beside its picture (docs/DISPLAY.md, "Sound").
// Two ways, either or both in one frame:
//
//   "tones" [{"hz" 440 "ms" 120 ["wave" "square"] ["vol" 0.3] ["to" 220]} …]
//       notes for the host to make — a game's sound effects, for nothing a frame. "wave" is
//       "square" (the default), "triangle", "sine", "sawtooth" or "noise"; "to" slides the pitch.
//   "audio" {"rate" 22050 "pcm" "<base64>"}
//       samples the program made itself, unsigned 8-bit, 128 silence — an emulated beeper or
//       sound chip. Each frame's samples follow the last frame's, without a gap.
//
// The parsing is pure (and tested); the playing is WebAudio's, started by the first click or key
// on the screen, as browsers ask.

import { b64ToBytes } from "../spectrum/screen";
import { dictGet, isDict, type JsonValue } from "../engine/types";

export type Wave = "square" | "triangle" | "sine" | "sawtooth" | "noise";
const WAVES: readonly Wave[] = ["square", "triangle", "sine", "sawtooth", "noise"];

export interface Tone {
  hz: number;
  ms: number;
  wave: Wave;
  vol: number;
  /** The pitch it slides to over its length; `hz` when it doesn't. */
  to: number;
}

export interface Pcm {
  rate: number;
  /** −1…1. */
  samples: Float32Array<ArrayBuffer>;
}

export interface Sound {
  tones: Tone[];
  pcm: Pcm | null;
}

/** Notes past these are not what a frame means: kept within hearing and a few seconds. */
const MAX_TONES = 16;
const MAX_MS = 5000;
const clamp = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

function tone(v: JsonValue): Tone | null {
  if (!isDict(v)) return null;
  const hz = Number(dictGet(v, "hz"));
  const ms = Number(dictGet(v, "ms"));
  if (!Number.isFinite(hz) || hz <= 0 || !Number.isFinite(ms) || ms <= 0) return null;
  const w = dictGet(v, "wave");
  const f = Math.min(20000, Math.max(20, hz));
  return {
    hz: f,
    ms: Math.min(MAX_MS, ms),
    wave: WAVES.includes(w as Wave) ? (w as Wave) : "square",
    vol: clamp(dictGet(v, "vol"), 0, 1, 0.3),
    to: clamp(dictGet(v, "to"), 20, 20000, f),
  };
}

/** The sound in a frame, by its fields; nothing when it has none. */
export function decodeSound(get: (key: string) => unknown): Sound {
  const t = get("tones");
  const tones = Array.isArray(t) ? t.slice(0, MAX_TONES).map(tone).filter((x): x is Tone => x !== null) : [];
  let pcm: Pcm | null = null;
  const a = get("audio") as JsonValue;
  if (isDict(a)) {
    const rate = Number(dictGet(a, "rate"));
    const data = dictGet(a, "pcm");
    if (Number.isFinite(rate) && rate >= 3000 && rate <= 96000 && typeof data === "string" && data) {
      try {
        const bytes = b64ToBytes(data);
        const samples = new Float32Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) samples[i] = (bytes[i] - 128) / 128;
        pcm = { rate, samples };
      } catch {
        pcm = null;
      }
    }
  }
  return { tones, pcm };
}

/** Samples are queued at most this far ahead: past it a frame's are dropped, so a stall can't build a lag. */
const AHEAD = 0.25;
/** How far ahead the first samples, and those after a gap, start. */
const LEAD = 0.05;

/** A screen's sound out: lazily a WebAudio context, once the user has touched the screen. */
export class SoundOut {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private cursor = 0;
  muted = false;
  /** Whether a frame has ever carried sound — the screen offers its mute button from then on. */
  heard = false;

  /** Call from a user gesture: browsers start sound only after one. */
  unlock(): void {
    if (this.ctx) return void (this.ctx.state === "suspended" && this.ctx.resume().catch(() => {}));
    const AC = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.muted ? 0 : 1;
      this.gain.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.gain) this.gain.gain.value = m ? 0 : 1;
  }

  play(s: Sound): void {
    if (!s.tones.length && !s.pcm) return;
    this.heard = true;
    const ctx = this.ctx;
    if (!ctx || !this.gain || ctx.state !== "running") return;
    for (const t of s.tones) this.tone(ctx, t);
    if (s.pcm && s.pcm.samples.length) this.queue(ctx, s.pcm);
  }

  private tone(ctx: AudioContext, t: Tone): void {
    const at = ctx.currentTime;
    const end = at + t.ms / 1000;
    const env = ctx.createGain();
    // a quick attack and release, so a note doesn't click
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(t.vol * 0.5, at + 0.005);
    env.gain.setValueAtTime(t.vol * 0.5, Math.max(at + 0.005, end - 0.01));
    env.gain.linearRampToValueAtTime(0, end);
    env.connect(this.gain!);
    let src: AudioScheduledSourceNode;
    if (t.wave === "noise") {
      const b = ctx.createBufferSource();
      b.buffer = this.noise ??= this.makeNoise(ctx);
      b.loop = true;
      b.playbackRate.setValueAtTime(t.hz / 440, at);
      if (t.to !== t.hz) b.playbackRate.linearRampToValueAtTime(t.to / 440, end);
      src = b;
    } else {
      const o = ctx.createOscillator();
      o.type = t.wave;
      o.frequency.setValueAtTime(t.hz, at);
      if (t.to !== t.hz) o.frequency.exponentialRampToValueAtTime(t.to, end);
      src = o;
    }
    src.connect(env);
    src.start(at);
    src.stop(end + 0.01);
    src.onended = () => env.disconnect();
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  private queue(ctx: AudioContext, p: Pcm): void {
    const now = ctx.currentTime;
    if (this.cursor < now) this.cursor = now + LEAD; // first samples, or after a gap
    if (this.cursor > now + AHEAD) return; // too far behind the picture: drop these
    const b = ctx.createBuffer(1, p.samples.length, p.rate);
    b.copyToChannel(p.samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(this.gain!);
    src.start(this.cursor);
    this.cursor += b.duration;
  }

  close(): void {
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.gain = null;
  }
}
