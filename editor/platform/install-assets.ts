/**
 * Which files each app materializes into ~/Applications/DreamStore/<App>/.
 * The frontend owns the Vite ?url imports, resolves them to bytes, and hands
 * them to the app_install command (Rust just writes bytes). Apps with no
 * assets have no entry.
 */

// Overlay-tolerant: private-app install assets live in apps-private/*/assets/.
// A shared clone has no overlay -> empty glob -> no private asset entries.
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
