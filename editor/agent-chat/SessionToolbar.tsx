import React from "react";
import { Button } from "@/components/ui/button";

interface Props {
  // agentLabel + cwd are kept in the contract (callers still pass them) but
  // are no longer shown here: the agent name now lives on the Chat toggle
  // label, and the project path lives in the editor header. The toolbar is
  // just the "Clear" affordance now.
  agentLabel: string;
  cwd: string;
  onEndSession: () => void;
  sessionAlive: boolean;
}

export const SessionToolbar: React.FC<Props> = ({ onEndSession, sessionAlive }) => {
  if (!sessionAlive) return null;
  return (
    <div className="flex items-center justify-end border-b border-border bg-card px-2.5 py-1.5">
      <Button variant="secondary" size="xs" onClick={onEndSession}>
        Clear
      </Button>
    </div>
  );
};
