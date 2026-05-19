/**
 * The Square's left rail.
 *
 * Renders the search input plus three sections — Browse, Categories,
 * Installed. Filter state is owned by the parent (Square); this
 * component is fully controlled.
 */
import React from "react";
import { color, font, radius, space } from "./theme";
import { APPS, type AppCategory, type AppManifest } from "./apps";

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

const sectionLabel: React.CSSProperties = {
  fontSize: font.size.xs,
  fontWeight: 600,
  color: color.text.dim,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  padding: "0 12px",
  marginBottom: space.s6,
};

const row = (active: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  background: "transparent",
  border: 0,
  textAlign: "left",
  color: active ? color.text.primary : color.text.secondary,
  fontFamily: font.family,
  fontSize: font.size.base,
  fontWeight: active ? 600 : 500,
  padding: "6px 12px",
  cursor: "pointer",
});

const dot = (visible: boolean): React.CSSProperties => ({
  width: 6,
  height: 6,
  borderRadius: radius.pill,
  background: visible ? color.accent.dot : "transparent",
  flex: "0 0 auto",
});

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
    <div
      style={{
        width: 220,
        flex: "0 0 220px",
        background: color.bg.surface,
        borderRight: `1px solid ${color.border.line}`,
        display: "flex",
        flexDirection: "column",
        padding: "16px 0 24px",
        gap: space.s20,
        overflowY: "auto",
        fontFamily: font.family,
      }}
    >
      <div style={{ padding: "0 12px" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: color.bg.raised,
            border: `1px solid ${color.border.line}`,
            borderRadius: radius.md,
            color: color.text.primary,
            fontFamily: font.family,
            fontSize: font.size.md,
            padding: "8px 10px",
            outline: "none",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = color.border.hover)}
          onBlur={(e) => (e.currentTarget.style.borderColor = color.border.line)}
        />
      </div>

      <div>
        <div style={sectionLabel}>Browse</div>
        {BROWSE.map((b) => {
          const active = sameFilter(filter, { kind: "browse", key: b.key });
          return (
            <button
              key={b.key}
              onClick={() => onFilter({ kind: "browse", key: b.key })}
              style={row(active)}
            >
              <span style={dot(active)} />
              {b.label}
            </button>
          );
        })}
      </div>

      {usedCategories.length > 0 && (
        <div>
          <div style={sectionLabel}>Categories</div>
          {usedCategories.map((cat) => {
            const active = sameFilter(filter, { kind: "category", name: cat });
            return (
              <button
                key={cat}
                onClick={() => onFilter({ kind: "category", name: cat })}
                style={row(active)}
              >
                <span style={dot(active)} />
                {CATEGORY_LABEL[cat]}
              </button>
            );
          })}
        </div>
      )}

      {installed.length > 0 && (
        <div>
          <div style={sectionLabel}>Installed</div>
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
                style={row(active)}
              >
                <span style={dot(active)} />
                {app.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
