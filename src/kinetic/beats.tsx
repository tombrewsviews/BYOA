/**
 * The three kinetic-typography capabilities — now parameter-driven.
 *
 * Every beat reads its tweakable params from the schema (easing, direction,
 * dynamics, stagger, scale, color, glow) so the Studio props editor's knobs
 * actually drive the motion. Visual polish — glow, depth, provider colors —
 * is wired throughout (this is the fix for "why is it black & white").
 *
 *   RevealBeat         — word builds in letter-by-letter
 *   MorphBeat          — a provider shape morphs into the first letter,
 *                        KEEPING the provider's fill color
 *   GenerativeFillBeat — the word masks a seeded animated gradient field
 *
 * REMOTION CONCERNS (unchanged, still apply):
 *  - flubber.interpolate() is memoized — built once, not per frame.
 *  - the noise field uses seeded random() — never Math.random().
 *  - glyph work is memoized off the parsed font.
 */
import React, { useMemo } from "react";
import {
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  random,
} from "remotion";
import { interpolate as flubberInterpolate } from "flubber";
import type { Beat, Story } from "./schema";
import { getGlyphPath, useFont, DEFAULT_MORPH_SHAPE } from "./glyphs";
import { resolveEasing, directionOffset } from "../typography/easings";

type BeatProps = {
  beat: Beat;
  story: Story;
  /** frames this beat is on screen (its Sequence duration) */
  durationInFrames: number;
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    {children}
  </div>
);

/** Per-element eased progress 0..1 with stagger, using the beat's params. */
const beatProgress = (
  frame: number,
  index: number,
  beat: Beat,
  durationInFrames: number,
  fps: number,
): number => {
  const ease = resolveEasing(beat.easing);
  const animateInFrames = durationInFrames * beat.animateInPortion;
  const localStart = index * beat.staggerSeconds * fps;
  const linear = interpolate(
    frame,
    [localStart, localStart + animateInFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return ease(linear);
};

/** CSS drop-shadow glow string from the beat + story glow params. */
const glowFilter = (beat: Beat, story: Story, color: string): string => {
  const radius = beat.glow * story.glowIntensity;
  if (radius <= 0) return "none";
  // layered shadows read as a soft glow
  return `drop-shadow(0 0 ${radius * 0.5}px ${color}) drop-shadow(0 0 ${radius}px ${color})`;
};

// ---------------------------------------------------------------------------
// 1. RevealBeat — letter-by-letter build-in
// ---------------------------------------------------------------------------

export const RevealBeat: React.FC<BeatProps> = ({
  beat,
  story,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chars = Array.from(beat.text);
  const color = beat.color ?? story.textColor;
  // dynamics scales how far each letter travels in
  const travel = 40 + beat.dynamics * 90;

  return (
    <Stage>
      <div
        style={{
          display: "flex",
          padding: "0.25em 0.1em",
          filter: glowFilter(beat, story, color),
        }}
      >
        {chars.map((ch, i) => {
          const p = beatProgress(frame, i, beat, durationInFrames, fps);
          const off = directionOffset(beat.direction, p, travel);
          const opacity = interpolate(p, [0, 0.6], [0, 1], {
            extrapolateRight: "clamp",
          });
          return (
            <span
              key={i}
              style={{
                fontSize: story.fontSize * beat.scale,
                fontWeight: 700,
                color,
                fontFamily: "'Space Grotesk', sans-serif",
                transform: `translate(${off.x}px, ${off.y}px) scale(${off.scale})`,
                opacity,
                whiteSpace: "pre",
                willChange: "transform, opacity",
                display: "inline-block",
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
// 2. MorphBeat — a provider shape morphs into the word's first letter
// ---------------------------------------------------------------------------

export const MorphBeat: React.FC<BeatProps> = ({
  beat,
  story,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const font = useFont();
  const textColor = beat.color ?? story.textColor;
  // the morphing shape keeps the PROVIDER'S color when the story doesn't
  // override it — this is the fix for the all-white look. Recraft fills
  // are stored as "#rrggbb|d"? No: shape is just `d`. The provider color
  // is carried separately via beat.color when set by the CLI; if absent,
  // fall back to the accent so the shape still reads as colorful.
  const shapeColor = beat.color ?? story.accentColor;

  const chars = Array.from(beat.text.toUpperCase());
  const CELL = 100;
  const GAP = 14;

  const glyphPaths = useMemo(() => {
    if (!font) return null;
    return chars.map((ch) => getGlyphPath(font, ch)?.d ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, beat.text]);

  const morph = useMemo(() => {
    const fromShape = beat.shape ?? DEFAULT_MORPH_SHAPE;
    const target = glyphPaths?.[0];
    if (!target) return () => fromShape;
    try {
      return flubberInterpolate(fromShape, target, { maxSegmentLength: 3 });
    } catch {
      return () => target;
    }
  }, [glyphPaths, beat.shape]);

  const ease = resolveEasing(beat.easing);
  const morphProgress = ease(
    interpolate(
      frame,
      [0, durationInFrames * beat.animateInPortion],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    ),
  );
  // color shifts shape→text color as it resolves into a letter
  const colorMix = interpolate(morphProgress, [0.4, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const firstGlyphColor = colorMix >= 1 ? textColor : shapeColor;

  const currentMorphPath = morph(morphProgress);

  // re-center the morphing path every frame (flubber doesn't keep bbox).
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

  const totalWidth = chars.length * CELL + (chars.length - 1) * GAP;
  const displayWidth = (story.fontSize / CELL) * totalWidth * beat.scale;
  const displayHeight = story.fontSize * beat.scale;
  const travel = 12 + beat.dynamics * 26;

  return (
    <Stage>
      <svg
        width={displayWidth}
        height={displayHeight}
        viewBox={`0 0 ${totalWidth} ${CELL}`}
        style={{
          overflow: "visible",
          filter: glowFilter(beat, story, shapeColor),
        }}
      >
        {chars.map((ch, i) => {
          const xOffset = i * (CELL + GAP);
          if (i === 0) {
            return (
              <g key={i} transform={`translate(${xOffset}, 0)`}>
                <path
                  d={currentMorphPath}
                  fill={firstGlyphColor}
                  transform={recenterTransform}
                />
              </g>
            );
          }
          // remaining glyphs enter using the beat's easing + direction.
          const p = beatProgress(
            frame - durationInFrames * 0.35,
            i,
            beat,
            durationInFrames,
            fps,
          );
          const off = directionOffset(beat.direction, p, travel);
          const d = glyphPaths?.[i];
          if (!d) return null;
          return (
            <path
              key={i}
              d={d}
              fill={textColor}
              opacity={interpolate(p, [0, 0.6], [0, 1], {
                extrapolateRight: "clamp",
              })}
              transform={`translate(${xOffset + off.x}, ${off.y})`}
            />
          );
        })}
      </svg>
    </Stage>
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
  // the fill blends the two story accents — this is what makes it colorful
  const colorA = beat.color ?? story.accentColor;
  const colorB = story.accent2Color;

  const BLOBS = 18;
  const cx0 = width / 2;
  const cy0 = height / 2;
  const fontSize = story.fontSize * beat.scale;
  const spreadX = fontSize * beat.text.length * 0.42;
  const spreadY = fontSize * 0.9;
  // dynamics drives how fast/far the field churns
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
      tint: random(`t-${beat.text}-${i}`), // 0 = colorA, 1 = colorB
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat.text, fontSize, energy]);

  const t = frame / fps;
  const maskId = `kfill-${beat.text.replace(/\W/g, "")}`;
  const gradId = `kgrad-${beat.text.replace(/\W/g, "")}`;

  const animateInFrames = durationInFrames * beat.animateInPortion;
  const opacity = interpolate(frame, [0, animateInFrames * 0.6], [0, 1], {
    extrapolateRight: "clamp",
  });
  // subtle scale-in on the whole word, eased
  const ease = resolveEasing(beat.easing);
  const scaleIn = interpolate(
    ease(interpolate(frame, [0, animateInFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })),
    [0, 1],
    [0.86, 1],
  );

  return (
    <Stage>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          opacity,
          transform: `scale(${scaleIn})`,
          filter: glowFilter(beat, story, colorA),
        }}
      >
        <defs>
          {/* a soft gradient so even the static parts read as colorful */}
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
              fontFamily="'Space Grotesk', sans-serif"
              fontWeight={700}
              fontSize={fontSize}
              fill="white"
            >
              {beat.text}
            </text>
          </mask>
        </defs>

        <g mask={`url(#${maskId})`}>
          {/* gradient base so the type is never flat black */}
          <rect
            x={cx0 - spreadX * 1.4}
            y={cy0 - spreadY * 1.4}
            width={spreadX * 2.8}
            height={spreadY * 2.8}
            fill={`url(#${gradId})`}
            opacity={0.5}
          />
          {/* the churning blob field on top */}
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
// Dispatcher
// ---------------------------------------------------------------------------

export const BeatRenderer: React.FC<BeatProps> = (props) => {
  switch (props.beat.kind) {
    case "morph":
      return <MorphBeat {...props} />;
    case "generativeFill":
      return <GenerativeFillBeat {...props} />;
    case "reveal":
    default:
      return <RevealBeat {...props} />;
  }
};
