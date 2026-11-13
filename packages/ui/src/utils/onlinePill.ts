// Cold-start state of the header's "online" pill. Module-level on purpose: the pill
// expands once per JS runtime, not once per mount. Pure so it is unit-testable.
let claimed = false;

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
