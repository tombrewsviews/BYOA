/**
 * THE PRODUCT SURFACE — and the parameter editor.
 *
 * A "kinetic story" is a JSON document: a sequence of beats. This schema
 * doubles as the Studio editor (Zod -> auto-generated controls).
 *
 * Division of control (unchanged):
 *  - Claude Code owns the SEQUENCE (beats, kinds, shapes).
 *  - Studio owns the PARAMETERS (knobs below).
 *
 * This file was extended to support the Tier-1/2/3 upgrades:
 *  • per-beat font family (variable fonts) + animated axis ranges (wght /
 *    wdth / slnt) so words can stretch & flex while on screen.
 *  • split entrance vs. exit motion (enterDirection / exitKind) so words
 *    enter readable (vertical) and leave dynamic (rotate / scatter / blur
 *    / echo / morphOut).
 *  • user-defined morph anchor (where on screen the shape→letter morph
 *    happens) + visible kinetic motion on the morph itself.
 *  • per-letter palette so each letter can take its own color from the
 *    story's palette (MAKE-LIFE-GOOD / KEEP-GOING look).
 *  • new beat kinds: `tile` (marquee tiling), `oscillate` (letters wobble
 *    around 1.0 — the ELASTIC reference), `cinema` (single-letter zoom).
 *
 * Back-compat: all new fields are optional with sensible defaults. An old
 * `direction` field still works and maps to `enterDirection`.
 */
import { z } from "zod";
import { zColor } from "@remotion/zod-types";

// ---------------------------------------------------------------------------
// Shared parameter vocabulary
// ---------------------------------------------------------------------------

export const easingSchema = z
  .enum(["power3.out", "power3.inOut", "power4.out", "spring", "elastic", "back.out"])
  .describe("Animation curve");

export const directionSchema = z
  .enum(["up", "down", "left", "right", "scale", "vertical-roll"])
  .describe("Entrance/exit direction");

export const exitKindSchema = z
  .enum(["none", "rotate", "drop", "scatter", "blur", "echo", "morphOut", "zoom"])
  .describe("How the word leaves the screen");

export const beatKindSchema = z
  .enum([
    "reveal",         // letter-by-letter build-in
    "morph",          // a shape morphs into the word's first letter
    "generativeFill", // word masks a moving generative noise field
    "tile",           // word tiled into a marquee grid (RISE / ELASTIC)
    "oscillate",      // letters wobble on wght+scale around 1.0 (ELASTIC)
    "cinema",         // massive zoom-in on a single letter or short word (HOPE)
    "shape",          // standalone illustration (one or more SVG paths)
    "videoClip",      // local MP4 (or YouTube-imported MP4) as a timeline clip
    "imageClip",      // still image with optional Ken Burns zoom/pan
  ])
  .describe("Animation type for this beat");

/**
 * One path in an illustration: SVG path `d` plus a fill color. Stroke is
 * optional for line-art illustrations (also used for draw-on entry where
 * we animate stroke-dashoffset along the path).
 */
export const shapePathSchema = z.object({
  d: z.string().describe("SVG path data"),
  fill: z.string().optional().describe("Fill color (hex). Omit for stroke-only."),
  stroke: z.string().optional().describe("Stroke color (hex). For line art."),
  strokeWidth: z.number().min(0).max(40).default(0).describe("Stroke width"),
});
export type ShapePath = z.infer<typeof shapePathSchema>;

/** Entry/exit styles a shape beat can use. */
export const shapeEntrySchema = z
  .enum(["fade", "scale", "draw", "fade-up"])
  .describe("How the shape enters");
export const shapeExitSchema = z
  .enum(["fade", "scale-down", "blur", "morphOut", "none"])
  .describe("How the shape leaves");

export const fontFamilySchema = z
  .enum([
    "SpaceGrotesk",
    "RobotoFlex",
    "Recursive",
    "InterVF",
    "Fraunces",
    "BricolageGrotesque",
    "InstrumentSans",
    "Archivo",
  ])
  .describe("Typeface");

export type BeatKind = z.infer<typeof beatKindSchema>;
export type Easing = z.infer<typeof easingSchema>;
export type Direction = z.infer<typeof directionSchema>;
export type ExitKind = z.infer<typeof exitKindSchema>;
export type FontFamily = z.infer<typeof fontFamilySchema>;

// ---------------------------------------------------------------------------
// Variable-font axis range — a [start, end] tuple animated across the beat
// ---------------------------------------------------------------------------

/**
 * `[start, end]` for an axis value, applied per-letter as the beat plays.
 * Use the same value twice (e.g. `[700, 700]`) to hold the axis static.
 *
 * The reveal/oscillate beats use these to drive `font-variation-settings`
 * — that's the move the ELASTIC reference is built on.
 */
const axisRange = (min: number, max: number, def: [number, number]) =>
  z
    .tuple([z.number().min(min).max(max), z.number().min(min).max(max)])
    .default(def);

export const axisRangesSchema = z.object({
  /** weight axis — Roboto Flex 100–1000, Recursive 300–1000, Inter 100–900 */
  wght: axisRange(100, 1000, [700, 700]).describe("Weight axis [start, end]"),
  /** width axis — Roboto Flex 25–151, others narrower or absent */
  wdth: axisRange(25, 200, [100, 100]).describe("Width axis [start, end]"),
  /** slant axis — Roboto Flex -10…0, Recursive -15…0 */
  slnt: axisRange(-15, 0, [0, 0]).describe("Slant axis [start, end]"),
}).default({ wght: [700, 700], wdth: [100, 100], slnt: [0, 0] });
export type AxisRanges = z.infer<typeof axisRangesSchema>;

// ---------------------------------------------------------------------------
// Beat — one word/phrase + every tweakable parameter for it
// ---------------------------------------------------------------------------

export const beatSchema = z.object({
  // --- content (Claude owns these) ---------------------------------------
  text: z.string().min(1).describe("Word or phrase"),
  kind: beatKindSchema.default("reveal"),
  /**
   * For `kind: "morph"` ONLY — the SVG path the first letter morphs FROM.
   * Generated by a vector provider (Recraft) via the `kinetic` CLI.
   */
  shape: z.string().optional().describe("Morph source path (provider-generated)"),

  // --- timing (tweakable) ------------------------------------------------
  /**
   * When this beat starts, in seconds from the beginning of the story.
   * If omitted, the beat is laid out sequentially after the previous one
   * (the legacy linear-sequence behavior). Setting it explicitly enables
   * arbitrary placement — overlapping beats, gaps, alignment across
   * tracks.
   */
  startSeconds: z
    .number()
    .min(0)
    .max(600)
    .optional()
    .describe("Start time in seconds (optional — defaults to sequential)"),
  /**
   * Vertical layering. Beats on the same `track` cannot overlap in time;
   * beats on different tracks render simultaneously. Used purely as a
   * z-order + non-overlap hint — KineticStory renders ALL beats whose
   * time window contains the current frame, regardless of track.
   */
  track: z
    .number()
    .int()
    .min(0)
    .max(15)
    .default(0)
    .describe("Track index (z-order layer)"),
  durationInSeconds: z
    .number()
    .min(0.3)
    .max(10)

    .default(1.5)
    .describe("Beat duration (seconds)"),
  /** fraction of the beat spent animating IN at the start (0.1–0.9) */
  animateInPortion: z
    .number()
    .min(0.1)
    .max(0.9)

    .default(0.4)
    .describe("Portion spent animating in"),
  /** fraction of the beat spent animating OUT at the end (0–0.6) */
  animateOutPortion: z
    .number()
    .min(0)
    .max(0.6)

    .default(0.25)
    .describe("Portion spent animating out"),

  // --- motion: enter -----------------------------------------------------
  easing: easingSchema.default("power3.out"),
  /**
   * Where the element enters from. "vertical-roll" is the slot-machine
   * effect (UNTITLED ref) — letter rolls down from above with a tall
   * clip-region so a slice of the previous letter is briefly visible.
   */
  enterDirection: directionSchema.default("vertical-roll"),
  /**
   * DEPRECATED, kept for back-compat with story.json files written before
   * the enter/exit split. If `enterDirection` is left at its default and
   * this is set, it aliases to enterDirection at parse time.
   */
  direction: directionSchema.optional().describe("(deprecated — use enterDirection)"),

  // --- motion: exit ------------------------------------------------------
  /**
   * How the word leaves. Default `rotate` matches the user brief: words
   * are easy to read on the way in (vertical), interesting on the way out
   * (rotate in plane while remaining in view).
   */
  exitKind: exitKindSchema.default("rotate"),
  /** angle in degrees the word rotates by during exit (rotate / echo) */
  exitRotation: z
    .number()
    .min(-180)
    .max(180)

    .default(-25)
    .describe("Exit rotation (deg)"),

  // --- motion: dynamics --------------------------------------------------
  dynamics: z
    .number()
    .min(0)
    .max(1)

    .default(0.5)
    .describe("Motion energy (subtle ↔ punchy)"),
  staggerSeconds: z
    .number()
    .min(0)
    .max(0.2)

    .default(0.05)
    .describe("Stagger between letters (seconds)"),
  /**
   * 0 = uniform stagger (left→right), 1 = wave (letters at the ends arrive
   * last). The elastic / KEEP-GOING look uses higher values.
   */
  staggerCurve: z
    .number()
    .min(0)
    .max(1)

    .default(0)
    .describe("Stagger wave-curve (0 linear ↔ 1 wave)"),
  scale: z
    .number()
    .min(0.3)
    .max(10)

    .default(1)
    .describe("Element scale (settled size multiplier — entry zooms are built into beat kinds)"),
  /**
   * Per-letter motion-blur intensity, in px. Applied during high-velocity
   * frames only (entry/exit). The MOBILE-APP swipe + KEEP-GOING-G feel.
   */
  motionBlur: z
    .number()
    .min(0)
    .max(20)

    .default(0)
    .describe("Motion blur (px)"),

  // --- typography --------------------------------------------------------
  /** override the story's font family for just this beat */
  fontFamily: fontFamilySchema.optional().describe("Font (overrides story)"),
  /** animated variable-font axes for this beat */
  axes: axisRangesSchema,

  // --- position (tweakable, drag-aware) ----------------------------------
  /**
   * Where the word is anchored on the canvas, normalized 0..1.
   * 0,0 = top-left, 1,1 = bottom-right, 0.5,0.5 = centered (default).
   * Drag a word in the preview to update these. Used by all beat kinds
   * (for morph beats, these override the legacy morphAnchorX/Y so the
   * single drag-to-position interaction works uniformly).
   */
  positionX: z
    .number()
    .min(-0.5)
    .max(1.5)
    .default(0.5)
    .describe("X position (0=left, 1=right)"),
  positionY: z
    .number()
    .min(-0.5)
    .max(1.5)
    .default(0.5)
    .describe("Y position (0=top, 1=bottom)"),
  /**
   * Static rotation in degrees applied around the beat's anchor. Stacks
   * ON TOP of any animated rotation (exit kinds like `rotate`, the
   * morph beat's `morphStartRotation`, etc.) — those keep working
   * unchanged; this is an extra tilt applied to the outermost
   * transform. Adjust via the preview's rotation handle or the panel
   * slider. 0 = upright (default).
   */
  rotation: z
    .number()
    .min(-180)
    .max(180)
    .default(0)
    .describe("Static rotation around the anchor (deg)"),

  // --- look (tweakable) --------------------------------------------------
  color: zColor().optional().describe("Color override (uniform)"),
  /**
   * Per-letter palette mode. If true, each letter cycles through the
   * story's [textColor, accentColor, accent2Color] in order (MAKE-LIFE-
   * GOOD / KEEP-GOING look).
   */
  perLetterPalette: z
    .boolean()
    .default(false)
    .describe("Cycle letters through the story palette"),
  glow: z
    .number()
    .min(0)
    .max(60)

    .default(0)
    .describe("Glow radius (px)"),
  /**
   * Stacked-offset drop-shadow count behind the type (LottieFiles + HOPE
   * reference). 0 = none, higher = deeper layered shadow.
   */
  shadowLayers: z
    .number()
    .int()
    .min(0)
    .max(8)

    .default(0)
    .describe("Layered drop-shadow depth (count)"),
  shadowColor: zColor().optional().describe("Shadow color"),
  /**
   * Beat opacity, 0..1. Multiplied with any animation-driven opacity
   * (e.g. exit fades), so user-set opacity caps the peak. Default 1
   * (no change).
   */
  opacity: z
    .number()
    .min(0)
    .max(1)

    .default(1)
    .describe("Beat opacity (0=invisible, 1=fully visible)"),
  /**
   * CSS `mix-blend-mode` applied to this beat. Lets the beat composite
   * against beats on lower tracks, videos, images, and the background.
   * Default `"normal"` (no change).
   */
  blendMode: z
    .enum([
      "normal",
      "multiply",
      "screen",
      "overlay",
      "darken",
      "lighten",
      "color-dodge",
      "color-burn",
      "hard-light",
      "soft-light",
      "difference",
      "exclusion",
      "hue",
      "saturation",
      "color",
      "luminosity",
    ])
    .default("normal")
    .describe("CSS mix-blend-mode applied to this beat"),

  // --- morph-only --------------------------------------------------------
  /**
   * Where (0..1 of screen) the morph happens. Default centered. Letting
   * the user place it makes the shape feel intentional, not floating.
   */
  morphAnchorX: z
    .number()
    .min(0)
    .max(1)

    .default(0.5)
    .describe("Morph anchor x (0=left, 1=right)"),
  morphAnchorY: z
    .number()
    .min(0)
    .max(1)

    .default(0.5)
    .describe("Morph anchor y (0=top, 1=bottom)"),
  /** scale of the morph shape at the START of the morph (1 = letter size) */
  morphStartScale: z
    .number()
    .min(0.1)
    .max(3)

    .default(0.5)
    .describe("Morph start scale"),
  /** rotation of the morph shape at the START, in degrees */
  morphStartRotation: z
    .number()
    .min(-180)
    .max(180)

    .default(-15)
    .describe("Morph start rotation (deg)"),

  // --- tile-only ---------------------------------------------------------
  /** for `kind: "tile"` — how many rows the word repeats in */
  tileRows: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(7)
    .describe("Tile rows"),
  /** for `kind: "tile"` — direction the tiled grid scrolls */
  tileScrollAngle: z
    .number()
    .min(-90)
    .max(90)

    .default(-15)
    .describe("Tile scroll angle (deg)"),

  // --- shape-beat-only ---------------------------------------------------
  /**
   * For `kind: "shape"` ONLY — the illustration's paths. Each entry is one
   * `<path>` in the rendered SVG. The illustration's authored viewBox is
   * assumed to be 0 0 100 100 (matches morph shapes). KineticStory scales
   * the whole illustration to `shapeSize` of the canvas height.
   */
  shapePaths: z
    .array(shapePathSchema)
    .default([])
    .describe("Illustration paths (shape beats)"),
  /** Size of the illustration relative to canvas height (0..1). */
  shapeSize: z
    .number()
    .min(0.05)
    .max(2)
    .default(0.5)
    .describe("Shape size (fraction of canvas height)"),
  /** How the shape comes onto the canvas. */
  shapeEntry: shapeEntrySchema.default("scale"),
  /** How the shape leaves. */
  shapeExit: shapeExitSchema.default("fade"),

  // --- imageClip-only ----------------------------------------------------
  /**
   * For `kind: "imageClip"` — absolute path to a local image file
   * (jpg/png/webp/gif). Imported files live under `<project>/assets/`
   * so the project stays self-contained.
   */
  imageSrc: z.string().optional().describe("Path to the local image source"),
  /**
   * Ken Burns zoom intensity. 0 = no zoom (still image stays the same
   * scale across the clip). 0.2 = subtle 20% zoom. 0.5 = noticeable
   * push. Direction (in or out) is controlled by zoomDir.
   */
  kenBurnsZoom: z
    .number()
    .min(0)
    .max(1)
    .default(0.15)
    .describe("Ken Burns zoom strength (0=off, 1=2x scale change)"),
  /**
   * Whether the Ken Burns motion zooms IN (starts wide, ends tight) or
   * OUT (starts tight, ends wide).
   */
  kenBurnsDir: z
    .enum(["in", "out"])
    .default("in")
    .describe("Ken Burns zoom direction"),
  /**
   * Pan amount during the clip, expressed as a fraction of the image's
   * own size. 0 = no pan. 0.1 = pan 10% of the image dimension across
   * the clip's duration.
   */
  kenBurnsPan: z
    .number()
    .min(0)
    .max(0.5)
    .default(0)
    .describe("Ken Burns pan amount (fraction of image size)"),
  /** Pan direction. */
  kenBurnsPanAngle: z
    .number()
    .min(-180)
    .max(180)
    .default(0)
    .describe("Pan direction (deg, 0=right, 90=down)"),

  // --- videoClip-only ----------------------------------------------------
  /**
   * For `kind: "videoClip"` — absolute path to the local MP4 the studio
   * plays. Files are kept under `<project>/assets/` so the project is
   * self-contained. YouTube imports run through yt-dlp on the Rust side
   * and end up here as a path to a downloaded MP4.
   */
  videoSrc: z.string().optional().describe("Path to the local MP4 source"),
  /**
   * Offset into the source video where playback begins, in seconds.
   * Together with `durationInSeconds` this defines the in-point / out-
   * point. 0 = play from the start of the source.
   */
  videoStartSec: z
    .number()
    .min(0)
    .max(3600)
    .default(0)
    .describe("Offset into source video where playback begins (seconds)"),
  /**
   * Audio level. Default 0 (silent) because kinetic-type stories are
   * usually scored separately; users opt in per clip.
   */
  volume: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .describe("Audio volume (0=silent, 1=full)"),

  // --- morph-from-shape (text morphs out of a shape on another track) ----
  /**
   * For `kind: "morph"` — instead of using the inline `shape` field, point
   * at the index of a sibling `shape` beat in this story. The morph beat
   * inherits that shape as the source. This is the "illustration → text"
   * pattern: a `shape` beat displays the illustration, then a `morph` beat
   * on the same time slot transforms it into the word's first letter.
   *
   * Schema-level reference: if set, takes priority over `shape`.
   */
  morphSourceBeat: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Index of sibling shape beat to morph FROM"),
  /**
   * How long the source shape holds, unchanged, before the morph begins.
   * Use to let the illustration breathe before transforming.
   * Measured as a fraction of the beat's duration (0..0.9).
   */
  morphHoldPortion: z
    .number()
    .min(0)
    .max(0.9)
    .default(0)
    .describe("Hold before morph starts (fraction of beat duration)"),
});
export type Beat = z.infer<typeof beatSchema>;

// ---------------------------------------------------------------------------
// Background (unchanged)
// ---------------------------------------------------------------------------

export const backgroundKindSchema = z
  .enum(["gradient", "shader"])
  .describe("Background type");

export const backgroundSchema = z.object({
  kind: backgroundKindSchema.default("gradient"),
  shaderStyle: z
    .enum(["aurora", "flowField", "mesh"])
    .default("aurora")
    .describe("Shader pattern"),
  motion: z
    .number()
    .min(0)
    .max(1)

    .default(0.5)
    .describe("Background motion"),
  /**
   * Grain overlay strength (HOPE reference). 0 = clean, higher = texture.
   */
  grain: z
    .number()
    .min(0)
    .max(1)

    .default(0)
    .describe("Grain texture overlay"),
});
export type Background = z.infer<typeof backgroundSchema>;
export type BackgroundKind = z.infer<typeof backgroundKindSchema>;

// ---------------------------------------------------------------------------
// Story — the whole sequence + the global palette
// ---------------------------------------------------------------------------

export const storySchema = z.object({
  /**
   * The sequence. May be empty — new projects start with 0 beats and
   * render an empty artboard until the user adds one. The Player and
   * KineticStory composition both handle the empty case.
   */
  beats: z.array(beatSchema),
  /**
   * Optional override for the composition's total duration in seconds.
   * When unset, the composition length equals the longest beat's end
   * time (or 4 s for an empty story). When set, the composition runs
   * for exactly this long regardless of beats — beats that end earlier
   * leave a background-only tail; beats that extend past it are
   * clipped at this point. Use this to lock a video to e.g. 15 s for
   * a Reel without retiming every beat.
   */
  durationInSeconds: z
    .number()
    .min(0.5)
    .max(600)
    .optional()
    .describe("Composition duration override (seconds)"),
  fontSize: z
    .number()
    .min(40)
    .max(400)

    .default(160)
    .describe("Base font size (px)"),
  /** default typeface — per-beat `fontFamily` overrides this */
  fontFamily: fontFamilySchema.default("RobotoFlex"),
  bgColor: zColor().default("#0a0a14").describe("Background color"),
  bgColor2: zColor().default("#1a1030").describe("Background gradient end"),
  textColor: zColor().default("#fafafa").describe("Default text color"),
  accentColor: zColor().default("#7c5cff").describe("Accent color"),
  accent2Color: zColor().default("#ff5ca8").describe("Secondary accent"),
  glowIntensity: z
    .number()
    .min(0)
    .max(2)

    .default(1)
    .describe("Global glow multiplier"),
  background: backgroundSchema.default({
    kind: "gradient",
    shaderStyle: "aurora",
    motion: 0.5,
    grain: 0,
  }),
});
export type Story = z.infer<typeof storySchema>;

/**
 * Resolve every beat to an explicit `{ startSeconds, endSeconds }` window.
 *
 * - If a beat has an explicit `startSeconds`, use it.
 * - Otherwise, place it sequentially after the previous beat **on the
 *   same track**. This preserves the old linear behavior for stories
 *   written before startSeconds existed, AND keeps tracks independent
 *   so adding a beat to track 0 doesn't move beats on track 1.
 *
 * The returned array matches `story.beats` index-for-index, so callers
 * can pair it with the source beat by index.
 */
export type ResolvedBeat = {
  startSeconds: number;
  endSeconds: number;
};

export const resolveBeatTimes = (story: Story): ResolvedBeat[] => {
  const perTrackCursor = new Map<number, number>();
  return story.beats.map((b) => {
    const track = b.track;
    const cursor = perTrackCursor.get(track) ?? 0;
    const start = b.startSeconds ?? cursor;
    const end = start + b.durationInSeconds;
    // sequential cursor for the next beat on this track is the end of
    // THIS beat (so a beat with explicit startSeconds in the future
    // leaves a gap that the next default-positioned beat starts after,
    // not overlapping)
    perTrackCursor.set(track, Math.max(cursor, end));
    return { startSeconds: start, endSeconds: end };
  });
};

export const storyDurationInFrames = (story: Story, fps: number): number => {
  // Explicit override wins. Allows users to lock the composition to a
  // specific length (e.g. 15s for a Reel) without retiming beats.
  if (story.durationInSeconds !== undefined) {
    return Math.max(1, Math.round(story.durationInSeconds * fps));
  }
  const resolved = resolveBeatTimes(story);
  const maxEnd = resolved.reduce((m, r) => Math.max(m, r.endSeconds), 0);
  // Empty story: give the background a 4-second loop so the artboard
  // shows the moving gradient instead of a single frozen frame.
  if (maxEnd <= 0) return Math.max(1, Math.round(4 * fps));
  return Math.max(1, Math.round(maxEnd * fps));
};

// ---------------------------------------------------------------------------
// Back-compat helper: maps legacy `direction` onto `enterDirection` so
// pre-rewrite story.json files keep rendering correctly.
// ---------------------------------------------------------------------------

export const normalizeBeat = (b: Beat): Beat => {
  // if the file set `direction` (old field) but left enterDirection at
  // its default, treat the legacy field as the entrance direction.
  if (b.direction && b.enterDirection === "vertical-roll") {
    return { ...b, enterDirection: b.direction };
  }
  return b;
};
