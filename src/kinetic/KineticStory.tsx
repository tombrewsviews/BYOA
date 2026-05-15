/**
 * KineticStory — the composition. Takes a validated `Story` (the API
 * surface) and lays its beats out on the timeline, one <Sequence> per
 * beat, back to back. Each beat renders via <BeatRenderer>.
 *
 * Two font paths are in play and BOTH must be ready before frames render:
 *  1. The webfont (CSS) — used by RevealBeat's <span>s and the
 *     GenerativeFillBeat <text> mask. Loaded via @remotion/google-fonts.
 *  2. The parsed .ttf — used by MorphBeat for glyph outlines. Loaded
 *     inside glyphs.ts via its own delayRender.
 *
 * Composition duration is NOT hardcoded — Root.tsx uses calculateMetadata()
 * + storyDurationInFrames() so the timeline always matches the script.
 */
import React from "react";
import {
  AbsoluteFill,
  Sequence,
  delayRender,
  continueRender,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";
import { type Story } from "./schema";
import { BeatRenderer } from "./beats";
import { Background } from "./Background";

// Webfont — held with delayRender so the <text> mask + spans don't render
// against a fallback (which would also shift the mask geometry).
const { waitUntilDone } = loadFont("normal", { weights: ["700"] });
const fontHandle = delayRender("KineticStory: webfont");
waitUntilDone()
  .then(() => continueRender(fontHandle))
  .catch(() => continueRender(fontHandle));

export const KineticStory: React.FC<Story> = (story) => {
  return (
    <AbsoluteFill>
      {/* the background layer — gradient / shader / image / video,
          selected by story.background.kind (see Background.tsx) */}
      <Background story={story} />
      <Timeline story={story} beats={story.beats} />
    </AbsoluteFill>
  );
};

// Split out so fps can be read via useVideoConfig without making
// KineticStory itself a hook-heavy component.
const Timeline: React.FC<{ story: Story; beats: Story["beats"] }> = ({
  story,
  beats,
}) => {
  const { fps } = useVideoConfig();
  let cursor = 0; // running frame offset

  return (
    <>
      {beats.map((beat, i) => {
        const durationInFrames = Math.max(
          1,
          Math.round(beat.durationInSeconds * fps),
        );
        const from = cursor;
        cursor += durationInFrames;
        return (
          <Sequence
            key={i}
            from={from}
            durationInFrames={durationInFrames}
            name={`Beat ${i + 1}: ${beat.kind} "${beat.text}"`}
          >
            <BeatRenderer
              beat={beat}
              story={story}
              durationInFrames={durationInFrames}
            />
          </Sequence>
        );
      })}
    </>
  );
};
