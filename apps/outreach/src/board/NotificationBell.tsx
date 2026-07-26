import React from "react";
import { Bell, CheckCheck } from "../icons";
import { notifications, markNotificationsRead } from "./api";
import type { Notification } from "./api";

/**
 * The notification bell for the board window header. Polls the signed-in user's
 * notifications, shows a red dot when any are unread, and lists them (newest
 * first) in a dropdown. Clicking a notification opens its lead in the main
 * window's Inspector (via `board_select_lead`) and marks everything read.
 * "Mark all read" clears the dot without opening anything.
 *
 * Poll cadence adapts to the board mode the same way the main poll does — a
 * remote (shared) board is polled rarely so the bell doesn't hammer Neon.
 */

const KIND_LABEL: Record<Notification["kind"], string> = {
  mention: "Mention",
  stage: "Stage",
  note: "Note",
  lead_added: "New lead",
};

/** Best-effort relative time ("3m", "2h", "1d") from an ISO timestamp. */
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export const NotificationBell: React.FC = () => {
  const [items, setItems] = React.useState<Notification[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Poll notifications on a self-scheduling timer (interval fixed at 4s — the
  // command is one round-trip and only the recipient's own rows are read).
  React.useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stopped) return;
      try {
        const n = await notifications();
        if (!stopped) {
          setItems(n.items);
          setUnread(n.unread);
        }
      } catch {
        /* transient (still connecting) — retry next tick */
      } finally {
        if (!stopped) timer = setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const markRead = async () => {
    setUnread(0);
    setItems((prev) => prev.map((it) => ({ ...it, read: true })));
    await markNotificationsRead().catch(() => {});
  };

  const openLead = async (leadId: string | null) => {
    setOpen(false);
    if (leadId) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("board_select_lead", { id: leadId }).catch(() => {});
    }
    // Opening any notification marks the feed read (matches "click to view").
    await markRead();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        className="relative flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-destructive ring-2 ring-background" />
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-1 w-80 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            <button
              onClick={markRead}
              disabled={unread === 0}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              title="Mark all as read"
            >
              <CheckCheck className="size-3.5" />
              Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-auto py-1">
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No notifications yet.
              </div>
            ) : (
              items.map((it) => (
                <button
                  key={it.seq}
                  onClick={() => void openLead(it.leadId)}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent ${
                    it.read ? "" : "bg-accent/40"
                  }`}
                >
                  {it.read ? (
                    <span className="mt-1.5 size-2 flex-none" />
                  ) : (
                    <span className="mt-1.5 size-2 flex-none rounded-full bg-primary" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{it.body}</span>
                    <span className="text-xs text-muted-foreground">
                      {KIND_LABEL[it.kind]} · {ago(it.createdAt)} ago
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
