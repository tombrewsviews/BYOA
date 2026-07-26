import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { Kanban } from "./Kanban";
import {
  poll,
  moveLead,
  addLead,
  addStage,
  listStages,
  setLeadArchived,
  deleteLead,
  ensureConnected,
} from "./api";
import type { PollStatus, Notification, Snapshot } from "./api";
import type { Stage, Lead } from "./types";
import { loadSnapshot, saveSnapshot } from "./snapshotCache";

function BoardApp() {
  const [stages, setStages] = React.useState<Stage[]>([]);
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [status, setStatus] = React.useState<PollStatus>("loading");
  const [notifItems, setNotifItems] = React.useState<Notification[]>([]);
  const [notifUnread, setNotifUnread] = React.useState(0);
  // The active project path, needed to key the on-disk snapshot cache. Fetched
  // once on mount (a fast local command).
  const projectPath = React.useRef<string | null>(null);

  // Ignore a poll result that's identical to what we already show, so the 5s
  // shared-board poll doesn't replace the arrays (new object identities) and
  // force every memoized card to re-render — that re-render was the scroll
  // stutter. Only genuinely-changed data updates state.
  const lastStagesJson = React.useRef("");
  const lastLeadsJson = React.useRef("");
  const lastNotifJson = React.useRef("");

  // Apply a snapshot (from the cache on open, or from the poll) to state,
  // de-duping each slice so nothing re-renders when it hasn't changed.
  const apply = React.useCallback((d: Snapshot) => {
    const sj = JSON.stringify(d.stages);
    if (sj !== lastStagesJson.current) {
      lastStagesJson.current = sj;
      setStages(d.stages);
    }
    const lj = JSON.stringify(d.leads);
    if (lj !== lastLeadsJson.current) {
      lastLeadsJson.current = lj;
      setLeads(d.leads);
    }
    const nj = JSON.stringify(d.notifications.items);
    if (nj !== lastNotifJson.current) {
      lastNotifJson.current = nj;
      setNotifItems(d.notifications.items);
    }
    setNotifUnread(d.notifications.unread);
  }, []);

  // Instant open: hydrate from the last on-disk snapshot BEFORE the first remote
  // read lands, so the board paints immediately from last-known data (the poll
  // then refreshes it). Fetch the project path first so the cache is per-board.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const path = await invoke<string>("active_project_path");
        if (cancelled) return;
        projectPath.current = path;
        const cached = loadSnapshot(path);
        if (cached) apply(cached);
      } catch {
        /* no project yet / not in Tauri — the poll will fill state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  React.useEffect(
    () =>
      poll((d) => {
        apply(d);
        // Persist the fresh snapshot as the read replica for next open.
        if (projectPath.current) saveSnapshot(projectPath.current, d);
      }, 1500, setStatus),
    [apply],
  );

  // Warm the (shared) board connection off the UI thread so the poll's board
  // commands don't have to connect synchronously — that remote connect is what
  // froze the whole app on open. Kick it off on mount, and re-try while we're
  // still not connected (a failed/slow warm-up, or the URL changing after open).
  React.useEffect(() => {
    if (status === "ok") return;
    void ensureConnected().catch(() => {/* poll keeps showing "Connecting…" */});
  }, [status]);

  // Selecting a card in this (board) window tells the main window to open the
  // Inspector on that lead. Routed through the backend (`board_select_lead`),
  // which emits to the main window explicitly — a webview-side `emit` does not
  // reliably cross windows.
  const onSelect = React.useCallback((id: string) => {
    setSelectedId(id);
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("board_select_lead", { id }).catch(() => {});
    })();
  }, []);

  const onMove = React.useCallback((id: string, to: string, version: number) => {
    // Optimistic: move the card in the UI immediately so the drag feels instant,
    // instead of waiting for the remote write + next poll (up to seconds on a
    // shared board). The write goes out in the background; the next poll
    // reconciles (and snaps back if it was rejected, e.g. a version conflict).
    setLeads((prev) => {
      const next = prev.map((l) =>
        l.id === id ? { ...l, stage: to, version: l.version + 1 } : l,
      );
      lastLeadsJson.current = JSON.stringify(next);
      return next;
    });
    void moveLead(id, to, version).catch(() => {/* conflict → next poll reconciles */});
  }, []);

  const onAddLead = React.useCallback((name: string, org: string | null, stage: string) => {
    void addLead(name, org, stage).catch(() => {});
  }, []);

  const onAddColumn = React.useCallback((label: string) => {
    void (async () => {
      const current = await listStages().catch(() => [] as Stage[]);
      const maxPos = current.reduce((m, s) => Math.max(m, s.position), -1);
      await addStage(label, maxPos + 1).catch(() => {});
    })();
  }, []);

  const onArchive = React.useCallback((id: string, archived: boolean) => {
    // Optimistic (same rationale as onMove): reflect archive/restore instantly.
    setLeads((prev) => {
      const next = prev.map((l) =>
        l.id === id ? { ...l, archivedAt: archived ? new Date().toISOString() : null } : l,
      );
      lastLeadsJson.current = JSON.stringify(next);
      return next;
    });
    void setLeadArchived(id, archived).catch(() => {});
  }, []);

  const onDelete = React.useCallback((id: string, name: string) => {
    // Native confirm — one guard against an accidental permanent delete.
    if (!window.confirm(`Delete "${name}"? This removes the card from the board.`)) return;
    // Optimistic: drop the card from the UI immediately.
    setLeads((prev) => {
      const next = prev.filter((l) => l.id !== id);
      lastLeadsJson.current = JSON.stringify(next);
      return next;
    });
    void deleteLead(id).catch(() => {});
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  // Before the board's first load succeeds, show progress instead of a blank
  // freeze — a shared (Postgres) board's first connect can take several seconds.
  const firstLoad = stages.length === 0;
  return (
    <>
      {firstLoad && status !== "ok" ? (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-2">
          <div className="rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
            {status === "error"
              ? "Can't reach the board — retrying…"
              : "Connecting to the board…"}
          </div>
        </div>
      ) : null}
      <Kanban
        stages={stages}
        leads={leads}
        onMove={onMove}
        onSelect={onSelect}
        onAddLead={onAddLead}
        onAddColumn={onAddColumn}
        onArchive={onArchive}
        onDelete={onDelete}
        selectedId={selectedId}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((v) => !v)}
        notifItems={notifItems}
        notifUnread={notifUnread}
      />
    </>
  );
}

createRoot(document.getElementById("board-root")!).render(
  <React.StrictMode><BoardApp /></React.StrictMode>,
);
