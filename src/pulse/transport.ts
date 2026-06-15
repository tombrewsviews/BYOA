// src/pulse/transport.ts
// A PlayerRef-shaped shim so the substrate Transport bar + Opt+Space work
// while the real clock is audio. Only the methods the shell calls are real.
export type TransportOpts = {
  durationSec: number;
  fps: number;
  getTime: () => number;        // returns audio currentTime in seconds
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (sec: number) => void;
  isPlaying?: () => boolean;
};

export type TransportShim = {
  getCurrentFrame: () => number;
  seekTo: (frame: number) => void;
  play: () => void;
  pause: () => void;
  isPlaying: () => boolean;
  getContainerNode: () => null;
  addEventListener: () => void;
  removeEventListener: () => void;
};

export function makeTransport(o: TransportOpts): TransportShim {
  let playing = false;
  return {
    getCurrentFrame: () => Math.round(o.getTime() * o.fps),
    seekTo: (frame: number) => o.onSeek?.(frame / o.fps),
    play: () => { playing = true; o.onPlay?.(); },
    pause: () => { playing = false; o.onPause?.(); },
    isPlaying: () => (o.isPlaying ? o.isPlaying() : playing),
    getContainerNode: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}
