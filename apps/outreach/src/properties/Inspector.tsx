import React from "react";
import type { LeadDetail } from "../board/api";

interface InspectorProps {
  lead: LeadDetail | null;
}

const renderValue = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-medium uppercase text-muted-foreground">{children}</div>
);

export const Inspector: React.FC<InspectorProps> = ({ lead }) => {
  if (lead === null) {
    return <div className="p-4 text-sm text-muted-foreground">Select a lead to inspect it.</div>;
  }

  const facts = lead.context.facts ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="text-sm font-medium text-foreground">{lead.name}</div>
        {lead.org ? <div className="text-xs text-muted-foreground">{lead.org}</div> : null}
      </div>

      <div className="flex flex-col gap-1">
        <SectionLabel>Context</SectionLabel>
        {facts.length === 0 ? (
          <div className="text-sm text-muted-foreground">No context yet.</div>
        ) : (
          facts.map((fact, i) => (
            <div key={i} className="text-sm text-foreground">
              {renderValue(fact)}
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-1">
        <SectionLabel>Messages</SectionLabel>
        {lead.messages.length === 0 ? (
          <div className="text-sm text-muted-foreground">No drafted messages.</div>
        ) : (
          lead.messages.map((msg, i) => (
            <div key={i} className="text-sm text-foreground">
              {renderValue(msg)}
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-1">
        <SectionLabel>Transcripts</SectionLabel>
        {lead.transcripts.length === 0 ? (
          <div className="text-sm text-muted-foreground">No transcripts.</div>
        ) : (
          lead.transcripts.map((t, i) => (
            <div key={i} className="text-sm text-foreground">
              {t.summary}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
