/**
 * The prompt library — a curated index of techniques the agent can build.
 *
 * Each entry is one card in the library tab. The user clicks Copy on a
 * card to paste the prompt into the terminal (or into their head). The
 * `story` field is a fragment of story.json that, when rendered standalone,
 * produces the preview the card shows.
 *
 * Adding a new entry: write the entry, run `npm run library:previews`
 * (defined in package.json) to regenerate the preview MP4 under
 * editor/library/previews/<slug>.mp4. The script reads this file's default
 * export and renders one composition per entry.
 *
 * Keep entries SHORT and TASTE-FORWARD: a card is an aspiration, not a
 * tutorial. Two sentences max in `blurb`, prompts under 30 words.
 */

import type { Beat, Story } from "../../src/kinetic/schema";

/**
 * The library entries live in plain TS but their `beats` rarely need to
 * specify every schema field — the Zod schema's defaults handle the rest
 * at parse-time. So entry beats are typed as Partial<Beat> & required text.
 * The preview script calls `storySchema.parse(entry.story)` which fills
 * in all defaults; the Library UI renders prompt + preview only and never
 * reads the per-beat fields directly.
 */
type EntryBeat = Partial<Beat> & Pick<Beat, "text">;
type EntryStory = Partial<Omit<Story, "beats">> & { beats: EntryBeat[] };

export type LibraryEntry = {
  /** stable slug used for preview filename + URL hash */
  slug: string;
  /** the technique name shown on the card */
  title: string;
  /** one-line description of when to use it */
  blurb: string;
  /** which broad category the card lives under */
  category:
    | "Entry"
    | "Exit"
    | "Variable font"
    | "Layering"
    | "Effects"
    | "Shapes";
  /** the prompt to copy — written as if the user is asking the agent */
  prompt: string;
  /** a 1.5–2.5s story fragment that demonstrates the technique */
  story: EntryStory;
};

/* ------------------------------------------------------------------ */
/* Shared minimal palette — keeps preview thumbs visually coherent.    */
/* Each entry may override any field. Stronger contrast than the dark  */
/* default so techniques read clearly in tiny preview tiles.           */
/* ------------------------------------------------------------------ */

const PALETTE = {
  fontSize: 200,
  fontFamily: "RobotoFlex" as const,
  bgColor: "#0b0b14",
  bgColor2: "#1c1432",
  textColor: "#fafafa",
  accentColor: "#7c5cff",
  accent2Color: "#ff5ca8",
  glowIntensity: 0.5,
  background: {
    kind: "shader" as const,
    shaderStyle: "aurora" as const,
    motion: 0.4,
    grain: 0,
  },
};

/* ------------------------------------------------------------------ */
/* Entries                                                             */
/* ------------------------------------------------------------------ */

export const ENTRIES: LibraryEntry[] = [
  // ---- Entry techniques --------------------------------------------------
  {
    slug: "vertical-roll",
    title: "Slot-machine roll-in",
    blurb:
      "Each letter rolls down vertically — readable on arrival, but never static.",
    category: "Entry",
    prompt:
      "Animate the word 'launch' as a slot-machine roll: letters fall in vertically from above with a small overshoot, hold readable, then exit by rotating -20°.",
    story: {
      ...PALETTE,
      beats: [
        {
          text: "launch",
          kind: "reveal",
          durationInSeconds: 1.8,
          animateInPortion: 0.5,
          animateOutPortion: 0.2,
          easing: "back.out",
          enterDirection: "vertical-roll",
          exitKind: "rotate",
          exitRotation: -20,
          dynamics: 0.6,
          staggerSeconds: 0.06,
          staggerCurve: 0.2,
          scale: 1,
          axes: { wght: [400, 800], wdth: [100, 110], slnt: [0, 0] },
          glow: 4,
          shadowLayers: 0,
          perLetterPalette: true,
        },
      ],
    },
  },
  {
    slug: "cinema-zoom",
    title: "Cinematic zoom-in",
    blurb: "One word fills the frame from huge → settled. For payoff moments.",
    category: "Entry",
    prompt:
      "Make the word 'HOPE' enter cinema-style — start massive (8× scale), settle at full size, exit zooming out into nothing. Single bold word, no glow.",
    story: {
      ...PALETTE,
      beats: [
        {
          text: "HOPE",
          kind: "cinema",
          durationInSeconds: 2.2,
          animateInPortion: 0.55,
          animateOutPortion: 0.25,
          easing: "power3.out",
          enterDirection: "scale",
          exitKind: "zoom",
          dynamics: 0.7,
          staggerSeconds: 0,
          staggerCurve: 0,
          scale: 1.1,
          axes: { wght: [900, 1000], wdth: [100, 100], slnt: [0, 0] },
          glow: 0,
          shadowLayers: 0,
          motionBlur: 4,
        },
      ],
    },
  },

  // ---- Variable-font techniques -----------------------------------------
  {
    slug: "elastic-oscillate",
    title: "Elastic oscillation",
    blurb:
      "Variable-font weight + scale pulse around 1.0. The 'always alive' look.",
    category: "Variable font",
    prompt:
      "Show the word 'elastic' wobbling — variable-font weight pulses 300→1000 around 1.0, letters scale subtly with the pulse, palette per letter.",
    story: {
      ...PALETTE,
      beats: [
        {
          text: "elastic",
          kind: "oscillate",
          durationInSeconds: 2.4,
          animateInPortion: 0.2,
          animateOutPortion: 0.15,
          easing: "elastic",
          enterDirection: "scale",
          exitKind: "scatter",
          dynamics: 0.8,
          staggerSeconds: 0.04,
          staggerCurve: 0.5,
          scale: 1,
          axes: { wght: [300, 1000], wdth: [85, 130], slnt: [0, 0] },
          perLetterPalette: true,
          glow: 0,
          shadowLayers: 2,
          shadowColor: "#000000",
        },
      ],
    },
  },
  {
    slug: "weight-wave",
    title: "Weight-wave reveal",
    blurb:
      "Letters travel up and gain weight + slant as they settle. Reads as growth.",
    category: "Variable font",
    prompt:
      "Reveal 'rising' with a weight wave — letters enter thin (wght 100) and end heavy (wght 900) with a slight forward slant, stagger curve wave so the ends arrive last.",
    story: {
      ...PALETTE,
      beats: [
        {
          text: "rising",
          kind: "reveal",
          durationInSeconds: 2.0,
          animateInPortion: 0.7,
          animateOutPortion: 0.15,
          easing: "power3.out",
          enterDirection: "up",
          exitKind: "echo",
          dynamics: 0.5,
          staggerSeconds: 0.08,
          staggerCurve: 0.8,
          scale: 1,
          axes: { wght: [100, 900], wdth: [110, 100], slnt: [-8, 0] },
          glow: 0,
          shadowLayers: 0,
          color: "#fafafa",
        },
      ],
    },
  },

  // ---- Exit techniques --------------------------------------------------
  {
    slug: "scatter-exit",
    title: "Scatter exit",
    blurb:
      "Letters explode outward in seeded random directions. Energy-release feeling.",
    category: "Exit",
    prompt:
      "Have the word 'boom' enter with elastic overshoot, hold for a beat, then scatter — each letter flies off in a random direction.",
    story: {
      ...PALETTE,
      bgColor: "#0a0a14",
      beats: [
        {
          text: "boom",
          kind: "reveal",
          durationInSeconds: 2.0,
          animateInPortion: 0.35,
          animateOutPortion: 0.4,
          easing: "elastic",
          enterDirection: "scale",
          exitKind: "scatter",
          dynamics: 0.9,
          staggerSeconds: 0.03,
          staggerCurve: 0.6,
          scale: 1.2,
          axes: { wght: [800, 900], wdth: [120, 130], slnt: [0, 0] },
          perLetterPalette: true,
          glow: 6,
          shadowLayers: 0,
        },
      ],
    },
  },
  {
    slug: "blur-exit",
    title: "Blur-out exit",
    blurb: "Word swells slightly while blurring into nothing. Soft fade.",
    category: "Exit",
    prompt:
      "Show 'memory' entering soft and gentle, holding briefly, then leaving by blurring out — the word should swell ~20% as it dissolves.",
    story: {
      ...PALETTE,
      beats: [
        {
          text: "memory",
          kind: "reveal",
          durationInSeconds: 2.4,
          animateInPortion: 0.4,
          animateOutPortion: 0.45,
          easing: "power3.out",
          enterDirection: "scale",
          exitKind: "blur",
          dynamics: 0.4,
          staggerSeconds: 0.06,
          staggerCurve: 0.3,
          scale: 1,
          axes: { wght: [300, 600], wdth: [100, 100], slnt: [-5, 0] },
          glow: 8,
          shadowLayers: 0,
        },
      ],
    },
  },
  {
    slug: "drop-exit",
    title: "Gravity drop exit",
    blurb: "Word stays, then gravity pulls it off-screen with a slight tumble.",
    category: "Exit",
    prompt:
      "Word 'gone' enters quickly, holds, then drops out of frame with gravity — falls down and rotates slightly as it goes.",
    story: {
      ...PALETTE,
      beats: [
        {
          text: "gone",
          kind: "reveal",
          durationInSeconds: 1.8,
          animateInPortion: 0.3,
          animateOutPortion: 0.4,
          easing: "back.out",
          enterDirection: "up",
          exitKind: "drop",
          dynamics: 0.55,
          staggerSeconds: 0.05,
          staggerCurve: 0.3,
          scale: 1,
          axes: { wght: [700, 900], wdth: [100, 100], slnt: [0, 0] },
          glow: 0,
          shadowLayers: 2,
          shadowColor: "#7c5cff",
        },
      ],
    },
  },

  // ---- Layering / palette -----------------------------------------------
  {
    slug: "palette-per-letter",
    title: "Palette per letter",
    blurb:
      "Each letter takes its own colour from the story palette. The MAKE-LIFE-GOOD look.",
    category: "Layering",
    prompt:
      "Show 'design' with per-letter palette cycling text → accent → secondary, slight stagger wave on entry, hold readable for a full second.",
    story: {
      ...PALETTE,
      accentColor: "#ff5ca8",
      accent2Color: "#7c5cff",
      beats: [
        {
          text: "design",
          kind: "reveal",
          durationInSeconds: 2.2,
          animateInPortion: 0.3,
          animateOutPortion: 0.2,
          easing: "back.out",
          enterDirection: "up",
          exitKind: "rotate",
          exitRotation: 15,
          dynamics: 0.6,
          staggerSeconds: 0.06,
          staggerCurve: 0.7,
          scale: 1,
          axes: { wght: [800, 900], wdth: [110, 110], slnt: [0, 0] },
          perLetterPalette: true,
          glow: 0,
          shadowLayers: 0,
        },
      ],
    },
  },
  {
    slug: "shadow-stack",
    title: "Stacked drop-shadow depth",
    blurb: "Layered offset shadows give 3D depth without 3D. The LottieFiles look.",
    category: "Effects",
    prompt:
      "Word 'depth' bold and centered, with a stack of 4 offset drop-shadows behind it in accent purple for cheap 3D depth, no glow.",
    story: {
      ...PALETTE,
      accentColor: "#7c5cff",
      beats: [
        {
          text: "depth",
          kind: "reveal",
          durationInSeconds: 2.0,
          animateInPortion: 0.4,
          animateOutPortion: 0.2,
          easing: "back.out",
          enterDirection: "scale",
          exitKind: "echo",
          dynamics: 0.5,
          staggerSeconds: 0.04,
          staggerCurve: 0.3,
          scale: 1,
          axes: { wght: [900, 1000], wdth: [120, 130], slnt: [0, 0] },
          perLetterPalette: false,
          color: "#fafafa",
          glow: 0,
          shadowLayers: 4,
          shadowColor: "#7c5cff",
        },
      ],
    },
  },

  // ---- Shapes / morph ---------------------------------------------------
  {
    slug: "morph-shape",
    title: "Shape morphs into word",
    blurb:
      "A custom SVG shape morphs into the first letter — the rest of the word fades in around it.",
    category: "Shapes",
    prompt:
      "Have a soft cloud-like shape (generate via Recraft) morph into the first letter of the word 'every', the rest of the word fading in around it, exit rotating gently.",
    story: {
      ...PALETTE,
      bgColor: "#1a0f24",
      bgColor2: "#3a1a4a",
      beats: [
        {
          text: "every",
          kind: "morph",
          durationInSeconds: 2.4,
          animateInPortion: 0.55,
          animateOutPortion: 0.2,
          easing: "back.out",
          enterDirection: "vertical-roll",
          exitKind: "rotate",
          exitRotation: -15,
          dynamics: 0.55,
          staggerSeconds: 0.05,
          staggerCurve: 0.4,
          scale: 1,
          axes: { wght: [600, 800], wdth: [90, 110], slnt: [0, 0] },
          morphAnchorX: 0.5,
          morphAnchorY: 0.5,
          morphStartScale: 0.45,
          morphStartRotation: -25,
          color: "#FFF4BC",
          glow: 6,
          shadowLayers: 0,
          // a soft blob shape (placeholder — Recraft would replace this)
          shape:
            "M 50 10 C 75 10 90 30 90 50 C 90 75 70 90 50 90 C 25 90 10 70 10 50 C 10 25 30 10 50 10 Z",
        },
      ],
    },
  },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const ENTRIES_BY_CATEGORY = (): Map<string, LibraryEntry[]> => {
  const m = new Map<string, LibraryEntry[]>();
  for (const e of ENTRIES) {
    const arr = m.get(e.category) ?? [];
    arr.push(e);
    m.set(e.category, arr);
  }
  return m;
};

export const findEntry = (slug: string): LibraryEntry | undefined =>
  ENTRIES.find((e) => e.slug === slug);
