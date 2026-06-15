import { analyzeChannel, type Analysis } from "../../../src/pulse/analysis";

const HOP = 1 / 60;

type Imported = { id: string; file: string; sourceName: string };

// Decode a normalized stem WAV via Web Audio and analyze its mono mix.
async function analyzeStem(audioCtx: AudioContext, url: string, id: string, file: string) {
  const buf = await fetch(url).then((r) => r.arrayBuffer());
  const decoded = await audioCtx.decodeAudioData(buf);
  // Mono mix across channels.
  const n = decoded.numberOfChannels;
  const len = decoded.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < n; c++) {
    const d = decoded.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i] / n;
  }
  const res = analyzeChannel(mono, decoded.sampleRate, HOP);
  return { id, file, durationSec: decoded.duration, sampleRate: decoded.sampleRate, ...res };
}

/**
 * Analyze every imported stem into an Analysis timeline. `convert` is
 * Tauri's `convertFileSrc` so the webview can fetch the on-disk WAVs.
 * Returns the timeline plus the URL of the first stem (used as the
 * playback clock for the slice).
 */
export async function runAnalysis(
  convert: (p: string) => string,
  projectPath: string,
  imported: Imported[],
): Promise<{ analysis: Analysis; firstAudioUrl: string }> {
  const audioCtx = new AudioContext();
  const stems: Analysis["stems"] = [];
  let durationSec = 0;
  let sampleRate = 48000;
  for (const im of imported) {
    const url = convert(`${projectPath}/stems/${im.file}`);
    const a = await analyzeStem(audioCtx, url, im.id, im.file);
    durationSec = Math.max(durationSec, a.durationSec);
    sampleRate = a.sampleRate;
    stems.push({
      id: a.id,
      file: a.file,
      role: a.role,
      roleConfidence: a.roleConfidence,
      level: a.level,
      bandLow: a.bandLow,
      bandMid: a.bandMid,
      bandHigh: a.bandHigh,
      brightness: a.brightness,
      flux: a.flux,
      onsets: a.onsets,
    });
  }
  const analysis: Analysis = {
    version: 1,
    sampleRate,
    hopSec: HOP,
    durationSec,
    tempoBpm: 0,
    beatTimesSec: [],
    stems,
  };
  await audioCtx.close();
  return { analysis, firstAudioUrl: convert(`${projectPath}/stems/${imported[0].file}`) };
}
