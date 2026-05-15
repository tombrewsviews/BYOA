/**
 * The background layer — behind the kinetic type.
 *
 * Four kinds (schema: `story.background.kind`):
 *  - gradient : animated mesh gradient — drifting linear base + two
 *               wandering radial accent glows. (was the old hardcoded bg)
 *  - shader   : "shader-like" animated patterns. NOT WebGL — these are
 *               frame-deterministic SVG/CSS, because Remotion needs every
 *               frame to be a pure function of the frame number and a
 *               WebGL context can't guarantee that. Three styles:
 *               aurora, flowField, mesh.
 *  - image    : a still <Img> from public/ or a URL. STUBBED — renders the
 *               image if `src` is set, else a labelled placeholder.
 *  - video    : an <OffthreadVideo>. STUBBED likewise. The "Claude-
 *               generated video" path would feed a generated file here,
 *               but that needs a video-gen API (separate work + cost).
 *
 * All animation is driven by useCurrentFrame() — deterministic, renders
 * identically every time.
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  random,
  Img,
  OffthreadVideo,
} from "remotion";
import type { Story } from "./schema";

/** 0..1 -> two-digit hex alpha suffix for an #rrggbb color. */
const alpha = (a: number): string =>
  Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, "0");

export const Background: React.FC<{ story: Story }> = ({ story }) => {
  const { kind } = story.background;
  switch (kind) {
    case "shader":
      return <ShaderBackground story={story} />;
    case "image":
      return <ImageBackground story={story} />;
    case "video":
      return <VideoBackground story={story} />;
    case "gradient":
    default:
      return <GradientBackground story={story} />;
  }
};

// ---------------------------------------------------------------------------
// gradient — drifting linear base + two wandering radial glows
// ---------------------------------------------------------------------------

const GradientBackground: React.FC<{ story: Story }> = ({ story }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const m = story.background.motion;

  const angle = 135 + Math.sin(t * 0.25 * m) * 35 * m;
  const gAX = width * (0.3 + Math.sin(t * 0.4 * m) * 0.18 * m);
  const gAY = height * (0.3 + Math.cos(t * 0.33 * m) * 0.15 * m);
  const gBX = width * (0.7 + Math.cos(t * 0.3 * m) * 0.18 * m);
  const gBY = height * (0.7 + Math.sin(t * 0.45 * m) * 0.15 * m);
  const pulse = interpolate(Math.sin(t * 0.6 * m), [-1, 1], [0.18, 0.32]);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${angle}deg, ${story.bgColor}, ${story.bgColor2})`,
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${gAX}px ${gAY}px, ${story.accentColor}${alpha(pulse)}, transparent 45%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${gBX}px ${gBY}px, ${story.accent2Color}${alpha(pulse * 0.8)}, transparent 45%)`,
        }}
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// shader — frame-deterministic "shader-like" patterns (no WebGL)
// ---------------------------------------------------------------------------

const ShaderBackground: React.FC<{ story: Story }> = ({ story }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const m = story.background.motion;
  const style = story.background.shaderStyle;

  if (style === "flowField") {
    // a field of seeded streaks that drift — reads like a flow field
    const STREAKS = 40;
    return (
      <AbsoluteFill style={{ background: story.bgColor, overflow: "hidden" }}>
        <svg width={width} height={height}>
          {new Array(STREAKS).fill(0).map((_, i) => {
            const bx = random(`fx${i}`) * width;
            const by = random(`fy${i}`) * height;
            const len = 40 + random(`fl${i}`) * 160;
            const speed = (0.3 + random(`fs${i}`) * 1.2) * m;
            const ang = random(`fa${i}`) * Math.PI * 2 + t * speed;
            const x2 = bx + Math.cos(ang) * len;
            const y2 = by + Math.sin(ang) * len;
            const col = random(`fc${i}`) > 0.5 ? story.accentColor : story.accent2Color;
            return (
              <line
                key={i}
                x1={bx}
                y1={by}
                x2={x2}
                y2={y2}
                stroke={col}
                strokeWidth={2}
                strokeLinecap="round"
                opacity={0.35}
              />
            );
          })}
        </svg>
      </AbsoluteFill>
    );
  }

  if (style === "mesh") {
    // four wandering radial blobs on a flat base — a moving mesh gradient
    const blob = (seed: string, color: string) => {
      const phase = random(seed) * Math.PI * 2;
      const x = 50 + Math.sin(t * 0.3 * m + phase) * 30 * m;
      const y = 50 + Math.cos(t * 0.37 * m + phase) * 30 * m;
      return `radial-gradient(circle at ${x}% ${y}%, ${color}55, transparent 50%)`;
    };
    return (
      <AbsoluteFill
        style={{
          background: [
            blob("m1", story.accentColor),
            blob("m2", story.accent2Color),
            blob("m3", story.bgColor2),
            story.bgColor,
          ].join(", "),
        }}
      />
    );
  }

  // aurora (default): stacked drifting waves of color
  return (
    <AbsoluteFill style={{ background: story.bgColor, overflow: "hidden" }}>
      {[story.accentColor, story.accent2Color, story.bgColor2].map((c, i) => {
        const offset = i * 0.6;
        const y = 30 + i * 20 + Math.sin(t * 0.4 * m + offset) * 15 * m;
        const skew = Math.sin(t * 0.3 * m + offset) * 12 * m;
        return (
          <AbsoluteFill
            key={i}
            style={{
              background: `linear-gradient(180deg, transparent, ${c}66, transparent)`,
              transform: `translateY(${y - 50}%) skewY(${skew}deg)`,
              opacity: 0.7,
              filter: "blur(40px)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// image / video — STUBBED. Render the asset if a src is given, else a
// labelled placeholder so the schema option is usable end-to-end.
// ---------------------------------------------------------------------------

const ImageBackground: React.FC<{ story: Story }> = ({ story }) => {
  const { src } = story.background;
  if (!src) return <Placeholder kind="image" story={story} />;
  return (
    <AbsoluteFill style={{ background: story.bgColor }}>
      <Img
        src={src}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </AbsoluteFill>
  );
};

const VideoBackground: React.FC<{ story: Story }> = ({ story }) => {
  const { src } = story.background;
  if (!src) return <Placeholder kind="video" story={story} />;
  return (
    <AbsoluteFill style={{ background: story.bgColor }}>
      <OffthreadVideo
        src={src}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
        muted
      />
    </AbsoluteFill>
  );
};

const Placeholder: React.FC<{ kind: string; story: Story }> = ({
  kind,
  story,
}) => (
  <AbsoluteFill
    style={{
      background: `linear-gradient(135deg, ${story.bgColor}, ${story.bgColor2})`,
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <div
      style={{
        color: "#ffffff55",
        fontSize: 36,
        fontFamily: "monospace",
        textAlign: "center",
        padding: 40,
      }}
    >
      {kind} background
      <br />
      <span style={{ fontSize: 22 }}>set background.src to an asset</span>
    </div>
  </AbsoluteFill>
);
