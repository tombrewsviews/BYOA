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
import { radius, formatBytes } from "./theme";
import { type AppManifest } from "./apps";
import { startInstall, useInstallState } from "./install";
import { Button } from "@/components/ui/button";
import { X, Star, ChevronUp, ChevronDown } from "../icons";

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
  <div className="flex items-baseline justify-between py-1 text-xs">
    <span className="text-muted-foreground">{k}</span>
    <span className="tabular-nums text-foreground">{v}</span>
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
        className="flex w-full items-center justify-between py-2 text-xs font-bold text-foreground"
      >
        <span>{title}</span>
        <span className="text-muted-foreground">
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </span>
      </button>
      {open && <div className="pb-2">{children}</div>}
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
      <Button disabled className="w-full">
        Coming soon
      </Button>
    );
  }
  if (rec.state === "installed") {
    return (
      <Button onClick={onOpen} className="w-full">
        Open {app.name}
      </Button>
    );
  }
  if (rec.state === "installing") {
    const pct = Math.round(rec.progress * 100);
    return (
      <div className="relative w-full overflow-hidden rounded-md border border-border bg-secondary px-3.5 py-2.5 text-center text-[13px] font-bold text-foreground">
        <div
          className="absolute bottom-0 left-0 h-0.5 bg-foreground transition-[width] duration-75"
          style={{ width: `${pct}%` }}
        />
        Installing… {pct}%
      </div>
    );
  }
  if (rec.state === "failed") {
    return (
      <Button
        variant="secondary"
        onClick={() => startInstall(app.id)}
        className="w-full"
      >
        Retry install
      </Button>
    );
  }
  return (
    <Button onClick={() => startInstall(app.id)} className="w-full">
      Install · {formatBytes(app.sizeBytes)}
    </Button>
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
    <div className="flex w-[360px] flex-none flex-col overflow-y-auto border-l border-border bg-card">
      <div className="flex items-center px-4 pb-2 pt-3.5">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          App
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close"
        >
          <X />
        </Button>
      </div>

      <div className="flex items-center gap-3 px-4 pb-4">
        <div
          aria-hidden
          className="flex size-10 items-center justify-center text-lg font-extrabold text-white/60"
          style={{
            background: `hsl(${app.hue}, 70%, 38%)`,
            borderRadius: radius.lg,
          }}
        >
          {app.name.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-foreground">{app.name}</div>
          <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
            app.{app.id}.v{app.version}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleFavorite}
          aria-label={favorite ? "Unfavorite" : "Favorite"}
          className={favorite ? "text-foreground" : "text-muted-foreground"}
        >
          <Star className={favorite ? "fill-current" : ""} />
        </Button>
      </div>

      <div className="flex-1 px-4 pb-4">
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

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {app.description}
        </p>
      </div>

      <div className="border-t border-border p-4">
        <CTA app={app} onOpen={onOpen} />
      </div>
    </div>
  );
};
