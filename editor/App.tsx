/**
 * Platform router — the compiled, immutable outer shell.
 *
 * Two routes:
 *   • The Square (default) — the marketplace home, owned by the
 *     platform. Users cannot modify it.
 *   • An app — the platform mounts the chosen app's Root component
 *     and hands it an onExit callback. Everything inside the app
 *     (its own top bar, onboarding, panels, tabs, custom flows) is
 *     the app's business; the platform stays out of its way.
 *
 * The PLATFORM CHROME — the title bar at the top of the window —
 * lives here and only here. It carries the macOS traffic lights, a
 * draggable region, the "back to The Square" button, and the current
 * app's name. The app gets the full content area below it.
 *
 * Selection of the open app is persisted in localStorage so a reload
 * doesn't dump the user back at The Square mid-edit.
 */
import React, { useEffect, useState } from "react";
import { APPS, findApp, type AppManifest } from "./platform/apps";
import { Square } from "./platform/Square";
import { color, font, secondaryBtn } from "./platform/theme";

const CURRENT_APP_KEY = "platform.currentApp";

const loadCurrentApp = (): string | null => {
  try {
    const id = localStorage.getItem(CURRENT_APP_KEY);
    if (!id) return null;
    const app = findApp(id);
    if (!app || app.status !== "available" || !app.Root) return null;
    return id;
  } catch {
    return null;
  }
};

const saveCurrentApp = (id: string | null) => {
  try {
    if (id) localStorage.setItem(CURRENT_APP_KEY, id);
    else localStorage.removeItem(CURRENT_APP_KEY);
  } catch {
    /* ignore */
  }
};

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/** Height of the platform title bar in CSS pixels. macOS's traffic
 *  lights sit ~28px from window top; 36 gives them a hair of breathing
 *  room and keeps the bar slim. */
const CHROME_HEIGHT = 36;
/** Left padding on macOS to clear the traffic lights (lights end at
 *  ~70px including the right edge of the green button). 84px gives
 *  ~14px gap before our content starts. */
const MAC_LEFT_PAD = 84;

const PlatformChrome: React.FC<{
  app: AppManifest | null;
  onExit: () => void;
}> = ({ app, onExit }) => (
  <div
    data-tauri-drag-region
    style={{
      height: CHROME_HEIGHT,
      flex: "0 0 auto",
      background: color.bg.surface,
      borderBottom: `1px solid ${color.border.line}`,
      display: "flex",
      alignItems: "center",
      gap: 10,
      paddingLeft: isMac ? MAC_LEFT_PAD : 12,
      paddingRight: 12,
      color: color.text.secondary,
      fontFamily: font.family,
      fontSize: font.size.md,
      userSelect: "none",
      WebkitUserSelect: "none",
    }}
  >
    {app ? (
      <>
        <button
          data-tauri-drag-region={false}
          onClick={onExit}
          title="Back to The Square"
          style={secondaryBtn({ size: "sm" })}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>⊞</span>
          The Square
        </button>
        <span style={{ color: color.text.primary, fontWeight: 600 }}>
          {app.name}
        </span>
        <span style={{ color: color.text.faint, fontSize: font.size.sm }}>
          v{app.version}
        </span>
      </>
    ) : (
      <span
        style={{
          color: color.text.primary,
          fontWeight: 700,
          letterSpacing: -0.2,
        }}
      >
        The Square
      </span>
    )}
  </div>
);

export const App: React.FC = () => {
  const [currentId, setCurrentId] = useState<string | null>(() => loadCurrentApp());

  useEffect(() => {
    saveCurrentApp(currentId);
  }, [currentId]);

  const currentApp = currentId ? findApp(currentId) ?? null : null;
  const Root = currentApp?.Root ?? null;

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <PlatformChrome app={currentApp} onExit={() => setCurrentId(null)} />
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {Root ? (
          <Root key={currentApp!.id} onExit={() => setCurrentId(null)} />
        ) : (
          <Square
            onOpen={(id) => {
              const app = APPS.find((a) => a.id === id);
              if (app?.status === "available" && app.Root) setCurrentId(id);
            }}
          />
        )}
      </div>
    </div>
  );
};
