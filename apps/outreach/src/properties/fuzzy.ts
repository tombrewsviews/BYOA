/**
 * Subsequence fuzzy score: do `query`'s characters appear in order within
 * `text` (case-insensitive)? Returns a score (higher = better) or -1 for no
 * match. Consecutive and word-start matches score higher so "am" ranks
 * "Amanulla" above a scattered mid-word hit.
 *
 * Shared by the lead picker (LeadCombobox) and the @-mention picker
 * (MentionField) so both rank the same way.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let ti = 0;
  let score = 0;
  let streak = 0;
  let prevWasSep = true;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] === ch) {
        found = j;
        break;
      }
    }
    if (found === -1) return -1;
    const atWordStart = found === 0 || /[\s·,.\-@]/.test(t[found - 1]);
    if (found === ti && !prevWasSep) streak += 1;
    else streak = 0;
    score += 1 + streak * 2 + (atWordStart ? 3 : 0);
    prevWasSep = false;
    ti = found + 1;
  }
  return score;
}
