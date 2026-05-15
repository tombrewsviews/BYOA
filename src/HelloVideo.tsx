/**
 * The video composition — a plain React component.
 *
 * TEACHING NOTES — the 3 Remotion fundamentals every composition uses:
 *
 * 1. useCurrentFrame()  -> the single source of truth for time. Remotion
 *    re-renders this component once per frame. You NEVER use setTimeout,
 *    requestAnimationFrame, or CSS animations — everything is derived from
 *    the current frame number so renders are deterministic.
 *
 * 2. interpolate(frame, [inFrame, outFrame], [fromValue, toValue])
 *    -> maps a frame range onto a value range. This is your linear tween.
 *
 * 3. spring({ frame, fps }) -> physically-based easing, returns ~0..1.
 *    Use it for natural motion (entrances, bounces) instead of linear interp.
 *
 * Because it's just a component, the SAME file is rendered by the CLI
 * (to an mp4) AND embedded live in a React app via <Player>. That dual use
 * is the whole point of Remotion.
 */
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Props are typed — these get passed from Studio defaultProps OR from the
// Player's inputProps at runtime. Same shape, two delivery mechanisms.
export type HelloVideoProps = {
  title: string;
  subtitle: string;
  bgColor: string;
  accentColor: string;
};

export const HelloVideo: React.FC<HelloVideoProps> = ({
  title,
  subtitle,
  bgColor,
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  // Spring-driven entrance for the title (scale + fade), starts at frame 0.
  const titleSpring = spring({ frame, fps, config: { damping: 12 } });
  const titleScale = interpolate(titleSpring, [0, 1], [0.6, 1]);
  const titleOpacity = interpolate(titleSpring, [0, 1], [0, 1]);

  // Subtitle slides up + fades in, delayed to frame 15.
  const subtitleProgress = spring({ frame: frame - 15, fps });
  const subtitleY = interpolate(subtitleProgress, [0, 1], [40, 0]);
  const subtitleOpacity = interpolate(subtitleProgress, [0, 1], [0, 1]);

  // An accent bar that wipes across the screen between frames 25 and 55.
  const barWidth = interpolate(frame, [25, 55], [0, width * 0.4], {
    extrapolateLeft: "clamp", // before frame 25 -> stay at 0
    extrapolateRight: "clamp", // after frame 55 -> stay at full width
  });

  // Subtle continuous "breathing" so the scene never looks frozen.
  const breathe = interpolate(
    Math.sin((frame / fps) * Math.PI),
    [-1, 1],
    [0.98, 1.02],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: bgColor }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          gap: 24,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div
          style={{
            height: 8,
            width: barWidth,
            backgroundColor: accentColor,
            borderRadius: 999,
          }}
        />
        <h1
          style={{
            margin: 0,
            fontSize: 90,
            fontWeight: 800,
            color: "white",
            transform: `scale(${titleScale * breathe})`,
            opacity: titleOpacity,
            textAlign: "center",
            letterSpacing: -2,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: 38,
            color: accentColor,
            transform: `translateY(${subtitleY}px)`,
            opacity: subtitleOpacity,
            fontWeight: 500,
          }}
        >
          {subtitle}
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
