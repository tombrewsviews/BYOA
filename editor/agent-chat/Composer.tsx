import React, { useState } from "react";

interface Props {
  disabled: boolean;
  onSubmit: (text: string, attachments: string[]) => void;
  onStop: () => void;
  running: boolean;
}

export const Composer: React.FC<Props> = ({
  disabled,
  onSubmit,
  onStop,
  running,
}) => {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [dropActive, setDropActive] = useState(false);

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
      // Tauri exposes the absolute path on dropped files via the
      // non-standard `path` property. Browser fallback: just the name.
      const anyFile = f as File & { path?: string };
      paths.push(anyFile.path ?? f.name);
    }
    if (paths.length) {
      setAttachments((prev) => [...prev, ...paths]);
    }
  };

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
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 6,
        }}
      >
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
