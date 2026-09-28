// Pure layout math behind `ClampedBody`: kept out of the component so it is
// unit-testable without React Native.

/** One rendered line, as reported by `onTextLayout`. */
export type TextLine = { y: number; height: number };

/** Height of `lines` clamped to `clamp` lines (every line when `clamp` is undefined). */
export function linesHeight(lines: TextLine[], clamp?: number): number {
  const shown = clamp === undefined ? lines : lines.slice(0, clamp);
  const last = shown[shown.length - 1];
  return last ? last.y + last.height : 0;
}

/**
 * Height the body reserves so switching between versions (original ↔
 * translation) never moves the layout: the tallest version at the current
 * clamp. Undefined until every version has been measured.
 */
export function reservedHeight(
  versions: (TextLine[] | null)[],
  clamp: number,
  expanded: boolean,
): number | undefined {
  if (versions.length === 0 || versions.some((v) => v === null)) return undefined;
  return Math.max(...versions.map((v) => linesHeight(v!, expanded ? undefined : clamp)));
}

/** Whether any version is longer than the clamp (so "View more" is offered for all). */
export function anyOverflows(versions: (TextLine[] | null)[], clamp: number): boolean {
  return versions.some((v) => (v?.length ?? 0) > clamp);
}
