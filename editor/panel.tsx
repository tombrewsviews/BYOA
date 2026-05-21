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
import {
  resolveBeatTimes,
  type Story,
  type Beat,
  type FontFamily,
  type AxisRanges,
} from "../src/kinetic/schema";
import type { Selection } from "./selection";
import type { EasingName } from "../src/typography/easings";
import {
  Row,
  Slider,
  Dropdown,
  ColorControl,
  EasingPicker,
  TextInput,
} from "./controls";
import {
  type AxisKey,
  axisBounds,
  axisSupported,
  clampAxis,
  setAxisStatic,
  setAxisRange,
  isAxisAnimated,
  staticWeightOptions,
} from "./typography-axes";
import { writeState } from "./state";
import { color, font, secondaryBtn } from "./platform/theme";

/**
 * Pillar 3 tracer toggle. When true, beat-color changes route
 * through state.writeState (JSON Patch + content-addressed
 * history). When false (default), the legacy full-doc save path
 * runs unchanged.
 *
 * Toggle by setting localStorage.PILLAR3="1" in devtools (and
 * reloading). Default off so the existing save path remains the
 * kill switch until the tracer is manually verified.
 */
const PILLAR3_PATCH_MODE =
  typeof window !== "undefined" &&
  window.localStorage.getItem("PILLAR3") === "1";

const KINDS = ["reveal", "morph", "generativeFill", "tile", "oscillate", "cinema", "shape", "videoClip", "imageClip"] as const;
const DIRECTIONS = ["up", "down", "left", "right", "scale", "vertical-roll"] as const;
const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
const BG_KINDS = ["gradient", "shader"] as const;
const SHADER_STYLES = ["aurora", "flowField", "mesh"] as const;
const FONT_FAMILIES = [
  "SpaceGrotesk",
  "RobotoFlex",
  "Recursive",
  "InterVF",
  "Fraunces",
  "BricolageGrotesque",
  "InstrumentSans",
  "Archivo",
] as const;

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
        color: color.text.dim,
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

// --- AxisControl: one variable-font axis, static or animated ---------------
//
// Panel-specific (knows the [start, end] tuple convention), so it lives here
// rather than in the schema-agnostic controls.tsx. Renders a primary slider
// for the start value; an "animate" checkbox reveals a second slider for the
// end value (driving font-variation-settings interpolation across the beat).
// When the selected font doesn't vary this axis, the slider is disabled and
// shows the fixed value — no silent no-ops.

const AxisControl: React.FC<{
  label: string;
  axis: AxisKey;
  axes: AxisRanges;
  family: FontFamily;
  onChange: (axes: AxisRanges) => void;
}> = ({ label, axis, axes, family, onChange }) => {
  const supported = axisSupported(axis, family);
  const [min, max] = axisBounds(axis, family);
  const animated = isAxisAnimated(axes, axis);
  const [start, end] = axes[axis];
  const step = axis === "slnt" ? 0.5 : 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Row label={label}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={start}
          disabled={!supported}
          onChange={(e) =>
            onChange(
              animated
                ? setAxisRange(axes, axis, Number(e.target.value), end, family)
                : setAxisStatic(axes, axis, Number(e.target.value), family),
            )
          }
          style={{
            flex: 1,
            accentColor: color.text.primary,
            height: 4,
            opacity: supported ? 1 : 0.4,
          }}
        />
        <span
          style={{
            width: 52,
            textAlign: "right",
            fontSize: 11,
            color: color.text.dim,
          }}
        >
          {axis === "slnt" ? start.toFixed(1) : Math.round(start)}
        </span>
      </Row>
      {supported && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingLeft: 88,
          }}
        >
          <label
            style={{
              fontSize: 10,
              color: color.text.muted,
              display: "flex",
              gap: 4,
              alignItems: "center",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={animated}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? setAxisRange(axes, axis, start, clampAxis(max, axis, family), family)
                    : setAxisStatic(axes, axis, start, family),
                )
              }
            />
            animate
          </label>
          {animated && (
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={end}
              onChange={(e) =>
                onChange(setAxisRange(axes, axis, start, Number(e.target.value), family))
              }
              style={{ flex: 1, accentColor: color.accent.fg, height: 4 }}
            />
          )}
        </div>
      )}
    </div>
  );
};

// --- TypographyAxes: weight + width + slant for a beat ----------------------
//
// Variable fonts get the continuous axis sliders (weight + any width/slant
// axes the font actually varies). Non-variable fonts (e.g. SpaceGrotesk) get
// a plain weight DROPDOWN of the discrete weights the file ships, and the
// width/slant controls are hidden entirely — they'd be no-ops.

const TypographyAxes: React.FC<{
  axes: AxisRanges;
  family: FontFamily;
  onChange: (axes: AxisRanges) => void;
}> = ({ axes, family, onChange }) => {
  const staticWeights = staticWeightOptions(family);

  if (staticWeights) {
    // Non-variable font — discrete weight dropdown, no width/slant.
    const current = axes.wght[0];
    return (
      <Row label="weight">
        <Dropdown
          value={String(current)}
          options={staticWeights.map((w) => String(w.value))}
          onChange={(v) =>
            onChange(setAxisStatic(axes, "wght", Number(v), family))
          }
        />
      </Row>
    );
  }

  // Variable font — show weight, plus width/slant only if the font varies them.
  return (
    <>
      <AxisControl label="weight" axis="wght" axes={axes} family={family} onChange={onChange} />
      {axisSupported("wdth", family) && (
        <AxisControl label="width" axis="wdth" axes={axes} family={family} onChange={onChange} />
      )}
      {axisSupported("slnt", family) && (
        <AxisControl label="slant" axis="slnt" axes={axes} family={family} onChange={onChange} />
      )}
    </>
  );
};


// --- the panel --------------------------------------------------------------

export const Panel: React.FC<{
  story: Story;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onChange: (story: Story) => void;
}> = ({ story, selection, onSelect, onChange }) => {
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
        background: color.bg.raised,
        borderLeft: `1px solid ${color.border.line}`,
        height: "100%",
        overflowY: "auto",
        padding: 16,
        boxSizing: "border-box",
        fontFamily: font.family,
      }}
    >
      {/* header — auto-save runs in the background, no manual button.
          When multiple beats are selected, the panel still shows the
          editor for the FIRST one (multi-edit isn't supported), but the
          header indicates how many are selected so the user isn't
          confused that their tweaks only apply to one. */}
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: color.text.secondary }}>
          {selection.kind === "story"
            ? "Story"
            : `${selection.indices[0] + 1}. ${story.beats[selection.indices[0]]?.text ?? ""}`}
        </span>
        {selection.kind === "beat" && selection.indices.length > 1 && (
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              color: color.text.muted,
              fontWeight: 400,
            }}
          >
            (+{selection.indices.length - 1} more selected)
          </span>
        )}
      </div>

      {selection.kind === "story" ? (
        <StoryEditor story={story} onChange={onChange} />
      ) : (
        <BeatEditor
          beat={story.beats[selection.indices[0]]}
          index={selection.indices[0]}
          fallbackTextColor={story.textColor}
          fallbackFontFamily={story.fontFamily}
          onChange={(patch) => patchBeat(selection.indices[0], patch)}
        />
      )}

      <div
        style={{
          fontSize: 10,
          color: color.text.faint,
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

  // What the composition length is right now: the explicit override if
  // set, otherwise the longest beat's end time (or the 4-second floor
  // for an empty story). Used both for the slider's effective value
  // and for hinting the user what "auto" would resolve to.
  const derivedDuration = (() => {
    const resolved = resolveBeatTimes(story);
    const maxEnd = resolved.reduce((m, r) => Math.max(m, r.endSeconds), 0);
    return maxEnd > 0 ? maxEnd : 4;
  })();
  const isAuto = story.durationInSeconds === undefined;
  const effectiveDuration = isAuto
    ? derivedDuration
    : story.durationInSeconds!;

  return (
    <>
      <Section title="Composition">
        <Row label="duration">
          <Slider
            value={effectiveDuration}
            min={0.5}
            max={Math.max(60, effectiveDuration + 5)}
            step={0.1}
            onChange={(v) => patchStory({ durationInSeconds: v })}
          />
        </Row>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 10,
            color: color.text.dim,
            marginTop: -2,
          }}
        >
          <span>
            {isAuto
              ? `auto · fits longest beat (${derivedDuration.toFixed(1)}s)`
              : `locked to ${effectiveDuration.toFixed(1)}s`}
          </span>
          <button
            onClick={() =>
              patchStory({
                durationInSeconds: isAuto ? derivedDuration : undefined,
              })
            }
            style={{
              ...secondaryBtn({ active: !isAuto }),
              fontSize: 10,
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            {isAuto ? "lock" : "auto"}
          </button>
        </div>
      </Section>

      <Section title="Palette & background">
        <Row label="font">
          <Dropdown
            value={story.fontFamily}
            options={FONT_FAMILIES}
            onChange={(v) => patchStory({ fontFamily: v as Story["fontFamily"] })}
          />
        </Row>
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
  fallbackFontFamily: FontFamily;
  onChange: (patch: Partial<Beat>) => void;
}> = ({ beat, index, fallbackTextColor, fallbackFontFamily, onChange }) => {
  if (!beat) {
    return (
      <div style={{ fontSize: 11, color: color.text.muted, padding: "10px 0" }}>
        Selected beat no longer exists.
      </div>
    );
  }
  const family: FontFamily = beat.fontFamily ?? fallbackFontFamily;
  return (
    <Section title={`${beat.kind} beat`}>
      <Row label="text">
        <TextInput
          value={beat.text}
          onChange={(v) => onChange({ text: v })}
          placeholder="the word"
        />
      </Row>
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
        <Row label="enter direction">
          <Dropdown
            value={beat.enterDirection}
            options={DIRECTIONS}
            onChange={(v) =>
              onChange({ enterDirection: v as Beat["enterDirection"] })
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
          max={10}
          step={0.05}
          onChange={(v) => onChange({ scale: v })}
        />
      </Row>
      <Row label="rotation">
        <Slider
          value={beat.rotation ?? 0}
          min={-180}
          max={180}
          step={1}
          onChange={(v) => onChange({ rotation: v })}
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
      <Row label="opacity">
        <Slider
          value={beat.opacity}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ opacity: v })}
        />
      </Row>
      <Row label="blend">
        <Dropdown
          value={beat.blendMode}
          options={BLEND_MODES}
          onChange={(v) => onChange({ blendMode: v as Beat["blendMode"] })}
        />
      </Row>
      <Row label="font">
        <Dropdown
          value={beat.fontFamily ?? fallbackFontFamily}
          options={FONT_FAMILIES}
          onChange={(v) => onChange({ fontFamily: v as FontFamily })}
        />
      </Row>
      <TypographyAxes
        axes={beat.axes}
        family={family}
        onChange={(axes) => onChange({ axes })}
      />
      <Row label="color">
        <ColorControl
          value={beat.color ?? fallbackTextColor}
          onChange={(v) => {
            if (PILLAR3_PATCH_MODE) {
              void writeState(
                [{ op: "replace", path: `/beats/${index}/color`, value: v }],
                "user",
              ).catch((e: unknown) => {
                // Pillar 3 tracer failures are non-fatal in the spike —
                // the legacy path stays the kill switch. Log so the user
                // sees what broke in devtools.
                console.error("[pillar3] apply_patch failed:", e);
              });
              return; // Don't run the legacy path; the watcher will pick up the new doc.
            }
            onChange({ color: v });
          }}
        />
      </Row>
      {beat.kind === "morph" && (
        <div
          style={{
            fontSize: 10,
            color: color.text.dim,
            marginTop: 4,
            fontStyle: "italic",
          }}
        >
          shape: {beat.shape ? "provider-generated" : "default circle"} —
          reprompt Claude Code to change
        </div>
      )}
      {beat.kind === "videoClip" && (
        <>
          <Row label="in-point">
            <Slider
              value={beat.videoStartSec ?? 0}
              min={0}
              max={Math.max(60, (beat.videoStartSec ?? 0) + 10)}
              step={0.1}
              onChange={(v) => onChange({ videoStartSec: v })}
            />
          </Row>
          <Row label="volume">
            <Slider
              value={beat.volume ?? 0}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => onChange({ volume: v })}
            />
          </Row>
          <div
            style={{
              fontSize: 10,
              color: color.text.dim,
              marginTop: 4,
              fontFamily: "ui-monospace, monospace",
              wordBreak: "break-all",
              lineHeight: 1.4,
            }}
            title={beat.videoSrc ?? ""}
          >
            {beat.videoSrc
              ? `src: ${beat.videoSrc.split("/").pop()}`
              : "src: (none)"}
          </div>
        </>
      )}
      {beat.kind === "imageClip" && (
        <>
          <Row label="zoom">
            <Slider
              value={beat.kenBurnsZoom ?? 0.15}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => onChange({ kenBurnsZoom: v })}
            />
          </Row>
          <Row label="zoom dir">
            <Dropdown
              value={beat.kenBurnsDir ?? "in"}
              options={["in", "out"] as const}
              onChange={(v) =>
                onChange({ kenBurnsDir: v as "in" | "out" })
              }
            />
          </Row>
          <Row label="pan">
            <Slider
              value={beat.kenBurnsPan ?? 0}
              min={0}
              max={0.5}
              step={0.01}
              onChange={(v) => onChange({ kenBurnsPan: v })}
            />
          </Row>
          <Row label="pan dir">
            <Slider
              value={beat.kenBurnsPanAngle ?? 0}
              min={-180}
              max={180}
              step={5}
              onChange={(v) => onChange({ kenBurnsPanAngle: v })}
            />
          </Row>
          <div
            style={{
              fontSize: 10,
              color: color.text.dim,
              marginTop: 4,
              fontFamily: "ui-monospace, monospace",
              wordBreak: "break-all",
              lineHeight: 1.4,
            }}
            title={beat.imageSrc ?? ""}
          >
            {beat.imageSrc
              ? `src: ${beat.imageSrc.split("/").pop()}`
              : "src: (none)"}
          </div>
        </>
      )}
    </Section>
  );
};
