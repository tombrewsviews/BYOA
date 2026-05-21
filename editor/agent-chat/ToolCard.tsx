import React, { useState } from "react";
import type { ToolCallRecord } from "./ChatStore";

interface Props {
  call: ToolCallRecord;
}

const summary = (call: ToolCallRecord): string => {
  const a = call.input;
  if (a && typeof a === "object") {
    const r = a as Record<string, unknown>;
    if (typeof r.file_path === "string") return String(r.file_path);
    if (typeof r.command === "string") return String(r.command);
    if (typeof r.url === "string") return String(r.url);
  }
  return "";
};

export const ToolCard: React.FC<Props> = ({ call }) => {
  const [open, setOpen] = useState(false);
  const sub = summary(call);
  const status = call.result == null ? "running" : call.result.ok ? "ok" : "err";
  const badge =
    status === "running" ? "…" : status === "ok" ? "✓" : "✗";
  // Status hue: running stays neutral (grey), success/error keep their
  // conventional green/red since they carry meaning, not decoration.
  const badgeClass =
    status === "running"
      ? "text-muted-foreground"
      : status === "ok"
        ? "text-green-500"
        : "text-destructive";

  return (
    <div className="my-2 rounded-md border border-border bg-card px-2.5 py-2 text-[13px] text-muted-foreground">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className={`font-semibold ${badgeClass}`}>{badge}</span>
        <span className="font-semibold text-foreground">{call.name}</span>
        {sub ? (
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs opacity-80">
            {sub}
          </span>
        ) : null}
        <span className="opacity-55">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-background p-2 text-xs">
{JSON.stringify(
              { input: call.input, result: call.result },
              null,
              2,
            )}
        </pre>
      ) : null}
    </div>
  );
};
