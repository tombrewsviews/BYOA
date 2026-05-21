/**
 * The Square's left rail.
 *
 * Renders the search input plus three sections — Browse, Categories,
 * Installed. Filter state is owned by the parent (Square); this
 * component is fully controlled.
 */
import React from "react";
import { APPS, type AppCategory, type AppManifest } from "./apps";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type Filter =
  | { kind: "browse"; key: "featured" | "new" | "most" | "soon" }
  | { kind: "category"; name: AppCategory }
  | { kind: "installed"; appId: string };

const BROWSE: { key: "featured" | "new" | "most" | "soon"; label: string }[] = [
  { key: "featured", label: "Featured" },
  { key: "new", label: "New this week" },
  { key: "most", label: "Most prompted" },
  { key: "soon", label: "Coming soon" },
];

const CATEGORY_LABEL: Record<AppCategory, string> = {
  "video-motion": "Video & Motion",
  audio: "Audio",
  "3d-render": "3D & Render",
  writing: "Writing",
  data: "Data",
  devtools: "Devtools",
};

const SECTION_LABEL =
  "mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";

const rowClass = (active: boolean): string =>
  cn(
    "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[13px] transition-colors hover:text-foreground",
    active
      ? "font-semibold text-foreground"
      : "font-medium text-muted-foreground",
  );

const dotClass = (visible: boolean): string =>
  cn("size-1.5 flex-none rounded-full", visible ? "bg-foreground" : "bg-transparent");

const sameFilter = (a: Filter, b: Filter): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "browse" && b.kind === "browse") return a.key === b.key;
  if (a.kind === "category" && b.kind === "category") return a.name === b.name;
  if (a.kind === "installed" && b.kind === "installed")
    return a.appId === b.appId;
  return false;
};

export const Sidebar: React.FC<{
  filter: Filter;
  onFilter: (f: Filter) => void;
  search: string;
  onSearch: (v: string) => void;
  installed: AppManifest[];
}> = ({ filter, onFilter, search, onSearch, installed }) => {
  // Only show category rows that have at least one app.
  const usedCategories = Array.from(
    new Set(APPS.map((a) => a.category)),
  ) as AppCategory[];

  return (
    <div className="flex w-[220px] flex-none flex-col gap-5 overflow-y-auto border-r border-border bg-card pb-6 pt-4">
      <div className="px-3">
        <Input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search…"
        />
      </div>

      <div>
        <div className={SECTION_LABEL}>Browse</div>
        {BROWSE.map((b) => {
          const active = sameFilter(filter, { kind: "browse", key: b.key });
          return (
            <button
              key={b.key}
              onClick={() => onFilter({ kind: "browse", key: b.key })}
              className={rowClass(active)}
            >
              <span className={dotClass(active)} />
              {b.label}
            </button>
          );
        })}
      </div>

      {usedCategories.length > 0 && (
        <div>
          <div className={SECTION_LABEL}>Categories</div>
          {usedCategories.map((cat) => {
            const active = sameFilter(filter, { kind: "category", name: cat });
            return (
              <button
                key={cat}
                onClick={() => onFilter({ kind: "category", name: cat })}
                className={rowClass(active)}
              >
                <span className={dotClass(active)} />
                {CATEGORY_LABEL[cat]}
              </button>
            );
          })}
        </div>
      )}

      {installed.length > 0 && (
        <div>
          <div className={SECTION_LABEL}>Installed</div>
          {installed.map((app) => {
            const active = sameFilter(filter, {
              kind: "installed",
              appId: app.id,
            });
            return (
              <button
                key={app.id}
                onClick={() =>
                  onFilter({ kind: "installed", appId: app.id })
                }
                className={rowClass(active)}
              >
                <span className={dotClass(active)} />
                {app.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
