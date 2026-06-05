import type { DialState } from "./types";

/** In-session named dial states for A/B. No persistence (matches spec). */
export class SnapshotStore {
  private map = new Map<string, DialState>();
  save(name: string, state: DialState): void { this.map.set(name, { ...state }); }
  get(name: string): DialState | undefined { const s = this.map.get(name); return s && { ...s }; }
  names(): string[] { return [...this.map.keys()]; }
  delete(name: string): void { this.map.delete(name); }
}
