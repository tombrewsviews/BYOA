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
      next();
    });
  },
});

export default defineConfig({
  root: path.join(PROJECT_ROOT, "editor"),
  plugins: [react(), storyJsonPlugin()],
  server: {
    port: 5174,
    fs: {
      // editor/ is root, but it imports from ../src and reads ../story.json
      allow: [PROJECT_ROOT],
    },
  },
  resolve: {
    // make ../src imports resolve cleanly from editor/
    alias: {},
  },
});
