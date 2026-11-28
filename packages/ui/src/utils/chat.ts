// Pure helpers of the chat screen (groups and dms modules): reply quotes and previews,
// day separators, runs of bubbles, the swipe to reply, jumping to a quoted message, the
// line that replaces the composer, a DM's request mode, "Seen" and the sender's context,
// and the Messages page's layout.
import type { DmRequest, Group, MessagingErrorCode } from "@rocapine/community-core";
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

/** Milliseconds from `now` to just past the next local midnight (DST-safe: built from
 * the calendar date, not 24 h). */
export function msUntilNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime() + 1000;
}

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
 * ellipsizes it), "🖼️ Photo" (`chat.reply.photo`) for a photo alone, null for an
 * attachment alone. */
export function replyPreview(
  m: { body: string | null; imagePath: string | null },
  t: TFn,
): string | null {
  const first = (m.body ?? "").trim().split("\n")[0]!.trim();
  if (first) return first;
  return m.imagePath ? t("chat.reply.photo") : null;
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
  // dms/005: a request's first message spends the day's request budget.
  if (code === "too_many_requests") return "dms.error.tooManyRequests";
  return "chat.error.generic";
}

// ============ DMS ============

type Listed = {
  kind: "dm" | "group";
  peerId: string | null;
  requestState: "active" | "request" | null;
};

/** What a conversation screen holds, from my list (active conversations), my pending
 * requests, and what the screen already knew (`sticky`: once a DM, always that DM with
 * that peer, through an accept or a decline while the lists refetch). Without dms, or in
 * a group preview, a group. With dms and an id in neither list: nothing until both lists
 * answered (`kind` null), then a group (with groups on) or a DM, unconfirmed. A listed DM
 * across a block has no peer. */
export function conversationIdentity(p: {
  listed: Listed | undefined;
  request: { senderId: string } | undefined;
  sticky: { kind: "dm" | "group"; peerId: string | null } | null;
  dmsOn: boolean;
  groupsOn: boolean;
  preview: boolean;
  loaded: boolean;
}): { kind: "dm" | "group" | null; peerId: string | null; confirmed: boolean } {
  if (p.listed) return { kind: p.listed.kind, peerId: p.listed.peerId, confirmed: true };
  if (p.request) return { kind: "dm", peerId: p.request.senderId, confirmed: true };
  if (p.sticky) return { ...p.sticky, confirmed: true };
  if (!p.dmsOn || p.preview) return { kind: "group", peerId: null, confirmed: true };
  if (!p.loaded) return { kind: null, peerId: null, confirmed: false };
  return { kind: p.groupsOn ? "group" : "dm", peerId: null, confirmed: false };
}

export type DmState = "loading" | "request" | "active" | "blocked" | "unavailable" | "left";

/** A DM screen's state. `left`: I declined or blocked it here (the screen is closing).
 * `blocked`: a block either way (the list has no peer across one, or a send said so).
 * `request`: mine to answer (read-only). Gone from both lists once they answered: a
 * request withdrawn by a block, a declined DM, a stale link (`unavailable`). */
export function dmState(p: {
  listed: { peerId: string | null; requestState: "active" | "request" | null } | undefined;
  pending: boolean;
  accepted: boolean;
  left: boolean;
  loaded: boolean;
  errorCode: MessagingErrorCode | null;
}): DmState {
  if (p.left) return "left";
  if (p.errorCode === "blocked" || (p.listed && p.listed.peerId === null)) return "blocked";
  if (p.accepted || p.listed?.requestState === "active") return "active";
  if (p.pending || p.listed?.requestState === "request") return "request";
  return p.loaded ? "unavailable" : "loading";
}

/** A group's closing line; an unconfirmed group (an id no list knew) that doesn't exist
 * reads as unavailable, not deleted: it may be a DM I can't open any more. */
export function groupClosed(
  group: Group | null | undefined,
  errorCode: MessagingErrorCode | null,
  confirmed: boolean,
): "removed" | "groupDeleted" | "unavailable" | null {
  if (group === null && !confirmed) return "unavailable";
  return closedReason(group, errorCode);
}

/** The message "Seen" goes under: my newest one (messages newest first) that is neither
 * a deleted or hidden tombstone nor still sending (`sending`), once the peer read up to
 * it. Never an older one: the peer's read time may pass messages hidden from them. */
export function seenMessageId(
  messages: readonly { id: string; authorId: string; createdAt: string; status: string }[],
  myUid: string | null,
  peerRead: string | null,
  sending: (m: { id: string }) => boolean,
): string | null {
  if (!peerRead || !myUid) return null;
  const mine = messages.find(
    (m) => m.authorId === myUid && m.status !== "deleted" && m.status !== "hidden" && !sending(m),
  );
  return mine && Date.parse(mine.createdAt) <= Date.parse(peerRead) ? mine.id : null;
}

/** The Requests row shows only when requests are waiting. */
export const showRequestsRow = (count: number) => count > 0;

/** Who sent a request: "Paris, Lyon +2 · Member since March 2026" (groups in common, up
 * to 3 named, then since when they are a member, in the reader's locale). */
export function senderContext(
  r: Pick<DmRequest, "groupsInCommon" | "commonGroupNames" | "memberSince">,
  locale: string,
  t: TFn,
): string {
  const named = r.commonGroupNames.length;
  const extra = r.groupsInCommon - named;
  const groups =
    named > 0
      ? r.commonGroupNames.join(", ") + (extra > 0 ? ` +${extra}` : "")
      : r.groupsInCommon > 0
        ? t("dms.context.groups", { count: r.groupsInCommon })
        : t("dms.context.noGroups");
  let since: string;
  try {
    since = formatDay(new Date(r.memberSince), locale, { month: "long", year: "numeric" });
  } catch {
    since = r.memberSince.slice(0, 7);
  }
  return `${groups} · ${t("dms.context.memberSince", { date: since })}`;
}

/** What the Messages page shows: both halves as tabs or one list, or the one half that
 * is on. With dms on and the home's "Feed | Groups" selector, groups live there. */
export function hubView(p: {
  groups: boolean;
  dms: boolean;
  hubLayout: "tabs" | "unified";
  homeLayout: "header" | "segmented";
}): "tabs" | "unified" | "dms" | "groups" | null {
  const groups = p.groups && !(p.dms && p.homeLayout === "segmented");
  if (groups && p.dms) return p.hubLayout;
  return p.dms ? "dms" : groups ? "groups" : null;
}
