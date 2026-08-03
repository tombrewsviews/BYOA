/**
 * Web Audio–synthesized SFX. No asset files. Never throws before the first
 * user gesture (§10.10): every effect no-ops until initAudio() has run and
 * the context is running.
 *
 * Everything routes through a master gain → compressor bus so layered,
 * loud effects glue together without clipping; percussive layers can also
 * route through a tanh waveshaper for grit.
 */
const MUTE_KEY = 'lastshell.muted';

let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  /* storage unavailable — default unmuted */
}

/** Call from a user gesture to unlock audio on mobile. Safe to call repeatedly. */
export function initAudio(): void {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function isAudioRunning(): boolean {
  return ctx?.state === 'running';
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function withCtx(fn: (ac: AudioContext, t0: number) => void): void {
  if (muted || !ctx) return;
  if (ctx.state !== 'running') {
    // SFX fire from gesture handlers, so this can recover a suspended context
    ctx.resume().catch(() => {});
    return;
  }
  try {
    fn(ctx, ctx.currentTime);
  } catch {
    /* never let SFX crash the game */
  }
}

let master: { ac: AudioContext; node: GainNode } | null = null;

function bus(ac: AudioContext): AudioNode {
  if (!master || master.ac !== ac) {
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    comp.connect(ac.destination);
    const g = ac.createGain();
    g.gain.value = 0.9;
    g.connect(comp);
    master = { ac, node: g };
  }
  return master.node;
}

let shaper: { ac: AudioContext; node: WaveShaperNode } | null = null;

function grit(ac: AudioContext): AudioNode {
  if (!shaper || shaper.ac !== ac) {
    const ws = ac.createWaveShaper();
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(2.5 * x);
    }
    ws.curve = curve;
    ws.connect(bus(ac));
    shaper = { ac, node: ws };
  }
  return shaper.node;
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  slideTo?: number;
  at?: number;
  drive?: boolean;
}

function tone(ac: AudioContext, t0: number, freq: number, dur: number, opts: ToneOpts = {}): void {
  const { type = 'sine', gain = 0.15, slideTo, at = 0, drive = false } = opts;
  const t = t0 + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(drive ? grit(ac) : bus(ac));
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

interface NoiseOpts {
  filter?: BiquadFilterType;
  freq?: number;
  gain?: number;
  at?: number;
  drive?: boolean;
}

function noise(ac: AudioContext, t0: number, dur: number, opts: NoiseOpts = {}): void {
  const { filter = 'lowpass', freq = 1000, gain = 0.3, at = 0, drive = false } = opts;
  const t = t0 + at;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const biquad = ac.createBiquadFilter();
  biquad.type = filter;
  biquad.frequency.setValueAtTime(freq, t);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(biquad).connect(g).connect(drive ? grit(ac) : bus(ac));
  src.start(t);
}

export const sfx = {
  /** Live round: sub-bass drop + driven boom + crack, slapback echo, room tail. */
  shot(): void {
    withCtx((ac, t) => {
      tone(ac, t, 160, 0.55, { type: 'sine', gain: 0.85, slideTo: 32 });
      noise(ac, t, 0.5, { filter: 'lowpass', freq: 520, gain: 0.9, drive: true });
      noise(ac, t, 0.05, { filter: 'highpass', freq: 2600, gain: 0.4 });
      noise(ac, t, 0.05, { filter: 'highpass', freq: 2200, gain: 0.16, at: 0.14 });
      noise(ac, t, 1.1, { filter: 'bandpass', freq: 220, gain: 0.3 });
    });
  },

  /** Blank: hammer snap, low thud, spring settle — dry but tense. */
  click(): void {
    withCtx((ac, t) => {
      noise(ac, t, 0.025, { filter: 'highpass', freq: 3200, gain: 0.3 });
      tone(ac, t, 2200, 0.03, { type: 'square', gain: 0.08 });
      tone(ac, t, 150, 0.07, { type: 'sine', gain: 0.25 });
      noise(ac, t, 0.05, { filter: 'bandpass', freq: 900, gain: 0.18, at: 0.07 });
      tone(ac, t, 620, 0.05, { type: 'square', gain: 0.06, at: 0.08 });
    });
  },

  /** Pump/rack at round start: two mechanical chunks with weight. */
  pump(): void {
    withCtx((ac, t) => {
      noise(ac, t, 0.09, { filter: 'bandpass', freq: 900, gain: 0.45 });
      tone(ac, t, 120, 0.07, { type: 'sine', gain: 0.25 });
      noise(ac, t, 0.11, { filter: 'bandpass', freq: 600, gain: 0.5, at: 0.16 });
      tone(ac, t, 90, 0.09, { type: 'sine', gain: 0.3, at: 0.16 });
    });
  },

  /** Shell-load tick (one per shell during the intro). */
  loadTick(): void {
    withCtx((ac, t) => {
      tone(ac, t, 1300, 0.03, { type: 'triangle', gain: 0.12 });
      noise(ac, t, 0.02, { filter: 'highpass', freq: 4000, gain: 0.1 });
    });
  },

  /** Item pickup: bright two-note blip with an octave shine. */
  pickup(): void {
    withCtx((ac, t) => {
      tone(ac, t, 660, 0.09, { type: 'triangle', gain: 0.14 });
      tone(ac, t, 990, 0.16, { type: 'triangle', gain: 0.14, at: 0.09 });
      tone(ac, t, 1980, 0.14, { type: 'sine', gain: 0.05, at: 0.09 });
    });
  },

  /** Magnifying glass: rising double sweep with a crystal sparkle. */
  peek(): void {
    withCtx((ac, t) => {
      tone(ac, t, 600, 0.35, { type: 'sine', gain: 0.12, slideTo: 1800 });
      tone(ac, t, 1200, 0.3, { type: 'sine', gain: 0.06, slideTo: 3600, at: 0.05 });
      tone(ac, t, 2093, 0.12, { type: 'triangle', gain: 0.08, at: 0.3 });
      tone(ac, t, 2637, 0.18, { type: 'triangle', gain: 0.08, at: 0.4 });
    });
  },

  /** Extra life: warm rising chord with harmonics and sparkle air. */
  heal(): void {
    withCtx((ac, t) => {
      const notes = [392, 523.25, 659.25, 783.99];
      notes.forEach((f, i) => {
        tone(ac, t, f, 0.3, { type: 'triangle', gain: 0.14, at: i * 0.09 });
        tone(ac, t, f * 2, 0.25, { type: 'sine', gain: 0.05, at: i * 0.09 });
      });
      tone(ac, t, 1046.5, 0.6, { type: 'sine', gain: 0.1, at: 0.36 });
      noise(ac, t, 0.5, { filter: 'highpass', freq: 8000, gain: 0.04, at: 0.1 });
    });
  },

  /** Saw: driven detuned growl sliding down, metal screech, ping-off. */
  saw(): void {
    withCtx((ac, t) => {
      tone(ac, t, 84, 0.55, { type: 'sawtooth', gain: 0.3, slideTo: 55, drive: true });
      tone(ac, t, 89, 0.55, { type: 'sawtooth', gain: 0.3, slideTo: 58, drive: true });
      tone(ac, t, 168, 0.5, { type: 'square', gain: 0.12, slideTo: 110, drive: true });
      noise(ac, t, 0.5, { filter: 'bandpass', freq: 2600, gain: 0.22 });
      noise(ac, t, 0.12, { filter: 'highpass', freq: 5000, gain: 0.15, at: 0.4 });
    });
  },

  /** Handcuffs: two heavy clanks and a ratchet zip. */
  cuff(): void {
    withCtx((ac, t) => {
      for (const at of [0, 0.16]) {
        noise(ac, t, 0.05, { filter: 'bandpass', freq: 3800, gain: 0.35, at });
        tone(ac, t, 1250, 0.1, { type: 'triangle', gain: 0.18, at });
        tone(ac, t, 2900, 0.14, { type: 'sine', gain: 0.1, at });
        tone(ac, t, 95, 0.08, { type: 'sine', gain: 0.3, at });
      }
      for (let i = 0; i < 6; i++) {
        noise(ac, t, 0.015, { filter: 'highpass', freq: 4500, gain: 0.12, at: 0.3 + i * 0.03 });
      }
    });
  },

  /** Elimination: sub drop into the floor, rumble, cracked bell. */
  elimination(): void {
    withCtx((ac, t) => {
      tone(ac, t, 220, 0.9, { type: 'sine', gain: 0.4, slideTo: 36 });
      tone(ac, t, 330, 0.4, { type: 'triangle', gain: 0.2, slideTo: 110 });
      noise(ac, t, 0.9, { filter: 'lowpass', freq: 300, gain: 0.35 });
      tone(ac, t, 655, 0.7, { type: 'triangle', gain: 0.12, slideTo: 640, at: 0.25 });
    });
  },

  /** Victory: two-voice fanfare into a held chord with shimmer. */
  victory(): void {
    withCtx((ac, t) => {
      const seq = [523.25, 659.25, 783.99, 1046.5];
      seq.forEach((f, i) => {
        tone(ac, t, f, 0.24, { type: 'triangle', gain: 0.16, at: i * 0.12 });
        tone(ac, t, f / 2, 0.24, { type: 'triangle', gain: 0.08, at: i * 0.12 });
      });
      [523.25, 659.25, 783.99, 1318.5].forEach((f) =>
        tone(ac, t, f, 0.9, { type: 'triangle', gain: 0.1, at: 0.5 }),
      );
      noise(ac, t, 0.8, { filter: 'highpass', freq: 7000, gain: 0.05, at: 0.5 });
    });
  },
};
