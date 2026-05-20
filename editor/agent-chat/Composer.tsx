import React, { useEffect, useState } from "react";
import {
  type PermissionMode,
  PERMISSION_MODES,
} from "./adapters/types";

interface Props {
  disabled: boolean;
  onSubmit: (text: string, attachments: string[]) => void;
  onStop: () => void;
  running: boolean;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
}

export const Composer: React.FC<Props> = ({
  disabled,
  onSubmit,
  onStop,
  running,
  permissionMode,
  onPermissionModeChange,
}) => {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [dropActive, setDropActive] = useState(false);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let aborted = false;

    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const webview = getCurrentWebview();
        const unlisten = await webview.onDragDropEvent((event) => {
          // Tauri v2 payload types: "enter" | "over" | "drop" | "leave".
          const t = (event.payload as { type: string }).type;
          if (t === "enter" || t === "over") {
            setDropActive(true);
          } else if (t === "leave") {
            setDropActive(false);
          } else if (t === "drop") {
            setDropActive(false);
            const paths = (event.payload as { paths?: string[] }).paths ?? [];
            if (paths.length) {
              setAttachments((prev) => [...prev, ...paths]);
            }
          }
        });
        if (aborted) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      } catch {
        /* not in Tauri context — browser DnD fallback remains active */
      }
    })();

    return () => {
      aborted = true;
      unlistenFn?.();
    };
  }, []);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed, attachments);
    setText("");
    setAttachments([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDropActive(false);
    const paths: string[] = [];
    for (const f of Array.from(e.dataTransfer.files)) {
      // Browser fallback path; under Tauri the webview drag-drop event
      // above handles it (e.dataTransfer.files is empty there).
      const anyFile = f as File & { path?: string };
      paths.push(anyFile.path ?? f.name);
    }
    if (paths.length) {
      setAttachments((prev) => [...prev, ...paths]);
    }
  };

  const openFilePicker = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: true });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      if (paths.length) setAttachments((prev) => [...prev, ...paths]);
    } catch {
      /* not in Tauri context — Attach button is a no-op in browser dev */
    }
  };

  const removeAttachment = (idx: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== idx));

  const canSend = !disabled && text.trim().length > 0;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
      style={{
        padding: 10,
        borderTop: "1px solid #2a2a36",
        background: dropActive ? "#1a1a25" : "transparent",
      }}
    >
      {attachments.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 6,
          }}
        >
          {attachments.map((p, i) => (
            <span
              key={`${p}-${i}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                background: "#1c1c26",
                color: "#cdcdd8",
              }}
            >
              @{p}
              <button
                onClick={() => removeAttachment(i)}
                aria-label={`Remove ${p}`}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  color: "#7a7a88",
                  fontSize: 12,
                  lineHeight: 1,
                  padding: "0 2px",
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={
          disabled ? "Waiting for agent…" : "Message your agent (Enter to send)"
        }
        rows={3}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#13131a",
          border: "1px solid #2a2a36",
          borderRadius: 8,
          color: "#e4e4ee",
          fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
          fontSize: 14,
          padding: 8,
          resize: "vertical",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 6,
        }}
      >
        <button
          onClick={() => void openFilePicker()}
          title="Attach files"
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #2a2a36",
            background: "transparent",
            color: "#cdcdd8",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Attach
        </button>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
            fontSize: 12,
            color: "#a4a4b4",
          }}
        >
          <span>Mode</span>
          <select
            value={permissionMode}
            onChange={(e) =>
              onPermissionModeChange(e.target.value as PermissionMode)
            }
            title="What the agent is allowed to do this turn"
            style={{
              background: "#13131a",
              border: "1px solid #2a2a36",
              borderRadius: 6,
              color: "#e4e4ee",
              fontSize: 12,
              padding: "4px 6px",
              cursor: "pointer",
            }}
          >
            {PERMISSION_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label} — {m.hint}
              </option>
            ))}
          </select>
        </label>

        <div style={{ flex: 1 }} />

        {running ? (
          <button
            onClick={onStop}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #ef4444",
              background: "transparent",
              color: "#ef4444",
              cursor: "pointer",
            }}
          >
            Stop
          </button>
        ) : null}
        <button
          onClick={submit}
          disabled={!canSend}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "none",
            background: canSend ? "#7c5cff" : "#3a3a48",
            color: "#fff",
            cursor: canSend ? "pointer" : "not-allowed",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};
