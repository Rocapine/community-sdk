// The text of a notification row, shared by the built-in row and a host's own
// (`renderInboxRow`'s `meta.parts`). Pure, so it is unit-testable.
import type { InboxItem } from "@rocapine/community-core";
import type { TFn } from "../i18n";
import { inboxExcerpt } from "./postImage";
import { formatTimeAgo } from "./time";

export function inboxRowText(
  t: TFn,
  item: InboxItem,
  nowMs: number,
): { title: string; excerpt: string | null; timeLabel: string } {
  return {
    title: rowTitle(t, item),
    excerpt: inboxExcerpt(item.payload.postExcerpt, t),
    timeLabel: formatTimeAgo(t, item.createdAt, nowMs),
  };
}

function rowTitle(t: TFn, item: InboxItem): string {
  const actor = item.actorName?.trim();
  // An announcement with no named author reads "News from the team" (a host
  // overrides `inbox.newsFromTeam` with its own name), not "from Someone".
  if (item.kind === "official_post" && !actor) return t("inbox.newsFromTeam");
  const name = actor || t("inbox.someone");
  switch (item.kind) {
    case "like":
      return t("inbox.liked", { name });
    case "comment":
      return t("inbox.commented", { name });
    case "reply":
      return t("inbox.replied", { name });
    case "reaction":
      return t("inbox.reacted", { name });
    case "official_post":
      return t("inbox.news", { name });
    default:
      return "";
  }
}
