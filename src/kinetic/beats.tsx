/**
 * The kinetic-typography beat renderers.
 *
 * Each beat has THREE phases on its <Sequence>:
 *   enter (0..animateInPortion)
 *     → text builds itself in: vertical-roll / scale / morph / tile / etc.
 *   hold  (animateInPortion..1-animateOutPortion)
 *     → text holds; variable-font axes can still drift (the ELASTIC
 *       reference) so motion never stops dead.
 *   exit  (1-animateOutPortion..1)
 *     → exitKind plays: rotate / drop / scatter / blur / echo / morphOut.
 *
 * Six kinds:
 *   reveal       — letter-by-letter build with variable-font axis animation.
 *   morph        — provider shape morphs into the first letter (centered
 *                  at user-defined anchor, scaling+rotating during morph,
 *                  with the rest of the word fading in as a skeleton).
 *   generativeFill — word masks a churning blob/gradient field.
 *   tile         — word tiled in a marquee grid that scrolls (RISE / ELASTIC).
 *   oscillate    — letters wobble wght+scale around 1.0 (ELASTIC core).
 *   cinema       — single-letter or short-phrase massive zoom (HOPE).
 *
 * REMOTION CONCERNS:
 *  - flubber.interpolate() is memoized — built once, not per frame.
 *  - The noise field uses seeded random() — never Math.random().
 *  - Glyph work is memoized off the parsed font.
 *  - All animation is a pure function of useCurrentFrame(): deterministic.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Img,
  interpolate,
  interpolateColors,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
  random,
} from "remotion";
import { interpolate as flubberInterpolate } from "flubber";
import type { Beat, Story } from "./schema";
import {
  getGlyphPath,
  outerSubpath,
  useFont,
  DEFAULT_MORPH_SHAPE,
  FONT_REGISTRY,
  FONT_AXIS_BOUNDS,
} from "./glyphs";
import { resolveEasing, directionOffset } from "../typography/easings";

type BeatProps = {
  beat: Beat;
  story: Story;
  durationInFrames: number;
};

// ---------------------------------------------------------------------------
// Shared helpers — phase, axes, palette, shadow, motion blur
// ---------------------------------------------------------------------------

/**
 * Stage — wraps a beat's content. Centers by default; respects per-beat
 * positionX/Y when provided (0..1 normalized to canvas dimensions).
 * Pass a beat to honor its position, or omit to keep classic centering.
 */
const Stage: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  beat?: Beat;
}> = ({ children, style, beat }) => {
  const x = beat?.positionX ?? 0.5;
  const y = beat?.positionY ?? 0.5;
  const rot = beat?.rotation ?? 0;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          // translate first to center on the anchor, then rotate around
          // the anchor point. The order matters — rotate after translate
          // would orbit the element around the canvas origin.
          transform: `translate(-50%, -50%) rotate(${rot}deg)`,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/**
 * Beat phase — three numbers all in [0,1]:
 *   inP  : entrance progress (0 at beat start → 1 when settled)
 *   outP : exit progress     (0 while holding → 1 at beat end)
 *   holdP: 1 while in the hold window, 0 otherwise (binary)
 */
type Phase = { inP: number; outP: number; t: number };

const beatPhase = (
  frame: number,
  beat: Beat,
  durationInFrames: number,
): Phase => {
  const inFrames = durationInFrames * beat.animateInPortion;
  const outStart = durationInFrames * (1 - beat.animateOutPortion);
  const outFrames = durationInFrames - outStart;
  const inP = interpolate(frame, [0, inFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const outP = interpolate(frame, [outStart, outStart + outFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return { inP, outP, t: frame / durationInFrames };
};

/**
 * Per-letter staggered eased progress. staggerCurve > 0 spreads the
 * stagger by a wave (letters at the ends arrive last) — the elastic feel.
 */
const letterProgress = (
  baseProgress01: number, // 0..1 from the beat phase
  letterIndex: number,
  letterCount: number,
  beat: Beat,
  durationInFrames: number,
  fps: number,
): number => {
  const ease = resolveEasing(beat.easing);
  // wave: 0..1..0 across the word's letter span, peaks in the middle
  const norm = letterCount > 1 ? letterIndex / (letterCount - 1) : 0;
  const wave = 1 - Math.abs(norm * 2 - 1); // 0 at ends, 1 at middle
  const linearIdx = letterIndex;
  const waveIdx = letterIndex + wave * letterCount * 0.5;
  const idx = linearIdx * (1 - beat.staggerCurve) + waveIdx * beat.staggerCurve;
  const localStartFrames = idx * beat.staggerSeconds * fps;
  // animateIn window in frames
  const animFrames = durationInFrames * beat.animateInPortion;
  // baseProgress01 maps frame across [0..animFrames]; multiply back
  const frame = baseProgress01 * animFrames;
  const linear = interpolate(
    frame,
    [localStartFrames, localStartFrames + animFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return ease(linear);
};

/** CSS font-variation-settings string for the current beat phase. */
const fontVariationSettings = (
  beat: Beat,
  story: Story,
  letterProgress01: number,
): string => {
  const family = beat.fontFamily ?? story.fontFamily;
  const bounds = FONT_AXIS_BOUNDS[family];
  const a = beat.axes;
  const clamp = (v: number, [lo, hi]: [number, number]) =>
    Math.max(lo, Math.min(hi, v));
  const w0 = clamp(a.wght[0], bounds.wght);
  const w1 = clamp(a.wght[1], bounds.wght);
  const wd0 = clamp(a.wdth[0], bounds.wdth);
  const wd1 = clamp(a.wdth[1], bounds.wdth);
  const sl0 = clamp(a.slnt[0], bounds.slnt);
  const sl1 = clamp(a.slnt[1], bounds.slnt);
  const wght = w0 + (w1 - w0) * letterProgress01;
  const wdth = wd0 + (wd1 - wd0) * letterProgress01;
  const slnt = sl0 + (sl1 - sl0) * letterProgress01;
  return `"wght" ${wght.toFixed(0)}, "wdth" ${wdth.toFixed(0)}, "slnt" ${slnt.toFixed(1)}`;
};

const fontFamilyCss = (beat: Beat, story: Story): string =>
  FONT_REGISTRY[beat.fontFamily ?? story.fontFamily].cssFamily;

/** Pick a color for letter i from the story's palette. */
const letterColor = (
  beat: Beat,
  story: Story,
  i: number,
): string => {
  if (beat.color) return beat.color;
  if (!beat.perLetterPalette) return story.textColor;
  const palette = [story.textColor, story.accentColor, story.accent2Color];
  return palette[i % palette.length];
};

/**
 * Layered drop-shadow CSS — N copies offset diagonally, optionally tinted.
 * The LottieFiles + HOPE "rainbow stack" / "echo" effect, free in CSS.
 */
const shadowStack = (beat: Beat): string => {
  if (beat.shadowLayers <= 0) return "none";
  const color = beat.shadowColor ?? "#000000";
  const parts: string[] = [];
  for (let i = 1; i <= beat.shadowLayers; i++) {
    parts.push(`drop-shadow(${i * 4}px ${i * 4}px 0 ${color})`);
  }
  return parts.join(" ");
};

const glowFilter = (beat: Beat, story: Story, color: string): string => {
  const radius = beat.glow * story.glowIntensity;
  if (radius <= 0) return "none";
  return `drop-shadow(0 0 ${radius * 0.5}px ${color}) drop-shadow(0 0 ${radius}px ${color})`;
};

const motionBlurFilter = (beat: Beat, velocity: number): string => {
  if (beat.motionBlur <= 0 || velocity <= 0.05) return "none";
  const px = beat.motionBlur * Math.min(1, velocity);
  return `blur(${px.toFixed(2)}px)`;
};

/** Combine glow + shadow stack + motion blur into one filter string. */
const combinedFilter = (
  beat: Beat,
  story: Story,
  color: string,
  velocity = 0,
): string => {
  const parts = [
    glowFilter(beat, story, color),
    shadowStack(beat),
    motionBlurFilter(beat, velocity),
  ].filter((f) => f !== "none");
  return parts.length ? parts.join(" ") : "none";
};

/**
 * Exit transform for a whole word, based on the exit kind + progress.
 * Returns a CSS transform string and an opacity multiplier.
 */
const exitTransform = (
  beat: Beat,
  outP: number,
): { transform: string; opacity: number; filter?: string } => {
  if (outP <= 0) return { transform: "", opacity: 1 };
  const e = resolveEasing("power3.inOut")(outP);
  switch (beat.exitKind) {
    case "rotate":
      return {
        transform: `rotate(${beat.exitRotation * e}deg) scale(${1 - e * 0.15})`,
        opacity: 1 - e * 0.4,
      };
    case "drop":
      return {
        transform: `translateY(${e * 200}px) rotate(${e * 8}deg)`,
        opacity: 1 - e,
      };
    case "scatter":
      // handled per-letter inside the renderer
      return { transform: "", opacity: 1 - e * 0.6 };
    case "blur":
      return {
        transform: `scale(${1 + e * 0.2})`,
        opacity: 1 - e,
        filter: `blur(${e * 24}px)`,
      };
    case "echo":
      return {
        transform: `translateX(${e * 60}px)`,
        opacity: 1 - e * 0.5,
      };
    case "zoom":
      return {
        transform: `scale(${1 + e * 4})`,
        opacity: 1 - e,
      };
    case "morphOut":
      return { transform: "", opacity: 1 - e };
    case "none":
    default:
      return { transform: "", opacity: 1 };
  }
};

// ---------------------------------------------------------------------------
// 1. RevealBeat — letter-by-letter build with variable-font animation
// ---------------------------------------------------------------------------

export const RevealBeat: React.FC<BeatProps> = ({
  beat,
  story,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phase = beatPhase(frame, beat, durationInFrames);
  const chars = Array.from(beat.text);
  const travel = 40 + beat.dynamics * 90;
  const exit = exitTransform(beat, phase.outP);

  return (
    <Stage beat={beat}>
      <div
        style={{
          display: "flex",
          padding: "0.25em 0.1em",
          transform: exit.transform,
          opacity: exit.opacity,
          filter: exit.filter,
          willChange: "transform, opacity, filter",
        }}
      >
        {chars.map((ch, i) => {
          const p = letterProgress(phase.inP, i, chars.length, beat, durationInFrames, fps);
          // velocity ~ derivative of progress (high during travel, low at rest)
          const velocity = p < 1 ? 1 - p : 0;
          const off = directionOffset(beat.enterDirection === "vertical-roll" ? "up" : beat.enterDirection as any, p, travel);
          const opacity = interpolate(p, [0, 0.6], [0, 1], {
            extrapolateRight: "clamp",
          });
          const color = letterColor(beat, story, i);
          // scatter exit: per-letter outward push
          const scatterX = beat.exitKind === "scatter"
            ? (random(`sx${beat.text}-${i}`) - 0.5) * 400 * phase.outP
            : 0;
          const scatterY = beat.exitKind === "scatter"
            ? (random(`sy${beat.text}-${i}`) - 0.5) * 400 * phase.outP
            : 0;
          return (
            <span
              key={i}
              style={{
                fontSize: story.fontSize * beat.scale,
                color,
                fontFamily: `'${fontFamilyCss(beat, story)}', sans-serif`,
                fontVariationSettings: fontVariationSettings(beat, story, p),
                transform: `translate(${off.x + scatterX}px, ${off.y + scatterY}px) scale(${off.scale})`,
                opacity,
                whiteSpace: "pre",
                willChange: "transform, opacity, font-variation-settings",
                display: "inline-block",
                filter: combinedFilter(beat, story, color, velocity),
              }}
            >
              {ch}
            </span>
          );
        })}
      </div>
    </Stage>
  );
};

// ---------------------------------------------------------------------------
// 2. MorphBeat — provider shape morphs into the word's first letter at a
//    user-defined anchor, with the shape itself moving (scale + rotation),
//    color blending into the word color, and the tail letters fading in
//    around it as a skeleton.
// ---------------------------------------------------------------------------

export const MorphBeat: React.FC<BeatProps> = ({
  beat,
  story,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const family = beat.fontFamily ?? story.fontFamily;
  const font = useFont(family);
  const phase = beatPhase(frame, beat, durationInFrames);
  const textColor = beat.color ?? story.textColor;
  const shapeColor = beat.color ?? story.accentColor;

  const chars = Array.from(beat.text.toUpperCase());
  const CELL = 100;
  const GAP = 14;

  const glyphPaths = useMemo(() => {
    if (!font) return null;
    return chars.map((ch) => getGlyphPath(font, ch)?.d ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, beat.text]);

  // Source shape: prefer an explicit reference to a sibling SHAPE beat
  // (the "illustration → text" pattern), then the inline `shape` field,
  // then the default circle. When morphSourceBeat is set we use the FIRST
  // path of that beat's shapePaths — illustrations may have many paths;
  // the first one's silhouette is what we morph.
  const sourceShape: string = useMemo(() => {
    if (typeof beat.morphSourceBeat === "number") {
      const src = story.beats[beat.morphSourceBeat];
      if (src && src.kind === "shape" && src.shapePaths.length > 0) {
        return src.shapePaths[0].d;
      }
    }
    return beat.shape ?? DEFAULT_MORPH_SHAPE;
  }, [beat.morphSourceBeat, beat.shape, story.beats]);

  // flubber needs SINGLE closed paths — extract the outer contour of the
  // first letter (drops counters for o/e/g/a — we add them back below).
  const morph = useMemo(() => {
    const targetFull = glyphPaths?.[0];
    if (!targetFull) return () => sourceShape;
    const targetOuter = outerSubpath(targetFull);
    const fromOuter = outerSubpath(sourceShape);
    try {
      return flubberInterpolate(fromOuter, targetOuter, {
        maxSegmentLength: 10,
      });
    } catch {
      return () => targetOuter;
    }
  }, [glyphPaths, sourceShape]);

  const ease = resolveEasing(beat.easing);
  // morphHoldPortion delays the morph: the source shape stays static for
  // `hold * animateInPortion`, then morphs through the remainder. This
  // makes the illustration the focal element before the text reveal.
  const hold = beat.morphHoldPortion;
  const heldInP = hold > 0
    ? interpolate(phase.inP, [hold, 1], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : phase.inP;
  const morphProgress = ease(heldInP);
  const currentMorphPath = morph(morphProgress);

  // recenter the morphing path inside its CELL (path bbox changes during interp)
  const recenterTransform = useMemo(() => {
    const nums = currentMorphPath.match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
    if (!nums || nums.length < 4) return "";
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < nums.length - 1; i += 2) {
      xs.push(parseFloat(nums[i]));
      ys.push(parseFloat(nums[i + 1]));
    }
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const w = Math.max(...xs) - minX || 1;
    const h = Math.max(...ys) - minY || 1;
    const s = Math.min((CELL * 0.92) / w, (CELL * 0.92) / h);
    const tx = (CELL - w * s) / 2 - minX * s;
    const ty = (CELL - h * s) / 2 - minY * s;
    return `translate(${tx} ${ty}) scale(${s})`;
  }, [currentMorphPath]);

  // ---- visible motion ON the morph itself ----
  // start small + rotated, settle to natural at end of morph
  const morphScale = interpolate(
    morphProgress,
    [0, 1],
    [beat.morphStartScale, 1],
  );
  const morphRotation = interpolate(
    morphProgress,
    [0, 1],
    [beat.morphStartRotation, 0],
  );

  // color blend: shapeColor → textColor across the morph (no snap)
  const blendedFirstColor = interpolateColors(
    morphProgress,
    [0, 1],
    [shapeColor, textColor],
  );

  // ---- the word layout ----
  const totalWidth = chars.length * CELL + (chars.length - 1) * GAP;
  const displayWidth = (story.fontSize / CELL) * totalWidth * beat.scale;
  const displayHeight = story.fontSize * beat.scale;
  const travel = 12 + beat.dynamics * 26;

  // Anchor: the user controls where the WORD'S VISUAL CENTER sits.
  // We center the entire word on (anchorX, anchorY) so that words longer
  // than 1 letter still fit on screen. The first letter (where the morph
  // happens) sits to the left of the anchor by half the word's pixel
  // width minus half a cell — the natural place inside the centered word.
  const anchorX = width * beat.morphAnchorX;
  const anchorY = height * beat.morphAnchorY;
  const wordOriginX = anchorX - displayWidth / 2;
  const wordOriginY = anchorY - displayHeight / 2;

  const exit = exitTransform(beat, phase.outP);

  // skeleton fade-in for tail letters — they appear faintly from frame 0,
  // become solid as the morph completes, so the word reads as a whole.
  const skeletonAlpha = interpolate(morphProgress, [0, 0.5], [0.0, 0.18], {
    extrapolateRight: "clamp",
  });

  // glow ramps with morph progress so we don't get a big bloom on a tiny shape
  const glowRamp = combinedFilter(
    {
      ...beat,
      glow: beat.glow * morphProgress,
    },
    story,
    blendedFirstColor,
    morphProgress < 1 ? 1 - morphProgress : 0,
  );

  // Static user rotation, applied around the morph anchor. exit.transform
  // appends after so exit-driven motion stacks on top.
  const userRotation = beat.rotation ?? 0;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `rotate(${userRotation}deg) ${exit.transform}`,
        transformOrigin: `${anchorX}px ${anchorY}px`,
        opacity: exit.opacity,
        filter: exit.filter,
      }}
    >
      <svg
        width={displayWidth}
        height={displayHeight}
        viewBox={`0 0 ${totalWidth} ${CELL}`}
        style={{
          position: "absolute",
          left: wordOriginX,
          top: wordOriginY,
          overflow: "visible",
          filter: glowRamp,
        }}
      >
        {chars.map((ch, i) => {
          const xOffset = i * (CELL + GAP);
          if (i === 0) {
            // morph rotation+scale happens around the cell's center
            return (
              <g
                key={i}
                transform={`translate(${xOffset + CELL / 2}, ${CELL / 2}) rotate(${morphRotation}) scale(${morphScale}) translate(${-CELL / 2}, ${-CELL / 2})`}
              >
                <path
                  d={currentMorphPath}
                  fill={blendedFirstColor}
                  transform={recenterTransform}
                />
              </g>
            );
          }
          // tail letters
          const d = glyphPaths?.[i];
          if (!d) return null;
          const p = letterProgress(
            phase.inP,
            i,
            chars.length,
            beat,
            durationInFrames,
            fps,
          );
          // shifted: tail letters can begin animating during the morph
          const off = directionOffset(
            beat.enterDirection === "vertical-roll" ? "up" : (beat.enterDirection as any),
            p,
            travel,
          );
          const color = letterColor(beat, story, i);
          // skeleton + final fill stacked
          const finalAlpha = interpolate(p, [0.3, 1], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <g
              key={i}
              transform={`translate(${xOffset + off.x}, ${off.y})`}
            >
              {/* faint skeleton */}
              <path d={d} fill={textColor} opacity={skeletonAlpha} />
              {/* final-color layer fades in over the skeleton */}
              <path d={d} fill={color} opacity={finalAlpha} />
            </g>
          );
        })}
      </svg>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 3. GenerativeFillBeat — word masks a seeded animated gradient field
// ---------------------------------------------------------------------------

export const GenerativeFillBeat: React.FC<BeatProps> = ({
  beat,
  story,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const phase = beatPhase(frame, beat, durationInFrames);
  const colorA = beat.color ?? story.accentColor;
  const colorB = story.accent2Color;

  const BLOBS = 18;
  const cx0 = width / 2;
  const cy0 = height / 2;
  const fontSize = story.fontSize * beat.scale;
  const spreadX = fontSize * beat.text.length * 0.42;
  const spreadY = fontSize * 0.9;
  const energy = 0.4 + beat.dynamics * 1.6;

  const blobs = useMemo(() => {
    return new Array(BLOBS).fill(0).map((_, i) => ({
      baseX: cx0 + (random(`x-${beat.text}-${i}`) - 0.5) * 2 * spreadX,
      baseY: cy0 + (random(`y-${beat.text}-${i}`) - 0.5) * 2 * spreadY,
      r: fontSize * (0.3 + random(`r-${beat.text}-${i}`) * 0.6),
      driftX: (random(`dx-${beat.text}-${i}`) - 0.5) * fontSize,
      driftY: (random(`dy-${beat.text}-${i}`) - 0.5) * fontSize,
      speed: (0.5 + random(`s-${beat.text}-${i}`) * 1.5) * energy,
      phase: random(`p-${beat.text}-${i}`) * Math.PI * 2,
      tint: random(`t-${beat.text}-${i}`),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat.text, fontSize, energy]);

  const t = frame / fps;
  const maskId = `kfill-${beat.text.replace(/\W/g, "")}`;
  const gradId = `kgrad-${beat.text.replace(/\W/g, "")}`;

  const opacity = interpolate(phase.inP, [0, 0.6], [0, 1], {
    extrapolateRight: "clamp",
  });
  const ease = resolveEasing(beat.easing);
  const scaleIn = interpolate(ease(phase.inP), [0, 1], [0.86, 1]);
  const exit = exitTransform(beat, phase.outP);

  return (
    <Stage beat={beat} style={{ transform: exit.transform, opacity: opacity * exit.opacity }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          transform: `scale(${scaleIn})`,
          filter: combinedFilter(beat, story, colorA),
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colorA} />
            <stop offset="100%" stopColor={colorB} />
          </linearGradient>
          <mask id={maskId}>
            <text
              x="50%"
              y="50%"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily={`'${fontFamilyCss(beat, story)}'`}
              fontSize={fontSize}
              fill="white"
              style={{
                fontVariationSettings: fontVariationSettings(beat, story, phase.inP),
              }}
            >
              {beat.text}
            </text>
          </mask>
        </defs>
        <g mask={`url(#${maskId})`}>
          <rect
            x={cx0 - spreadX * 1.4}
            y={cy0 - spreadY * 1.4}
            width={spreadX * 2.8}
            height={spreadY * 2.8}
            fill={`url(#${gradId})`}
            opacity={0.5}
          />
          {blobs.map((b, i) => {
            const cx = b.baseX + Math.sin(t * b.speed + b.phase) * b.driftX;
            const cy = b.baseY + Math.cos(t * b.speed + b.phase) * b.driftY;
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={b.r}
                fill={b.tint > 0.5 ? colorB : colorA}
                opacity={0.55}
              />
            );
          })}
        </g>
      </svg>
    </Stage>
  );
};

// ---------------------------------------------------------------------------
// 4. TileBeat — marquee tiled word that scrolls (RISE / ELASTIC reference)
// ---------------------------------------------------------------------------

export const TileBeat: React.FC<BeatProps> = ({
  beat,
  story,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const phase = beatPhase(frame, beat, durationInFrames);
  const t = frame / fps;
  const exit = exitTransform(beat, phase.outP);

  const rows = beat.tileRows;
  const fontSize = story.fontSize * beat.scale * 0.8;
  // measured-ish: word width estimate for vw-style placement
  const rowHeight = fontSize * 1.05;
  // scroll across the diagonal — angle in degrees
  const angle = beat.tileScrollAngle;
  const speed = 60 + beat.dynamics * 240; // px/sec
  const offset = (t * speed) % (width + fontSize * beat.text.length * 0.7);

  // entrance: rows fade & shift in from the staggerCurve direction
  const rowProgress = (i: number) =>
    letterProgress(phase.inP, i, rows, beat, durationInFrames, fps);

  return (
    <Stage beat={beat} style={{ transform: exit.transform, opacity: exit.opacity }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          transform: `rotate(${angle}deg)`,
        }}
      >
        {new Array(rows).fill(0).map((_, i) => {
          const p = rowProgress(i);
          const opacity = interpolate(p, [0, 1], [0, 1]);
          const yShift = (1 - p) * 30;
          const color = beat.perLetterPalette
            ? [story.textColor, story.accentColor, story.accent2Color][i % 3]
            : letterColor(beat, story, 0);
          // marquee: shift this row's start position by `offset` modulo word span
          // every other row scrolls in the opposite direction for tension
          const dirOffset = i % 2 === 0 ? -offset : offset;
          return (
            <div
              key={i}
              style={{
                height: rowHeight,
                display: "flex",
                alignItems: "center",
                whiteSpace: "nowrap",
                opacity,
                transform: `translate(${dirOffset}px, ${yShift}px)`,
                willChange: "transform, opacity",
              }}
            >
              {/* render enough copies to span the rotated rect */}
              {new Array(8).fill(0).map((_, k) => (
                <span
                  key={k}
                  style={{
                    fontFamily: `'${fontFamilyCss(beat, story)}'`,
                    fontSize,
                    fontVariationSettings: fontVariationSettings(beat, story, p),
                    color,
                    padding: "0 0.3em",
                    filter: combinedFilter(beat, story, color),
                  }}
                >
                  {beat.text}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </Stage>
  );
};

// ---------------------------------------------------------------------------
// 5. OscillateBeat — letters wobble wght+scale around 1.0 (ELASTIC core)
// ---------------------------------------------------------------------------

export const OscillateBeat: React.FC<BeatProps> = ({
  beat,
  story,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phase = beatPhase(frame, beat, durationInFrames);
  const t = frame / fps;
  const chars = Array.from(beat.text);
  const exit = exitTransform(beat, phase.outP);

  // each letter pulses at the same frequency, offset by index
  const freq = 0.6 + beat.dynamics * 1.6; // Hz
  const offsetPerLetter = 0.18;

  return (
    <Stage beat={beat} style={{ transform: exit.transform, opacity: exit.opacity }}>
      <div style={{ display: "flex", padding: "0.25em 0.1em" }}>
        {chars.map((ch, i) => {
          // entrance: snap letters into place quickly so the oscillation
          // is what reads, not the entry
          const enterP = letterProgress(
            phase.inP,
            i,
            chars.length,
            beat,
            durationInFrames,
            fps,
          );
          const enterScale = interpolate(enterP, [0, 1], [0.4, 1]);
          // oscillation around 1.0
          const wob = Math.sin(t * freq * Math.PI * 2 + i * offsetPerLetter);
          // map wob to a *position within the axis range* so wght+wdth pulse
          const axisT = (wob + 1) / 2; // 0..1
          const pulseScale = 1 + wob * 0.08 * beat.dynamics;
          const color = letterColor(beat, story, i);
          return (
            <span
              key={i}
              style={{
                fontSize: story.fontSize * beat.scale,
                color,
                fontFamily: `'${fontFamilyCss(beat, story)}', sans-serif`,
                fontVariationSettings: fontVariationSettings(beat, story, axisT),
                transform: `scale(${enterScale * pulseScale})`,
                opacity: enterP,
                whiteSpace: "pre",
                display: "inline-block",
                willChange: "transform, font-variation-settings",
                filter: combinedFilter(beat, story, color),
              }}
            >
              {ch}
            </span>
          );
        })}
      </div>
    </Stage>
  );
};

// ---------------------------------------------------------------------------
// 6. CinemaBeat — single letter or short phrase, massive zoom (HOPE)
// ---------------------------------------------------------------------------

export const CinemaBeat: React.FC<BeatProps> = ({
  beat,
  story,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const phase = beatPhase(frame, beat, durationInFrames);
  const ease = resolveEasing(beat.easing);

  // Cap the *settled* font size to ~85% canvas width so wide/heavy axes
  // don't clip at the right edge. Heavy + wide variable fonts can hit
  // ~0.85em per glyph (1000 wght + 130 wdth + tight letter-spacing).
  const approxCharWidth = beat.text.length * 0.85;
  const maxFontSize = (width * 0.85) / Math.max(approxCharWidth, 1);
  const requestedSize = story.fontSize * beat.scale * 1.5;
  const settledFontSize = Math.min(requestedSize, maxFontSize);

  // big zoom in: scale from huge → 1
  const zoomIn = interpolate(
    ease(phase.inP),
    [0, 1],
    [6 + beat.dynamics * 6, 1],
  );
  const exit = exitTransform(beat, phase.outP);
  const color = beat.color ?? story.textColor;

  return (
    <Stage beat={beat}>
      <div
        style={{
          transform: `scale(${zoomIn}) ${exit.transform}`,
          opacity: exit.opacity * interpolate(phase.inP, [0, 0.2], [0, 1]),
          fontSize: settledFontSize,
          color,
          fontFamily: `'${fontFamilyCss(beat, story)}', sans-serif`,
          fontVariationSettings: fontVariationSettings(beat, story, phase.inP),
          letterSpacing: "-0.04em",
          filter: combinedFilter(beat, story, color, 1 - phase.inP),
          willChange: "transform, opacity, filter",
          whiteSpace: "nowrap",
        }}
      >
        {beat.text}
      </div>
    </Stage>
  );
};

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 7. ShapeBeat — a standalone illustration (one or more SVG paths)
// ---------------------------------------------------------------------------

/**
 * Renders one of the beat's shapePaths as a real <path> in an SVG that
 * fills the canvas at `shapeSize * canvasHeight`. Honors the per-beat
 * positionX/Y so the illustration can be anchored anywhere. Multiple
 * paths in shapePaths stack in z-order (top of array = back, bottom =
 * front, matching SVG's default rendering).
 *
 * Entry styles:
 *   - fade    : opacity 0 → 1
 *   - scale   : scale 0.3 → 1, eased (default)
 *   - draw    : stroke-dashoffset animates the path drawing itself in
 *               (needs stroke + strokeWidth on the path)
 *   - fade-up : translate from below + fade
 *
 * Exit styles:
 *   - fade        : opacity → 0
 *   - scale-down  : shrinks and fades
 *   - blur        : CSS blur ramps up while fading
 *   - morphOut    : opacity fades; intended as the input to a morph beat
 *                   on the next track that picks up the shape via
 *                   morphSourceBeat (KineticStory handles continuity).
 *   - none        : remains until the beat's Sequence ends.
 */
export const ShapeBeat: React.FC<BeatProps> = ({
  beat,
  story,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const phase = beatPhase(frame, beat, durationInFrames);
  const ease = resolveEasing(beat.easing);

  const inP = ease(phase.inP);
  const outP = phase.outP;

  // Sizing — author space is 0..100. Render at shapeSize * canvas height.
  const SIZE = height * beat.shapeSize;
  const px = width * beat.positionX;
  const py = height * beat.positionY;

  // Entry transform
  let scale = 1;
  let translateY = 0;
  let opacity = 1;
  let blur = 0;

  switch (beat.shapeEntry) {
    case "fade":
      opacity *= inP;
      break;
    case "scale":
      scale *= interpolate(inP, [0, 1], [0.3, 1]);
      opacity *= interpolate(inP, [0, 0.5], [0, 1], { extrapolateRight: "clamp" });
      break;
    case "fade-up":
      translateY = (1 - inP) * 80;
      opacity *= inP;
      break;
    case "draw":
      // opacity full quickly; the stroke-dashoffset trick happens on each path
      opacity *= interpolate(inP, [0, 0.1], [0, 1], { extrapolateRight: "clamp" });
      break;
  }

  // Exit transform
  if (outP > 0) {
    const eOut = resolveEasing("power3.inOut")(outP);
    switch (beat.shapeExit) {
      case "fade":
      case "morphOut":
        opacity *= 1 - eOut;
        break;
      case "scale-down":
        scale *= 1 - eOut * 0.6;
        opacity *= 1 - eOut;
        break;
      case "blur":
        blur = eOut * 24;
        opacity *= 1 - eOut;
        break;
      case "none":
        break;
    }
  }

  // For "draw" entry: each path needs its own dasharray. We pass inP to
  // the path component which sets stroke-dashoffset = (1 - inP) * pathLen.
  const drawing = beat.shapeEntry === "draw" && inP < 1;

  const userRotation = beat.rotation ?? 0;
  return (
    <div
      style={{
        position: "absolute",
        left: px,
        top: py,
        // translate centers the SVG on the anchor; rotate then orbits
        // around that center; entry/exit translateY and scale stack on.
        transform: `translate(-50%, -50%) rotate(${userRotation}deg) translateY(${translateY}px) scale(${scale})`,
        opacity,
        filter: blur > 0 ? `blur(${blur.toFixed(1)}px)` : undefined,
        willChange: "transform, opacity",
      }}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox="0 0 100 100"
        style={{ overflow: "visible" }}
      >
        {beat.shapePaths.map((p, i) => (
          <ShapePathEl
            key={i}
            path={p}
            drawProgress={drawing ? inP : 1}
            beat={beat}
            story={story}
          />
        ))}
      </svg>
    </div>
  );
};

const ShapePathEl: React.FC<{
  path: { d: string; fill?: string; stroke?: string; strokeWidth: number };
  drawProgress: number;
  beat: Beat;
  story: Story;
}> = ({ path, drawProgress, beat, story }) => {
  // For the draw-on entry we need the path length so we can animate the
  // stroke-dashoffset. We measure it from the DOM on mount.
  const ref = React.useRef<SVGPathElement>(null);
  const [pathLen, setPathLen] = React.useState<number | null>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      setPathLen(el.getTotalLength());
    } catch {
      setPathLen(null);
    }
  }, [path.d]);

  const fallbackFill = beat.color ?? story.accentColor;
  const fill = path.fill ?? fallbackFill;
  const stroke = path.stroke;
  const strokeWidth = path.strokeWidth;
  // Apply glow via the same drop-shadow filter the other beats use.
  const glow = beat.glow > 0
    ? `drop-shadow(0 0 ${beat.glow * 0.5 * story.glowIntensity}px ${fill}) drop-shadow(0 0 ${beat.glow * story.glowIntensity}px ${fill})`
    : undefined;

  // Draw-on animation via stroke-dashoffset.
  const drawProps =
    beat.shapeEntry === "draw" && pathLen !== null
      ? {
          fill: "none",
          stroke: stroke ?? fill,
          strokeWidth: strokeWidth || 1.5,
          strokeDasharray: pathLen,
          strokeDashoffset: (1 - drawProgress) * pathLen,
          strokeLinecap: "round" as const,
          strokeLinejoin: "round" as const,
        }
      : {
          fill,
          stroke: stroke ?? "none",
          strokeWidth: strokeWidth || 0,
        };

  return <path ref={ref} d={path.d} style={{ filter: glow }} {...drawProps} />;
};

// ---------------------------------------------------------------------------
// 8. VideoClipBeat — local MP4 played as a timeline clip.
// ---------------------------------------------------------------------------

/**
 * Renders a local MP4 inside the beat's time window. The source video
 * may be longer than the clip — `videoStartSec` is the offset into the
 * source where playback begins, and the beat's `durationInSeconds`
 * (via the parent Sequence) controls how long it plays.
 *
 * Sized by `scale` (1 = full canvas width), anchored at positionX/Y,
 * rotated by `rotation`, optionally with audio. Uses `<OffthreadVideo>`
 * — the correct primitive for both Player preview and CLI render.
 *
 * Path handling: when running inside the Tauri webview the local-file
 * path must be converted via `convertFileSrc()` to an `asset://` URL.
 * In the Remotion CLI renderer Node loads the path directly. We detect
 * Tauri at module-load and pick the right strategy.
 */
const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" &&
  // Tauri 2 sets this on the global object before app boot.
  (typeof (window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__ !== "undefined" ||
    typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined");

export const VideoClipBeat: React.FC<BeatProps> = ({
  beat,
  story,
  durationInFrames,
}) => {
  const { fps, width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const phase = beatPhase(frame, beat, durationInFrames);

  // Resolve the on-disk path to a URL the webview can fetch. In the
  // Remotion CLI render path we pass the absolute file path through
  // directly (Node loads it). We only need conversion in Tauri.
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!beat.videoSrc) {
      setResolvedSrc(null);
      return;
    }
    if (isTauriRuntime()) {
      void (async () => {
        try {
          const { convertFileSrc } = await import("@tauri-apps/api/core");
          if (!cancelled) setResolvedSrc(convertFileSrc(beat.videoSrc!));
        } catch {
          if (!cancelled) setResolvedSrc(beat.videoSrc ?? null);
        }
      })();
    } else {
      setResolvedSrc(beat.videoSrc);
    }
    return () => {
      cancelled = true;
    };
  }, [beat.videoSrc]);

  if (!resolvedSrc) {
    // No source yet — render a placeholder so the timeline still
    // reserves the slot visually.
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#4b4b5a",
          fontFamily: "ui-monospace, monospace",
          fontSize: 16,
        }}
      >
        (no video source)
      </div>
    );
  }

  // Compute display size. scale=1 means fill the canvas width. Aspect
  // ratio comes from the actual video — we let it letterbox via
  // object-fit: contain.
  const displayWidth = width * beat.scale;
  const displayHeight = height * beat.scale;
  const px = width * beat.positionX;
  const py = height * beat.positionY;

  const userRotation = beat.rotation ?? 0;
  const exit = exitTransform(beat, phase.outP);

  // Compose entry opacity: the videoClip kind keeps motion minimal —
  // a tiny fade-in over the animateInPortion so cuts feel intentional
  // rather than abrupt. Power users can set animateInPortion=0.1 for
  // a near-instant cut.
  const entryOpacity = interpolate(phase.inP, [0, 1], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: px,
        top: py,
        width: displayWidth,
        height: displayHeight,
        transform: `translate(-50%, -50%) rotate(${userRotation}deg) ${exit.transform}`,
        opacity: entryOpacity * exit.opacity,
        filter: exit.filter,
        overflow: "hidden",
        willChange: "transform, opacity",
      }}
    >
      <OffthreadVideo
        src={resolvedSrc}
        startFrom={Math.max(0, Math.round(beat.videoStartSec * fps))}
        volume={beat.volume}
        muted={beat.volume <= 0}
        style={{
          width: "100%",
          height: "100%",
          // contain so the user can see the full frame; cover would
          // crop. For a "fill canvas" look the user sets scale > 1.
          objectFit: "contain",
          display: "block",
        }}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// 9. ImageClipBeat — still image with Ken Burns (zoom + pan over duration).
// ---------------------------------------------------------------------------

/**
 * Renders a local image as a timeline clip. Like videoClip, the image
 * is anchored at positionX/Y, sized by `scale` (1 = fill canvas
 * width), and rotated by `rotation`. Stills get Ken Burns motion for
 * free: a slow zoom (in or out, controlled by `kenBurnsDir`) plus an
 * optional pan in any direction over the clip's duration.
 *
 * The image source is converted to an `asset://` URL inside Tauri so
 * the webview can load it; the Remotion CLI render path uses the
 * absolute file path directly.
 */
export const ImageClipBeat: React.FC<BeatProps> = ({
  beat,
  story,
  durationInFrames,
}) => {
  const { width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const phase = beatPhase(frame, beat, durationInFrames);

  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!beat.imageSrc) {
      setResolvedSrc(null);
      return;
    }
    if (isTauriRuntime()) {
      void (async () => {
        try {
          const { convertFileSrc } = await import("@tauri-apps/api/core");
          if (!cancelled) setResolvedSrc(convertFileSrc(beat.imageSrc!));
        } catch {
          if (!cancelled) setResolvedSrc(beat.imageSrc ?? null);
        }
      })();
    } else {
      setResolvedSrc(beat.imageSrc);
    }
    return () => {
      cancelled = true;
    };
  }, [beat.imageSrc]);

  if (!resolvedSrc) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#4b4b5a",
          fontFamily: "ui-monospace, monospace",
          fontSize: 16,
        }}
      >
        (no image source)
      </div>
    );
  }

  // Beat-local progress (0 at start, 1 at end of beat) drives Ken Burns.
  // Use the un-eased phase.t so motion is linear — Ken Burns wants a
  // steady drift, not snappy.
  const kbT = phase.t;

  // Zoom: in = scale 1 → 1+zoom, out = 1+zoom → 1.
  const zoomAmt = beat.kenBurnsZoom ?? 0;
  const kbZoom =
    beat.kenBurnsDir === "out"
      ? interpolate(kbT, [0, 1], [1 + zoomAmt, 1])
      : interpolate(kbT, [0, 1], [1, 1 + zoomAmt]);

  // Pan: convert angle to a unit vector, scale by panAmt and the image
  // size at this scale.
  const panAmt = beat.kenBurnsPan ?? 0;
  const panAngle = ((beat.kenBurnsPanAngle ?? 0) * Math.PI) / 180;
  const panRange = panAmt * width; // approx — width-based feels right at 9:16
  const panX = interpolate(kbT, [0, 1], [0, Math.cos(panAngle) * panRange]);
  const panY = interpolate(kbT, [0, 1], [0, Math.sin(panAngle) * panRange]);

  const displayWidth = width * beat.scale;
  const displayHeight = height * beat.scale;
  const px = width * beat.positionX;
  const py = height * beat.positionY;

  const userRotation = beat.rotation ?? 0;
  const exit = exitTransform(beat, phase.outP);
  const entryOpacity = interpolate(phase.inP, [0, 1], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: px,
        top: py,
        width: displayWidth,
        height: displayHeight,
        transform: `translate(-50%, -50%) rotate(${userRotation}deg) ${exit.transform}`,
        opacity: entryOpacity * exit.opacity,
        filter: exit.filter,
        overflow: "hidden",
        willChange: "transform, opacity",
      }}
    >
      <Img
        src={resolvedSrc}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          // Ken Burns: zoom + pan inside the clip's bounding box.
          transform: `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${kbZoom.toFixed(4)})`,
          transformOrigin: "center",
          display: "block",
        }}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export const BeatRenderer: React.FC<BeatProps> = (props) => {
  switch (props.beat.kind) {
    case "morph":
      return <MorphBeat {...props} />;
    case "generativeFill":
      return <GenerativeFillBeat {...props} />;
    case "tile":
      return <TileBeat {...props} />;
    case "oscillate":
      return <OscillateBeat {...props} />;
    case "cinema":
      return <CinemaBeat {...props} />;
    case "shape":
      return <ShapeBeat {...props} />;
    case "videoClip":
      return <VideoClipBeat {...props} />;
    case "imageClip":
      return <ImageClipBeat {...props} />;
    case "reveal":
    default:
      return <RevealBeat {...props} />;
  }
};
