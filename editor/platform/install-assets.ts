/**
 * Which files each app materializes into ~/Applications/DreamStore/<App>/.
 * The frontend owns the Vite ?url imports, resolves them to bytes, and hands
 * them to the app_install command (Rust just writes bytes). Apps with no
 * assets have no entry.
 */

// Overlay-tolerant: private-app install assets live in apps-private/*/assets/.
// A shared clone has no overlay -> empty glob -> no private asset entries.
//
// We copy EVERY asset the app ships (the whole assets/ dir), not just the ones
// the current build happens to use. In DS-1 the install folder is a state
// marker the running app doesn't read yet (it still loads assets from its
// bundled ?url imports), so the copy is forward-looking: DS-2 loads the app's
// frontend from the install folder, at which point it needs every asset it
// consumes at runtime (Remit uses the PDF template + signature for export AND
// the white PNG for its on-screen preview). Copying the full assets/ dir keeps
// the folder self-sufficient for that transition.
const overlayAssets = import.meta.glob("../apps-private/*/assets/*", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

// Map appId -> [{name,url}] from the globbed overlay paths.
const ASSET_URLS: Record<string, { name: string; url: string }[]> = {};
for (const [path, url] of Object.entries(overlayAssets)) {
  const m = path.match(/apps-private\/([^/]+)\/assets\/(.+)$/);
  if (!m) continue;
  const [, appId, name] = m;
  (ASSET_URLS[appId] ??= []).push({ name, url });
}

export const installAssetsFor = async (
  appId: string,
): Promise<{ name: string; bytes: number[] }[]> => {
  const specs = ASSET_URLS[appId] ?? [];
  return Promise.all(
    specs.map(async ({ name, url }) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`asset not found: ${name}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      return { name, bytes: Array.from(buf) };
    }),
  );
};
