/**
 * State writes — the Pillar 3 tracer surface.
 *
 * Replaces full-doc rewrites with RFC 6902 JSON Patches. The Rust
 * side applies the patch, writes the new doc atomically, and
 * appends to the content-addressed history log under
 * <project>/.kinetic-studio/history/.
 *
 * Schema validation happens on the frontend after the watcher fires
 * — Zod re-parses the new doc and the editor reacts to invalid
 * states (which the patch step has already accepted on disk).
 * Long-term, the Rust side should validate up-front; the spike
 * keeps the change small.
 *
 * Author values per the history entry shape:
 *   - "user" — for user-triggered patches (UI controls, drag).
 *   - "agent" — for agent-driven patches (future).
 *   - "<verb-name>" — for declared-verb-triggered patches (future).
 */
import { invoke } from "@tauri-apps/api/core";

export type JsonPatchOp =
  | { op: "add";     path: string; value: unknown }
  | { op: "remove";  path: string }
  | { op: "replace"; path: string; value: unknown }
  | { op: "move";    path: string; from: string }
  | { op: "copy";    path: string; from: string }
  | { op: "test";    path: string; value: unknown };

export type JsonPatch = JsonPatchOp[];

export type WriteResult = { newDocJson: string };

/**
 * Apply a JSON Patch to the active project's canvas doc.
 *
 * Atomic: the new doc is written via tmp+rename, and the history
 * entry is appended only after the write succeeds. If anything in
 * the chain fails (bad patch, fs error), the function rejects and
 * the on-disk doc is unchanged.
 */
export async function writeState(
  patch: JsonPatch,
  author: string,
): Promise<WriteResult> {
  const newDocJson = await invoke<string>("apply_patch", {
    patchJson: JSON.stringify(patch),
    author,
  });
  return { newDocJson };
}
