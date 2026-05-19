/**
 * The Square — the platform's launch screen.
 *
 * What it is: a marketplace-style home for community apps that run
 * inside the platform. Each card describes one app — name, blurb,
 * creator, version, tokens spent on its generation, file/LOC count,
 * star rating, tags.
 *
 * What the user can do here:
 *   • Click anywhere on an "available" card → opens the app inside
 *     the platform window.
 *   • Click the stats button on a card → opens a side panel with the
 *     full description and detailed stats.
 *   • Click the star → toggles favorite. Stored in localStorage; the
 *     favorites filter brings only starred apps to the top.
 *   • Type in the search box → filters by name, blurb, or tag.
 *
 * What we DO NOT do here: render anything that an app owns. The Square
 * is the compiled, platform-controlled surface; everything inside an
 * app (top bar, terminal, panels, custom flows) is the app's business.
 */
import React, { useEffect, useMemo, useState } from "react";
import { APPS, type AppManifest } from "./apps";

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

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const formatLoc = (n: number): string => {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const Stars: React.FC<{ rating: number; size?: number }> = ({
  rating,
  size = 11,
}) => {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span style={{ color: "#facc15", fontSize: size, letterSpacing: 1 }}>
      {"★".repeat(full)}
      {half && "⯨"}
      <span style={{ color: "#2e2e3c" }}>
        {"★".repeat(Math.max(0, 5 - full - (half ? 1 : 0)))}
      </span>
    </span>
  );
};

const StatRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
    <span style={{ color: "#8b8b9a" }}>{label}</span>
    <span style={{ color: "#fafafa", fontWeight: 600 }}>{value}</span>
  </div>
);

const Card: React.FC<{
  app: AppManifest;
  favorite: boolean;
  onOpen: () => void;
  onStats: () => void;
  onToggleFavorite: () => void;
}> = ({ app, favorite, onOpen, onStats, onToggleFavorite }) => {
  const available = app.status === "available";
  const gradient = `linear-gradient(135deg, hsl(${app.hue}, 70%, 18%) 0%, hsl(${
    (app.hue + 40) % 360
  }, 55%, 10%) 100%)`;
  return (
    <div
      role={available ? "button" : undefined}
      tabIndex={available ? 0 : -1}
      onClick={() => available && onOpen()}
      onKeyDown={(e) => {
        if (!available) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        background: "#0f0f18",
        border: "1px solid #232330",
        borderRadius: 10,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        cursor: available ? "pointer" : "default",
        opacity: available ? 1 : 0.55,
        transition: "transform 120ms ease, border-color 120ms ease",
      }}
      onMouseEnter={(e) => {
        if (!available) return;
        (e.currentTarget as HTMLDivElement).style.borderColor = "#3a3a4a";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "#232330";
      }}
    >
      {/* Hero band — colored gradient placeholder until apps ship art. */}
      <div
        style={{
          aspectRatio: "16 / 9",
          background: gradient,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 32,
          fontWeight: 800,
          letterSpacing: -1,
        }}
      >
        <span style={{ opacity: 0.75 }}>{app.name.split(" ")[0]}</span>
        {!available && (
          <span
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 7px",
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 999,
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            Coming soon
          </span>
        )}
      </div>

      <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fafafa" }}>{app.name}</div>
            <div style={{ fontSize: 11, color: "#8b8b9a", marginTop: 2 }}>{app.blurb}</div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            aria-label={favorite ? "Unfavorite" : "Favorite"}
            style={{
              background: "transparent",
              border: 0,
              cursor: "pointer",
              fontSize: 16,
              color: favorite ? "#facc15" : "#3a3a4a",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ★
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 6,
            fontSize: 10,
            color: "#6b6b80",
            paddingTop: 6,
            borderTop: "1px solid #1a1a24",
          }}
        >
          <div>
            <div style={{ color: "#e4e4ee", fontWeight: 600, fontSize: 12 }}>
              {formatTokens(app.tokens)}
            </div>
            <div>tokens</div>
          </div>
          <div>
            <div style={{ color: "#e4e4ee", fontWeight: 600, fontSize: 12 }}>{app.files}</div>
            <div>files</div>
          </div>
          <div>
            <div style={{ color: "#e4e4ee", fontWeight: 600, fontSize: 12 }}>
              {formatLoc(app.loc)}
            </div>
            <div>lines</div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 6,
            borderTop: "1px solid #1a1a24",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {app.ratingCount > 0 ? (
              <Stars rating={app.rating} />
            ) : (
              <span style={{ fontSize: 10, color: "#5a5a6e" }}>no ratings yet</span>
            )}
            <span style={{ fontSize: 10, color: "#5a5a6e" }}>by {app.creator}</span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStats();
            }}
            style={{
              background: "#1c1c26",
              border: "1px solid #2e2e3c",
              borderRadius: 6,
              color: "#e4e4ee",
              fontSize: 10,
              fontWeight: 600,
              padding: "4px 9px",
              cursor: "pointer",
            }}
          >
            Stats →
          </button>
        </div>
      </div>
    </div>
  );
};

const StatsPanel: React.FC<{
  app: AppManifest;
  favorite: boolean;
  onClose: () => void;
  onOpen: () => void;
  onToggleFavorite: () => void;
}> = ({ app, favorite, onClose, onOpen, onToggleFavorite }) => {
  const available = app.status === "available";
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 380,
        background: "#0a0a10",
        borderLeft: "1px solid #232330",
        display: "flex",
        flexDirection: "column",
        zIndex: 50,
        boxShadow: "-12px 0 32px rgba(0,0,0,0.4)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 14px",
          borderBottom: "1px solid #232330",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: "#fafafa", flex: 1 }}>
          App details
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent",
            border: 0,
            color: "#8b8b9a",
            fontSize: 18,
            cursor: "pointer",
            padding: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            aspectRatio: "16 / 9",
            background: `linear-gradient(135deg, hsl(${app.hue}, 70%, 18%) 0%, hsl(${
              (app.hue + 40) % 360
            }, 55%, 10%) 100%)`,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontSize: 38,
            fontWeight: 800,
            letterSpacing: -1,
          }}
        >
          <span style={{ opacity: 0.8 }}>{app.name.split(" ")[0]}</span>
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fafafa", flex: 1 }}>
              {app.name}
            </div>
            <button
              onClick={onToggleFavorite}
              aria-label={favorite ? "Unfavorite" : "Favorite"}
              style={{
                background: "transparent",
                border: 0,
                cursor: "pointer",
                fontSize: 18,
                color: favorite ? "#facc15" : "#3a3a4a",
                padding: 0,
              }}
            >
              ★
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#8b8b9a", marginTop: 4 }}>{app.blurb}</div>
          <div style={{ fontSize: 11, color: "#5a5a6e", marginTop: 6 }}>
            by {app.creator} · v{app.version}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {app.tags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 10,
                padding: "2px 8px",
                background: "#1c1c26",
                border: "1px solid #2e2e3c",
                borderRadius: 999,
                color: "#8b8b9a",
              }}
            >
              {t}
            </span>
          ))}
        </div>
        <p style={{ fontSize: 12, color: "#c4c4d4", lineHeight: 1.6, margin: 0 }}>
          {app.description}
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 12,
            background: "#0f0f18",
            border: "1px solid #232330",
            borderRadius: 8,
          }}
        >
          <StatRow label="Tokens spent" value={formatTokens(app.tokens)} />
          <StatRow label="Source files" value={String(app.files)} />
          <StatRow label="Lines of code" value={formatLoc(app.loc)} />
          <StatRow
            label="Rating"
            value={app.ratingCount > 0 ? `${app.rating.toFixed(1)} (${app.ratingCount})` : "—"}
          />
          <StatRow label="Version" value={app.version} />
          <StatRow label="Creator" value={app.creator} />
          <StatRow label="Status" value={available ? "Available" : "Coming soon"} />
        </div>
        {available && (
          <button
            onClick={onOpen}
            style={{
              background: "#7c5cff",
              border: 0,
              borderRadius: 8,
              color: "white",
              fontSize: 13,
              fontWeight: 700,
              padding: "10px 14px",
              cursor: "pointer",
            }}
          >
            Open {app.name} →
          </button>
        )}
      </div>
    </div>
  );
};

export const Square: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const [search, setSearch] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [statsId, setStatsId] = useState<string | null>(null);

  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return APPS.filter((a) => {
      if (favoritesOnly && !favorites.has(a.id)) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.blurb.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [search, favoritesOnly, favorites]);

  const statsApp = statsId ? APPS.find((a) => a.id === statsId) : null;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#08080c",
        color: "#e4e4ee",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        overflow: "auto",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "60px 32px 80px" }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -1 }}>The Square</div>
          <div style={{ fontSize: 14, color: "#8b8b9a", marginTop: 8, maxWidth: 560, lineHeight: 1.5 }}>
            Local-first apps you can drive with your own agent. Bring your
            Claude / Codex / Gemini subscription; the apps ship the skills
            so the agent is an expert from first launch.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps, tags, blurbs…"
            style={{
              flex: 1,
              background: "#0f0f18",
              border: "1px solid #232330",
              borderRadius: 8,
              color: "#e4e4ee",
              fontSize: 13,
              padding: "9px 12px",
              outline: "none",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#7c5cff")}
            onBlur={(e) => (e.target.style.borderColor = "#232330")}
          />
          <button
            onClick={() => setFavoritesOnly((v) => !v)}
            aria-pressed={favoritesOnly}
            style={{
              background: favoritesOnly ? "#7c5cff" : "#0f0f18",
              border: "1px solid",
              borderColor: favoritesOnly ? "#9d83ff" : "#232330",
              borderRadius: 8,
              color: favoritesOnly ? "white" : "#e4e4ee",
              fontSize: 12,
              fontWeight: 600,
              padding: "9px 14px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ★ Favorites
          </button>
        </div>

        {filtered.length === 0 ? (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: "#5a5a6e",
              fontSize: 13,
              border: "1px dashed #232330",
              borderRadius: 12,
            }}
          >
            No apps match. Try clearing the filters.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            {filtered.map((app) => (
              <Card
                key={app.id}
                app={app}
                favorite={favorites.has(app.id)}
                onOpen={() => onOpen(app.id)}
                onStats={() => setStatsId(app.id)}
                onToggleFavorite={() => toggleFavorite(app.id)}
              />
            ))}
          </div>
        )}
      </div>

      {statsApp && (
        <StatsPanel
          app={statsApp}
          favorite={favorites.has(statsApp.id)}
          onClose={() => setStatsId(null)}
          onOpen={() => {
            setStatsId(null);
            onOpen(statsApp.id);
          }}
          onToggleFavorite={() => toggleFavorite(statsApp.id)}
        />
      )}
    </div>
  );
};
