import React from "react";

interface Props {
  text: string;
  streaming: boolean;
}

export const Message: React.FC<Props> = ({ text, streaming }) => (
  <div
    style={{
      maxWidth: "70ch",
      fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
      fontSize: 15,
      lineHeight: 1.55,
      color: "#e4e4ee",
      whiteSpace: "pre-wrap",
      padding: "10px 0",
    }}
  >
    {text}
    {streaming ? (
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 8,
          height: 14,
          background: "#7c5cff",
          marginLeft: 3,
          verticalAlign: "text-bottom",
          animation: "agentchat-pulse 1s steps(2) infinite",
        }}
      />
    ) : null}
  </div>
);
