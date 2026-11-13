// Cold-start state of the header's "online" pill. Module-level on purpose: the pill
// expands once per JS runtime, not once per mount. Pure so it is unit-testable.
// Render reads `coldStartExpansionPending` (no side effect, so StrictMode's double
// render agrees); a mount effect calls `claimColdStartExpansion`.
let claimed = false;

/** Whether no pill has claimed the cold-start expansion yet. Never mutates. */
export function coldStartExpansionPending(): boolean {
  return !claimed;
}

/** True on the first call per JS runtime, false after. */
export function claimColdStartExpansion(): boolean {
  if (claimed) return false;
  claimed = true;
  return true;
}

export function resetColdStartExpansion(): void {
  claimed = false;
}

/** The label's visible text: the translated string with the number removed (it is
 * drawn apart, in tabular figures). shortcut: matches the plain `String(count)`,
 * upgrade if a locale formats numbers with separators. */
export function withoutCount(text: string, count: number): string {
  return text.replace(String(count), "").replace(/\s+/g, " ").trim();
}

/** Whether the translated string keeps the number glued to the text after it
 * ("12명 온라인"), so the label must not add a gap the copy doesn't have. */
export function countGluedToLabel(text: string, count: number): boolean {
  const digits = String(count);
  const at = text.indexOf(digits);
  const next = at < 0 ? undefined : text[at + digits.length];
  return next !== undefined && !/\s/.test(next);
}
