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
