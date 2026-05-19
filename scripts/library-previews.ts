/**
 * Generate one short MP4 per library entry for the prompt-library cards.
 *
 * For each entry in editor/library/entries.ts we:
 *   1) write its `story` fragment to a temp story.json
 *   2) render it via the existing KineticStory composition
 *   3) move the output to editor/library/previews/<slug>.mp4
 *
 * Existing story.json is preserved (saved + restored).
 *
 * Run with:  npx tsx scripts/library-previews.ts            (all entries)
 *            npx tsx scripts/library-previews.ts <slug>     (one entry)
 *
 * Re-renders are skipped if the preview already exists and is newer than
 * entries.ts (cheap incremental). Force re-render with --force.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { storySchema, storyDurationInFrames } from "../src/kinetic/schema";
import { ENTRIES } from "../editor/library/entries";

const ROOT = path.resolve(__dirname, "..");
const STORY_PATH = path.join(ROOT, "story.json");
const STORY_BACKUP = path.join(ROOT, "story.preview-backup.json");
const PREVIEWS_DIR = path.join(ROOT, "editor", "library", "previews");
const ENTRIES_SOURCE = path.join(ROOT, "editor", "library", "entries.ts");

const FPS = 30;

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const onlySlug = argv.find((a) => !a.startsWith("--"));

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

const fileMtime = async (p: string): Promise<number> => {
  const s = await fs.stat(p);
  return s.mtimeMs;
};

const runRender = (outPath: string, durationInFrames: number) =>
  new Promise<void>((resolve, reject) => {
    // Render in CLI mode with no concurrency cap — these are tiny clips.
    const child = spawn(
      "npx",
      [
        "remotion",
        "render",
        "KineticStory",
        outPath,
        "--concurrency=4",
        `--frames=0-${durationInFrames - 1}`,
      ],
      { cwd: ROOT, stdio: "inherit" },
    );
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`render exited ${code}`)),
    );
  });

const main = async () => {
  await fs.mkdir(PREVIEWS_DIR, { recursive: true });

  // Save the user's current story.json so we can restore it.
  const hadStory = await fileExists(STORY_PATH);
  if (hadStory) {
    await fs.copyFile(STORY_PATH, STORY_BACKUP);
  }

  const entriesMtime = await fileMtime(ENTRIES_SOURCE);

  const targets = onlySlug
    ? ENTRIES.filter((e) => e.slug === onlySlug)
    : ENTRIES;
  if (onlySlug && targets.length === 0) {
    console.error(`No entry with slug "${onlySlug}"`);
    process.exit(1);
  }

  try {
    for (const entry of targets) {
      const outPath = path.join(PREVIEWS_DIR, `${entry.slug}.mp4`);
      if (!force && (await fileExists(outPath))) {
        const previewMtime = await fileMtime(outPath);
        if (previewMtime > entriesMtime) {
          console.log(`[skip] ${entry.slug} — preview is up to date`);
          continue;
        }
      }
      console.log(`\n[render] ${entry.slug} — ${entry.title}`);

      // validate + write the entry's story fragment to story.json
      const parsed = storySchema.parse(entry.story);
      await fs.writeFile(STORY_PATH, JSON.stringify(parsed, null, 2), "utf8");

      const duration = storyDurationInFrames(parsed, FPS);
      await runRender(outPath, duration);
      console.log(`[ok]    ${entry.slug}.mp4`);
    }
  } finally {
    // Restore the user's story.json no matter what.
    if (hadStory) {
      await fs.copyFile(STORY_BACKUP, STORY_PATH);
      await fs.unlink(STORY_BACKUP);
    } else {
      // there was no story.json before — leave the last preview's contents
      // in place would be confusing; remove it.
      try {
        await fs.unlink(STORY_PATH);
      } catch {
        /* ignore */
      }
    }
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
