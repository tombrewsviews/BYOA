// src/pulse/audioGraph.ts
import type { Stem } from "./schema";

export type Gains = Record<string, number>;

export function computeGains(stems: Pick<Stem, "id" | "volume" | "muted">[]): Gains {
  const g: Gains = {};
  for (const s of stems) g[s.id] = s.muted ? 0 : s.volume;
  return g;
}

// Live multi-stem player: one AudioContext, a decoded buffer + gain per stem,
// all started together so they stay sample-locked. currentTime is the shared
// clock the visualizer reads. Browser/Tauri webview only (needs Web Audio).
export type AudioGraph = {
  readonly ctx: AudioContext;
  play: () => void;
  pause: () => void;
  seek: (sec: number) => void;
  currentTime: () => number;
  duration: () => number;
  isPlaying: () => boolean;
  setGains: (g: Gains) => void;
  setLoop: (on: boolean) => void;
  isLooping: () => boolean;
  dispose: () => void;
};

export async function createAudioGraph(
  stemUrls: { id: string; url: string }[],
): Promise<AudioGraph> {
  const ctx = new AudioContext();
  const buffers: { id: string; buffer: AudioBuffer; gain: GainNode }[] = [];
  let duration = 0;
  for (const s of stemUrls) {
    const ab = await fetch(s.url).then((r) => r.arrayBuffer());
    const buffer = await ctx.decodeAudioData(ab);
    duration = Math.max(duration, buffer.duration);
    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(ctx.destination);
    buffers.push({ id: s.id, buffer, gain });
  }

  let sources: AudioBufferSourceNode[] = [];
  let startedAt = 0;       // ctx.currentTime when playback (re)started
  let offset = 0;          // seconds into the song at last (re)start
  let playing = false;
  let loop = true;         // loop on by default

  const stopSources = () => {
    for (const s of sources) { try { s.stop(); } catch { /* already stopped */ } }
    sources = [];
  };

  const startSources = (at: number) => {
    stopSources();
    offset = Math.max(0, Math.min(duration, at));
    startedAt = ctx.currentTime;
    sources = buffers.map((b) => {
      const src = ctx.createBufferSource();
      src.buffer = b.buffer;
      src.loop = loop;
      src.loopStart = 0;
      src.loopEnd = duration;
      src.connect(b.gain);
      src.start(0, offset);
      return src;
    });
  };

  // Elapsed time since the last (re)start, wrapped to the loop length when
  // looping so currentTime() stays within [0, duration).
  const elapsed = () => {
    const raw = offset + (ctx.currentTime - startedAt);
    if (loop && duration > 0) return raw % duration;
    return Math.min(duration, raw);
  };

  return {
    ctx,
    play: () => { if (playing) return; void ctx.resume(); startSources(offset); playing = true; },
    pause: () => { if (!playing) return; offset = elapsed(); stopSources(); playing = false; },
    seek: (sec: number) => { offset = Math.max(0, Math.min(duration, sec)); if (playing) startSources(offset); },
    currentTime: () => (playing ? elapsed() : offset),
    duration: () => duration,
    isPlaying: () => playing,
    setGains: (g) => { for (const b of buffers) { const v = g[b.id]; if (v != null) b.gain.gain.value = v; } },
    setLoop: (on: boolean) => {
      loop = on;
      for (const s of sources) s.loop = on;
    },
    isLooping: () => loop,
    dispose: () => { stopSources(); void ctx.close(); },
  };
}
