import type { GraphDoc } from "./schema";

/** Direct upstream node ids of `nodeId` (edges whose `to` is nodeId). */
export function upstreamIds(doc: GraphDoc, nodeId: string): string[] {
  return doc.edges.filter((e) => e.to === nodeId).map((e) => e.from);
}

/** Direct downstream node ids (edges whose `from` is nodeId). */
function downstreamIds(doc: GraphDoc, nodeId: string): string[] {
  return doc.edges.filter((e) => e.from === nodeId).map((e) => e.to);
}

/** Topologically sort node ids; throws on a cycle. Kahn's algorithm. */
export function topoOrder(doc: GraphDoc): string[] {
  const ids = doc.nodes.map((n) => n.id);
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of doc.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const d of downstreamIds(doc, id)) {
      const n = (indeg.get(d) ?? 0) - 1;
      indeg.set(d, n);
      if (n === 0) queue.push(d);
    }
  }
  if (out.length !== ids.length) throw new Error("cycle detected in graph");
  return out;
}

/** The changed node plus everything transitively downstream, in topo order. */
export function dirtySubgraph(doc: GraphDoc, changedId: string): string[] {
  const dirty = new Set<string>([changedId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of doc.edges) {
      if (dirty.has(e.from) && !dirty.has(e.to)) {
        dirty.add(e.to);
        grew = true;
      }
    }
  }
  return topoOrder(doc).filter((id) => dirty.has(id));
}

/** Node ids referenced via {{id}} tokens, de-duped, first-seen order. */
export function sqlTokenRefs(sql: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
