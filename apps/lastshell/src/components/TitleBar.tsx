/**
 * Slim draggable title bar.
 *
 * The window uses a hidden/overlay native title bar (the traffic lights float
 * over the top-left), so WITHOUT an explicit drag region the window cannot be
 * moved at all. The bar itself is the region; interactive children opt out with
 * `data-tauri-drag-region={false}` or they'd swallow the drag.
 *
 * Spans the full width above both panes so there's always somewhere to grab,
 * whatever the sidebar is doing.
 */
import { useCallback } from 'react';
import { isTauri } from '../runtime';

/** macOS traffic lights end at ~70px; 84 leaves a ~14px gap before content. */
const MAC_LEFT_PAD = 84;

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export function TitleBar({
  round,
  muted,
  onToggleMute,
}: {
  round: number | null;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const openStore = useCallback(async () => {
    if (!isTauri()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_dreamstore').catch(() => {});
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="titlebar"
      style={{ paddingLeft: isMac ? MAC_LEFT_PAD : 12 }}
    >
      <span data-tauri-drag-region className="titlebar-name">
        LAST SHELL
      </span>

      {round !== null && (
        <span data-tauri-drag-region className="titlebar-round">
          ROUND {round}
        </span>
      )}

      <div className="titlebar-actions">
        <button
          data-tauri-drag-region={false}
          className="titlebar-btn"
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute sound' : 'Mute sound'}
          aria-pressed={muted}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        {isTauri() && (
          <button
            data-tauri-drag-region={false}
            className="titlebar-btn"
            onClick={openStore}
            title="Open DreamStore"
          >
            ⌘
          </button>
        )}
      </div>
    </div>
  );
}
