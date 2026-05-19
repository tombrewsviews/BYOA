/**
 * A single row in The Square's app list.
 *
 * Layout: 44×44 colored icon · name + sub-line (blurb · creator · version) ·
 * trailing install/open button. Click on icon or the text block opens the
 * drawer for this app. Click on the button installs or opens — and does
 * NOT open the drawer (the button stops propagation).
 */
import React from "react";
import { color, font, radius, primaryBtn, secondaryBtn, formatBytes } from "./theme";
import { type AppManifest } from "./apps";
import { startInstall, useInstallState } from "./install";

const ICON_SIZE = 44;

const InstallButton: React.FC<{
  app: AppManifest;
  onOpen: () => void;
}> = ({ app, onOpen }) => {
  const rec = useInstallState(app.id);
  if (app.status === "coming-soon") {
    return (
      <button
        disabled
        style={secondaryBtn({ disabled: true })}
        onClick={(e) => e.stopPropagation()}
      >
        Coming soon
      </button>
    );
  }
  if (rec.state === "installed") {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        style={primaryBtn({ size: "sm" })}
      >
        Open
      </button>
    );
  }
  if (rec.state === "installing") {
    const pct = Math.round(rec.progress * 100);
    return (
      <button
        onClick={(e) => e.stopPropagation()}
        style={secondaryBtn()}
        title="Installing…"
      >
        Installing… {pct}%
      </button>
    );
  }
  if (rec.state === "failed") {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          startInstall(app.id);
        }}
        style={secondaryBtn()}
      >
        Retry install
      </button>
    );
  }
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        startInstall(app.id);
      }}
      style={primaryBtn({ size: "sm" })}
    >
      Install · {formatBytes(app.sizeBytes)}
    </button>
  );
};

export const AppRow: React.FC<{
  app: AppManifest;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}> = ({ app, selected, onSelect, onOpen }) => {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 14px",
        background: selected ? color.bg.selected : color.bg.raised,
        border: `1px solid ${color.border.line}`,
        borderRadius: radius.lg,
        cursor: "pointer",
        fontFamily: font.family,
        transition: "border-color 120ms ease, background 120ms ease",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.borderColor = color.border.hover)
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.borderColor = color.border.line)
      }
    >
      <div
        aria-hidden
        style={{
          width: ICON_SIZE,
          height: ICON_SIZE,
          flex: "0 0 auto",
          background: `hsl(${app.hue}, 70%, 38%)`,
          borderRadius: radius.lg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.6)",
          fontSize: 18,
          fontWeight: 800,
          letterSpacing: -0.5,
        }}
      >
        {app.name.charAt(0)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: font.size.lg,
            fontWeight: 700,
            color: color.text.primary,
          }}
        >
          {app.name}
        </div>
        <div
          style={{
            fontSize: font.size.md,
            color: color.text.muted,
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {app.blurb} · {app.creator} · v{app.version}
        </div>
      </div>
      <InstallButton app={app} onOpen={onOpen} />
    </div>
  );
};
