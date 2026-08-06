#!/usr/bin/env node
/**
 * Patch the vendored canvas-server frontend bundle so dropped images survive
 * a board reopen.
 *
 * THE BUG (upstream, in mcp-excalidraw-server): the frontend GETs /api/files on
 * load, but never POSTs. Dropping an image onto the board puts the binary in
 * Excalidraw's own in-memory file store and syncs the *element* (carrying its
 * fileId) — but the bytes never reach the canvas server. Our autosave then
 * reads an empty /api/files and writes `files: {}` into board.json alongside an
 * image element pointing at a fileId that no longer resolves. Reopen the board
 * and Excalidraw renders a grey placeholder.
 *
 * THE FIX: before each element sync, push the scene's files to /api/files.
 * Element sync is the natural hook — it already fires on every canvas change,
 * so files land server-side before autosave reads them.
 *
 * WHY A SCRIPT: dist/ is a build artifact. `stage-server.sh` re-copies it from
 * node_modules on every build, so a hand-edit would be silently reverted (the
 * same trap that let an unpatched MCP ship before). This runs as part of
 * staging, and is idempotent — it no-ops if the patch is already applied.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MARKER = "__brainstormFileSync";

/**
 * Anchor: the start of the statement that filters the scene elements and POSTs
 * them. Unique in the bundle.
 *
 * Note the sync is a comma-chained declaration —
 * `const D=P.filter(...),O=await fetch(...)` — so the upload can't be injected
 * between `D` and `O` without splitting the declarator. We prepend it to the
 * whole statement instead, where `P` (the scene elements) is already in scope.
 */
const ANCHOR = "const D=P.filter(B=>!B.isDeleted).map(x),O=await fetch(\"/api/elements/sync\"";

/**
 * Upload the scene's files, then fall through to the original sync.
 *
 * Excalidraw's getFiles() returns every file it knows about, so we send only
 * those an element actually references — a board that had an image deleted
 * shouldn't keep re-uploading its bytes forever.
 *
 * Failure is deliberately swallowed: a file upload that fails must not block
 * the element sync, or a transient error would stall the whole board.
 */
const INJECT = `await (async()=>{/*${MARKER}*/try{const f=e.getFiles&&e.getFiles();if(f){const used=new Set(P.filter(z=>z&&z.fileId&&!z.isDeleted).map(z=>z.fileId));const list=Object.values(f).filter(z=>z&&z.id&&used.has(z.id));if(list.length)await fetch("/api/files",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({files:list})});}}catch(_e){console.warn("file sync failed",_e);}})();`;

function findBundle(assetsDir) {
  const candidates = readdirSync(assetsDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({ f, size: statSync(join(assetsDir, f)).size }))
    .filter(({ f }) => readFileSync(join(assetsDir, f), "utf8").includes(ANCHOR));
  if (candidates.length !== 1) {
    throw new Error(
      `expected exactly 1 bundle containing the sync anchor, found ${candidates.length}. ` +
        `The vendored frontend changed — re-check the anchor in this script.`,
    );
  }
  return join(assetsDir, candidates[0].f);
}

const assetsDir = process.argv[2];
if (!assetsDir) {
  console.error("usage: patch-canvas-frontend.mjs <path-to-frontend/assets>");
  process.exit(1);
}

const bundlePath = findBundle(assetsDir);
const src = readFileSync(bundlePath, "utf8");

if (src.includes(MARKER)) {
  console.log(`canvas frontend already patched (${bundlePath})`);
  process.exit(0);
}

const idx = src.indexOf(ANCHOR);
const patched = src.slice(0, idx) + INJECT + src.slice(idx);
writeFileSync(bundlePath, patched);
console.log(`patched canvas frontend: files now upload before element sync`);
console.log(`  ${bundlePath}`);
