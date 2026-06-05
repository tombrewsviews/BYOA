/**
 * Vite config for the kinetic story EDITOR (editor/).
 *
 * Two non-default things:
 *  1. root = editor/ so editor/index.html is the entry, but `story.json`
 *     and `src/` still resolve (fs.allow + a /story.json static route).
 *  2. a tiny dev-server plugin: POST /__save-story writes the body to
 *     <project>/story.json. This is the persistence layer — the panel's
 *     "Save" button hits it, so edits land in the same story.json that
 *     Studio and renders read. No database, no backend service.
 */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = __dirname;
const STORY_PATH = path.join(PROJECT_ROOT, "story.json");

// --- dev-server plugin: serve + save story.json -----------------------------
const storyJsonPlugin = (): Plugin => ({
  name: "kinetic-story-json",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      // serve the project-root story.json at /story.json
      if (req.method === "GET" && req.url === "/story.json") {
        res.setHeader("content-type", "application/json");
        res.end(fs.readFileSync(STORY_PATH, "utf8"));
        return;
      }
      // persist edits: POST /__save-story  (body = the new story.json)
      if (req.method === "POST" && req.url === "/__save-story") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            JSON.parse(body); // validate it's JSON before writing
            fs.writeFileSync(STORY_PATH, body.endsWith("\n") ? body : body + "\n");
            res.statusCode = 200;
            res.end("ok");
          } catch (e) {
            res.statusCode = 400;
            res.end(`invalid story json: ${(e as Error).message}`);
          }
        });
        return;
      }
      // dev-only: apply resolved design tokens to index.css + theme.ts.
      // Body = { cssVars: {"--x": "..."}, themeTs: {"bg.surface": "#..."} }.
      if (req.method === "POST" && req.url === "/__apply-tokens") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const patch = JSON.parse(body) as {
              cssVars: Record<string, string>;
              themeTs: Record<string, string>;
            };
            const cssPath = path.join(PROJECT_ROOT, "editor", "index.css");
            let css = fs.readFileSync(cssPath, "utf8");
            for (const [k, v] of Object.entries(patch.cssVars || {})) {
              // replace "  --k: <old>;" with the new value (first :root occurrence)
              const re = new RegExp(`(${k.replace(/-/g, "\\-")}:\\s*)([^;]+)(;)`);
              css = css.replace(re, `$1${v}$3`);
            }
            fs.writeFileSync(cssPath, css);

            const themePath = path.join(PROJECT_ROOT, "editor", "platform", "theme.ts");
            let ts = fs.readFileSync(themePath, "utf8");
            for (const [dotPath, v] of Object.entries(patch.themeTs || {})) {
              const leaf = dotPath.split(".").pop()!;
              // swap only the quoted string literal next to this leaf key; first
              // occurrence (bg.* precede border.* so bg.hover wins over border.hover)
              const re = new RegExp(`(${leaf}:\\s*")(#[0-9a-fA-F]{3,8}|rgba\\([^)]*\\))(")`);
              ts = ts.replace(re, `$1${v}$3`);
            }
            fs.writeFileSync(themePath, ts);

            res.statusCode = 200;
            res.end("ok");
          } catch (e) {
            res.statusCode = 400;
            res.end(`apply failed: ${(e as Error).message}`);
          }
        });
        return;
      }
      next();
    });
  },
});

export default defineConfig({
  root: path.join(PROJECT_ROOT, "editor"),
  // The composition's @font-face rules load self-hosted fonts via Remotion's
  // staticFile(), which resolves to the page origin's root (/fonts/...). With
  // root = editor/, vite's default publicDir would be editor/public (which
  // doesn't exist), so the fonts 404 and every family silently falls back to
  // a system sans-serif that ignores font-variation-settings — making the
  // typography axes (weight/width/slant) and font-family picker no-ops in the
  // preview. Point publicDir at the repo's public/ (where the fonts live) so
  // they're served in dev AND copied into editor/dist on build.
  publicDir: path.join(PROJECT_ROOT, "public"),
  plugins: [tailwindcss(), react(), storyJsonPlugin()],
  server: {
    port: 5174,
    fs: {
      // editor/ is root, but it imports from ../src and reads ../story.json
      allow: [PROJECT_ROOT],
    },
  },
  resolve: {
    // @/* resolves to editor/* (shadcn/ReUI component convention)
    alias: { "@": path.join(PROJECT_ROOT, "editor") },
  },
});
