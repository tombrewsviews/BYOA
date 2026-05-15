/**
 * Demo composition showing all three ported typography animations,
 * sequenced. This is the "social post" style title card.
 *
 * FONT LOADING — important Remotion + pretext detail:
 * pretext measures text against a font. If the font isn't loaded yet, it
 * measures the fallback, computes line breaks for the wrong metrics, then
 * the real font swaps in and the layout jumps. @remotion/google-fonts'
 * `loadFont()` + `waitForFonts()` (wired in Root via delayRender or just
 * importing here) ensures the font is ready. We load it at module scope
 * so it's registered before any frame renders.
 *
 * <Sequence> is Remotion's timing primitive: it shifts a child's frame 0
 * to a later point on the timeline. Each animation below lives in its own
 * Sequence so they play one after another.
 */
import React from "react";
import { AbsoluteFill, Sequence, delayRender, continueRender } from "remotion";
import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";
import { LineReveal, ScatterText, WidthReveal } from "./typography/AnimatedText";

// FONT LOADING — must finish before any frame (and before pretext measures).
// loadFont() returns { fontFamily, waitUntilDone }. We hold the render with
// delayRender() until the font is actually ready, then release it. Without
// this, pretext measures the fallback serif and the render uses it too.
const { fontFamily, waitUntilDone } = loadFont();
const fontHandle = delayRender("Loading Space Grotesk");
waitUntilDone()
  .then(() => continueRender(fontHandle))
  .catch(() => continueRender(fontHandle));

export type TypographyDemoProps = {
  headline: string;
  ctaText: string;
  shipText: string;
  bgColor: string;
  accentColor: string;
};

// pretext wants a CSS font shorthand string: "<weight> <size>px <family>".
const fontStr = (weight: number, size: number) =>
  `${weight} ${size}px ${fontFamily}`;

export const TypographyDemo: React.FC<TypographyDemoProps> = ({
  headline,
  ctaText,
  shipText,
  bgColor,
  accentColor,
}) => {
  const CONTENT_WIDTH = 1000;

  return (
    <AbsoluteFill style={{ backgroundColor: bgColor, fontFamily }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: 80,
        }}
      >
        {/* 1. LINE REVEAL — frames 0..~70. Section-heading slide-up. */}
        <Sequence durationInFrames={75} name="LineReveal">
          <Centered>
            <LineReveal
              text={headline}
              font={fontStr(700, 96)}
              fontSize={96}
              maxWidth={CONTENT_WIDTH}
              color="white"
              staggerSeconds={0.08}
              durationSeconds={0.9}
              style={{ textTransform: "uppercase" }}
            />
          </Centered>
        </Sequence>

        {/* 2. SCATTER TEXT — frames 75..~165. CTA scatter-to-assemble. */}
        <Sequence from={75} durationInFrames={90} name="ScatterText">
          <Centered>
            <ScatterText
              text={ctaText}
              fontSize={88}
              color={accentColor}
              staggerSeconds={0.015}
              durationSeconds={1}
              seed={7}
              style={{
                justifyContent: "center",
                textTransform: "uppercase",
                maxWidth: CONTENT_WIDTH,
              }}
            />
          </Centered>
        </Sequence>

        {/* 3. WIDTH REVEAL — frames 165..end. Ship-title expand + reflow. */}
        <Sequence from={165} name="WidthReveal">
          <Centered>
            <WidthReveal
              text={shipText}
              font={fontStr(700, 72)}
              fontSize={72}
              fullWidth={CONTENT_WIDTH}
              color="white"
              durationSeconds={1.5}
              startEm={3}
              style={{ textTransform: "uppercase", textAlign: "center" }}
            />
          </Centered>
        </Sequence>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      justifyContent: "center",
      alignItems: "center",
    }}
  >
    {children}
  </AbsoluteFill>
);
