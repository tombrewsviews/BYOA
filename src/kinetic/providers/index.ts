/**
 * Provider registry. Everything that needs "the list of vector providers"
 * imports from here — the CLI, the benchmark, the editor's provider picker.
 * Adding a model = add its file + one line here.
 */
import type { ProviderId, VectorProvider } from "./types";
import { recraftProvider } from "./recraft";
import { claudeProvider } from "./claude";
import { ollamaProvider } from "./ollama";

export * from "./types";
export { extractShapePath } from "./svg-extract";

export const providers: Record<ProviderId, VectorProvider> = {
  recraft: recraftProvider,
  claude: claudeProvider,
  ollama: ollamaProvider,
  // "handwritten" isn't a generator — it's the no-provider fallback used
  // directly via the `shape` field in the story. Not listed as a runnable
  // provider, but kept in the ProviderId union for completeness.
  handwritten: {
    id: "handwritten",
    label: "Hand-written",
    isAvailable: () => false,
    generate: async () => {
      throw new Error(
        "handwritten is not a generator — put the path in the beat's `shape` field directly",
      );
    },
  },
};

export const runnableProviders = (): VectorProvider[] =>
  [recraftProvider, claudeProvider, ollamaProvider];

export const getProvider = (id: ProviderId): VectorProvider => providers[id];
