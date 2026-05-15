/**
 * The design-properties panel.
 *
 * Per-beat cards (one per beat in the story) + a story-level palette
 * section. Each control edits a parameter and calls onChange with the
 * updated story. The panel ONLY edits parameters — it never adds/removes
 * beats or regenerates shapes. That's Claude Code's job (the orchestrator
 * division); changing the sequence means reprompting Claude.
 *
 * Read-only things the panel surfaces but won't let you edit:
 *   - beat.text  (the word — content, Claude owns it)
 *   - beat.shape (provider-generated geometry — reprompt to change)
 */
import React from "react";
import type { Story, Beat } from "../src/kinetic/schema";
import type { Selection } from "./App";
import type { EasingName } from "../src/typography/easings";
import {
  Row,
  Slider,
  Dropdown,
  ColorControl,
  EasingPicker,
} from "./controls";

const KINDS = ["reveal", "morph", "generativeFill"] as const;
const DIRECTIONS = ["up", "down", "left", "right", "scale"] as const;
const BG_KINDS = ["gradient", "shader", "image", "video"] as const;
const SHADER_STYLES = ["aurora", "flowField", "mesh"] as const;

// --- section scaffold -------------------------------------------------------

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div style={{ marginBottom: 18 }}>
    <div
      style={{
        fontSize: 10,
        letterSpacing: 1,
        textTransform: "uppercase",
        color: "#6b6b80",
        marginBottom: 8,
        fontWeight: 600,
      }}
    >
      {title}
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {children}
    </div>
  </div>
);


// --- the panel --------------------------------------------------------------

export const Panel: React.FC<{
  story: Story;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onChange: (story: Story) => void;
  dirty: boolean;
  onSave: () => void;
}> = ({ story, selection, onSelect, onChange, dirty, onSave }) => {
  // immutably patch one beat
  const patchBeat = (i: number, patch: Partial<Beat>) => {
    const beats = story.beats.map((b, idx) =>
      idx === i ? { ...b, ...patch } : b,
    );
    onChange({ ...story, beats });
  };

  return (
    <div
      style={{
        background: "#0e0e14",
        borderLeft: "1px solid #232330",
        height: "100%",
        overflowY: "auto",
        padding: 16,
        boxSizing: "border-box",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* header + save */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "#e4e4ee" }}>
          {selection.kind === "story"
            ? "Story"
            : `${selection.index + 1}. ${story.beats[selection.index]?.text ?? ""}`}
        </span>
        <button
          onClick={onSave}
          disabled={!dirty}
          style={{
            fontSize: 11,
            padding: "5px 12px",
            borderRadius: 6,
            border: "none",
            cursor: dirty ? "pointer" : "default",
            background: dirty ? "#7c5cff" : "#232330",
            color: dirty ? "white" : "#6b6b80",
            fontWeight: 600,
          }}
        >
          {dirty ? "Save to story.json" : "Saved"}
        </button>
      </div>

      {selection.kind === "story" ? (
        <StoryEditor story={story} onChange={onChange} />
      ) : (
        <BeatEditor
          beat={story.beats[selection.index]}
          index={selection.index}
          fallbackTextColor={story.textColor}
          onChange={(patch) => patchBeat(selection.index, patch)}
        />
      )}

      <div
        style={{
          fontSize: 10,
          color: "#4b4b5a",
          lineHeight: 1.5,
          marginTop: 16,
        }}
      >
        This panel tweaks parameters only. To change the sequence — add or
        remove beats, edit words, generate new shapes — reprompt Claude
        Code (open the terminal pane).
      </div>
    </div>
  );
};

// --- StoryEditor subcomponent -----------------------------------------------

const StoryEditor: React.FC<{
  story: Story;
  onChange: (story: Story) => void;
}> = ({ story, onChange }) => {
  const patchStory = (patch: Partial<Story>) => onChange({ ...story, ...patch });

  return (
    <>
      <Section title="Palette & background">
        <Row label="bg">
          <ColorControl
            value={story.bgColor}
            onChange={(v) => patchStory({ bgColor: v })}
          />
        </Row>
        <Row label="bg end">
          <ColorControl
            value={story.bgColor2}
            onChange={(v) => patchStory({ bgColor2: v })}
          />
        </Row>
        <Row label="text">
          <ColorControl
            value={story.textColor}
            onChange={(v) => patchStory({ textColor: v })}
          />
        </Row>
        <Row label="accent">
          <ColorControl
            value={story.accentColor}
            onChange={(v) => patchStory({ accentColor: v })}
          />
        </Row>
        <Row label="accent 2">
          <ColorControl
            value={story.accent2Color}
            onChange={(v) => patchStory({ accent2Color: v })}
          />
        </Row>
        <Row label="font size">
          <Slider
            value={story.fontSize}
            min={40}
            max={400}
            step={5}
            onChange={(v) => patchStory({ fontSize: v })}
          />
        </Row>
        <Row label="glow">
          <Slider
            value={story.glowIntensity}
            min={0}
            max={2}
            step={0.1}
            onChange={(v) => patchStory({ glowIntensity: v })}
          />
        </Row>
      </Section>

      <Section title="Background">
        <Row label="type">
          <Dropdown
            value={story.background.kind}
            options={BG_KINDS}
            onChange={(v) =>
              patchStory({
                background: {
                  ...story.background,
                  kind: v as Story["background"]["kind"],
                },
              })
            }
          />
        </Row>
        {story.background.kind === "shader" && (
          <Row label="style">
            <Dropdown
              value={story.background.shaderStyle}
              options={SHADER_STYLES}
              onChange={(v) =>
                patchStory({
                  background: {
                    ...story.background,
                    shaderStyle: v as Story["background"]["shaderStyle"],
                  },
                })
              }
            />
          </Row>
        )}
        {(story.background.kind === "image" ||
          story.background.kind === "video") && (
          <Row label="src">
            <input
              value={story.background.src ?? ""}
              placeholder="path under public/ or URL"
              onChange={(e) =>
                patchStory({
                  background: { ...story.background, src: e.target.value },
                })
              }
              style={{
                flex: 1,
                background: "#1c1c26",
                border: "1px solid #2e2e3c",
                borderRadius: 5,
                color: "#e4e4ee",
                fontSize: 11,
                padding: "3px 6px",
              }}
            />
          </Row>
        )}
        <Row label="motion">
          <Slider
            value={story.background.motion}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) =>
              patchStory({
                background: { ...story.background, motion: v },
              })
            }
          />
        </Row>
      </Section>
    </>
  );
};

// --- BeatEditor subcomponent ------------------------------------------------

const BeatEditor: React.FC<{
  beat: Beat | undefined;
  index: number;
  fallbackTextColor: string;
  onChange: (patch: Partial<Beat>) => void;
}> = ({ beat, fallbackTextColor, onChange }) => {
  if (!beat) {
    return (
      <div style={{ fontSize: 11, color: "#8b8b9a", padding: "10px 0" }}>
        Selected beat no longer exists.
      </div>
    );
  }
  return (
    <Section title={`${beat.kind} beat`}>
      <Row label="kind">
        <Dropdown
          value={beat.kind}
          options={KINDS}
          onChange={(v) => onChange({ kind: v as Beat["kind"] })}
        />
      </Row>
      <Row label="duration">
        <Slider
          value={beat.durationInSeconds}
          min={0.3}
          max={10}
          step={0.1}
          onChange={(v) => onChange({ durationInSeconds: v })}
        />
      </Row>
      <Row label="easing">
        <EasingPicker
          value={beat.easing as EasingName}
          onChange={(v) => onChange({ easing: v })}
        />
      </Row>
      {beat.kind !== "generativeFill" && (
        <Row label="direction">
          <Dropdown
            value={beat.direction}
            options={DIRECTIONS}
            onChange={(v) =>
              onChange({ direction: v as Beat["direction"] })
            }
          />
        </Row>
      )}
      <Row label="dynamics">
        <Slider
          value={beat.dynamics}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => onChange({ dynamics: v })}
        />
      </Row>
      <Row label="stagger">
        <Slider
          value={beat.staggerSeconds}
          min={0}
          max={0.2}
          step={0.005}
          onChange={(v) => onChange({ staggerSeconds: v })}
        />
      </Row>
      <Row label="anim in">
        <Slider
          value={beat.animateInPortion}
          min={0.1}
          max={0.9}
          step={0.05}
          onChange={(v) => onChange({ animateInPortion: v })}
        />
      </Row>
      <Row label="scale">
        <Slider
          value={beat.scale}
          min={0.3}
          max={2.5}
          step={0.05}
          onChange={(v) => onChange({ scale: v })}
        />
      </Row>
      <Row label="glow">
        <Slider
          value={beat.glow}
          min={0}
          max={60}
          step={2}
          onChange={(v) => onChange({ glow: v })}
        />
      </Row>
      <Row label="color">
        <ColorControl
          value={beat.color ?? fallbackTextColor}
          onChange={(v) => onChange({ color: v })}
        />
      </Row>
      {beat.kind === "morph" && (
        <div
          style={{
            fontSize: 10,
            color: "#6b6b80",
            marginTop: 4,
            fontStyle: "italic",
          }}
        >
          shape: {beat.shape ? "provider-generated" : "default circle"} —
          reprompt Claude Code to change
        </div>
      )}
    </Section>
  );
};
