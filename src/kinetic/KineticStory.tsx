/**
 * KineticStory — the composition. Takes a validated `Story` and lays its
 * beats out on the timeline, one <Sequence> per beat, back to back.
 *
 * Font loading: we self-host four families from public/fonts/ and register
 * them via @font-face. Three of them are variable fonts and we expose
 * their axes via `font-variation-settings` so the beats can animate
 * wght / wdth / slnt per frame. We DON'T use @remotion/google-fonts here
 * because we want a) deterministic local files (no network during render)
 * and b) the actual variable axes, which Google's helper subsets out.
 *
 * Composition duration is NOT hardcoded — Root.tsx uses calculateMetadata()
 * + storyDurationInFrames() so the timeline always matches the script.
 */
import React from "react";
import {
  AbsoluteFill,
  Sequence,
  staticFile,
  useVideoConfig,
} from "remotion";
import { type Story, normalizeBeat, resolveBeatTimes } from "./schema";
import { BeatRenderer } from "./beats";
import { Background } from "./Background";
import { FONT_REGISTRY } from "./glyphs";

/**
 * Emit one @font-face per family. font-display: block so the renderer
 * waits for the file (matches Remotion's frame-deterministic guarantee).
 */
const FontFaces: React.FC = () => {
  const css = (Object.entries(FONT_REGISTRY))
    .map(
      ([, entry]) => `
@font-face {
  font-family: '${entry.cssFamily}';
  src: url('${staticFile(entry.file)}') format('truetype-variations'),
       url('${staticFile(entry.file)}') format('truetype');
  font-weight: 100 1000;
  font-stretch: 25% 200%;
  font-style: oblique -15deg 0deg;
  font-display: block;
}`,
    )
    .join("\n");
  return <style>{css}</style>;
};

export const KineticStory: React.FC<Story> = (story) => {
  return (
    <AbsoluteFill>
      <FontFaces />
      <Background story={story} />
      <Timeline story={story} beats={story.beats} />
    </AbsoluteFill>
  );
};

const Timeline: React.FC<{ story: Story; beats: Story["beats"] }> = ({
  story,
  beats,
}) => {
  const { fps } = useVideoConfig();
  // resolveBeatTimes gives us per-beat startSeconds (explicit OR derived
  // per-track sequentially). Each beat becomes a Sequence at that start.
  // Beats can now overlap (same time, different tracks) or have gaps.
  const resolved = resolveBeatTimes(story);

  // Sort by track ascending so higher tracks render on top — Remotion
  // renders later siblings on top of earlier ones in the absolute-fill
  // composition.
  const order = beats
    .map((b, i) => ({ i, track: b.track }))
    .sort((a, b) => a.track - b.track);

  return (
    <>
      {order.map(({ i }) => {
        const beat = beats[i];
        const normalized = normalizeBeat(beat);
        const r = resolved[i];
        const from = Math.max(0, Math.round(r.startSeconds * fps));
        const durationInFrames = Math.max(
          1,
          Math.round(normalized.durationInSeconds * fps),
        );
        return (
          <Sequence
            key={i}
            from={from}
            durationInFrames={durationInFrames}
            name={`Beat ${i + 1} [t${beat.track}]: ${normalized.kind} "${normalized.text}"`}
          >
            <BeatRenderer
              beat={normalized}
              story={story}
              durationInFrames={durationInFrames}
            />
          </Sequence>
        );
      })}
    </>
  );
};
