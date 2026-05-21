import React from "react";
import ReactMarkdown from "react-markdown";

interface Props {
  text: string;
  streaming: boolean;
}

export const Message: React.FC<Props> = ({ text, streaming }) => (
  <div className="max-w-[70ch] py-2.5 text-[15px] leading-relaxed text-foreground">
    <ReactMarkdown
      components={{
        code(props) {
          const { children, className } = props;
          const isBlock = className && className.startsWith("language-");
          if (isBlock) {
            return (
              <pre className="my-2 overflow-auto rounded-md border border-border bg-card p-2.5 text-[13px]">
                <code>{children}</code>
              </pre>
            );
          }
          return (
            <code className="rounded-sm bg-secondary px-1 py-px font-mono text-[13px]">
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
              className="text-foreground underline underline-offset-2"
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
          className="ml-[3px] inline-block h-3.5 w-2 align-text-bottom bg-foreground"
          style={{ animation: "agentchat-pulse 1s steps(2) infinite" }}
        />
      </>
    ) : null}
  </div>
);
