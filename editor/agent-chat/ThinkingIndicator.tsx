import React from "react";

/**
 * "Thinking" loader shown while a turn is running but hasn't produced its
 * next visible output yet — the gap after send / between a tool call and
 * the agent's next message. Three dots that fade in sequence.
 *
 * Keyframes are injected locally (the codebase has no global stylesheet
 * for agent-chat; see the same pattern in AddVideo.tsx).
 */
export const ThinkingIndicator: React.FC = () => (
  <div
    role="status"
    aria-label="Agent is thinking"
    style={{
      display: "flex",
      alignItems: "center",
      gap: 5,
      padding: "12px 0",
    }}
  >
    <style>{`
      @keyframes agentchat-thinking {
        0%, 80%, 100% { opacity: 0.2; }
        40%           { opacity: 1; }
      }
    `}</style>
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#7c5cff",
          animation: "agentchat-thinking 1.2s ease-in-out infinite",
          animationDelay: `${i * 0.16}s`,
        }}
      />
    ))}
  </div>
);
