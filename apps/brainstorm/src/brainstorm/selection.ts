/**
 * Reads the board's live selection (pushed by the board window on every
 * Excalidraw selection change, via the canvas-server's `/api/selection`
 * endpoint) so the chat window — a separate Tauri window/origin — can attach
 * it to the next turn and show a summary chip above the composer.
 */

export interface SelectedElementSummary {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** Text content for text elements, or a bound label for shapes. */
  text?: string;
}

/** Raw shape returned by `/api/elements` — only the fields we read. */
interface RawElement {
  id?: unknown;
  type?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  text?: unknown;
  /** Present on elements created via the MCP/HTTP API, before Excalidraw
   *  normalises them. */
  label?: { text?: unknown };
  /** Set on a text element that is a shape's bound label — this is how
   *  Excalidraw actually stores labels once the board syncs back. */
  containerId?: unknown;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

/** Build a `containerId -> label text` map from the board's text elements.
 *  Excalidraw stores a shape's label as a SEPARATE text element pointing back
 *  at its container, so a selected rectangle carries no text of its own. */
const boundLabels = (elements: RawElement[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const el of elements) {
    const container = str(el.containerId);
    const text = str(el.text);
    if (container && text) map.set(container, text);
  }
  return map;
};

const summarize = (
  el: RawElement,
  labels: Map<string, string>,
): SelectedElementSummary => {
  const id = String(el.id ?? "");
  // Own text (a text element) > bound label (a shape's label child) >
  // `label.text` (an API-created element not yet normalised by Excalidraw).
  const text = str(el.text) ?? labels.get(id) ?? str(el.label?.text);
  return {
    id,
    type: typeof el.type === "string" ? el.type : "unknown",
    x: typeof el.x === "number" ? el.x : 0,
    y: typeof el.y === "number" ? el.y : 0,
    width: typeof el.width === "number" ? el.width : undefined,
    height: typeof el.height === "number" ? el.height : undefined,
    text,
  };
};

/** Fetch the board's current selection (ids) then the matching element data.
 *  Returns `[]` if nothing is selected, the canvas server is unreachable, or
 *  the fetch otherwise fails — selection context is best-effort, never
 *  something a turn should block or error on. */
export async function fetchSelectedElements(
  canvasUrl: string,
): Promise<SelectedElementSummary[]> {
  try {
    const selRes = await fetch(`${canvasUrl}/api/selection`);
    if (!selRes.ok) return [];
    const selBody = (await selRes.json()) as { elementIds?: string[] };
    const ids = selBody.elementIds ?? [];
    if (ids.length === 0) return [];

    const elRes = await fetch(`${canvasUrl}/api/elements`);
    if (!elRes.ok) return [];
    const elBody = (await elRes.json()) as { elements?: RawElement[] };
    const all = elBody.elements ?? [];
    // Labels must be resolved against the WHOLE board, not just the selected
    // subset: selecting a labelled shape selects the container, not its
    // bound text child.
    const labels = boundLabels(all);
    const idSet = new Set(ids);
    return all
      .filter((el) => idSet.has(String(el.id ?? "")))
      // Drop a bound label that came along with its selected container — its
      // text is already reported on the container, so listing it separately
      // is duplicate noise.
      .filter((el) => {
        const container = str(el.containerId);
        return !(container && idSet.has(container));
      })
      .map((el) => summarize(el, labels));
  } catch {
    return [];
  }
}

/** Format selected elements as a prompt block prepended to the user's
 *  message. Pure function — easy to unit test independent of fetch/DOM. */
export function formatSelectionBlock(
  elements: SelectedElementSummary[],
): string {
  if (elements.length === 0) return "";
  const lines = elements.map((el, i) => {
    const size =
      el.width !== undefined && el.height !== undefined
        ? `, ${el.width}×${el.height}`
        : "";
    const label = el.text ? ` — "${el.text}"` : "";
    return `${i + 1}. ${el.type} (id: ${el.id}) at (${el.x}, ${el.y})${size}${label}`;
  });
  return ["[selected on board]", ...lines].join("\n");
}

/** Short human-readable summary for the composer chip, e.g.
 *  `3 selected: "Login flow", rectangle, arrow`. */
export function summarizeSelectionForChip(
  elements: SelectedElementSummary[],
): string {
  if (elements.length === 0) return "";
  const parts = elements
    .slice(0, 3)
    .map((el) => (el.text ? `"${el.text}"` : el.type));
  const more = elements.length > 3 ? ` +${elements.length - 3} more` : "";
  return `${elements.length} selected: ${parts.join(", ")}${more}`;
}
