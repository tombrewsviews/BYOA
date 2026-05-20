import React, { useEffect } from "react";
import type { PendingPermission } from "./ChatStore";

export type Decision = "allow" | "allow-always" | "deny";

interface Props {
  pending: PendingPermission;
  onDecide: (promptId: string, decision: Decision) => void;
}

// v1 coverage: handles Write/Edit (file_path), Bash (command), WebFetch
// (url). Tools with other arg shapes (Glob, Grep, TodoWrite…) fall back
// to the tool name, which is acceptable for v1 but a latent UX gap to
// improve later.
const summarize = (tool: string, args: unknown): string => {
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    if (typeof a.file_path === "string") return String(a.file_path);
    if (typeof a.command === "string") return String(a.command);
    if (typeof a.url === "string") return String(a.url);
  }
  return tool;
};

export const PermissionDialog: React.FC<Props> = ({ pending, onDecide }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDecide(pending.promptId, "deny");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending.promptId, onDecide]);

  const summary = summarize(pending.tool, pending.args);

  return (
    <div
      role="dialog"
      aria-label={`Permission request: ${pending.tool}`}
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 80, // assumes parent is position:relative with ≥80px composer below
        background: "#15151c",
        border: "1px solid #2a2a36",
        borderRadius: 10,
        padding: 16,
        fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
        color: "#e4e4ee",
        boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          opacity: 0.6,
          marginBottom: 6,
        }}
      >
        Permission required · {pending.scope}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
        {pending.tool}
      </div>
      <div
        style={{
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: 12,
          opacity: 0.85,
          marginBottom: 14,
          wordBreak: "break-all",
        }}
      >
        {summary}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={() => onDecide(pending.promptId, "deny")}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #3a3a48",
            background: "transparent",
            color: "#e4e4ee",
            cursor: "pointer",
          }}
        >
          Deny
        </button>
        <button
          onClick={() => onDecide(pending.promptId, "allow")}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #4a4a58",
            background: "#2a2a36",
            color: "#e4e4ee",
            cursor: "pointer",
          }}
        >
          Allow once
        </button>
        <button
          onClick={() => onDecide(pending.promptId, "allow-always")}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            background: "#7c5cff",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Allow always
        </button>
      </div>
    </div>
  );
};
