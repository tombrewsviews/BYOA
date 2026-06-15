/**
 * Render one project's preview MP4 for the projects-list card.
 *
 * Usage:  npx tsx scripts/project-preview.ts <project-path>
 *
 * Reads <project>/story.json, renders KineticStory at low res (360x640
 * @ 30fps) to <project>/.kinetic-studio/preview.mp4. Uses Remotion's
 * --props flag so the project's story drives the render WITHOUT mutating
 * the repo's own story.json — multiple projects can render in parallel
 * because each invocation passes its own props on the command line.
 *
 * Skipped silently if story.json has zero beats (nothing meaningful to
 * preview). Caller (the Rust `project_close` hook) just fires and
 * forgets; output is logged but errors don't propagate.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { storySchema, storyDurationInFrames } from "../src/kinetic/schema";

const ROOT = path.resolve(__dirname, "..");
const FPS = 30;
const WIDTH = 360;
const HEIGHT = 640;

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * A media file copied into Remotion's `public/` for the duration of a
 * render. `owned` is true only when WE created it (it wasn't already
 * there) — so cleanup never deletes a file that legitimately ships in
 * public/. Mirrors `stage_media` / `StagedMedia` in src-tauri/src/video.rs;
 * the export path stages the same way, and the preview render must too or
 * any project with an imageClip/videoClip 404s on staticFile().
 */
type StagedMedia = { dest: string; owned: boolean };

/** Collect absolute imageSrc / videoSrc paths a story references. */
const storyMediaPaths = (story: ReturnType<typeof storySchema.parse>): string[] => {
  const paths: string[] = [];
  for (const beat of story.beats) {
    for (const p of [beat.imageSrc, beat.videoSrc]) {
      if (typeof p === "string" && p.startsWith("/")) paths.push(p);
    }
  }
  return paths;
};

/** Copy referenced media into `<root>/public/<basename>`. Files already
 * present are left untouched (owned=false). Missing sources are skipped —
 * the render shows the placeholder rather than failing. */
const stageMedia = async (root: string, media: string[]): Promise<StagedMedia[]> => {
  const publicDir = path.join(root, "public");
  await fs.mkdir(publicDir, { recursive: true });
  const staged: StagedMedia[] = [];
  for (const src of media) {
    if (!(await fileExists(src))) continue;
    const dest = path.join(publicDir, path.basename(src));
    const owned = !(await fileExists(dest));
    if (owned) await fs.copyFile(src, dest);
    staged.push({ dest, owned });
  }
  return staged;
};

/** Remove the copies we created (leave pre-existing public/ files alone). */
const unstageMedia = async (staged: StagedMedia[]): Promise<void> => {
  for (const s of staged) {
    if (!s.owned) continue;
    try {
      await fs.unlink(s.dest);
    } catch {
      /* ignore — interrupted render or already gone */
    }
  }
};

const main = async () => {
  const projectPath = process.argv[2];
  if (!projectPath) {
    console.error("usage: project-preview.ts <project-path>");
    process.exit(2);
  }

  const storyPath = path.join(projectPath, "story.json");
  if (!(await fileExists(storyPath))) {
    console.error(`no story.json at ${storyPath}`);
    process.exit(2);
  }

  const raw = JSON.parse(await fs.readFile(storyPath, "utf8"));
  const story = storySchema.parse(raw);
  if (story.beats.length === 0) {
    console.log(`[skip] empty story — no preview`);
    return;
  }

  const duration = storyDurationInFrames(story, FPS);

  const metaDir = path.join(projectPath, ".kinetic-studio");
  await fs.mkdir(metaDir, { recursive: true });
  const outPath = path.join(metaDir, "preview.mp4");
  // Unique tmp + props paths per invocation so two concurrent renders
  // (e.g. user closes project A, then B in quick succession) don't
  // clobber each other's files.
  const tag = `${process.pid}-${Date.now()}`;
  const tmpPath = path.join(metaDir, `preview.tmp.${tag}.mp4`);
  // Props go through a temp file rather than an inline arg — inline JSON
  // can exceed command-line length limits and shell-escape badly.
  const propsPath = path.join(metaDir, `preview.props.${tag}.json`);
  await fs.writeFile(propsPath, JSON.stringify(story), "utf8");

  console.log(`[render] ${projectPath} (${duration} frames)`);

  // Stage project media (imageClip / videoClip sources) into the repo's
  // public/ so the composition's staticFile(basename) resolves. Without
  // this, headless Chromium 404s on absolute paths and the render exits 1.
  const media = storyMediaPaths(story);
  const staged = await stageMedia(ROOT, media);

  const args = [
    "remotion",
    "render",
    "KineticStory",
    tmpPath,
    `--props=${propsPath}`,
    `--width=${WIDTH}`,
    `--height=${HEIGHT}`,
    `--frames=0-${duration - 1}`,
    "--concurrency=2",
    "--codec=h264",
    "--crf=28",
    "--log=error",
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("npx", args, { cwd: ROOT, stdio: "inherit" });
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`render exited ${code}`)),
      );
    });
    // Atomic move so the editor never sees a half-written file.
    await fs.rename(tmpPath, outPath);
    console.log(`[ok] ${outPath}`);
  } finally {
    await unstageMedia(staged);
    try {
      await fs.unlink(propsPath);
    } catch {
      /* ignore */
    }
  }
};

main().catch((e) => {
  console.error(`[preview error] ${e?.message ?? e}`);
  process.exit(1);
});
