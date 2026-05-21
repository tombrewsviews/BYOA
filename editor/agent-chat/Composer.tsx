import React, { useEffect, useRef, useState } from "react";
import {
  type PermissionMode,
  PERMISSION_MODES,
} from "./adapters/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

/**
 * The mounted chat input, exposed module-side so app-level shortcuts
 * (e.g. Opt+C in chat mode) can focus it programmatically — mirrors
 * `focusActiveTerminal` in terminal.tsx. Single composer at a time, so
 * a module mutable is fine. Set on mount, cleared on unmount.
 */
let _activeChatInput: HTMLTextAreaElement | null = null;
export const focusActiveChatInput = (): void => {
  _activeChatInput?.focus();
};

/**
 * Append text into the chat composer (e.g. when the user copies a prompt
 * from the Library while in chat view — the chat analog of
 * `pty_paste_prompt`). Appends rather than replaces so an in-progress
 * draft isn't clobbered.
 *
 * The composer is NOT always mounted: switching to the Library tab
 * unmounts it. So when no composer is live we stash the text in a pending
 * buffer that the next-mounted composer drains. This always "handles" the
 * prompt (returns nothing) — the caller is expected to also reveal the
 * chat panel so the buffer gets consumed.
 */
let _appendActiveChatInput: ((text: string) => void) | null = null;
let _pendingChatPrompt: string | null = null;

export const queueChatPrompt = (text: string): void => {
  if (_appendActiveChatInput) {
    _appendActiveChatInput(text);
    _activeChatInput?.focus();
  } else {
    // No live composer (Library tab is showing). Buffer for next mount.
    _pendingChatPrompt = _pendingChatPrompt
      ? `${_pendingChatPrompt}\n${text}`
      : text;
  }
};

/** Test-only: reset module state between cases. */
export const __resetComposerModuleStateForTesting = (): void => {
  _activeChatInput = null;
  _appendActiveChatInput = null;
  _pendingChatPrompt = null;
};

interface Props {
  disabled: boolean;
  onSubmit: (text: string, attachments: string[]) => void;
  onStop: () => void;
  running: boolean;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
}

export const Composer: React.FC<Props> = ({
  disabled,
  onSubmit,
  onStop,
  running,
  permissionMode,
  onPermissionModeChange,
}) => {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Expose this composer's textarea + an append-text setter for app-level
  // actions (Opt+C focus, Library "copy prompt" paste), and drain any
  // prompt that was queued while this composer was unmounted (the user
  // copied from the Library tab, which swaps the chat panel out).
  useEffect(() => {
    _activeChatInput = inputRef.current;
    _appendActiveChatInput = (incoming: string) =>
      setText((prev) => (prev ? `${prev}\n${incoming}` : incoming));
    if (_pendingChatPrompt) {
      const queued = _pendingChatPrompt;
      _pendingChatPrompt = null;
      setText((prev) => (prev ? `${prev}\n${queued}` : queued));
      // Focus once the textarea has the queued text.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    return () => {
      if (_activeChatInput === inputRef.current) _activeChatInput = null;
      _appendActiveChatInput = null;
    };
  }, []);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let aborted = false;

    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const webview = getCurrentWebview();
        const unlisten = await webview.onDragDropEvent((event) => {
          // Tauri v2 payload types: "enter" | "over" | "drop" | "leave".
          const t = (event.payload as { type: string }).type;
          if (t === "enter" || t === "over") {
            setDropActive(true);
          } else if (t === "leave") {
            setDropActive(false);
          } else if (t === "drop") {
            setDropActive(false);
            const paths = (event.payload as { paths?: string[] }).paths ?? [];
            if (paths.length) {
              setAttachments((prev) => [...prev, ...paths]);
            }
          }
        });
        if (aborted) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      } catch {
        /* not in Tauri context — browser DnD fallback remains active */
      }
    })();

    return () => {
      aborted = true;
      unlistenFn?.();
    };
  }, []);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed, attachments);
    setText("");
    setAttachments([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDropActive(false);
    const paths: string[] = [];
    for (const f of Array.from(e.dataTransfer.files)) {
      // Browser fallback path; under Tauri the webview drag-drop event
      // above handles it (e.dataTransfer.files is empty there).
      const anyFile = f as File & { path?: string };
      paths.push(anyFile.path ?? f.name);
    }
    if (paths.length) {
      setAttachments((prev) => [...prev, ...paths]);
    }
  };

  const openFilePicker = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: true });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      if (paths.length) setAttachments((prev) => [...prev, ...paths]);
    } catch {
      /* not in Tauri context — Attach button is a no-op in browser dev */
    }
  };

  const removeAttachment = (idx: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== idx));

  const canSend = !disabled && text.trim().length > 0;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
      className={`border-t border-border p-2.5 ${dropActive ? "bg-accent" : "bg-transparent"}`}
    >
      {attachments.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {attachments.map((p, i) => (
            <span
              key={`${p}-${i}`}
              className="inline-flex items-center gap-1 rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              @{p}
              <button
                onClick={() => removeAttachment(i)}
                aria-label={`Remove ${p}`}
                className="cursor-pointer px-0.5 text-xs leading-none text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={
          disabled ? "Waiting for agent…" : "Message your agent (Enter to send)"
        }
        rows={3}
        className="box-border w-full resize-y rounded-lg border border-input bg-card p-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon-sm"
          onClick={() => void openFilePicker()}
          title="Attach files"
          aria-label="Attach files"
        >
          +
        </Button>

        <Select
          value={permissionMode}
          onValueChange={(v) => onPermissionModeChange(v as PermissionMode)}
        >
          <SelectTrigger
            size="sm"
            title="What the agent is allowed to do this turn"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERMISSION_MODES.map((m) => (
              <SelectItem key={m.value} value={m.value} title={m.hint}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        {running ? (
          <Button variant="secondary" size="sm" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={submit} disabled={!canSend}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
};
