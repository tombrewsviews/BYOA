/**
 * The opening instruction handed to the agent CLI as its first prompt, so a
 * table starts playing itself. The user should never have to type "play".
 *
 * Deliberately short: the real manual is the installed skill. This only has to
 * get the agent to load it and enter the wait/act loop.
 */
export function kickoffPrompt(seats: { seat: number; name: string; tier: string }[]): string {
  const roster = seats.map((s) => `seat ${s.seat} (${s.name}, ${s.tier})`).join(', ');
  return [
    `You are playing LAST SHELL. Read .claude/skills/lastshell/SKILL.md now, then start playing immediately.`,
    `You hold ${roster}.`,
    `Wait for your turn by checking .lastshell/turn.txt with a short bounded wait (a few seconds, then return — never a long blocking loop).`,
    `When turn.txt changes, read .lastshell/game-state.json; if awaitingSeat is yours, write your move to .lastshell/moves.json.`,
    `Keep going turn after turn until phase is gameOver. Do not ask whether to continue and do not wait to be told it is your turn.`,
  ].join(' ');
}

/** The agent CLIs the picker offers. Ids match Rust's AgentKind kebab-case. */
export interface AgentCli {
  id: string;
  label: string;
  binary: string;
  installHint: string;
  installed: boolean;
  path: string | null;
}
