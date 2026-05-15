/**
 * The Remotion "Root" — this is what the Studio and the CLI renderer load.
 * It does ONE job: register <Composition> entries.
 *
 * A <Composition> = a video definition: which component, its dimensions,
 * fps, duration in frames, and default props. Think of it as the "render
 * recipe". The Player does NOT use this file — it imports the component
 * directly. Same component, two consumers.
 */
import React from "react";
import { Composition } from "remotion";
import { HelloVideo } from "./HelloVideo";
import { TypographyDemo } from "./TypographyDemo";
import { KineticStory } from "./kinetic/KineticStory";
import { storySchema, storyDurationInFrames, type Story } from "./kinetic/schema";

const typographyDefaults = {
  headline: "Ship faster with motion",
  ctaText: "Start now",
  shipText: "Built with code, not timelines",
  bgColor: "#0f172a",
  accentColor: "#38bdf8",
};

// The story script comes from story.json — the single source of truth that
// Claude Code edits (via the `kinetic` CLI) and the editor app writes back
// to. storySchema.parse fills defaults + validates. Bundled as JSON so
// Studio picks up changes on reload.
import storyData from "../story.json";
const sampleStory: Story = storySchema.parse(storyData);

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HelloVideo"
        component={HelloVideo}
        durationInFrames={120} // 4 seconds at 30fps
        fps={30}
        width={1280}
        height={720}
        defaultProps={{
          title: "Made with Remotion",
          subtitle: "React components, rendered to video",
          bgColor: "#0f172a",
          accentColor: "#38bdf8",
        }}
      />

      {/* Typography animations ported from the Portfolio 2026 v3 project
          (pretext line layout + GSAP easing curves, frame-based). */}
      <Composition
        id="TypographyDemo"
        component={TypographyDemo}
        durationInFrames={240} // 8s at 30fps
        fps={30}
        width={1280}
        height={720}
        defaultProps={typographyDefaults}
      />

      {/* Same composition, vertical 9:16 — Reels / TikTok / Shorts.
          The animation components are resolution-agnostic, so a second
          <Composition> with different dimensions is all it takes. */}
      <Composition
        id="TypographyDemo-Vertical"
        component={TypographyDemo}
        durationInFrames={240}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={typographyDefaults}
      />

      {/* KineticStory — script-driven typographic storytelling.

          `schema={storySchema}` is what makes the Studio Props panel
          render the PARAMETER EDITOR — sliders, color pickers, dropdowns,
          generated from the Zod schema. Without it the panel shows nothing
          editable. defaultProps must satisfy the schema.

          Duration is DERIVED from the script via calculateMetadata: the
          sum of all beat durations. 9:16 vertical, social-native. */}
      <Composition
        id="KineticStory"
        component={KineticStory}
        schema={storySchema}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={sampleStory}
        calculateMetadata={({ props }) => ({
          durationInFrames: storyDurationInFrames(props, 30),
        })}
      />
    </>
  );
};
