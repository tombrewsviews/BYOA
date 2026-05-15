/**
 * Frame-based ports of the portfolio's GSAP typography animations.
 *
 * The portfolio drives these with GSAP timelines on scroll. Here they're
 * driven by `useCurrentFrame()` so they render deterministically to MP4
 * AND play live in the <Player>. Same visual design — easing curves,
 * stagger timings and offsets are copied from the GSAP config — different
 * (frame-based) engine.
 *
 * Three components, mirroring the portfolio:
 *   <LineReveal/>   — section-heading line-by-line slide-up (power4.out)
 *   <ScatterText/>  — CTA scatter-to-assemble, stagger from center (power3.out)
 *   <WidthReveal/>  — ship-title width expand + natural reflow (power3.inOut)
 *
 * Shared timing helper: `staggered()` computes a per-item progress value
 * from the global frame, an item index, a per-item delay and a duration —
 * this is the frame-based equivalent of GSAP's `stagger`.
 */
import React, { useMemo } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { power3, power4 } from "./easings";
import { useLines, splitChars } from "./useLines";

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

/**
 * Per-item eased progress 0..1.
 * @param frame      current frame
 * @param index      item's position in the sequence
 * @param opts.delay frames before the WHOLE animation starts
 * @param opts.stagger  frames between consecutive items (GSAP `stagger`)
 * @param opts.duration frames each item takes to animate
 * @param opts.ease  easing fn from ./easings
 */
const staggered = (
  frame: number,
  index: number,
  opts: {
    delay: number;
    stagger: number;
    duration: number;
    ease: (t: number) => number;
  },
): number => {
  const localStart = opts.delay + index * opts.stagger;
  const linear = interpolate(
    frame,
    [localStart, localStart + opts.duration],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return opts.ease(linear);
};

/**
 * Tiny seeded PRNG (mulberry32). REMOTION PITFALL: never call Math.random()
 * in a composition — it returns a different value every frame, so the
 * "scattered" positions would jitter and the MP4 render would differ from
 * the preview. A seeded generator gives stable per-character offsets.
 */
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------------
// 1. LineReveal — section-heading line-by-line slide-up
//    Portfolio: gsap.set(inners,{y:'110%'}); gsap.to(inners,{y:'0%',
//    stagger:0.08, duration:0.9, ease:'power4.out'})
// ---------------------------------------------------------------------------

export type LineRevealProps = {
  text: string;
  /** CSS font shorthand for pretext, e.g. "700 96px 'Space Grotesk'" */
  font: string;
  fontSize: number;
  maxWidth: number;
  color?: string;
  lineHeightRatio?: number; // portfolio uses ~0.85 for tight display type
  delay?: number; // frames before first line moves
  staggerSeconds?: number; // portfolio: 0.08
  durationSeconds?: number; // portfolio: 0.9
  style?: React.CSSProperties;
};

export const LineReveal: React.FC<LineRevealProps> = ({
  text,
  font,
  fontSize,
  maxWidth,
  color = "white",
  lineHeightRatio = 0.85,
  delay = 0,
  staggerSeconds = 0.08,
  durationSeconds = 0.9,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lineHeight = fontSize * lineHeightRatio;
  const lines = useLines(text, font, maxWidth, lineHeight);

  return (
    <div style={{ maxWidth, ...style }}>
      {lines.map((line, i) => {
        const p = staggered(frame, i, {
          delay,
          stagger: staggerSeconds * fps,
          duration: durationSeconds * fps,
          ease: power4.out,
        });
        // y: 110% -> 0%, masked by the overflow:hidden wrapper.
        const y = interpolate(p, [0, 1], [110, 0]);
        return (
          <div key={i} style={{ overflow: "hidden", lineHeight: 1 }}>
            <div
              style={{
                fontSize,
                fontWeight: 700,
                color,
                transform: `translateY(${y}%)`,
                lineHeight: lineHeightRatio,
                willChange: "transform",
              }}
            >
              {line.text}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 2. ScatterText — CTA scatter-to-assemble
//    Portfolio: chars start at random x(-20..20) y(-12.5..12.5)
//    rotateZ(-4..4) opacity:0; animate to 0/0/0/1 with
//    stagger {each:0.015, from:'center'}, duration:1, ease:'power3.out'
// ---------------------------------------------------------------------------

export type ScatterTextProps = {
  text: string;
  fontSize: number;
  color?: string;
  fontWeight?: number;
  delay?: number;
  staggerSeconds?: number; // portfolio: 0.015
  durationSeconds?: number; // portfolio: 1
  seed?: number; // change to get a different scatter pattern
  scatter?: number; // overall offset magnitude multiplier
  style?: React.CSSProperties;
};

export const ScatterText: React.FC<ScatterTextProps> = ({
  text,
  fontSize,
  color = "white",
  fontWeight = 700,
  delay = 0,
  staggerSeconds = 0.015,
  durationSeconds = 1,
  seed = 1,
  scatter = 1,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chars = splitChars(text);

  // Precompute each char's scattered start state ONCE (seeded, stable).
  const offsets = useMemo(() => {
    const rand = mulberry32(seed);
    return chars.map(() => ({
      x: (rand() - 0.5) * 40 * scatter,
      y: (rand() - 0.5) * 25 * scatter,
      rot: (rand() - 0.5) * 8 * scatter,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, seed, scatter]);

  // GSAP `from: 'center'` — stagger index counts outward from the middle.
  const mid = (chars.length - 1) / 2;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", ...style }}>
      {chars.map((ch, i) => {
        // Spaces need an explicit width — in a flex row a bare space (or
        // &nbsp;) collapses, gluing words together ("Start now" -> "Startnow").
        if (ch.trim() === "") {
          return (
            <span
              key={i}
              style={{ display: "inline-block", width: fontSize * 0.32 }}
            />
          );
        }
        const distFromCenter = Math.abs(i - mid);
        const p = staggered(frame, distFromCenter, {
          delay,
          stagger: staggerSeconds * fps,
          duration: durationSeconds * fps,
          ease: power3.out,
        });
        const o = offsets[i];
        const x = interpolate(p, [0, 1], [o.x, 0]);
        const y = interpolate(p, [0, 1], [o.y, 0]);
        const rot = interpolate(p, [0, 1], [o.rot, 0]);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              fontSize,
              fontWeight,
              color,
              opacity: p,
              transform: `translate(${x}px, ${y}px) rotate(${rot}deg)`,
              willChange: "transform, opacity",
            }}
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 3. WidthReveal — ship-title width expand + natural reflow
//    Portfolio: gsap.set(el,{maxWidth:'3em'}); gsap.to(el,{maxWidth:fullPx,
//    duration:1.5, ease:'power3.inOut'}) — text reflows as the box widens.
// ---------------------------------------------------------------------------

export type WidthRevealProps = {
  text: string;
  font: string;
  fontSize: number;
  fullWidth: number; // target width in px
  color?: string;
  fontWeight?: number;
  lineHeightRatio?: number;
  delay?: number;
  durationSeconds?: number; // portfolio: 1.5
  startEm?: number; // portfolio: 3
  style?: React.CSSProperties;
};

export const WidthReveal: React.FC<WidthRevealProps> = ({
  text,
  font,
  fontSize,
  fullWidth,
  color = "white",
  fontWeight = 700,
  lineHeightRatio = 0.9,
  delay = 0,
  durationSeconds = 1.5,
  startEm = 3,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Validate the final layout with pretext (matches portfolio's
  // `pt.layout(...)` sanity check) — also primes pretext's cache.
  useLines(text, font, fullWidth, fontSize * lineHeightRatio);

  const linear = interpolate(
    frame,
    [delay, delay + durationSeconds * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const p = power3.inOut(linear);
  const width = interpolate(p, [0, 1], [startEm * fontSize, fullWidth]);

  return (
    <div
      style={{
        maxWidth: width,
        overflow: "hidden",
        fontSize,
        fontWeight,
        color,
        lineHeight: lineHeightRatio,
        ...style,
      }}
    >
      {text.replace(/\s+/g, " ").trim()}
    </div>
  );
};
