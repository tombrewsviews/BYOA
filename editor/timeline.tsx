/**
 * The studio timeline — multi-track edition.
 *
 * Tracks are rows; clips are positioned absolutely within their track row,
 * width proportional to `durationInSeconds` and left = `startSeconds` *
 * pxPerSecond.
 *
 * Layer-stack convention: track 0 is the BOTTOM of the visual stack
 * (backgrounds live there); higher track numbers stack on top. The
 * timeline UI mirrors that — track 0 renders at the BOTTOM row of the
 * timeline, highest track at the top. This is a render-only flip; the
 * data (story.json) is unchanged, so existing projects and the agent
 * skill (which documents "track 0 = behind") keep working.
 *
 * Each clip supports three drag interactions:
 *
 *   • clip body  → drag horizontally to shift `startSeconds`
 *                  drag vertically across tracks to change `track`
 *   • right edge → drag to resize `durationInSeconds`
 *
 * Track count is `max(track) + 1` but never less than 1, so a single-track
 * story still renders one row. A `+ track` button below the last row adds
 * a fresh empty track (a beat dropped onto it becomes a layered overlay).
 *
 * Click a clip → seek + select. Click empty timeline → seek-without-select.
 * Click the + button → append a new beat to track 0.
 *
 * The Playhead is local state subscribed to playerRef.frameupdate so 30fps
 * frame ticks don't re-render the rest of the studio.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CallbackListener, PlayerRef } from "@remotion/player";
import {
  beatSchema,
  resolveBeatTimes,
  type Beat,
  type Story,
} from "../src/kinetic/schema";
import type { Selection } from "./selection";
import { AddVideo } from "./AddVideo";
import { AddImage } from "./AddImage";

type TimelineProps = {
  story: Story;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onChange: (s: Story) => void;
  playerRef: React.RefObject<PlayerRef | null>;
  durationInFrames: number;
  fps: number;
};

const ROW_HEIGHT = 32;
const ROW_GAP = 4;
const RIGHT_PAD = 60; // room for the + button at the end of the timeline
const MIN_DURATION = 0.3; // matches schema.min

export const Timeline: React.FC<TimelineProps> = React.memo(
  ({ story, selection, onSelect, onChange, playerRef, durationInFrames, fps }) => {
    const resolved = useMemo(() => resolveBeatTimes(story), [story]);
    // CRITICAL: this MUST equal `durationInFrames / fps` for the
    // scrubber and the clips to share the same time axis. Both
    // values come from `storyDurationInFrames(story, fps)` upstream
    // — we just convert back to seconds. (Earlier this used a
    // separate `max(maxEnd, 4)` floor that diverged from the
    // Player's range for short stories, which made the playhead
    // and the clips render at different scales.)
    const totalSeconds = useMemo(
      () => durationInFrames / fps,
      [durationInFrames, fps],
    );

    // Manual extra-rows state: users can add empty rows that don't yet
    // contain any beats. We can't store this in story.json (an empty
    // row isn't a beat), so it lives in component state only. The
    // visible row count is max(max beat track, manualMinTracks) + 1.
    const [manualMinTracks, setManualMinTracks] = useState(0);
    const trackCount = useMemo(() => {
      const max = story.beats.reduce((m, b) => Math.max(m, b.track), 0);
      return Math.max(max, manualMinTracks) + 1;
    }, [story.beats, manualMinTracks]);

    // ----- track-row operations -------------------------------------------
    // Add a new empty row that renders at the TOP of the timeline.
    // Since the UI flips so that track 0 is at the bottom, "top of the
    // timeline" = highest track number. Beats don't move; we just grow
    // manualMinTracks so a new empty row appears one above the current
    // topmost beat / row.
    //
    // Jump past the current top track on every press. trackCount is
    // `max(maxBeatTrack, manualMinTracks) + 1`, so manualMinTracks
    // alone may sit BELOW maxBeatTrack. If we just incremented it by
    // 1, the user would need to press the button multiple times before
    // it overtakes the beat-driven floor and a new row actually
    // appears. Instead we set it to current-trackCount (one past the
    // topmost row) so each press unconditionally adds exactly one
    // visible row.
    const addTopTrack = useCallback(() => {
      setManualMinTracks(trackCount);
    }, [trackCount]);

    // Swap two tracks (a, b): every beat on track `a` becomes track `b`
    // and vice versa. Used by the gutter ↑/↓ arrows to reorder rows
    // without changing their contents. No effect on manualMinTracks.
    const swapTracks = useCallback(
      (a: number, b: number) => {
        if (a === b) return;
        const nextBeats = story.beats.map((bt) => {
          if (bt.track === a) return { ...bt, track: b };
          if (bt.track === b) return { ...bt, track: a };
          return bt;
        });
        onChange({ ...story, beats: nextBeats });
      },
      [story, onChange],
    );

    // Delete a row at index `t`: every beat with track > t shifts down
    // by 1. Beats AT this track are removed too (the user accepts).
    // Caller is responsible for the confirm prompt.
    const deleteTrack = useCallback(
      (t: number) => {
        const nextBeats = story.beats
          .filter((b) => b.track !== t)
          .map((b) => (b.track > t ? { ...b, track: b.track - 1 } : b));
        onChange({ ...story, beats: nextBeats });
        setManualMinTracks((cur) => Math.max(0, cur - 1));
      },
      [story, onChange],
    );

    // Live playhead.
    const [currentFrame, setCurrentFrame] = useState(0);
    useEffect(() => {
      const player = playerRef.current;
      if (!player) return;
      const handler: CallbackListener<"frameupdate"> = (e) =>
        setCurrentFrame(e.detail.frame);
      player.addEventListener("frameupdate", handler);
      return () => {
        player.removeEventListener("frameupdate", handler);
      };
    }, [playerRef]);

    const tracksRef = useRef<HTMLDivElement>(null);

    const pxPerSecond = (containerW: number) => containerW / totalSeconds;

    const seek = useCallback(
      (frame: number) => {
        const p = playerRef.current;
        if (!p) return;
        p.seekTo(Math.max(0, Math.min(durationInFrames - 1, frame)));
      },
      [playerRef, durationInFrames],
    );

    const seekAndPlay = useCallback(
      (e: React.MouseEvent, frame: number) => {
        const p = playerRef.current;
        if (!p) return;
        p.seekTo(Math.max(0, Math.min(durationInFrames - 1, frame)));
        p.play(e);
      },
      [playerRef, durationInFrames],
    );

    // ----- click on empty track area: scrub-only ----------------------------
    const onEmptyAreaClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      const rect = tracksRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const sec = (x / rect.width) * totalSeconds;
      seek(Math.round(sec * fps));
    };

    // ----- add a new beat --------------------------------------------------
    // Default placement: a fresh track ABOVE every existing row. Users
    // can drag the new clip down onto a populated row if they want it
    // to stack with existing beats; the default "one item per track"
    // makes the timeline read clearly and matches what users expect
    // from After Effects / Premiere.
    const onAddBeat = useCallback(() => {
      const newBeat = beatSchema.parse({ text: "new", track: trackCount });
      onChange({ ...story, beats: [...story.beats, newBeat] });
      onSelect({ kind: "beat", indices: [story.beats.length] });
    }, [story, onChange, onSelect, trackCount]);

    // ----- add a new videoClip beat ---------------------------------------
    // Video clips default to track 0 (under any text beats) at the
    // current playhead, with 4s duration as a placeholder. The user
    // tunes durationInSeconds via the right-edge resize and
    // videoStartSec (in-point) via the left-edge resize once the
    // clip is selected.
    const onAddVideo = useCallback(
      (absolutePath: string) => {
        const playheadSec = (playerRef.current?.getCurrentFrame() ?? 0) / fps;
        const newBeat = beatSchema.parse({
          text: absolutePath.split("/").pop() ?? "video",
          kind: "videoClip",
          track: trackCount,
          startSeconds: playheadSec,
          durationInSeconds: 4,
          animateInPortion: 0.1,
          animateOutPortion: 0.1,
          videoSrc: absolutePath,
          videoStartSec: 0,
          volume: 0,
          scale: 1,
          // Center on the canvas by default.
          positionX: 0.5,
          positionY: 0.5,
        });
        const nextBeats = [...story.beats, newBeat];
        onChange({ ...story, beats: nextBeats });
        onSelect({ kind: "beat", indices: [story.beats.length] });
      },
      [story, onChange, onSelect, playerRef, fps, trackCount],
    );

    // ----- add a new imageClip beat ---------------------------------------
    // Same shape as videoClip but for stills. Default Ken Burns: gentle
    // 15% zoom in over the clip duration. User tweaks via the panel.
    const onAddImage = useCallback(
      (absolutePath: string) => {
        const playheadSec = (playerRef.current?.getCurrentFrame() ?? 0) / fps;
        const newBeat = beatSchema.parse({
          text: absolutePath.split("/").pop() ?? "image",
          kind: "imageClip",
          track: trackCount,
          startSeconds: playheadSec,
          durationInSeconds: 4,
          animateInPortion: 0.15,
          animateOutPortion: 0.15,
          imageSrc: absolutePath,
          kenBurnsZoom: 0.15,
          kenBurnsDir: "in",
          kenBurnsPan: 0,
          scale: 1,
          positionX: 0.5,
          positionY: 0.5,
        });
        const nextBeats = [...story.beats, newBeat];
        onChange({ ...story, beats: nextBeats });
        onSelect({ kind: "beat", indices: [story.beats.length] });
      },
      [story, onChange, onSelect, playerRef, fps, trackCount],
    );

    // ----- add a new (empty) track -----------------------------------------
    // No data model change — the next beat dropped here gets track = trackCount.
    // Implementation: the "+ track" button is purely visual; rows just expand
    // when a beat with a higher track index is added. So we don't need any
    // state for it. (Kept for future when we let user drop a clip onto an
    // empty row to set its track.)

    // ----- drag handling ---------------------------------------------------
    // We update story.beats[i] continuously during the drag — that flows
    // through to KineticStory's resolveBeatTimes and the Player re-renders
    // live. rAF-coalesce so we don't fire 60+ setStory/sec; one per frame
    // is enough and the composition is heavy enough that more is wasteful.
    //
    // Stable-ref trick: we keep the latest `story` / `onChange` / etc in
    // refs so the drag listeners (which are attached to `window` for the
    // duration of the drag) always read the current props, not the
    // closure they were created in. This makes vertical drag reliable
    // even when KineticApp's history hook creates a new onChange identity
    // mid-drag — without it, the flush would fight against a stale
    // baseStory and the track update could silently no-op.
    const storyRef = useRef(story);
    const totalSecondsRef = useRef(totalSeconds);
    const onChangeRef = useRef(onChange);
    const selectionRef = useRef(selection);
    useEffect(() => {
      storyRef.current = story;
    }, [story]);
    useEffect(() => {
      totalSecondsRef.current = totalSeconds;
    }, [totalSeconds]);
    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);
    useEffect(() => {
      selectionRef.current = selection;
    }, [selection]);

    const beginDrag = useCallback(
      (
        beatIndex: number,
        mode: "move" | "resize" | "trim-start",
        downEvent: React.PointerEvent,
      ) => {
        downEvent.preventDefault();
        downEvent.stopPropagation();
        const rect = tracksRef.current?.getBoundingClientRect();
        if (!rect) return;
        // Snapshot the story-at-drag-start. Each rAF flush builds a new
        // story from this baseline; we write through onChangeRef so the
        // latest setter (post-history-rerender) always runs.
        const baseStory = storyRef.current;
        const sel = selectionRef.current;
        const sPerPx = totalSecondsRef.current / rect.width;
        const startBeat = baseStory.beats[beatIndex];
        if (!startBeat) return;
        const resolvedAll = resolveBeatTimes(baseStory);
        const baselineStart = resolvedAll[beatIndex].startSeconds;
        const baselineDuration = startBeat.durationInSeconds;
        const baselineVideoStartSec = startBeat.videoStartSec ?? 0;

        // Group-drag set: when `move`-dragging a beat that's part of a
        // multi-selection, ALL selected beats move together.
        const isPartOfGroup =
          mode === "move" &&
          sel.kind === "beat" &&
          sel.indices.length > 1 &&
          sel.indices.includes(beatIndex);
        const groupIndices = isPartOfGroup ? sel.indices : [beatIndex];
        const groupBaselines = groupIndices.map((i) => ({
          index: i,
          start: resolvedAll[i].startSeconds,
          track: baseStory.beats[i].track,
        }));
        const minTrack = Math.min(...groupBaselines.map((g) => g.track));
        const minStart = Math.min(...groupBaselines.map((g) => g.start));

        const startX = downEvent.clientX;
        const startY = downEvent.clientY;

        let rafId = 0;
        let pendingDx = 0;
        let pendingDy = 0;
        const flush = () => {
          rafId = 0;
          const dSeconds = pendingDx * sPerPx;
          const apply = onChangeRef.current;

          if (mode === "move") {
            const dSecClamped = Math.max(dSeconds, -minStart);
            // Round the vertical pixel delta to the nearest whole row.
            // Half a row's worth of movement snaps to the next track,
            // so a deliberate drag (say 20px) reliably crosses.
            //
            // Layer-flip: track 0 renders at the BOTTOM of the
            // timeline. Pointer dy is positive when the cursor moves
            // DOWN the screen → the user expects the clip's track
            // number to DECREASE (move toward the bottom of the
            // stack). So we subtract dyTracks, not add it.
            const dyTracks = Math.round(pendingDy / (ROW_HEIGHT + ROW_GAP));
            // Clamp so the new minimum track stays >= 0.
            // new track = g.track - dyTracks ≥ 0 for the beat with
            // the smallest baseline track ⇒ dyTracks ≤ minTrack.
            const dyClamped = Math.min(dyTracks, minTrack);
            const patches = new Map<number, Partial<Beat>>();
            for (const g of groupBaselines) {
              patches.set(g.index, {
                startSeconds: g.start + dSecClamped,
                track: g.track - dyClamped,
              });
            }
            const nextBeats = baseStory.beats.map((b, i) => {
              const p = patches.get(i);
              return p ? { ...b, ...p } : b;
            });
            apply({ ...baseStory, beats: nextBeats });
            return;
          }

          // Single-beat resize / trim — never group-drag.
          const updated: Partial<Beat> = {};
          if (mode === "resize") {
            const newDuration = Math.max(
              MIN_DURATION,
              baselineDuration + dSeconds,
            );
            updated.durationInSeconds = newDuration;
          } else if (mode === "trim-start") {
            // Trim from the left edge. For videoClip beats this also
            // moves the in-point (videoStartSec) so the visible content
            // shifts forward in the source. For other beat kinds we
            // just retime — the right edge stays anchored visually so
            // the clip's "end on the timeline" doesn't jump.
            //
            // Constraint: durationInSeconds >= MIN_DURATION, and for
            // videoClip the new videoStartSec must stay >= 0.
            let trim = dSeconds;
            const maxTrim = baselineDuration - MIN_DURATION;
            if (trim > maxTrim) trim = maxTrim;
            if (startBeat.kind === "videoClip") {
              const minTrim = -baselineVideoStartSec;
              if (trim < minTrim) trim = minTrim;
            } else {
              if (trim < -baselineStart) trim = -baselineStart;
            }
            updated.startSeconds = Math.max(0, baselineStart + trim);
            updated.durationInSeconds = baselineDuration - trim;
            if (startBeat.kind === "videoClip") {
              updated.videoStartSec = Math.max(
                0,
                baselineVideoStartSec + trim,
              );
            }
          }
          const nextBeats = baseStory.beats.map((b, i) =>
            i === beatIndex ? { ...b, ...updated } : b,
          );
          apply({ ...baseStory, beats: nextBeats });
        };

        const onMove = (ev: PointerEvent) => {
          pendingDx = ev.clientX - startX;
          pendingDy = ev.clientY - startY;
          if (rafId === 0) rafId = requestAnimationFrame(flush);
        };
        const onUp = () => {
          if (rafId !== 0) cancelAnimationFrame(rafId);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      },
      [],
    );

    return (
      <div
        style={{
          background: "#0a0a10",
          borderTop: "1px solid #232330",
          padding: "10px 12px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {/* "+ Track" button (left) + Story selector row. The + sits
            in the gutter column above the per-track gutters, aligning
            with them visually. It CREATES a new empty row at the top
            of the timeline (highest track number); the gutter ↑/↓
            arrows below REORDER existing rows. */}
        <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
          <button
            onClick={addTopTrack}
            title="Add a new empty track on top"
            style={{
              width: 48,
              height: 22,
              borderRadius: 6,
              padding: 0,
              border: "1px solid #232330",
              background: "#14141c",
              color: "#8b8b9a",
              fontSize: 14,
              lineHeight: 1,
              cursor: "pointer",
              flex: "0 0 auto",
            }}
          >
            +
          </button>
          <button
            onClick={(e) => {
              onSelect({ kind: "story" });
              seekAndPlay(e, 0);
            }}
            aria-pressed={selection.kind === "story"}
            style={{
              flex: 1,
              height: 22,
              borderRadius: 6,
              cursor: "pointer",
              textAlign: "left",
              padding: "0 8px",
              fontSize: 10,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              color: selection.kind === "story" ? "white" : "#8b8b9a",
              background: selection.kind === "story" ? "#7c5cff" : "#14141c",
              border:
                selection.kind === "story"
                  ? "1px solid #9d83ff"
                  : "1px solid #232330",
            }}
          >
            Story
          </button>
        </div>

        {/* Track area: left gutter with per-row controls + the
            actual time ruler that holds clips. */}
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "stretch",
          }}
        >
          {/* GUTTER — one slot per track, with add-above/below + delete
              buttons that appear on hover. */}
          <div
            style={{
              width: 48,
              flex: "0 0 auto",
              position: "relative",
              height: trackCount * ROW_HEIGHT + (trackCount - 1) * ROW_GAP,
            }}
          >
            {Array.from({ length: trackCount }, (_, t) => (
              <TrackGutter
                key={`gutter-${t}`}
                trackIndex={t}
                // Render with track 0 at the BOTTOM. "uiRow" is the
                // visual row index (0 = top); the bottom row in the
                // UI hosts track 0. Same flip applies to clips + the
                // track-row backgrounds below.
                top={(trackCount - 1 - t) * (ROW_HEIGHT + ROW_GAP)}
                hasBeats={story.beats.some((b) => b.track === t)}
                // With the flip, "up in the UI" = higher track number.
                canMoveUp={t < trackCount - 1}
                canMoveDown={t > 0}
                onMoveUp={() => swapTracks(t, t + 1)}
                onMoveDown={() => swapTracks(t, t - 1)}
                onDelete={() => deleteTrack(t)}
              />
            ))}
          </div>

          {/* TRACKS — same as before, just inside the flex row now. */}
        <div
          ref={tracksRef}
          onClick={onEmptyAreaClick}
          style={{
            position: "relative",
            flex: 1,
            minWidth: 0,
            height: trackCount * ROW_HEIGHT + (trackCount - 1) * ROW_GAP,
            cursor: "crosshair",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          {/* track row backgrounds — track 0 at the BOTTOM. */}
          {Array.from({ length: trackCount }, (_, t) => (
            <div
              key={`row-${t}`}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: (trackCount - 1 - t) * (ROW_HEIGHT + ROW_GAP),
                height: ROW_HEIGHT,
                background: "#0e0e16",
                border: "1px solid #1c1c26",
                borderRadius: 4,
                pointerEvents: "none",
              }}
            />
          ))}

          {/* clips, positioned absolutely within the tracks area */}
          {story.beats.map((beat, i) => {
            const r = resolved[i];
            const leftPct = (r.startSeconds / totalSeconds) * 100;
            const widthPct = (beat.durationInSeconds / totalSeconds) * 100;
            // Flip: track 0 renders at the BOTTOM (matches the
            // visual stack — backgrounds at the bottom of the
            // timeline, like the bottom of the preview stack).
            const top =
              (trackCount - 1 - beat.track) * (ROW_HEIGHT + ROW_GAP);
            const isSelected =
              selection.kind === "beat" && selection.indices.includes(i);
            const isVideo = beat.kind === "videoClip";
            const isImage = beat.kind === "imageClip";
            // Media clips (video and image) get distinct colors so they
            // stand out from text beats in the timeline at a glance.
            const clipBg = isSelected
              ? "#7c5cff"
              : isVideo
                ? "#1a2a3a"
                : isImage
                  ? "#2a1a3a"
                  : "#1c1c26";
            const clipBorder = isSelected
              ? "1px solid #9d83ff"
              : isVideo
                ? "1px solid #2e4666"
                : isImage
                  ? "1px solid #4d2e66"
                  : "1px solid #2e2e3c";
            return (
              <div
                key={i}
                onPointerDown={(e) => {
                  // Behaviour: on every press we ALWAYS start the drag
                  // (so an already-selected clip can be re-dragged
                  // without first being deselected). Selection updates
                  // happen on pointerup if the gesture was actually
                  // just a click (no significant movement).
                  //
                  //   shift-press → toggle this beat in the selection,
                  //                  no drag (pure selection gesture).
                  //   plain press on unselected → select-only + drag.
                  //   plain press on selected single → drag; if it was
                  //                  a pure click (no movement), DESELECT
                  //                  on pointerup.
                  //   plain press on selected multi → group-drag; click
                  //                  alone keeps the selection.
                  const currentlySelected =
                    selection.kind === "beat" ? selection.indices : [];
                  if (e.shiftKey) {
                    const next = currentlySelected.includes(i)
                      ? currentlySelected.filter((k) => k !== i)
                      : [...currentlySelected, i];
                    if (next.length === 0) {
                      onSelect({ kind: "story" });
                    } else {
                      onSelect({ kind: "beat", indices: next });
                    }
                    return;
                  }

                  const wasOnlySelected =
                    isSelected && currentlySelected.length === 1;

                  // Select-only-on-press for currently-unselected beats
                  // so the panel updates immediately even before drag.
                  if (!isSelected) {
                    onSelect({ kind: "beat", indices: [i] });
                  }

                  // Always begin the drag. beginDrag attaches listeners
                  // to window for pointermove + pointerup; if no
                  // movement happens before release, the drag is a
                  // no-op and we use the click-vs-drag check below to
                  // run selection-side effects.
                  const startX = e.clientX;
                  const startY = e.clientY;
                  beginDrag(i, "move", e);

                  // Click-vs-drag detector: on the same press, listen
                  // for pointerup separately and, if movement was tiny
                  // (< 3px), treat it as a click and apply the
                  // deselect-on-click rule for a single-selected beat.
                  const onUpClickCheck = (ev: PointerEvent) => {
                    window.removeEventListener("pointerup", onUpClickCheck);
                    const dx = Math.abs(ev.clientX - startX);
                    const dy = Math.abs(ev.clientY - startY);
                    if (dx < 3 && dy < 3 && wasOnlySelected) {
                      onSelect({ kind: "story" });
                    }
                  };
                  window.addEventListener("pointerup", onUpClickCheck);
                }}
                style={{
                  position: "absolute",
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  top,
                  height: ROW_HEIGHT,
                  borderRadius: 6,
                  border: clipBorder,
                  background: clipBg,
                  color: isSelected ? "white" : "#e4e4ee",
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "0 12px 0 14px",
                  display: "flex",
                  alignItems: "center",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  cursor: "grab",
                  boxSizing: "border-box",
                }}
                title={`${beat.text} (${beat.kind}, ${beat.durationInSeconds.toFixed(2)}s @ ${r.startSeconds.toFixed(2)}s, track ${beat.track})`}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    pointerEvents: "none",
                  }}
                >
                  {beat.text}
                </span>
                {/* Left-edge trim handle. For video clips this moves
                    the in-point; for other beat kinds it retimes the
                    start while keeping the right edge anchored. */}
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    beginDrag(i, "trim-start", e);
                  }}
                  title={
                    isVideo
                      ? "Drag to trim in-point"
                      : isImage
                        ? "Drag to retime (right edge stays put)"
                        : "Drag to retime (right edge stays put)"
                  }
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 8,
                    cursor: "ew-resize",
                    background: isSelected
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.08)",
                  }}
                />
                {/* Right-edge resize handle */}
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    beginDrag(i, "resize", e);
                  }}
                  title="Drag to resize"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: 8,
                    cursor: "ew-resize",
                    background: isSelected
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.08)",
                  }}
                />
              </div>
            );
          })}

          {/* empty state */}
          {story.beats.length === 0 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                color: "#4b4b5a",
                letterSpacing: 0.5,
                textTransform: "uppercase",
                pointerEvents: "none",
              }}
            >
              empty — add a beat with the + button below
            </div>
          )}

          {/* Playhead — draggable scrubber with a circle handle that
              extends above the tracks so users have a clear target to grab
              without dragging the clips underneath. */}
          <Scrubber
            currentFrame={currentFrame}
            durationInFrames={durationInFrames}
            onScrub={seek}
            containerRef={tracksRef}
          />
        </div>
        </div>{/* end flex wrapper around gutter + tracks */}

        {/* + Beat button below the timeline */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddBeat();
            }}
            title="Add a beat"
            style={{
              flex: "0 0 auto",
              padding: "4px 12px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px dashed #3a3a4c",
              background: "transparent",
              color: "#8b8b9a",
              cursor: "pointer",
            }}
          >
            + Beat
          </button>
          <AddVideo onImported={onAddVideo} />
          <AddImage onImported={onAddImage} />
          <span style={{ fontSize: 10, color: "#4b4b5a" }}>
            Drag clip to move/retime · drag edges to resize/trim · drag
            vertically to change layer
          </span>
        </div>
      </div>
    );
  },
);
Timeline.displayName = "Timeline";

/**
 * Left-gutter slot for one track row. Renders three small controls
 * that appear on hover:
 *   • + above — insert an empty row above this one
 *   • × delete — remove this row (confirms if it has beats)
 *   • + below — insert an empty row below this one
 *
 * Always shows the track index as a tiny label so users can see
 * which track they're on at a glance.
 */
const TrackGutter: React.FC<{
  trackIndex: number;
  top: number;
  hasBeats: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}> = ({
  trackIndex,
  top,
  hasBeats,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDelete,
}) => {
  const [hover, setHover] = useState(false);

  const handleDelete = () => {
    if (hasBeats) {
      const ok = window.confirm(
        `Track ${trackIndex} has beats on it. Delete them all?`,
      );
      if (!ok) return;
    }
    onDelete();
  };

  const btnStyle: React.CSSProperties = {
    width: 14,
    height: 14,
    padding: 0,
    background: "transparent",
    border: "1px solid #2e2e3c",
    borderRadius: 2,
    color: "#8b8b9a",
    fontSize: 10,
    lineHeight: 1,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top,
        height: ROW_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 4px",
        background: hover ? "#14141c" : "transparent",
        borderRadius: 4,
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: "#4b4b5a",
          fontFamily: "ui-monospace, monospace",
          flex: "0 0 auto",
        }}
      >
        {trackIndex}
      </span>
      {hover && (
        <div style={{ display: "flex", gap: 2 }}>
          {/* Reorder arrows are ONLY shown on rows that contain beats.
              On an empty row they'd be a foot-gun: after pressing ↑
              once, the beat moves up and the row under the user's
              cursor is now empty; pressing ↑ again would just swap
              the empty row back with the beat row above, looking
              like the action was reverted. Hiding them on empty rows
              means consecutive clicks at the same screen position
              stop firing once the beat has moved away — a clear
              signal that the user needs to follow the beat. */}
          {hasBeats && (
            <button
              onClick={onMoveUp}
              disabled={!canMoveUp}
              title={
                canMoveUp
                  ? `Move track ${trackIndex} up`
                  : "Already at the top"
              }
              style={{
                ...btnStyle,
                opacity: canMoveUp ? 1 : 0.3,
                cursor: canMoveUp ? "pointer" : "not-allowed",
              }}
            >
              ↑
            </button>
          )}
          <button
            onClick={handleDelete}
            title={
              hasBeats
                ? `Delete track ${trackIndex} (has beats — will confirm)`
                : `Delete empty track ${trackIndex}`
            }
            style={{ ...btnStyle, color: "#ff8b8b" }}
          >
            ×
          </button>
          {hasBeats && (
            <button
              onClick={onMoveDown}
              disabled={!canMoveDown}
              title={
                canMoveDown
                  ? `Move track ${trackIndex} down`
                  : "Already at the bottom"
              }
              style={{
                ...btnStyle,
                opacity: canMoveDown ? 1 : 0.3,
                cursor: canMoveDown ? "pointer" : "not-allowed",
              }}
            >
              ↓
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Draggable scrubber. The vertical line spans the tracks; the circle
 * handle sits 12px above so it's an obvious, clip-free target. Both
 * the line and the handle accept pointer events to start a scrub drag.
 * stopPropagation prevents the underlying clip from also receiving the
 * pointerdown (which would start a clip-move drag).
 */
const Scrubber: React.FC<{
  currentFrame: number;
  durationInFrames: number;
  onScrub: (frame: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}> = ({ currentFrame, durationInFrames, onScrub, containerRef }) => {
  const leftPct = (currentFrame / Math.max(1, durationInFrames - 1)) * 100;
  const beginDrag = useCallback(
    (downEvent: React.PointerEvent) => {
      downEvent.preventDefault();
      downEvent.stopPropagation();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const seekAt = (clientX: number) => {
        const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
        const frac = x / rect.width;
        onScrub(Math.round(frac * (durationInFrames - 1)));
      };
      seekAt(downEvent.clientX);

      let rafId = 0;
      let pendingX = downEvent.clientX;
      const flush = () => {
        rafId = 0;
        seekAt(pendingX);
      };
      const onMove = (ev: PointerEvent) => {
        pendingX = ev.clientX;
        if (rafId === 0) rafId = requestAnimationFrame(flush);
      };
      const onUp = () => {
        if (rafId !== 0) cancelAnimationFrame(rafId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
      };
      document.body.style.cursor = "ew-resize";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [containerRef, durationInFrames, onScrub],
  );

  return (
    <>
      {/* line */}
      <div
        onPointerDown={beginDrag}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${leftPct}%`,
          width: 3,
          marginLeft: -1, // center the 3px line on the exact frame position
          background: "#facc15",
          cursor: "ew-resize",
          boxShadow: "0 0 8px rgba(250,204,21,0.6)",
          zIndex: 6,
        }}
      />
      {/* circle handle, floating ABOVE the tracks so the user can grab it
          without colliding with clips below */}
      <div
        onPointerDown={beginDrag}
        title="Drag to scrub"
        style={{
          position: "absolute",
          top: -10,
          left: `${leftPct}%`,
          width: 14,
          height: 14,
          marginLeft: -7,
          borderRadius: "50%",
          background: "#facc15",
          border: "2px solid #0a0a10",
          cursor: "ew-resize",
          boxShadow: "0 0 6px rgba(250,204,21,0.7)",
          zIndex: 7,
        }}
      />
    </>
  );
};
