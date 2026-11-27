// Pure helpers of the chat screen (groups module): reply quotes and previews, day
// separators, runs of bubbles, the swipe to reply, jumping to a quoted message, and the
// line that replaces the composer.
import type { Group, MessagingErrorCode } from "@rocapine/community-core";
import type { TFn } from "../i18n";

const QUOTE_LINES = 2;
const QUOTE_MAX = 120;

/** A reply's quote: the first two lines, at most 120 characters, "…" when cut. */
export function quoteExcerpt(body: string | null, deleted: boolean, t: TFn): string {
  if (deleted) return t("chat.deleted");
  const lines = (body ?? "").trim().split("\n");
  // Code points, so an emoji is never cut in half.
  const chars = Array.from(lines.slice(0, QUOTE_LINES).join("\n"));
  const cut = lines.length > QUOTE_LINES || chars.length > QUOTE_MAX;
  const out = chars.slice(0, QUOTE_MAX).join("").trimEnd();
  return cut ? `${out}…` : out;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** A date's local day, `YYYY-MM-DD`. */
export const localDay = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Messages cut into local days (`YYYY-MM-DD`), in the order given. */
export function groupByDay<T extends { createdAt: string }>(
  messages: readonly T[],
): Array<{ day: string; items: T[] }> {
  const groups: Array<{ day: string; items: T[] }> = [];
  for (const m of messages) {
    const day = localDay(new Date(m.createdAt));
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(m);
    else groups.push({ day, items: [m] });
  }
  return groups;
}

const ymd = (day: string) => day.split("-").map(Number) as [number, number, number];
const DAY_MS = 86_400_000;
const dayFormats = new Map<string, Intl.DateTimeFormat>();
function formatDay(date: Date, locale: string, opts: Intl.DateTimeFormatOptions): string {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = dayFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts);
    dayFormats.set(key, f);
  }
  return f.format(date);
}

/** A day separator's label, `day` and `today` as `YYYY-MM-DD`: "Today", "Yesterday",
 * the weekday within the last 6 days ("mardi"), else "mer. 18 nov." (the year added
 * when it isn't this year), in the reader's locale. The ISO day for a bad locale. */
export function dayLabel(day: string, today: string, locale: string, t: TFn): string {
  const [y, m, d] = ymd(day);
  const [ty, tm, td] = ymd(today);
  // Calendar days apart, whatever the DST shifts in between.
  const ago = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / DAY_MS);
  if (ago <= 0) return t("chat.today");
  if (ago === 1) return t("chat.yesterday");
  const date = new Date(y, m - 1, d, 12);
  try {
    if (ago < 7) return formatDay(date, locale, { weekday: "long" });
    return formatDay(date, locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(y === ty ? {} : { year: "numeric" }),
    });
  } catch {
    return day;
  }
}

/** For each message of one day, newest first: whether it opens (`first`, the oldest)
 * or closes (`last`, the newest) its run of consecutive messages by one author. The
 * bubble shows the name on the first, the avatar and the tail on the last. */
export function runFlags(items: readonly { authorId: string }[]): {
  first: boolean;
  last: boolean;
}[] {
  return items.map((m, i) => ({
    last: items[i - 1]?.authorId !== m.authorId,
    first: items[i + 1]?.authorId !== m.authorId,
  }));
}

/** The line under "Replying to Ana": the replied message's first line (the composer
 * ellipsizes it), "📷 Photo" for a photo alone, null for an attachment alone. */
export function replyPreview(
  m: { body: string | null; imagePath: string | null },
  t: TFn,
): string | null {
  const first = (m.body ?? "").trim().split("\n")[0]!.trim();
  if (first) return first;
  return m.imagePath ? t("image.photo") : null;
}

// Swipe-to-reply (native only). Worklets: they run in the pan's callbacks.
/** The finger travel (pt) that triggers a reply. */
export const SWIPE_REPLY_AT = 64;
/** How far the bubble follows the finger, at most (pt). */
export const SWIPE_MAX = 48;
/** Touches starting this close to the screen's left edge belong to the system's back
 * swipe (iOS). */
export const SWIPE_EDGE = 24;

/** The bubble's offset for a finger travel `dx`: right only, half the travel, capped. */
export function swipeOffset(dx: number): number {
  "worklet";
  return Math.min(SWIPE_MAX, Math.max(0, dx) * 0.5);
}

/** Whether releasing at `dx` replies. */
export function swipeTriggered(dx: number): boolean {
  "worklet";
  return dx >= SWIPE_REPLY_AT;
}

/** Whether a touch at `x` (from the screen's left edge) is left to the back swipe. */
export function startsAtEdge(x: number): boolean {
  "worklet";
  return x < SWIPE_EDGE;
}

/** The index of message `id` across `pages`, loading older pages until it shows up.
 * `loadOlder` resolves to every page after the load, or null when the history ends. */
export async function findOrLoadMessage<T extends { id: string }>(
  id: string,
  pages: T[][],
  loadOlder: () => Promise<T[][] | null>,
): Promise<number | null> {
  let current = pages;
  for (;;) {
    const index = current.flat().findIndex((m) => m.id === id);
    if (index >= 0) return index;
    const next = await loadOlder();
    if (!next || next.length <= current.length) return null;
    current = next;
  }
}

/** Whether I may delete this message, as `delete_message` allows: my own; any as an app
 * admin; another member's as the group's creator, unless its author is an app admin. */
export function canDeleteMessage(p: {
  own: boolean;
  meAdmin: boolean;
  creator: boolean;
  authorAdmin: boolean;
}): boolean {
  return p.own || p.meAdmin || (p.creator && !p.authorAdmin);
}

export type ChatAction = "send" | "join" | "edit" | "delete" | "like" | "translate" | "notify";

/** The error code the screen keeps: only a failed send or join may close the
 * conversation (removed, group gone); any other failure is a passing generic error. */
export function screenErrorCode(action: ChatAction, code: MessagingErrorCode): MessagingErrorCode {
  return action === "send" || action === "join" ? code : "unknown";
}

const clocks = new Map<string, Intl.DateTimeFormat>();
/** "17:02" in the host's locale; one formatter per locale. Empty for a bad locale. */
export function formatClock(iso: string, locale: string): string {
  try {
    let f = clocks.get(locale);
    if (!f) {
      f = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
      clocks.set(locale, f);
    }
    return f.format(new Date(iso));
  } catch {
    return "";
  }
}

/** Why the composer gives way to a line, or null. `group`: undefined while loading,
 * null when gone. Not a member without a removal (left, or readmitted) is no line: the
 * screen offers Join. */
export function closedReason(
  group: Group | null | undefined,
  errorCode: MessagingErrorCode | null,
): "removed" | "groupDeleted" | null {
  if (group === null || errorCode === "not_found") return "groupDeleted";
  if (errorCode === "not_a_member" || errorCode === "removed_from_group") return "removed";
  // In preview too: a removed member can't read or rejoin it (no Join bar).
  if (group?.removed) return "removed";
  return null;
}

/** The copy for a failed send. */
export function sendErrorKey(code: MessagingErrorCode): string {
  if (code === "message_too_long") return "chat.error.tooLong";
  if (code === "rate_limited") return "chat.error.rateLimited";
  return "chat.error.generic";
}
