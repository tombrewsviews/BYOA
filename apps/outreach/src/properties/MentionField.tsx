import React from "react";
import type { Actor } from "../board/api";
import { fuzzyScore } from "./fuzzy";

/**
 * A note textarea with @-mention autocomplete. Typing `@` followed by letters
 * opens a dropdown of matching board users (fuzzy-ranked by label); picking one
 * replaces the `@partial` with `@Full Name ` so the backend's mention parser
 * (which matches `@<label>`) resolves it. Keyboard: ↑/↓ move, Enter/Tab pick,
 * Esc dismiss the dropdown.
 *
 * Controlled: `value`/`onChange` own the text; the mention state is internal.
 */

/** Find an active `@mention` token ending at the caret: the `@` and the word
 *  chars (letters, digits, spaces run — labels can have spaces) after it, with
 *  no intervening newline. Returns the token's start index and the query (text
 *  after `@`), or null when the caret isn't in a mention. */
function activeMention(text: string, caret: number): { start: number; query: string } | null {
  // Walk back from the caret to the nearest `@`, stopping at a newline (a
  // mention doesn't span lines). Allow spaces so "@Ada Lo" is one query.
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === "@") {
      const query = text.slice(i + 1, caret);
      // A query with a newline isn't a mention; also cap length so a stray `@`
      // far up the note doesn't turn the whole paragraph into a query.
      if (query.includes("\n") || query.length > 40) return null;
      return { start: i, query };
    }
    if (ch === "\n") return null;
    i -= 1;
  }
  return null;
}

export const MentionField: React.FC<{
  value: string;
  onChange: (v: string) => void;
  actors: Actor[];
  placeholder?: string;
  onSubmit?: () => void;
}> = ({ value, onChange, actors, placeholder, onSubmit }) => {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = React.useState(0);
  const [active, setActive] = React.useState(0);
  const [open, setOpen] = React.useState(false);

  const mention = open ? activeMention(value, caret) : null;

  const matches = React.useMemo(() => {
    if (!mention) return [];
    const q = mention.query.trim();
    const scored = actors
      .map((a) => ({ a, s: q ? fuzzyScore(q, a.label) : 0 }))
      .filter((r) => r.s >= 0)
      .sort((x, y) => y.s - x.s)
      .map((r) => r.a);
    return scored.slice(0, 8);
  }, [mention, actors]);

  const showMenu = open && mention !== null && matches.length > 0;

  React.useEffect(() => {
    setActive(0);
  }, [mention?.query]);

  const pick = (actor: Actor) => {
    if (!mention) return;
    const before = value.slice(0, mention.start);
    const after = value.slice(caret);
    const next = `${before}@${actor.label} ${after}`;
    onChange(next);
    setOpen(false);
    // Restore focus + caret just past the inserted mention.
    const newCaret = before.length + actor.label.length + 2; // "@" + label + " "
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(newCaret, newCaret);
        setCaret(newCaret);
      }
    });
  };

  const syncCaret = () => {
    const el = ref.current;
    if (!el) return;
    const c = el.selectionStart ?? 0;
    setCaret(c);
    // Opening/closing follows the caret: if it sits inside an @-token, show the
    // menu (so clicking into an existing mention re-opens it); otherwise hide it.
    setOpen(activeMention(el.value, c) !== null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMenu) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, matches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[active]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }
    // Cmd/Ctrl+Enter submits (matches the old NoteComposer shortcut).
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        className="min-h-[52px] w-full rounded-md border border-input bg-transparent p-2 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          // caret moves with the change; read it after React applies the value
          requestAnimationFrame(syncCaret);
        }}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Delay so a click on a menu row is handled before the menu unmounts.
          setTimeout(() => setOpen(false), 120);
        }}
      />
      {showMenu ? (
        <div className="absolute z-30 mt-1 max-h-56 w-64 overflow-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md">
          {matches.map((a, i) => (
            <button
              key={a.id}
              type="button"
              className={`block w-full truncate px-3 py-1.5 text-left text-sm ${
                i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent"
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(a)}
            >
              @{a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
