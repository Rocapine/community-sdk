// Pure helpers of the chat screen (groups module): reply quotes, day separators,
// jumping to a quoted message, and the line that replaces the composer.
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

/** Messages cut into local days, in the order given. `day`: "today", "yesterday" or
 * the local date (`YYYY-MM-DD`). */
export function groupByDay<T extends { createdAt: string }>(
  messages: readonly T[],
  now: number,
): Array<{ day: string; items: T[] }> {
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const labels: Record<string, string> = {
    [localDay(today)]: "today",
    [localDay(yesterday)]: "yesterday",
  };
  const groups: Array<{ day: string; items: T[] }> = [];
  for (const m of messages) {
    const key = localDay(new Date(m.createdAt));
    const day = labels[key] ?? key;
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(m);
    else groups.push({ day, items: [m] });
  }
  return groups;
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
