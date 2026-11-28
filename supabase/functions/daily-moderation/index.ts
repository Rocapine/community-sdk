// Daily moderation batch + backstop. Runs every not-yet-moderated post/comment
// through OpenAI's moderation endpoint (free): flagged -> soft-hide, clean
// 'pending' -> promote to 'visible' (catches items whose synchronous
// moderate-one call failed), clean 'visible' -> just stamp. Also sweeps
// not-yet-checked usernames (profiles.username is client-writable, see
// core/007_username_moderation.sql): flagged or containing the app's name ->
// blanked, i.e. back to the default name (core/009). Chat messages and group
// fields (messaging/groups modules) the synchronous call missed go through the
// same per-item logic as moderate-one (_shared/messaging.ts), and the files of deleted
// groups and abandoned chat uploads are removed (groups/005). Posts a Slack
// summary when there was something to check (no-op if SLACK_WEBHOOK_URL is
// unset — see _shared/slack.ts). Never deletes rows. App criticism is not a
// category (stays visible).
//
// Reachable with the anon key (the cron calls it that way) and idempotent:
// once a sweep has stamped its items, a stray call finds nothing to check and
// exits without an API call or a Slack post.

import { adminClient } from "../_shared/client.ts";
import {
  assertModerationConfigured,
  flaggedCategories,
  moderateItem,
  type ModerationResult,
} from "../_shared/moderation.ts";
import {
  fetchImagePaths,
  POST_IMAGES_BUCKET,
  postImageUrl,
  sweepMessagingImages,
} from "../_shared/images.ts";
import {
  GROUP_COLUMNS,
  type GroupRow,
  isMissingTable,
  MESSAGE_COLUMNS,
  type MessageRow,
  moderateGroup,
  moderateMessage,
  readMessagingMode,
} from "../_shared/messaging.ts";
import { containsAppName } from "../_shared/names.ts";
import { postToSlack } from "../_shared/slack.ts";

assertModerationConfigured();

const supabase = adminClient();

interface Item {
  id: string;
  content: string;
  author_id: string;
  status: string;
  imagePath: string | null;
  // The image_path lookup errored: not moderated (nor stamped/promoted) this run.
  imageLookupFailed: boolean;
  profiles: {
    username: string | null;
    amplitude_id: string | null;
    revenuecat_id: string | null;
  } | null;
  table: "posts" | "comments";
}

// Without generated DB types, supabase-js can't tell a `profiles!fk(...)`
// embed is to-one, so its inferred type is an array; normalize it to a
// single row (or null) to match Item.profiles above.
function toOne<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** One OpenAI moderation call for up to 100 inputs; null on any failure so
 * the caller can skip stamping and retry next run. */
async function moderateBatch(inputs: string[]): Promise<ModerationResult[] | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "omni-moderation-latest", input: inputs }),
    });
    if (!res.ok) return null;
    const { results } = await res.json();
    return results as ModerationResult[];
  } catch {
    return null;
  }
}

interface ProfileItem {
  id: string;
  username: string;
  amplitude_id: string | null;
  revenuecat_id: string | null;
}

/**
 * Username sweep (core/007): moderate every not-yet-checked username, blank
 * the flagged ones (remembering the value in `username_rejected` so a client
 * re-sync keeps it blank) and stamp the rest. Capped per run so the first
 * sweep after the migration stays within the function's time budget. On an
 * install without core/007 the select errors and the sweep is skipped.
 */
async function sweepUsernames(): Promise<{
  checked: number;
  blanked: { profile: ProfileItem; categories: string[] }[];
  failedBatches: number;
  skipped: boolean;
}> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, amplitude_id, revenuecat_id")
    .not("username", "is", null)
    .is("username_checked_at", null)
    .limit(1000);
  if (error) return { checked: 0, blanked: [], failedBatches: 0, skipped: true };
  const profiles = (data ?? []) as ProfileItem[];
  const blanked: { profile: ProfileItem; categories: string[] }[] = [];
  const processed: ProfileItem[] = [];
  let failedBatches = 0;
  for (let i = 0; i < profiles.length; i += 100) {
    const batch = profiles.slice(i, i + 100);
    const results = await moderateBatch(batch.map((p) => p.username));
    if (!results) {
      failedBatches++;
      continue;
    }
    results.forEach((r, idx) => {
      const cats = flaggedCategories(r);
      if (containsAppName(batch[idx].username)) cats.push("app_name");
      if (cats.length > 0) blanked.push({ profile: batch[idx], categories: cats });
    });
    processed.push(...batch);
  }
  const now = new Date().toISOString();
  for (const { profile } of blanked) {
    // Guarded on the current value: a name changed since the select is left
    // for the next sweep (the change trigger reset its checked_at anyway).
    await supabase
      .from("profiles")
      .update({ username: null, username_rejected: profile.username, username_checked_at: now })
      .eq("id", profile.id)
      .eq("username", profile.username);
  }
  const blankedIds = new Set(blanked.map((b) => b.profile.id));
  const cleanIds = processed.filter((p) => !blankedIds.has(p.id)).map((p) => p.id);
  if (cleanIds.length > 0) {
    await supabase.from("profiles").update({ username_checked_at: now }).in("id", cleanIds);
  }
  return { checked: processed.length, blanked, failedBatches, skipped: false };
}

/** Deletes storage objects no live post/comment references (abandoned uploads,
 * deleted authors' files), capped per run. Skipped silently without the images
 * module (the RPC doesn't exist). Returns how many files were removed, and the
 * storage error when the removal failed (surfaced in the Slack summary). */
async function sweepUnreferencedImages(): Promise<{ removed: number; error?: string }> {
  const { data, error } = await supabase.rpc("post_images_unreferenced", { p_limit: 500 });
  const names = (data ?? []) as string[];
  if (error || names.length === 0) return { removed: 0 };
  const { data: removed, error: removeError } = await supabase.storage
    .from(POST_IMAGES_BUCKET)
    .remove(names);
  if (removeError) {
    console.error("image sweep: remove failed", removeError.message);
    return { removed: 0, error: removeError.message };
  }
  return { removed: removed?.length ?? 0 };
}

// One page of a keyset walk: rows after `after` in (created_at, key) order.
type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string } | null }>;
const keysetAfter = (after: { created_at: string; key: string } | null, keyCol: string) =>
  after
    ? `created_at.gt."${after.created_at}",and(created_at.eq."${after.created_at}",${keyCol}.gt.${after.key})`
    : null;

/** Walks every row a page fetcher returns, oldest first, until the rows run out or the
 * deadline passes. Paging past each row (not re-reading the oldest) means rows that
 * fail closed on every run can't starve newer ones. Returns false on a read error
 * other than a missing table (no messaging / groups module). */
async function walk<T extends { created_at: string }>(
  fetchPage: (after: { created_at: string; key: string } | null) => Page<T>,
  key: (row: T) => string,
  handle: (row: T) => Promise<void>,
  deadline: number,
  parallel: number,
): Promise<boolean> {
  let after: { created_at: string; key: string } | null = null;
  while (Date.now() < deadline) {
    const { data, error } = await fetchPage(after);
    if (error) return isMissingTable(error.code);
    const rows = data ?? [];
    for (let i = 0; i < rows.length && Date.now() < deadline; i += parallel) {
      await Promise.all(rows.slice(i, i + parallel).map(handle));
    }
    if (rows.length < 100) return true;
    const last = rows[rows.length - 1];
    after = { created_at: last.created_at, key: key(last) };
  }
  return true;
}

/** Messages and groups left unmoderated for 5 minutes (the client's moderate-one call
 * failed or never came), oldest first, within a time budget. A group waiting for its
 * creator's fix (rejected_fields set) is skipped. Groups have no "submitted at", so a
 * fresh edit of an old group may race moderate-one: the guarded writes keep that safe.
 * `failed` counts items left unchecked (fail closed) plus read errors. */
async function sweepChat(budgetMs: number): Promise<{
  messages: number;
  messagesHidden: number;
  groups: number;
  groupsRejected: number;
  failed: number;
}> {
  const out = { messages: 0, messagesHidden: 0, groups: 0, groupsRejected: 0, failed: 0 };
  const deadline = Date.now() + budgetMs;
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();

  const { installed, mode } = await readMessagingMode(supabase);
  // No messaging module: nothing to sweep (and nothing worth an error in the logs).
  if (!installed) return out;
  const messagesOk = await walk<MessageRow>(
    (after) => {
      let q = supabase
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .is("moderated_at", null)
        .in("status", ["pending", "visible"])
        .lt("created_at", cutoff);
      const k = keysetAfter(after, "id");
      if (k) q = q.or(k);
      return q.order("created_at").order("id").limit(100) as unknown as Page<MessageRow>;
    },
    (m) => m.id,
    async (m) => {
      // Settings unreadable: fail closed, every message counts as unchecked.
      const v = mode
        ? await moderateMessage(supabase, m, mode)
        : { status: "pending", error: "settings" };
      if (v.error) out.failed++;
      else out.messages++;
      if (v.status === "rejected") out.messagesHidden++;
    },
    deadline,
    5,
  );
  if (!messagesOk) out.failed++;

  const groupsOk = await walk<GroupRow>(
    (after) => {
      let q = supabase
        .from("groups")
        .select(GROUP_COLUMNS)
        .or(
          "pending_name.not.is.null,pending_description.not.is.null,pending_image_path.not.is.null",
        )
        .neq("status", "deleted")
        .eq("rejected_fields", "{}")
        .lt("created_at", cutoff);
      const k = keysetAfter(after, "conversation_id");
      if (k) q = q.or(k);
      return q.order("created_at").order("conversation_id").limit(100) as unknown as Page<GroupRow>;
    },
    (g) => g.conversation_id,
    async (g) => {
      const v = await moderateGroup(supabase, g);
      if (v.error) out.failed++;
      else out.groups++;
      if (!v.error && v.rejected.length > 0) out.groupsRejected++;
    },
    deadline,
    1,
  );
  if (!groupsOk) out.failed++;
  return out;
}

Deno.serve(async () => {
  const startedAt = Date.now();
  const { data: posts, error: postsError } = await supabase
    .from("posts")
    .select(
      "id, content, author_id, status, profiles!posts_author_id_fkey(username, amplitude_id, revenuecat_id)",
    )
    .is("moderated_at", null)
    .in("status", ["pending", "visible"]);
  const { data: comments, error: commentsError } = await supabase
    .from("comments")
    .select("id, content, author_id, status, profiles(username, amplitude_id, revenuecat_id)")
    .is("moderated_at", null)
    .in("status", ["pending", "visible"]);
  if (postsError || commentsError) {
    return new Response(JSON.stringify({ error: (postsError ?? commentsError)!.message }), {
      status: 500,
    });
  }

  // Poll option labels are user content: fold them into the post's moderated
  // text (same treatment as the synchronous moderate-one function). The polls
  // module is optional: without it the table doesn't exist, the query errors,
  // and posts are moderated on their text alone (a separate query instead of
  // an embed so a core-only install doesn't 400 the whole sweep).
  const optionsByPost = new Map<string, { idx: number; label: string }[]>();
  if (posts && posts.length > 0) {
    const { data: options, error } = await supabase
      .from("poll_options")
      .select("post_id, idx, label")
      .in(
        "post_id",
        posts.map((p) => p.id),
      );
    if (!error) {
      for (const o of options ?? []) {
        const list = optionsByPost.get(o.post_id) ?? [];
        list.push({ idx: o.idx, label: o.label });
        optionsByPost.set(o.post_id, list);
      }
    }
  }
  const postImages = await fetchImagePaths(
    supabase,
    "posts",
    (posts ?? []).map((p) => p.id),
  );
  const commentImages = await fetchImagePaths(
    supabase,
    "comments",
    (comments ?? []).map((c) => c.id),
  );
  const items: Item[] = [
    ...(posts ?? []).map((p) => ({
      ...p,
      imagePath: postImages.paths.get(p.id) ?? null,
      imageLookupFailed: postImages.failedIds.has(p.id),
      profiles: toOne(p.profiles),
      content: [
        p.content,
        ...(optionsByPost.get(p.id) ?? []).sort((a, b) => a.idx - b.idx).map((o) => o.label),
      ].join("\n"),
      table: "posts" as const,
    })),
    ...(comments ?? []).map((c) => ({
      ...c,
      imagePath: commentImages.paths.get(c.id) ?? null,
      imageLookupFailed: commentImages.failedIds.has(c.id),
      profiles: toOne(c.profiles),
      table: "comments" as const,
    })),
  ];

  // Moderate in batches of 100 (API limit). Only items whose batch succeeded
  // get stamped moderated_at, so a transient failure is retried tomorrow.
  const flagged: { item: Item; categories: string[] }[] = [];
  const processed: Item[] = [];
  let failedBatches = 0;
  const textItems = items.filter((it) => !it.imagePath && !it.imageLookupFailed);
  if (items.some((it) => it.imageLookupFailed)) failedBatches++;
  for (let i = 0; i < textItems.length; i += 100) {
    const batch = textItems.slice(i, i + 100);
    const results = await moderateBatch(batch.map((it) => it.content));
    if (!results) {
      failedBatches++; // API/network error; skip stamping, retried next run
      continue;
    }
    results.forEach((r, idx) => {
      const cats = flaggedCategories(r);
      if (cats.length > 0) flagged.push({ item: batch[idx], categories: cats });
    });
    processed.push(...batch);
  }
  // Items with an image go one by one (text + image calls); a failed one
  // counts as a failed batch: not stamped, retried next run.
  for (const item of items.filter((it) => it.imagePath)) {
    const verdict = await moderateItem(item.content, postImageUrl(item.imagePath!));
    if (!verdict) {
      failedBatches++;
      continue;
    }
    if (verdict.flagged) flagged.push({ item, categories: verdict.categories });
    processed.push(item);
  }
  const totalItems = items.length;

  const flaggedIds = new Set(flagged.map((f) => f.item.id));
  // Status guards: a row the author soft-deleted while the sweep ran must not
  // be resurrected as hidden/visible, so every write re-checks the status it
  // was selected with.
  const imageErrors: string[] = [];
  for (const { item, categories } of flagged) {
    // Child-safety hit: the file goes now. Any other hide keeps it.
    if (item.imagePath && categories.includes("sexual/minors")) {
      const { error } = await supabase.storage.from(POST_IMAGES_BUCKET).remove([item.imagePath]);
      if (error) {
        console.error("sexual/minors image not deleted", item.imagePath, error.message);
        imageErrors.push(
          `sexual/minors image \`${item.imagePath}\` NOT deleted (${error.message}), remove it by hand`,
        );
      }
    }
    await supabase
      .from(item.table)
      .update({ status: "hidden", moderation_reason: categories.join(",") })
      .eq("id", item.id)
      .in("status", ["pending", "visible"]);
  }
  // Backstop: promote clean 'pending' items to 'visible' (their synchronous
  // moderate-one call must have failed).
  const promote = processed.filter((i) => i.status === "pending" && !flaggedIds.has(i.id));
  const promotePostIds = promote.filter((i) => i.table === "posts").map((i) => i.id);
  const promoteCommentIds = promote.filter((i) => i.table === "comments").map((i) => i.id);
  if (promotePostIds.length > 0) {
    await supabase
      .from("posts")
      .update({ status: "visible" })
      .in("id", promotePostIds)
      .eq("status", "pending");
  }
  if (promoteCommentIds.length > 0) {
    await supabase
      .from("comments")
      .update({ status: "visible" })
      .in("id", promoteCommentIds)
      .eq("status", "pending");
  }
  const now = new Date().toISOString();
  const processedPostIds = processed.filter((i) => i.table === "posts").map((i) => i.id);
  const processedCommentIds = processed.filter((i) => i.table === "comments").map((i) => i.id);
  if (processedPostIds.length > 0) {
    await supabase.from("posts").update({ moderated_at: now }).in("id", processedPostIds);
  }
  if (processedCommentIds.length > 0) {
    await supabase.from("comments").update({ moderated_at: now }).in("id", processedCommentIds);
  }

  const usernames = await sweepUsernames();
  const sweep = await sweepUnreferencedImages();
  const chatSweep = await sweepMessagingImages(supabase);
  // Last, within what is left of a 120 s run: everything above is already written.
  const chat = await sweepChat(Math.max(0, startedAt + 120_000 - Date.now()));
  const imagesSwept = sweep.removed + chatSweep.removed;
  if (sweep.error) imageErrors.push(`image sweep failed: ${sweep.error}`);
  if (chatSweep.error) imageErrors.push(`chat image sweep failed: ${chatSweep.error}`);
  const allFailedBatches = failedBatches + usernames.failedBatches + chat.failed;

  // Quiet when there was nothing to check at all (a stray or duplicate call
  // finds every item already stamped): no Slack noise, no API cost.
  if (
    totalItems === 0 &&
    usernames.checked === 0 &&
    chat.messages === 0 &&
    chat.groups === 0 &&
    allFailedBatches === 0 &&
    imagesSwept === 0 &&
    imageErrors.length === 0
  ) {
    return new Response(
      JSON.stringify({
        checked: 0,
        hidden: 0,
        usernames_checked: 0,
        usernames_blanked: 0,
        messages_checked: 0,
        groups_checked: 0,
        failed_batches: 0,
      }),
    );
  }

  const lines = flagged.map(({ item, categories }) => {
    const p = item.profiles;
    return (
      `* [${item.table}] *${p?.username ?? item.author_id}*, _${categories.join(", ")}_\n` +
      `  > ${item.content.slice(0, 200)}\n` +
      `  amplitude: \`${p?.amplitude_id ?? "?"}\` | revenuecat: \`${p?.revenuecat_id ?? "?"}\``
    );
  });
  const usernameLines = usernames.blanked.map(
    ({ profile, categories }) =>
      `* [username] *${profile.username}* blanked, _${categories.join(", ")}_\n` +
      `  amplitude: \`${profile.amplitude_id ?? "?"}\` | revenuecat: \`${profile.revenuecat_id ?? "?"}\``,
  );
  const usernameSummary =
    usernames.checked > 0
      ? ` Usernames: ${usernames.blanked.length}/${usernames.checked} blanked.`
      : "";
  // Counts only: chat text never goes to Slack from here.
  const chatSummary =
    (chat.messages > 0 ? ` Messages: ${chat.messagesHidden}/${chat.messages} hidden.` : "") +
    (chat.groups > 0
      ? ` Groups: ${chat.groupsRejected}/${chat.groups} with rejected fields.`
      : "") +
    (chat.failed > 0 ? ` Messages/groups not checked (retried next run): ${chat.failed}.` : "");
  const sweepSummary = chatSummary + (imagesSwept > 0 ? ` Images swept: ${imagesSwept}.` : "");
  let summaryText: string;
  if (allFailedBatches > 0) {
    const uncheckedCount = totalItems - processed.length;
    summaryText =
      `Daily moderation: WARNING, ${allFailedBatches} batch(es) failed to reach the moderation API ` +
      `(${uncheckedCount} of ${totalItems} items were not checked and will be retried). ` +
      `${flagged.length} items hidden.${usernameSummary}${sweepSummary}`;
  } else if (
    flagged.length === 0 &&
    usernames.blanked.length === 0 &&
    chat.messagesHidden === 0 &&
    chat.groupsRejected === 0
  ) {
    summaryText = `Daily moderation: ${processed.length} items checked, nothing to report.${usernameSummary}${sweepSummary}`;
  } else {
    summaryText =
      `Daily moderation: ${flagged.length}/${processed.length} items hidden.${usernameSummary}${sweepSummary}\n\n` +
      [...lines, ...usernameLines].join("\n");
  }
  if (imageErrors.length > 0) {
    summaryText += `\n\n${imageErrors.map((e) => `* WARNING: ${e}`).join("\n")}`;
  }
  await postToSlack({ text: summaryText });

  return new Response(
    JSON.stringify({
      checked: processed.length,
      hidden: flagged.length,
      usernames_checked: usernames.checked,
      usernames_blanked: usernames.blanked.length,
      messages_checked: chat.messages,
      messages_hidden: chat.messagesHidden,
      groups_checked: chat.groups,
      groups_rejected: chat.groupsRejected,
      failed_batches: allFailedBatches,
    }),
  );
});
