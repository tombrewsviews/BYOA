/**
 * The Square — the platform's launch screen.
 *
 * Three columns: Sidebar (filters), center list of AppRows, and a
 * conditional AppDrawer when the user has selected an app.
 *
 * Filter rules:
 *  - The active sidebar filter constrains which apps appear in the list.
 *  - Typing into the search box OVERRIDES the sidebar filter while the
 *    search value is non-empty.
 *  - Sort is in-memory; resets on reload.
 *
 * Selection rules:
 *  - Clicking an app's icon or row body opens the drawer for that app.
 *  - Clicking the row's install/open button does NOT open the drawer.
 *  - If the selected app is filtered out of the current view, the drawer
 *    closes automatically.
 *  - Clicking the active row again closes the drawer.
 */
import React, { useEffect, useMemo, useState } from "react";
import { APPS, type AppManifest } from "./apps";
import { Sidebar, type Filter } from "./Sidebar";
import { AppRow } from "./AppRow";
import { AppDrawer } from "./AppDrawer";
import { getInstallState } from "./install";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown } from "../icons";

const FAVORITES_KEY = "platform.favorites";

const loadFavorites = (): Set<string> => {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
};

const saveFavorites = (set: Set<string>) => {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
};

type SortKey = "featured" | "new" | "tokens";

const BROWSE_DISPLAY: Record<
  "featured" | "new" | "most" | "soon",
  { title: string; sort: SortKey }
> = {
  featured: { title: "Featured", sort: "featured" },
  new: { title: "New this week", sort: "new" },
  most: { title: "Most prompted", sort: "tokens" },
  soon: { title: "Coming soon", sort: "featured" },
};

const CATEGORY_DISPLAY: Record<string, string> = {
  "video-motion": "Video & Motion",
  audio: "Audio",
  "3d-render": "3D & Render",
  writing: "Writing",
  data: "Data",
  devtools: "Devtools",
};

const filterApps = (filter: Filter): AppManifest[] => {
  if (filter.kind === "browse") {
    if (filter.key === "soon") {
      return APPS.filter((a) => a.status === "coming-soon");
    }
    if (filter.key === "new") {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return APPS.filter((a) => Date.parse(a.releasedAt) >= cutoff);
    }
    return APPS;
  }
  if (filter.kind === "category") {
    return APPS.filter((a) => a.category === filter.name);
  }
  // installed
  return APPS.filter((a) => a.id === filter.appId);
};

const sortApps = (
  apps: AppManifest[],
  key: SortKey,
  dir: "asc" | "desc",
): AppManifest[] => {
  const copy = [...apps];
  if (key === "featured") {
    if (dir === "asc") copy.reverse();
    return copy;
  }
  const cmp = (a: AppManifest, b: AppManifest): number => {
    if (key === "new") return Date.parse(b.releasedAt) - Date.parse(a.releasedAt);
    if (key === "tokens") return b.tokens - a.tokens;
    return 0;
  };
  copy.sort(cmp);
  if (dir === "asc") copy.reverse();
  return copy;
};

const searchApps = (query: string): AppManifest[] => {
  const q = query.trim().toLowerCase();
  if (!q) return APPS;
  return APPS.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.blurb.toLowerCase().includes(q) ||
      a.tags.some((t) => t.toLowerCase().includes(q)),
  );
};

const filterTitle = (filter: Filter): string => {
  if (filter.kind === "browse") return BROWSE_DISPLAY[filter.key].title;
  if (filter.kind === "category") return CATEGORY_DISPLAY[filter.name] ?? filter.name;
  const app = APPS.find((a) => a.id === filter.appId);
  return app ? app.name : "Installed";
};

export const Square: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const [filter, setFilter] = useState<Filter>({ kind: "browse", key: "featured" });
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  const toggleFavorite = (id: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const installed = useMemo(
    () => APPS.filter((a) => getInstallState(a.id).state === "installed"),
    [],
  );

  const sortKey: SortKey =
    filter.kind === "browse" ? BROWSE_DISPLAY[filter.key].sort : "featured";

  const visible = useMemo(() => {
    const base = search.trim() ? searchApps(search) : filterApps(filter);
    return sortApps(base, sortKey, sortDir);
  }, [filter, search, sortKey, sortDir]);

  // Close drawer if the selected app is no longer visible.
  useEffect(() => {
    if (!selectedAppId) return;
    if (!visible.some((a) => a.id === selectedAppId)) setSelectedAppId(null);
  }, [visible, selectedAppId]);

  // Sidebar filter change with a selection: if the user clicked an
  // "Installed → kinetic" entry, also open the drawer for it.
  const handleFilter = (next: Filter) => {
    setFilter(next);
    setSearch("");
    if (next.kind === "installed") setSelectedAppId(next.appId);
  };

  const onRowSelect = (id: string) => {
    setSelectedAppId((cur) => (cur === id ? null : id));
  };

  const headerTitle = search.trim() ? "Search" : filterTitle(filter);
  const selectedApp = selectedAppId
    ? APPS.find((a) => a.id === selectedAppId) ?? null
    : null;

  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-muted-foreground">
      <Sidebar
        filter={filter}
        onFilter={handleFilter}
        search={search}
        onSearch={(v) => {
          setSearch(v);
        }}
        installed={installed}
      />

      <div className="min-w-0 flex-1 overflow-y-auto px-8 pb-20 pt-8">
        <div className="mx-auto max-w-[920px]">
          <div className="mb-6">
            <h1 className="text-4xl font-extrabold tracking-tight text-foreground">
              {headerTitle}
            </h1>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{visible.length} results · sort: {sortKey}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                aria-label="Toggle sort direction"
              >
                {sortDir === "desc" ? <ArrowDown /> : <ArrowUp />}
              </Button>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-[13px] text-muted-foreground">
              No apps match. Try clearing the filters.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((app) => (
                <AppRow
                  key={app.id}
                  app={app}
                  selected={selectedAppId === app.id}
                  onSelect={() => onRowSelect(app.id)}
                  onOpen={() => onOpen(app.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedApp && (
        <AppDrawer
          app={selectedApp}
          favorite={favorites.has(selectedApp.id)}
          onToggleFavorite={() => toggleFavorite(selectedApp.id)}
          onClose={() => setSelectedAppId(null)}
          onOpen={() => onOpen(selectedApp.id)}
        />
      )}
    </div>
  );
};
