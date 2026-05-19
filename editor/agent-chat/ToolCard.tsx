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
  const badgeColor =
    status === "running" ? "#7c5cff" : status === "ok" ? "#22c55e" : "#ef4444";

  return (
    <div
      style={{
        border: "1px solid #2a2a36",
        borderRadius: 8,
        padding: "8px 10px",
        margin: "8px 0",
        fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
        fontSize: 13,
        color: "#cdcdd8",
        background: "#13131a",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          gap: 8,
          width: "100%",
          alignItems: "center",
        }}
      >
        <span style={{ color: badgeColor, fontWeight: 600 }}>{badge}</span>
        <span style={{ fontWeight: 600 }}>{call.name}</span>
        {sub ? (
          <span
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 12,
              opacity: 0.8,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              minWidth: 0,
            }}
          >
            {sub}
          </span>
        ) : null}
        <span style={{ opacity: 0.55 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <pre
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            background: "#0a0a10",
            padding: 8,
            borderRadius: 6,
            overflow: "auto",
            maxHeight: 240,
          }}
        >
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
