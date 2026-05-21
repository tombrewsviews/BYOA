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
import { font } from "./platform/theme";
import { Button } from "@/components/ui/button";
import { LayoutGrid } from "./icons";

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
    className="relative flex flex-none select-none items-center gap-2.5 border-b border-border bg-card pr-3 text-sm text-muted-foreground"
    style={{
      height: CHROME_HEIGHT,
      paddingLeft: isMac ? MAC_LEFT_PAD : 12,
      fontFamily: font.family,
    }}
  >
    {app ? (
      <>
        <Button
          data-tauri-drag-region={false}
          variant="ghost"
          size="sm"
          onClick={onExit}
          title="Back to The Square"
        >
          <LayoutGrid />
          The Square
        </Button>
        {/* App name centered in the bar, independent of the left/right
            content. pointer-events-none so it never blocks the drag region. */}
        <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-baseline gap-1.5">
          <span className="font-semibold text-foreground">{app.name}</span>
          <span className="text-xs text-muted-foreground/60">v{app.version}</span>
        </div>
      </>
    ) : (
      <span className="absolute left-1/2 -translate-x-1/2 font-bold tracking-tight text-foreground">
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
