import React, { useState } from "react";
import type { LeadDetail } from "../board/api";
import type { Stage } from "../board/types";
import { Copy, Check, Paperclip } from "../icons";

interface InspectorProps {
  lead: LeadDetail | null;
  stages: Stage[];
  onChangeStage: (toStage: string) => void;
  onAddNote: (note: string) => void;
  onAttach: () => void;
  onRevealAttachment: (path: string) => void;
}

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </div>
);

/** Fields whose values are worth a one-click copy (contact handles). */
const COPYABLE = /email|e-mail|linkedin|phone|mobile|tel|whatsapp|handle|url|website|twitter|x\b/i;
/** Fields that are our own structured markers, rendered specially, not as text. */
const NOTE_KEY = "note";
const PRESENTATION_KEY = "presentation";

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const humanize = (key: string): string =>
  key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (c) => c.toUpperCase());

const CopyButton: React.FC<{ value: string }> = ({ value }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — no-op */
    }
  };
  return (
    <button
      onClick={copy}
      title="Copy"
      className="flex-none rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
};

/** One key/value row from a fact object. Copyable fields get a copy button. */
const FieldRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const copyable = COPYABLE.test(label);
  return (
    <div className="flex items-start gap-2 py-0.5">
      <div className="w-24 flex-none text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 break-words text-sm text-foreground">{value}</div>
      {copyable ? <CopyButton value={value} /> : null}
    </div>
  );
};

/** Render a single context fact. Objects become field rows; notes and
 *  presentations get their own affordances; anything else prints as text. */
const Fact: React.FC<{
  fact: unknown;
  onRevealAttachment: (path: string) => void;
}> = ({ fact, onRevealAttachment }) => {
  if (isObject(fact)) {
    // A note marker: { note: "..." }
    if (typeof fact[NOTE_KEY] === "string" && Object.keys(fact).length <= 2) {
      return (
        <div className="rounded-md border border-border bg-muted/40 p-2 text-sm text-foreground">
          {String(fact[NOTE_KEY])}
        </div>
      );
    }
    // A presentation attachment: { presentation: { name, path } }
    const pres = fact[PRESENTATION_KEY];
    if (isObject(pres) && typeof pres.path === "string") {
      const name = typeof pres.name === "string" ? pres.name : "Attachment";
      return (
        <button
          onClick={() => onRevealAttachment(String(pres.path))}
          className="flex items-center gap-2 rounded-md border border-border p-2 text-left text-sm text-foreground hover:bg-accent"
        >
          <Paperclip className="size-3.5 flex-none text-muted-foreground" />
          <span className="truncate">{name}</span>
        </button>
      );
    }
    // Generic object → field rows.
    return (
      <div className="rounded-md border border-border p-2">
        {Object.entries(fact).map(([k, v]) => (
          <FieldRow key={k} label={humanize(k)} value={typeof v === "string" ? v : JSON.stringify(v)} />
        ))}
      </div>
    );
  }
  return <div className="text-sm text-foreground">{String(fact)}</div>;
};

const StageSelect: React.FC<{
  stages: Stage[];
  value: string;
  onChange: (toStage: string) => void;
}> = ({ stages, value, onChange }) => {
  const ordered = [...stages]
    .filter((s) => s.retiredAt === null)
    .sort((a, b) => a.position - b.position);
  return (
    <select
      className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
      value={value}
      onChange={(e) => {
        if (e.target.value !== value) onChange(e.target.value);
      }}
    >
      {ordered.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
      {ordered.some((s) => s.id === value) ? null : <option value={value}>{value}</option>}
    </select>
  );
};

const NoteComposer: React.FC<{ onAdd: (note: string) => void }> = ({ onAdd }) => {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
  };
  return (
    <div className="flex flex-col gap-1">
      <textarea
        className="min-h-[52px] rounded-md border border-input bg-transparent p-2 text-sm"
        placeholder="Add a note…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <div className="flex justify-end">
        <button
          className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
          disabled={!text.trim()}
          onClick={submit}
        >
          Add note
        </button>
      </div>
    </div>
  );
};

export const Inspector: React.FC<InspectorProps> = ({
  lead,
  stages,
  onChangeStage,
  onAddNote,
  onAttach,
  onRevealAttachment,
}) => {
  if (lead === null) {
    return <div className="p-4 text-sm text-muted-foreground">Select a lead to inspect it.</div>;
  }

  const facts = Array.isArray(lead.context?.facts) ? lead.context.facts : [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="text-base font-semibold text-foreground">{lead.name}</div>
        {lead.org ? <div className="text-sm text-muted-foreground">{lead.org}</div> : null}
      </div>

      <div className="flex flex-col gap-1">
        <SectionLabel>Stage</SectionLabel>
        <StageSelect stages={stages} value={lead.stage} onChange={onChangeStage} />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Details &amp; context</SectionLabel>
        {facts.length === 0 ? (
          <div className="text-sm text-muted-foreground">No context yet.</div>
        ) : (
          facts.map((fact, i) => (
            <Fact key={i} fact={fact} onRevealAttachment={onRevealAttachment} />
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Notes</SectionLabel>
        <NoteComposer onAdd={onAddNote} />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Attachments</SectionLabel>
        <button
          onClick={onAttach}
          className="flex items-center gap-2 self-start rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
        >
          <Paperclip className="size-4" />
          Attach presentation
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <SectionLabel>Messages</SectionLabel>
        {lead.messages.length === 0 ? (
          <div className="text-sm text-muted-foreground">No drafted messages.</div>
        ) : (
          lead.messages.map((msg, i) => (
            <div key={i} className="text-sm text-foreground">
              {typeof msg === "string" ? msg : JSON.stringify(msg)}
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
