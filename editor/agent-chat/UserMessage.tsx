import React from "react";

interface Props {
  text: string;
}

export const UserMessage: React.FC<Props> = ({ text }) => (
  <div
    style={{
      maxWidth: "70ch",
      marginLeft: "auto",
      fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
      fontSize: 15,
      lineHeight: 1.55,
      color: "#e4e4ee",
      background: "#1c1c26",
      borderRadius: 10,
      padding: "8px 12px",
      whiteSpace: "pre-wrap",
    }}
  >
    {text}
  </div>
);
