import React from "react";

interface Props {
  text: string;
}

export const UserMessage: React.FC<Props> = ({ text }) => (
  <div className="ml-auto max-w-[70ch] whitespace-pre-wrap rounded-lg bg-secondary px-3 py-2 text-sm leading-relaxed text-foreground">
    {text}
  </div>
);
