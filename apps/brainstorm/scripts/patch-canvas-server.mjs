#!/usr/bin/env node
/**
 * Patch the staged mcp-excalidraw-server with Brainstorm's selection support.
 *
 * The upstream package has no concept of "what the user currently has
 * selected": the MCP server ships a `sceneState.selectedElements` Set that is
 * never populated, and the frontend's `onChange` handler discards Excalidraw's
 * `appState` entirely. Without that, the embedded agent cannot see the user's
 * selection at all.
 *
 * Rather than fork/rebuild the vendored package (its frontend is a minified
 * Vite bundle with no source in this repo, wiring up image export, viewport
 * control and mermaid conversion we must not disturb), we apply three
 * surgical patches to the STAGED copy — `stage-server.sh` runs this right
 * after `cp`, so the patches survive every restage:
 *
 *   1. server.js  — hold the current selection + expose GET/POST
 *                   /api/selection, broadcasting `selection_changed`.
 *   2. index.js   — a `get_selected_elements` MCP tool, and make
 *                   `get_resource("scene").selectedElements` real.
 *   3. frontend   — push `appState.selectedElementIds` to /api/selection on
 *                   change, reusing the component's existing live-API ref.
 *
 * Every patch asserts its anchor matches EXACTLY ONCE and is a no-op if
 * already applied, so a botched upstream bump fails loudly instead of
 * silently shipping a half-patched server.
 */

import fs from "fs";
import path from "path";

const dest = process.argv[2];
if (!dest) {
  console.error("usage: patch-canvas-server.mjs <staged-canvas-server-dir>");
  process.exit(1);
}

/** Replace `anchor` with `replacement`, requiring exactly one match.
 *  Returns false (no-op) if `alreadyApplied` is already present. */
function patchFile(file, { anchor, replacement, alreadyApplied, label }) {
  const full = path.join(dest, file);
  const before = fs.readFileSync(full, "utf8");
  if (before.includes(alreadyApplied)) {
    console.log(`  = ${label} (already applied)`);
    return false;
  }
  const count = before.split(anchor).length - 1;
  if (count !== 1) {
    console.error(
      `ERROR: ${file}: expected exactly 1 occurrence of anchor for "${label}", found ${count}.`,
    );
    console.error(
      "The vendored mcp-excalidraw-server probably changed. Re-derive the patch against the new version.",
    );
    process.exit(1);
  }
  fs.writeFileSync(full, before.replace(anchor, replacement));
  console.log(`  + ${label}`);
  return true;
}

console.log("patching canvas-server for selection support:");

// ── 1. server.js: selection state + endpoints ────────────────────────────
patchFile("dist/server.js", {
  label: "server.js: currentSelection state",
  alreadyApplied: "let currentSelection =",
  anchor: "// WebSocket connections\nconst clients = new Set();",
  replacement: `// Current board selection, pushed by the frontend on every selection change.
// Purely in-memory (like \`elements\`) — not persisted, resets on restart.
let currentSelection = { elementIds: [], updatedAt: null };
// WebSocket connections
const clients = new Set();`,
});

patchFile("dist/server.js", {
  label: "server.js: GET/POST /api/selection",
  alreadyApplied: "'/api/selection'",
  anchor: "// ─── Files API (for image elements) ───────────────────────────",
  replacement: `// ─── Selection API (what the user currently has selected on the board) ────
// POST from the frontend on every selection change.
app.post('/api/selection', (req, res) => {
    const { elementIds } = req.body;
    if (!Array.isArray(elementIds)) {
        return res.status(400).json({
            success: false,
            error: 'Expected elementIds to be an array'
        });
    }
    currentSelection = { elementIds, updatedAt: new Date().toISOString() };
    broadcast({
        type: 'selection_changed',
        elementIds: currentSelection.elementIds,
        updatedAt: currentSelection.updatedAt
    });
    res.json({ success: true, ...currentSelection });
});
// GET the current selection — used by the chat window (no WS connection
// there) and by the MCP's get_selected_elements tool.
app.get('/api/selection', (_req, res) => {
    res.json({ success: true, ...currentSelection });
});
// ─── Files API (for image elements) ───────────────────────────`,
});

// ── 2. index.js: the MCP tool ───────────────────────────────────────────
patchFile("dist/index.js", {
  label: "index.js: get_selected_elements tool definition",
  alreadyApplied: "name: 'get_selected_elements'",
  anchor: `    {
        name: 'get_resource',
        description: 'Get an Excalidraw resource',`,
  replacement: `    {
        name: 'get_selected_elements',
        description: 'Get the elements currently selected by the user on the board (their live Excalidraw selection). Returns an empty list if nothing is selected.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_resource',
        description: 'Get an Excalidraw resource',`,
});

patchFile("dist/index.js", {
  label: "index.js: get_selected_elements handler",
  alreadyApplied: "case 'get_selected_elements'",
  anchor: `                catch (error) {
                    throw new Error(\`Failed to query elements: \${error.message}\`);
                }
            }
            case 'get_resource': {`,
  replacement: `                catch (error) {
                    throw new Error(\`Failed to query elements: \${error.message}\`);
                }
            }
            case 'get_selected_elements': {
                try {
                    const selResponse = await fetch(\`\${EXPRESS_SERVER_URL}/api/selection\`);
                    if (!selResponse.ok) {
                        throw new Error(\`HTTP server error: \${selResponse.status} \${selResponse.statusText}\`);
                    }
                    const selData = await selResponse.json();
                    const elementIds = selData.elementIds || [];
                    if (elementIds.length === 0) {
                        return {
                            content: [{ type: 'text', text: JSON.stringify({ elements: [], message: 'Nothing is currently selected on the board.' }, null, 2) }]
                        };
                    }
                    const elResponse = await fetch(\`\${EXPRESS_SERVER_URL}/api/elements\`);
                    if (!elResponse.ok) {
                        throw new Error(\`HTTP server error: \${elResponse.status} \${elResponse.statusText}\`);
                    }
                    const elData = await elResponse.json();
                    const allElements = elData.elements || [];
                    const idSet = new Set(elementIds);
                    // Excalidraw stores a shape's label as a SEPARATE text
                    // element pointing back at its container, so a selected
                    // rectangle carries no text of its own. Attach it as
                    // \`labelText\` so the agent can see what the shape says.
                    const labels = new Map();
                    for (const el of allElements) {
                        if (el.containerId && typeof el.text === 'string') {
                            labels.set(el.containerId, el.text);
                        }
                    }
                    const results = allElements
                        .filter((el) => idSet.has(el.id))
                        // A bound label that came along with its selected
                        // container is duplicate noise — its text is reported
                        // on the container below.
                        .filter((el) => !(el.containerId && idSet.has(el.containerId)))
                        .map((el) => {
                            const labelText = labels.get(el.id);
                            return labelText ? { ...el, labelText } : el;
                        });
                    return {
                        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
                    };
                }
                catch (error) {
                    throw new Error(\`Failed to get selected elements: \${error.message}\`);
                }
            }
            case 'get_resource': {`,
});

patchFile("dist/index.js", {
  label: "index.js: get_resource(scene) reports the real selection",
  alreadyApplied: "Failed to fetch selection for get_resource(scene)",
  anchor: `                    case 'scene':
                        result = {
                            theme: sceneState.theme,
                            viewport: sceneState.viewport,
                            selectedElements: Array.from(sceneState.selectedElements)
                        };
                        break;`,
  replacement: `                    case 'scene': {
                        let selectedElements = [];
                        try {
                            const selResponse = await fetch(\`\${EXPRESS_SERVER_URL}/api/selection\`);
                            if (selResponse.ok) {
                                const selData = await selResponse.json();
                                selectedElements = selData.elementIds || [];
                            }
                        }
                        catch (error) {
                            logger.warn('Failed to fetch selection for get_resource(scene):', error.message);
                        }
                        result = {
                            theme: sceneState.theme,
                            viewport: sceneState.viewport,
                            selectedElements
                        };
                        break;
                    }`,
});

// ── 3. frontend bundle: push selection on change ────────────────────────
// The bundle is minified, so this patches two tiny, verified-unique anchors.
// `n` is the component's ref holding the live excalidrawAPI (kept in sync via
// `useEffect(() => { n.current = e }, [e])` in the same closure), so
// `n.current.getAppState()` is the same instance the user is drawing on.
// Vite emits several hashed index-*.js chunks; only one holds the app
// component. Pick it by CONTENT (the anchor we need, or our own already-applied
// marker) rather than by filename, so a chunk-hash change upstream doesn't
// silently send us to the wrong file.
const frontendDir = path.join(dest, "dist/frontend/assets");
const ONCHANGE_ANCHOR = "onChange:()=>{T()}";
const APPLIED_MARKER = "__pushSelection(n.current)";
const candidates = fs
  .readdirSync(frontendDir)
  .filter((f) => f.endsWith(".js"))
  .filter((f) => {
    const src = fs.readFileSync(path.join(frontendDir, f), "utf8");
    return src.includes(ONCHANGE_ANCHOR) || src.includes(APPLIED_MARKER);
  });
if (candidates.length !== 1) {
  console.error(
    `ERROR: expected exactly 1 frontend chunk containing the app component in ${frontendDir}, found ${candidates.length}${candidates.length ? `: ${candidates.join(", ")}` : ""}.`,
  );
  console.error(
    "The vendored mcp-excalidraw-server frontend probably changed. Re-derive the patch against the new build.",
  );
  process.exit(1);
}
const bundleName = candidates[0];
const bundleRel = path.join("dist/frontend/assets", bundleName);

patchFile(bundleRel, {
  label: `${bundleName}: __pushSelection helper`,
  alreadyApplied: "function __pushSelection",
  anchor: "function zve(){",
  replacement:
    "let __selPushTimer=null,__selPushLast='';" +
    "function __pushSelection(api){" +
    "if(!api)return;" +
    "if(__selPushTimer)clearTimeout(__selPushTimer);" +
    "__selPushTimer=setTimeout(()=>{" +
    "__selPushTimer=null;" +
    "try{" +
    "const ids=Object.keys(api.getAppState().selectedElementIds||{});" +
    "const key=ids.slice().sort().join(',');" +
    "if(key===__selPushLast)return;" +
    "__selPushLast=key;" +
    "fetch('/api/selection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({elementIds:ids})}).catch(()=>{});" +
    "}catch(e){}" +
    "},250)" +
    "};" +
    "function zve(){",
});

patchFile(bundleRel, {
  label: `${bundleName}: onChange pushes selection`,
  alreadyApplied: "__pushSelection(n.current)",
  anchor: "onChange:()=>{T()}",
  replacement: "onChange:()=>{T();__pushSelection(n.current)}",
});

console.log("canvas-server patched for selection support.");
