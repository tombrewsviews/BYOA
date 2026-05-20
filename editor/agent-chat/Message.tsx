import React from "react";
import ReactMarkdown from "react-markdown";

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
      padding: "10px 0",
    }}
  >
    <ReactMarkdown
      components={{
        code(props) {
          const { children, className } = props;
          const isBlock = className && className.startsWith("language-");
          if (isBlock) {
            return (
              <pre
                style={{
                  background: "#13131a",
                  border: "1px solid #2a2a36",
                  borderRadius: 6,
                  padding: 10,
                  overflow: "auto",
                  fontSize: 13,
                  margin: "8px 0",
                }}
              >
                <code>{children}</code>
              </pre>
            );
          }
          return (
            <code
              style={{
                background: "#1c1c26",
                padding: "1px 4px",
                borderRadius: 3,
                fontSize: 13,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              }}
            >
              {children}
            </code>
          );
        },
        a(props) {
          return (
            <a
              href={props.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#7c5cff" }}
            >
              {props.children}
            </a>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
    {streaming ? (
      <>
        <style>{`
          @keyframes agentchat-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
        `}</style>
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
      </>
    ) : null}
  </div>
);
