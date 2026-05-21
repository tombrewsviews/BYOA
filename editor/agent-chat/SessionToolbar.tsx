import React from "react";

interface Props {
  // agentLabel + cwd are kept in the contract (callers still pass them) but
  // are no longer shown here: the agent name now lives on the Chat toggle
  // label, and the project path lives in the editor header. The toolbar is
  // just the "Clear" affordance now.
  agentLabel: string;
  cwd: string;
  onEndSession: () => void;
  sessionAlive: boolean;
}

export const SessionToolbar: React.FC<Props> = ({ onEndSession, sessionAlive }) => {
  if (!sessionAlive) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        padding: "6px 10px",
        borderBottom: "1px solid #2a2a36",
        background: "#0e0e16",
      }}
    >
      <button
        onClick={onEndSession}
        style={{
          padding: "3px 8px",
          borderRadius: 4,
          border: "1px solid #3a3a48",
          background: "transparent",
          color: "#cdcdd8",
          cursor: "pointer",
          fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
          fontSize: 12,
        }}
      >
        Clear
      </button>
    </div>
  );
};
