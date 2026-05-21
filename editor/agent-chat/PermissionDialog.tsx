import React, { useEffect } from "react";
import type { PendingPermission } from "./ChatStore";
import { Button } from "@/components/ui/button";

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
      className="absolute bottom-20 left-4 right-4 rounded-lg border border-border bg-popover p-4 text-foreground shadow-xl"
    >
      <div className="mb-1.5 text-xs uppercase tracking-wide opacity-60">
        Permission required · {pending.scope}
      </div>
      <div className="mb-1 text-[15px] font-semibold">{pending.tool}</div>
      <div className="mb-3.5 break-all font-mono text-xs opacity-85">
        {summary}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onDecide(pending.promptId, "deny")}
        >
          Deny
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onDecide(pending.promptId, "allow")}
        >
          Allow once
        </Button>
        <Button
          size="sm"
          onClick={() => onDecide(pending.promptId, "allow-always")}
        >
          Allow always
        </Button>
      </div>
    </div>
  );
};
