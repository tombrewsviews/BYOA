import React from "react";
import type { AgentQuestion } from "./events";

interface Props {
  questions: AgentQuestion[];
  /** Called with the composed answer text when the user picks option(s). */
  onAnswer: (answer: string) => void;
  disabled: boolean;
}

/**
 * Renders an agent AskUserQuestion as clickable option buttons. v1 handles
 * the common single-question / single-select case: clicking an option
 * immediately answers. (multiSelect is rendered the same way for now —
 * each click answers with that one option; refine if multi-select prompts
 * become common.)
 */
export const QuestionCard: React.FC<Props> = ({
  questions,
  onAnswer,
  disabled,
}) => {
  const answer = (q: AgentQuestion, label: string) => {
    if (disabled) return;
    // Compose a natural answer the resumed agent will understand.
    const prefix = q.header ? `${q.header}: ` : "";
    onAnswer(`${prefix}${label}`);
  };

  return (
    <div
      style={{
        border: "1px solid #2a2a36",
        borderRadius: 10,
        padding: 12,
        margin: "8px 0",
        background: "#13131a",
        fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
      }}
    >
      {questions.map((q, qi) => (
        <div key={qi} style={{ marginBottom: qi < questions.length - 1 ? 14 : 0 }}>
          {q.header ? (
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                opacity: 0.55,
                color: "#a4a4b4",
                marginBottom: 4,
              }}
            >
              {q.header}
            </div>
          ) : null}
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#e4e4ee",
              marginBottom: 8,
            }}
          >
            {q.question}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {q.options.map((o, oi) => (
              <button
                key={oi}
                onClick={() => answer(q, o.label)}
                disabled={disabled}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #2a2a36",
                  background: disabled ? "#1a1a22" : "#1c1c26",
                  color: "#e4e4ee",
                  cursor: disabled ? "not-allowed" : "pointer",
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 600 }}>{o.label}</div>
                {o.description ? (
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.7,
                      marginTop: 2,
                    }}
                  >
                    {o.description}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
