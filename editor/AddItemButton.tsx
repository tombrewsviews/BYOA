/**
 * The shared dashed "+ X" button used in the timeline's bottom toolbar
 * (+ Beat, + Video, + Image, + Layer). One component so all four are
 * pixel-identical — same padding, dashed border, type, and hover.
 */
import React from "react";

type Props = {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  title?: string;
};

export const AddItemButton: React.FC<Props> = ({
  label,
  onClick,
  disabled = false,
  title,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className="flex-none rounded-md border border-dashed border-border bg-transparent px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-input hover:text-foreground disabled:cursor-default disabled:opacity-50"
  >
    {label}
  </button>
);
