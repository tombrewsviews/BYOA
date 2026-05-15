#!/usr/bin/env tsx
/**
 * `kinetic` — the CLI that Claude Code drives.
 *
 * This is the agent interface (per the chosen "story file Claude edits
 * directly" approach): Claude Code runs these commands via Bash to call
 * vector providers and write shapes into story.json. The Remotion Studio /
 * editor then picks up story.json for human tweaking + render.
 *
 * ⚠️ COST DISCIPLINE: real provider calls cost money (Recraft = $0.08 each).
 * `gen` and `set-shape` serve from the local shape cache/library by default
 * and FREE. A real API call only happens with an explicit `--force` flag.
 * Every real call is then cached so it's free forever after.
 *
 * Commands:
 *   kinetic providers                      list providers + availability
 *   kinetic shapes                         list cached + library shapes
 *   kinetic gen <provider> "<prompt>"      cache hit -> reuse; miss -> error
 *   kinetic gen <provider> "<prompt>" --force    actually call the API ($)
 *   kinetic set-shape <beatIndex> <provider> "<prompt>" [--force] [--story f]
 *                                          shape into a beat (cache-first)
 *   kinetic use-library <beatIndex> <name> [--story f]
 *                                          put a named library shape in a beat
 *   kinetic benchmark "<prompt>" [--force]  compare providers (cache-first)
 *
 * Env (.env): RECRAFT_API_KEY, ANTHROPIC_API_KEY, OLLAMA_BASE_URL/MODEL
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import {
  runnableProviders,
  getProvider,
  type ProviderId,
  type VectorResult,
} from "../src/kinetic/providers/index";
import {
  getCached,
  putCached,
  getLibraryShape,
  listShapes,
} from "../src/kinetic/providers/shape-store";
import { storySchema, type Story } from "../src/kinetic/schema";

const DEFAULT_STORY = path.resolve(process.cwd(), "story.json");

// --- helpers ----------------------------------------------------------------

const die = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const loadStory = (file: string): Story => {
  if (!fs.existsSync(file)) die(`story file not found: ${file}`);
  try {
    return storySchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (e) {
    return die(`invalid story file: ${(e as Error).message}`);
  }
};

const saveStory = (file: string, story: Story) => {
  fs.writeFileSync(file, JSON.stringify(story, null, 2) + "\n");
  console.log(`✓ wrote ${file}`);
};

const flag = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const flagPresent = (args: string[], name: string): boolean =>
  args.includes(`--${name}`);

/** A shape ready to use: just the bits a beat needs. */
type ResolvedShape = { d: string; fill: string | null; source: string };

/**
 * Get a shape WITHOUT spending money unless forced.
 *  1. cache hit  -> reuse, free
 *  2. cache miss + no --force -> ERROR (tells you to add --force)
 *  3. cache miss + --force    -> real API call ($), then cache it
 */
const resolveShape = async (
  providerId: ProviderId,
  prompt: string,
  force: boolean,
): Promise<ResolvedShape> => {
  const cached = getCached(providerId, prompt);
  if (cached) {
    console.error(
      `  ◦ cache hit (${providerId}) — reused free, no API call`,
    );
    return { d: cached.d, fill: cached.fill, source: `cache:${providerId}` };
  }
  if (!force) {
    die(
      `no cached shape for ${providerId} + "${prompt}".\n` +
        `  This would cost a real API call. Re-run with --force to spend, ` +
        `or use \`kinetic shapes\` / \`use-library\` for a free shape.`,
    );
  }
  const provider = getProvider(providerId);
  if (!provider) die(`unknown provider: ${providerId}`);
  console.error(`→ ${provider.label}: "${prompt}"  (--force: real API call)`);
  const result = await provider.generate(prompt);
  printMetrics(result);
  putCached(providerId, prompt, result); // cache so it's free next time
  console.error(`  ◦ cached — future calls with this prompt are free`);
  return { d: result.d, fill: result.fill, source: `${providerId}:fresh` };
};

// --- commands ---------------------------------------------------------------

const cmdProviders = async () => {
  console.log("Vector providers:\n");
  for (const p of runnableProviders()) {
    const ok = await p.isAvailable();
    console.log(`  ${ok ? "●" : "○"} ${p.id.padEnd(10)} ${p.label}`);
    if (!ok) console.log(`    └ unavailable (missing key / service down)`);
  }
  console.log("\n  ● = ready   ○ = unavailable");
};

const cmdShapes = () => {
  const { cache, library } = listShapes();
  console.log(`Library shapes (${library.length}) — free, pick by name:`);
  if (!library.length) console.log("  (none yet)");
  for (const name of library) console.log(`  ▪ ${name}`);
  console.log(`\nCached generations (${cache.length}) — free to reuse:`);
  if (!cache.length) console.log("  (none yet)");
  for (const c of cache) {
    console.log(`  ◦ ${c.provider.padEnd(9)} "${c.prompt}"`);
  }
  console.log(
    `\n  use-library <beatIndex> <name>     put a library shape in a beat (free)`,
  );
};

const cmdGen = async (providerId: string, prompt: string, force: boolean) => {
  if (!prompt) die('usage: kinetic gen <provider> "<prompt>" [--force]');
  const shape = await resolveShape(providerId as ProviderId, prompt, force);
  console.error(`  source: ${shape.source} | fill: ${shape.fill ?? "—"}`);
  // path goes to stdout so it can be piped/captured
  console.log(shape.d);
};

/** Shared: write a shape+color into a beat, switch it to morph, save. */
const applyShapeToBeat = (
  file: string,
  story: Story,
  beatIndex: number,
  d: string,
  fill: string | null,
  sourceLabel: string,
) => {
  story.beats[beatIndex].shape = d;
  story.beats[beatIndex].kind = "morph";
  if (fill) story.beats[beatIndex].color = fill;
  saveStory(file, story);
  console.log(
    `✓ beat ${beatIndex} ("${story.beats[beatIndex].text}") now morphs from ` +
      `${sourceLabel}${fill ? ` (color ${fill})` : ""}`,
  );
};

const cmdSetShape = async (args: string[]) => {
  const [beatIdxRaw, providerId, prompt] = args;
  const beatIndex = Number(beatIdxRaw);
  if (Number.isNaN(beatIndex) || !providerId || !prompt) {
    die(
      'usage: kinetic set-shape <beatIndex> <provider> "<prompt>" [--force] [--story f]',
    );
  }
  const file = flag(args, "story") ?? DEFAULT_STORY;
  const story = loadStory(file);
  if (beatIndex < 0 || beatIndex >= story.beats.length) {
    die(`beat index ${beatIndex} out of range (0..${story.beats.length - 1})`);
  }
  // cache-first; only spends with --force
  const shape = await resolveShape(
    providerId as ProviderId,
    prompt,
    flagPresent(args, "force"),
  );
  applyShapeToBeat(file, story, beatIndex, shape.d, shape.fill, shape.source);
};

const cmdUseLibrary = (args: string[]) => {
  const [beatIdxRaw, name] = args;
  const beatIndex = Number(beatIdxRaw);
  if (Number.isNaN(beatIndex) || !name) {
    die("usage: kinetic use-library <beatIndex> <name> [--story f]");
  }
  const file = flag(args, "story") ?? DEFAULT_STORY;
  const story = loadStory(file);
  if (beatIndex < 0 || beatIndex >= story.beats.length) {
    die(`beat index ${beatIndex} out of range (0..${story.beats.length - 1})`);
  }
  const lib = getLibraryShape(name);
  if (!lib) {
    return die(
      `no library shape named "${name}". Run \`kinetic shapes\` to list.`,
    );
  }
  applyShapeToBeat(file, story, beatIndex, lib.d, lib.fill, `library:${name}`);
};

const cmdBenchmark = async (prompt: string, force: boolean) => {
  if (!prompt) die('usage: kinetic benchmark "<prompt>" [--force]');
  console.log(`Benchmark — prompt: "${prompt}"${force ? " (--force)" : ""}\n`);

  const rows: { provider: string; result?: VectorResult; error?: string }[] =
    [];
  for (const p of runnableProviders()) {
    // cache-first per provider — benchmark is free to re-run once cached
    const cached = getCached(p.id, prompt);
    if (cached) {
      rows.push({
        provider: `${p.label} (cached)`,
        result: { ...cached, rawSvg: "" } as VectorResult,
      });
      continue;
    }
    if (!force) {
      rows.push({
        provider: p.label,
        error: "not cached — re-run with --force to call the API",
      });
      continue;
    }
    if (!(await p.isAvailable())) {
      rows.push({ provider: p.label, error: "unavailable (skipped)" });
      continue;
    }
    try {
      const result = await p.generate(prompt);
      putCached(p.id, prompt, result); // cache so re-runs are free
      rows.push({ provider: p.label, result });
    } catch (e) {
      rows.push({ provider: p.label, error: (e as Error).message });
    }
  }

  // comparison table — this is the core of the benchmark product
  console.log(
    "  " +
      "PROVIDER".padEnd(26) +
      "NODES".padEnd(8) +
      "PATHS".padEnd(8) +
      "LATENCY".padEnd(10) +
      "COST",
  );
  console.log("  " + "─".repeat(58));
  for (const r of rows) {
    if (r.error) {
      console.log("  " + r.provider.padEnd(26) + `✗ ${r.error}`);
      continue;
    }
    const m = r.result!.metrics;
    console.log(
      "  " +
        r.provider.padEnd(26) +
        String(m.nodeCount).padEnd(8) +
        String(m.rawPathCount).padEnd(8) +
        `${m.latencyMs}ms`.padEnd(10) +
        (m.costUsd === null ? "—" : `$${m.costUsd.toFixed(3)}`),
    );
  }
  console.log(
    "\n  Lower NODES morphs cleaner. PATHS near 1-2 = clean output.",
  );

  // dump full results (incl. paths + raw svg) for the comparison view
  const outFile = path.resolve(process.cwd(), "benchmark-result.json");
  fs.writeFileSync(
    outFile,
    JSON.stringify({ prompt, rows }, null, 2) + "\n",
  );
  console.log(`\n  full results -> ${outFile}`);
};

const printMetrics = (r: VectorResult) => {
  const m = r.metrics;
  console.error(
    `  ✓ ${r.model} | ${m.nodeCount} nodes | ${m.rawPathCount} paths | ` +
      `${m.latencyMs}ms | ${m.costUsd === null ? "cost ?" : "$" + m.costUsd}`,
  );
};

// --- dispatch ---------------------------------------------------------------

const main = async () => {
  const [cmd, ...args] = process.argv.slice(2);
  const force = flagPresent(args, "force");
  switch (cmd) {
    case "providers":
      return cmdProviders();
    case "shapes":
      return cmdShapes();
    case "gen":
      return cmdGen(args[0], args[1], force);
    case "set-shape":
      return cmdSetShape(args);
    case "use-library":
      return cmdUseLibrary(args);
    case "benchmark":
      return cmdBenchmark(args[0], force);
    default:
      console.log(
        [
          "kinetic — vector-shape CLI for the kinetic-typography tool",
          "",
          "  Cost-safe by default: generation serves from the local cache/",
          "  library for free. A real API call ($) needs --force.",
          "",
          "  kinetic providers                              list providers",
          "  kinetic shapes                                 list cached + library shapes",
          '  kinetic gen <provider> "<prompt>" [--force]    get a shape (cache-first)',
          '  kinetic set-shape <i> <provider> "<prompt>" [--force] [--story f]',
          "  kinetic use-library <i> <name> [--story f]     free: a named library shape",
          '  kinetic benchmark "<prompt>" [--force]         compare providers (cache-first)',
          "",
          "  providers: recraft | claude | ollama",
        ].join("\n"),
      );
  }
};

main().catch((e) => die((e as Error).message));
