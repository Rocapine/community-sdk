// "View more" on the last visible line of a clamped body (`…text… View more`),
// never on a line of its own. React Native can't append a link to a
// `numberOfLines` ellipsis, so the body is cut by hand from the unclamped
// layout's lines: whole lines up to the last visible one, then as much of that
// one as leaves room for "…" + the suffix.

/** The shown text (ending with "…") when `lines` overflow `maxLines`, else
 * null. `suffixWidth` is the measured width of the " View more" link. With
 * `charEnds` (each code point's right edge, from the start of the line), the
 * cut is exact and `suffixWidth` must be that of "… View more". Without, uses
 * the last visible line's average character width: proportional fonts make it
 * an estimate, so `SLACK_CHARS` cover the "…" and glyphs wider than the average. */
const SLACK_CHARS = 3;

export function clampWithSuffix(
  lines: { text: string; width: number; charEnds?: number[] }[],
  maxLines: number,
  lineWidth: number,
  suffixWidth: number,
): string | null {
  if (lines.length <= maxLines) return null;
  const head = lines
    .slice(0, maxLines - 1)
    .map((l) => l.text)
    .join("");
  const last = lines[maxLines - 1];
  const chars = Array.from(last.text);
  const charWidth = chars.length > 0 ? last.width / chars.length : 1;
  // Each character's right edge when known (web): exact.
  const keep = last.charEnds
    ? last.charEnds.filter((end) => end + suffixWidth <= lineWidth).length
    : Math.max(0, Math.floor((lineWidth - suffixWidth) / charWidth) - SLACK_CHARS);
  return (head + chars.slice(0, keep).join("")).trimEnd() + "…";
}
