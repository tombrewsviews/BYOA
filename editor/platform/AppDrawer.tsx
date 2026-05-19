/**
 * The Square's right detail drawer.
 *
 * Renders an app's full identity, bundle stats, optional skills, and
 * optional runtime hints, plus the same install/open CTA as the row.
 * Visible only when the user has clicked an app's icon or row body.
 * Closes on × button, Esc, or by clicking the active row again
 * (handled in the parent).
 */
import React, { useEffect, useState } from "react";
import {
  color,
  font,
  radius,
  space,
  primaryBtn,
  secondaryBtn,
  ghostBtn,
  formatBytes,
} from "./theme";
import { type AppManifest } from "./apps";
import { startInstall, useInstallState } from "./install";

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const formatLoc = (n: number): string => {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const KV: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      padding: "4px 0",
      fontSize: font.size.md,
    }}
  >
    <span style={{ color: color.text.muted }}>{k}</span>
    <span
      style={{
        color: color.text.primary,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {v}
    </span>
  </div>
);

const Section: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "transparent",
          border: 0,
          color: color.text.primary,
          fontFamily: font.family,
          fontSize: font.size.md,
          fontWeight: 700,
          padding: "8px 0",
          cursor: "pointer",
        }}
      >
        <span>{title}</span>
        <span style={{ color: color.text.dim, fontSize: font.size.sm }}>
          {open ? "⌃" : "⌄"}
        </span>
      </button>
      {open && <div style={{ paddingBottom: space.s8 }}>{children}</div>}
    </div>
  );
};

const CTA: React.FC<{
  app: AppManifest;
  onOpen: () => void;
}> = ({ app, onOpen }) => {
  const rec = useInstallState(app.id);
  if (app.status === "coming-soon") {
    return (
      <button disabled style={{ ...primaryBtn({ disabled: true }), width: "100%" }}>
        Coming soon
      </button>
    );
  }
  if (rec.state === "installed") {
    return (
      <button onClick={onOpen} style={{ ...primaryBtn(), width: "100%" }}>
        Open {app.name}
      </button>
    );
  }
  if (rec.state === "installing") {
    const pct = Math.round(rec.progress * 100);
    return (
      <div
        style={{
          width: "100%",
          background: color.bg.selected,
          border: `1px solid ${color.border.strong}`,
          borderRadius: radius.md,
          padding: "10px 14px",
          fontSize: font.size.base,
          fontWeight: 700,
          color: color.text.primary,
          position: "relative",
          overflow: "hidden",
          textAlign: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: 2,
            width: `${pct}%`,
            background: color.accent.fg,
            transition: "width 60ms linear",
          }}
        />
        Installing… {pct}%
      </div>
    );
  }
  if (rec.state === "failed") {
    return (
      <button
        onClick={() => startInstall(app.id)}
        style={{ ...secondaryBtn(), width: "100%" }}
      >
        Retry install
      </button>
    );
  }
  return (
    <button
      onClick={() => startInstall(app.id)}
      style={{ ...primaryBtn(), width: "100%" }}
    >
      Install · {formatBytes(app.sizeBytes)}
    </button>
  );
};

export const AppDrawer: React.FC<{
  app: AppManifest;
  favorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
  onOpen: () => void;
}> = ({ app, favorite, onToggleFavorite, onClose, onOpen }) => {
  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      style={{
        width: 360,
        flex: "0 0 360px",
        background: color.bg.surface,
        borderLeft: `1px solid ${color.border.line}`,
        display: "flex",
        flexDirection: "column",
        fontFamily: font.family,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "14px 16px 8px",
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: font.size.xs,
            fontWeight: 600,
            color: color.text.dim,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          App
        </span>
        <button onClick={onClose} aria-label="Close" style={ghostBtn()}>
          ×
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 16px 16px",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 40,
            height: 40,
            background: `hsl(${app.hue}, 70%, 38%)`,
            borderRadius: radius.lg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,0.6)",
            fontSize: font.size.xl,
            fontWeight: 800,
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
              fontSize: font.size.sm,
              color: color.text.dim,
              marginTop: 2,
              letterSpacing: 0.2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            app.{app.id}.v{app.version}
          </div>
        </div>
        <button
          onClick={onToggleFavorite}
          aria-label={favorite ? "Unfavorite" : "Favorite"}
          style={{
            ...ghostBtn(),
            color: favorite ? color.text.primary : color.text.faint,
            fontSize: font.size.lg,
          }}
        >
          ★
        </button>
      </div>

      <div style={{ padding: "0 16px 16px", flex: 1 }}>
        <Section title="Identity">
          <KV k="Name" v={app.name} />
          <KV k="Author" v={app.creator} />
          <KV k="Version" v={app.version} />
        </Section>

        <Section title="Bundle">
          <KV k="Tokens" v={formatTokens(app.tokens)} />
          <KV k="Files" v={String(app.files)} />
          <KV k="Lines" v={formatLoc(app.loc)} />
          <KV k="Size" v={formatBytes(app.sizeBytes)} />
        </Section>

        {app.skills && app.skills.length > 0 && (
          <Section title="Skills">
            {app.skills.map((s) => (
              <KV key={s.name} k={s.name} v={s.on ? "on" : "off"} />
            ))}
          </Section>
        )}

        {app.runtime && (
          <Section title="Runtime">
            <KV k="Model" v={app.runtime.model} />
            <KV k="Context" v={app.runtime.context} />
            <KV k="Effort" v={app.runtime.effort} />
          </Section>
        )}

        <p
          style={{
            fontSize: font.size.md,
            color: color.text.secondary,
            lineHeight: 1.6,
            margin: "12px 0 0",
          }}
        >
          {app.description}
        </p>
      </div>

      <div style={{ padding: 16, borderTop: `1px solid ${color.border.faint}` }}>
        <CTA app={app} onOpen={onOpen} />
      </div>
    </div>
  );
};
