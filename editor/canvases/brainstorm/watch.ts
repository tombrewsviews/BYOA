/**
 * Continuous-mode watch loop for Brainstorm Canvas.
 *
 * "Watching" doesn't mean a long-lived agent — the agent runs one-shot per
 * turn. This controller decides WHEN to wake it: it listens to the canvas
 * server's WebSocket (which broadcasts every element change), debounces until
 * the user pauses, then fires a single observe-only turn via the Chat handle.
 *
 * Guards that keep it feeling like a collaborator, not a bot (and prevent a
 * self-triggering runaway):
 *   - Debounce: wake only after ~QUIET_MS of no canvas changes.
 *   - Running gate: never wake while a turn is in flight (the agent's own
 *     reads/edits could otherwise re-trigger the loop). Also means a flurry of
 *     edits collapses into one wake after the user stops.
 *   - Scene-hash dedup: if the scene is identical to what we last sent the
 *     agent (e.g. a pure pan/zoom, or edits that net out), don't wake.
 */

const QUIET_MS = 4000;

/** The watch prompt sent on each wake. Mirrors the brainstorm SKILL.md
 *  contract: observe, suggest briefly if useful, else NOTHING_TO_ADD, never
 *  modify the canvas. */
const WATCH_PROMPT = [
  "[continuous watch] The user just paused editing the Excalidraw board.",
  "Look at it now (describe_scene and/or get_canvas_screenshot).",
  "If you have something genuinely useful — a suggestion, a question, a",
  "connection you notice, a gap, a grouping idea — say it briefly (1–3",
  "sentences), like a collaborator in the room. If you have nothing worth",
  "interrupting for, reply with exactly NOTHING_TO_ADD and stop. Do NOT",
  "modify the canvas.",
].join(" ");

export interface WatchHandle {
  sendWatch: (prompt: string) => void;
  isRunning: () => boolean;
}

/** A cheap, order-independent hash of the scene's element ids + versions so we
 *  can tell whether anything substantive changed since the last wake.
 *  Exported for testing the dedup guard. */
export function hashElements(elements: Array<Record<string, unknown>>): string {
  return elements
    .map((e) => `${e.id ?? ""}:${e.version ?? ""}:${e.versionNonce ?? ""}`)
    .sort()
    .join("|");
}

/** A text element on the board addressed to the agent via "@agent". */
export interface Mention {
  id: string;
  version: number;
  text: string;
  instruction: string;
}

const MENTION_RE = /@agent/i;
/** Strips a leading "@agent" (case-insensitive) + following whitespace. */
const LEADING_MENTION_RE = /^@agent\s*/i;

/**
 * Find text elements whose content mentions "@agent". Detection is purely
 * content-based (no special element type/color). A leading "@agent " prefix is
 * stripped for the instruction; a mid-sentence mention is kept verbatim so the
 * agent gets the full request. Exported for unit testing.
 */
export function detectMentions(
  elements: Array<Record<string, unknown>>,
): Mention[] {
  const out: Mention[] = [];
  for (const el of elements) {
    if (el.type !== "text") continue;
    const text = typeof el.text === "string" ? el.text : "";
    if (!MENTION_RE.test(text)) continue;
    out.push({
      id: String(el.id ?? ""),
      version: typeof el.version === "number" ? el.version : 0,
      text,
      instruction: text.replace(LEADING_MENTION_RE, "").trim(),
    });
  }
  return out;
}

/** Stable per-version identity of a mention. Including the version means an
 *  edited tag (Excalidraw bumps version) counts as a fresh, re-triggerable
 *  mention; an unchanged tag the agent forgot to delete is not re-fired. */
export function mentionSignature(m: Mention): string {
  return `${m.id}:${m.version}`;
}

/** Keep only mentions not already dispatched this session. Pure: the caller
 *  records signatures into `seen` after a successful send. */
export function filterUndispatched(
  mentions: Mention[],
  seen: Set<string>,
): Mention[] {
  return mentions.filter((m) => !seen.has(mentionSignature(m)));
}

/** Build the editable turn for one or more @agent mentions: the scaffolded
 *  prompt sent to the model, and the readable bubble shown in chat. */
export function buildMentionTurn(mentions: Mention[]): {
  prompt: string;
  bubble: string;
} {
  const bubble = mentions.map((m) => m.instruction).join("\n");
  const list = mentions
    .map((m, i) => `${i + 1}. "${m.instruction}"  (id: ${m.id})`)
    .join("\n");
  const prompt = [
    "[board instruction] The user left message(s) for you on the board.",
    "Read the board first (describe_scene), then act on these:",
    "",
    list,
    "",
    "After acting, delete these element(s) from the board (delete_element) so",
    "the instruction is cleared. Then say briefly in chat what you did.",
  ].join("\n");
  return { prompt, bubble };
}

/**
 * Start the watch loop against a running canvas server. Returns a stop fn that
 * tears down the socket + timer. Safe to call only when in continuous mode;
 * the caller (BrainstormApp) starts/stops it as the mode toggles.
 */
export function startWatchLoop(canvasUrl: string, handle: WatchHandle): () => void {
  const wsUrl = canvasUrl.replace(/^http/, "ws");
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSentHash = "";
  let stopped = false;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const wake = async () => {
    timer = null;
    if (stopped) return;
    // Never wake while a turn is running — the agent's reads (or any stray
    // edit) would otherwise feed back into the loop.
    if (handle.isRunning()) return;
    try {
      const res = await fetch(`${canvasUrl}/api/elements`);
      if (!res.ok) return;
      const body = (await res.json()) as { elements?: Array<Record<string, unknown>> };
      const elements = body.elements ?? [];
      if (elements.length === 0) return; // empty board: nothing to react to
      const hash = hashElements(elements);
      if (hash === lastSentHash) return; // nothing substantive changed
      lastSentHash = hash;
      handle.sendWatch(WATCH_PROMPT);
    } catch {
      /* canvas server unreachable — skip this wake */
    }
  };

  const scheduleWake = () => {
    if (stopped) return;
    clearTimer();
    timer = setTimeout(() => void wake(), QUIET_MS);
  };

  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(wsUrl);
    socket.onmessage = (ev) => {
      let type = "";
      try {
        type = (JSON.parse(ev.data as string) as { type?: string }).type ?? "";
      } catch {
        return;
      }
      // Any element-changing broadcast resets the quiet timer. The connect-time
      // snapshot/status messages are ignored so opening the board doesn't wake
      // the agent immediately.
      if (
        type === "element_created" ||
        type === "element_updated" ||
        type === "element_deleted" ||
        type === "elements_batch_created" ||
        type === "canvas_cleared"
      ) {
        scheduleWake();
      }
    };
    socket.onclose = () => {
      // Reconnect unless we were told to stop (the server may restart).
      if (!stopped) setTimeout(connect, 1000);
    };
    socket.onerror = () => socket?.close();
  };

  connect();

  return () => {
    stopped = true;
    clearTimer();
    socket?.close();
    socket = null;
  };
}
