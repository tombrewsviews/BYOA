import React from "react";

interface Props {
  agentLabel: string;
  cwd: string;
  onSwitchToTerminal: () => void;
  onEndSession: () => void;
  sessionAlive: boolean;
}

export const SessionToolbar: React.FC<Props> = ({
  agentLabel,
  cwd,
  onSwitchToTerminal,
  onEndSession,
  sessionAlive,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "6px 10px",
      borderBottom: "1px solid #2a2a36",
      fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
      fontSize: 12,
      color: "#a4a4b4",
      background: "#0e0e16",
    }}
  >
    <span style={{ fontWeight: 600, color: "#e4e4ee" }}>{agentLabel}</span>
    <span
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        opacity: 0.7,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: 1,
        minWidth: 0,
      }}
      title={cwd}
    >
      {cwd}
    </span>
    {sessionAlive ? (
      <button
        onClick={onEndSession}
        style={{
          padding: "3px 8px",
          borderRadius: 4,
          border: "1px solid #3a3a48",
          background: "transparent",
          color: "#cdcdd8",
          cursor: "pointer",
        }}
      >
        End
      </button>
    ) : null}
    <button
      onClick={onSwitchToTerminal}
      style={{
        padding: "3px 8px",
        borderRadius: 4,
        border: "1px solid #3a3a48",
        background: "transparent",
        color: "#cdcdd8",
        cursor: "pointer",
      }}
    >
      Terminal
    </button>
  </div>
);
