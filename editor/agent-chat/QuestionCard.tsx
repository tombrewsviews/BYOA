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
    <div className="my-2 rounded-md border border-border bg-card p-3">
      {questions.map((q, qi) => (
        <div key={qi} className={qi < questions.length - 1 ? "mb-3.5" : ""}>
          {q.header ? (
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground opacity-90">
              {q.header}
            </div>
          ) : null}
          <div className="mb-2 text-sm font-semibold text-foreground">
            {q.question}
          </div>
          <div className="flex flex-col gap-1.5">
            {q.options.map((o, oi) => (
              <button
                key={oi}
                onClick={() => answer(q, o.label)}
                disabled={disabled}
                className="rounded-md border border-border bg-secondary px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="font-semibold">{o.label}</div>
                {o.description ? (
                  <div className="mt-0.5 text-xs opacity-70">
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
