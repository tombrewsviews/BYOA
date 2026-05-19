/**
 * Story-shape diff: compute the set of fields that differ between two
 * Story values, and merge per-field changes from two sides on top of a
 * common base.
 *
 * Why field-level (not deep JSON diff): the studio thinks about the
 * story in flat-ish fields the panel exposes. A "field" here is one of:
 *
 *   "bgColor" | "bgColor2" | "textColor" | "accentColor" | "accent2Color"
 *   "fontSize" | "glowIntensity" | "background"
 *   "beat:<i>:<key>"
 *   "beats:length"     (special — only differs if array lengths differ)
 *
 * The Panel UI maps each control to exactly one of these field keys, so
 * a per-field merge is faithful to user intent without needing array
 * reconciliation.
 */
import type { Story, Beat } from "../../../src/kinetic/schema";

export type FieldKey =
  | "bgColor"
  | "bgColor2"
  | "textColor"
  | "accentColor"
  | "accent2Color"
  | "fontSize"
  | "glowIntensity"
  | "background"
  | "beats:length"
  | `beat:${number}:${keyof Beat & string}`;

const STORY_SCALARS = [
  "bgColor",
  "bgColor2",
  "textColor",
  "accentColor",
  "accent2Color",
  "fontSize",
  "glowIntensity",
] as const;

const BEAT_KEYS: Array<keyof Beat & string> = [
  "text",
  "kind",
  // `track` and `startSeconds` are LOAD-BEARING here. They are
  // mutated by timeline drag (vertical = track, horizontal =
  // startSeconds) and by trim handles. Omitting them caused a
  // silent revert: the file watcher fires after every autosave; the
  // merge compares saved-vs-inMem field-by-field and, finding "no
  // tracked field changed", treats the disk content as authoritative
  // and overwrites in-mem state — including the just-dragged track
  // value. The drag appeared to succeed once (the visible state
  // updated immediately) but the next watcher tick rolled it back.
  "track",
  "startSeconds",
  "durationInSeconds",
  "easing",
  "direction",
  "dynamics",
  "staggerSeconds",
  "animateInPortion",
  "scale",
  "glow",
  "color",
  "shape",
];

const eq = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export const diffFields = (a: Story, b: Story): Set<FieldKey> => {
  const changed = new Set<FieldKey>();

  for (const k of STORY_SCALARS) {
    if (!eq(a[k], b[k])) changed.add(k);
  }
  if (!eq(a.background, b.background)) changed.add("background");
  if (a.beats.length !== b.beats.length) changed.add("beats:length");

  const minLen = Math.min(a.beats.length, b.beats.length);
  for (let i = 0; i < minLen; i++) {
    for (const key of BEAT_KEYS) {
      if (!eq(a.beats[i][key], b.beats[i][key])) {
        changed.add(`beat:${i}:${key}`);
      }
    }
  }
  return changed;
};

/**
 * Apply field-level changes from `from` onto `base`, but only for the
 * fields named in `fields`. Returns a new Story.
 */
export const applyFields = (
  base: Story,
  from: Story,
  fields: Set<FieldKey>,
): Story => {
  let next: Story = { ...base, beats: [...base.beats] };

  for (const f of fields) {
    if (f === "background") {
      next = { ...next, background: from.background };
    } else if (f === "beats:length") {
      next = { ...next, beats: [...from.beats] };
    } else if (f.startsWith("beat:")) {
      const [, idxStr, key] = f.split(":");
      const i = Number(idxStr);
      if (Number.isNaN(i) || i >= next.beats.length) continue;
      const k = key as keyof Beat;
      const updated: Beat = { ...next.beats[i], [k]: from.beats[i]?.[k] };
      next.beats = next.beats.map((b, idx) => (idx === i ? updated : b));
    } else {
      const k = f as (typeof STORY_SCALARS)[number];
      next = { ...next, [k]: from[k] } as Story;
    }
  }
  return next;
};

/** Read a field value from a story (for the conflict prompt text). */
export const readField = (s: Story, f: FieldKey): unknown => {
  if (f === "background") return s.background;
  if (f === "beats:length") return s.beats.length;
  if (f.startsWith("beat:")) {
    const [, idxStr, key] = f.split(":");
    const i = Number(idxStr);
    return s.beats[i]?.[key as keyof Beat];
  }
  return s[f as (typeof STORY_SCALARS)[number]];
};

/** Human-readable line for the conflict prompt. */
export const fieldLabel = (f: FieldKey): string => {
  if (f.startsWith("beat:")) {
    const [, idxStr, key] = f.split(":");
    return `beats[${idxStr}].${key}`;
  }
  if (f === "beats:length") return "beats (length)";
  return `story.${f}`;
};
