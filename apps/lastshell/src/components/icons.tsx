import type { Item } from '../engine/types';

export function ShotgunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 72 20" width="72" height="20" aria-hidden="true">
      <g fill="currentColor">
        <rect x="1" y="7" width="42" height="4" rx="1.5" />
        <rect x="12" y="12" width="12" height="4.5" rx="2" />
        <path d="M43 6.5 l12 -1.5 c5 0 9 2 12 5.5 l4 5 -7 4.5 -8 -6 -13 -2 z" />
        <rect x="40" y="5.5" width="5" height="8" rx="1" />
      </g>
    </svg>
  );
}

export function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 22" width="20" height="18" aria-hidden="true" className={filled ? 'heart full' : 'heart lost'}>
      {filled ? (
        <path
          fill="currentColor"
          d="M12 21 4.3 13.3 A6 6 0 0 1 12 4.6 6 6 0 0 1 19.7 13.3 Z"
        />
      ) : (
        <>
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            d="M12 20 4.6 12.9 A5.6 5.6 0 0 1 12 4.9 5.6 5.6 0 0 1 19.4 12.9 Z"
          />
          <path fill="none" stroke="currentColor" strokeWidth="1.4" d="m12 5.5-2 5 3.4 2.6-1.8 5.5" />
        </>
      )}
    </svg>
  );
}

export function SkullIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a8.5 8.5 0 0 0-8.5 8.5c0 3 1.6 5.6 4 7v3a1.5 1.5 0 0 0 1.5 1.5h6A1.5 1.5 0 0 0 16.5 20.5v-3c2.4-1.4 4-4 4-7A8.5 8.5 0 0 0 12 2Zm-3.4 12a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4Zm6.8 0a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4ZM12 15l1.4 3h-2.8Z"
      />
    </svg>
  );
}

export const ITEM_ICONS: Record<Item, string> = {
  glass: '🔍',
  saw: '🪚',
  life: '❤️',
  cuffs: '⛓️',
  split: '🔀',
  golden: '🥇',
};

export const ITEM_NAMES: Record<Item, string> = {
  glass: 'Magnifying glass',
  saw: 'Saw',
  life: 'Extra life',
  cuffs: 'Handcuffs',
  split: 'Split shell',
  golden: 'Golden bullet',
};
