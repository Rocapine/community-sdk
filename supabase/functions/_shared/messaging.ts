// Moderation of chat messages and group fields (messaging and groups modules), shared by
// moderate-one (a single item, right after the client's write) and daily-moderation (the
// backstop). The pure parts are tested in messaging_test.ts.
//
// Fail closed: an item whose text or image couldn't be checked stays as it is (a message
// pending or unmoderated, a group's values pending) for a retry. Every write is guarded by
// the values it read, so an edit, a delete or a parallel run in between is never
// overwritten with a verdict about older content.

import type { adminClient } from "./client.ts";
import {
  GROUP_IMAGES_BUCKET,
  GROUP_IMAGES_PENDING_BUCKET,
  isMissingColumn,
  MESSAGE_IMAGES_BUCKET,
  messageImageUrl,
  signedImageUrl,
} from "./images.ts";
import { moderateItem } from "./moderation.ts";
import { postToSlack } from "./slack.ts";

type Admin = ReturnType<typeof adminClient>;

export const MESSAGE_COLUMNS =
  "id, author_id, body, image_path, status, moderated_at, edited_at, created_at";
// One literal (no concatenation), so supabase-js can type the selected row.
export const GROUP_COLUMNS =
  "conversation_id, created_by, name, description, image_path, pending_name, pending_description, pending_image_path, status, rejected_fields, created_at";

export interface MessageRow {
  id: string;
  author_id: string;
  body: string | null;
  image_path: string | null;
  status: string;
  moderated_at: string | null;
  edited_at: string | null;
  created_at: string;
}

export type GroupField = "name" | "description" | "image";

export interface GroupValues {
  name: string | null;
  description: string | null;
  image_path: string | null;
  pending_name: string | null;
  pending_description: string | null;
  pending_image_path: string | null;
  status: string;
}

export interface GroupRow extends GroupValues {
  conversation_id: string;
  created_by: string | null;
  rejected_fields: string[];
  created_at: string;
}

export interface GroupUpdate {
  name?: string;
  description?: string;
  image_path?: string;
  pending_name?: null;
  pending_description?: null;
  pending_image_path?: null;
  rejected_fields: GroupField[];
  status?: "visible";
}

export type ModerationMode = "pre" | "post" | "reportOnly";

// The text the AI reads: none in 'reportOnly' (an image is still checked) or for an
// attachment-only message; "" makes moderateItem skip the text call.
export function messageModerationInput(
  row: { body: string | null },
  mode: ModerationMode = "post",
): string {
  return mode === "reportOnly" ? "" : (row.body ?? "");
}

// Postgres' undefined_table (42P01) or PostgREST's "table not found" (PGRST205): the
// install has no messaging / groups module.
export const isMissingTable = (code: string | undefined) => code === "42P01" || code === "PGRST205";

/** The backend's moderation mode. `installed: false` without the messaging module (no
 * error logged); `mode: null` when the settings couldn't be read (callers fail closed). */
export async function readMessagingMode(
  supabase: Pick<Admin, "from">,
): Promise<{ installed: boolean; mode: ModerationMode | null }> {
  const { data, error } = await supabase
    .from("messaging_settings")
    .select("settings")
    .eq("id", 1)
    .single();
  if (error) {
    if (isMissingTable(error.code)) return { installed: false, mode: null };
    console.error("messaging_settings read failed", error.message);
    return { installed: true, mode: null };
  }
  const mode = (data?.settings as { moderation?: string } | null)?.moderation ?? "post";
  return { installed: true, mode: mode === "pre" || mode === "reportOnly" ? mode : "post" };
}

// messaging_settings.moderation; null when it can't be read (the caller fails closed).
export async function messagingMode(supabase: Admin): Promise<ModerationMode | null> {
  return (await readMessagingMode(supabase)).mode;
}

const FIELDS = [
  { field: "name", live: "name", pending: "pending_name" },
  { field: "description", live: "description", pending: "pending_description" },
  { field: "image", live: "image_path", pending: "pending_image_path" },
] as const;

export function groupFieldsToModerate(
  row: GroupValues,
): Array<{ field: GroupField; value: string }> {
  return FIELDS.filter((f) => row[f.pending] !== null).map((f) => ({
    field: f.field,
    value: row[f.pending]!,
  }));
}

// All or nothing: every pending value goes live together, or none does. A flagged value
// is dropped (the creator is asked to change it), the clean ones wait with the fix. A new
// group needs a name and a description to go visible: a missing one counts as rejected.
export function nextGroupState(row: GroupValues, flagged: Set<string>): GroupUpdate {
  const missing =
    row.status === "pending"
      ? FIELDS.filter((f) => f.field !== "image" && (row[f.pending] ?? row[f.live]) === null)
      : [];
  const rejected = FIELDS.filter((f) => flagged.has(f.field) || missing.includes(f));
  if (rejected.length > 0) {
    const update: GroupUpdate = { rejected_fields: rejected.map((f) => f.field) };
    for (const f of rejected) if (row[f.pending] !== null) update[f.pending] = null;
    return update;
  }
  const update: GroupUpdate = { rejected_fields: [] };
  for (const f of FIELDS) {
    if (row[f.pending] === null) continue;
    update[f.live] = row[f.pending]!;
    update[f.pending] = null;
  }
  if (row.status === "pending") update.status = "visible";
  return update;
}

export type Verdict = { status: string; reason?: string | null; error?: string };

// Child-safety hits must not stay stored: a failed delete alerts ops to remove it by hand.
async function removeImage(
  supabase: Admin,
  bucket: string,
  path: string,
  { mandatory = false, label = "" } = {},
): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (!error) return;
  console.error("image not deleted", bucket, path, error.message);
  if (mandatory) {
    await postToSlack({
      text: `Moderation: sexual/minors image \`${bucket}/${path}\` (${label}) NOT deleted (${error.message}), remove it by hand.`,
    }).catch((e) => console.error("slack alert failed", e));
  }
}

// Allowed on a pending message, or a visible one the AI hasn't seen yet ('post' mode).
// `mode` is read from messaging_settings when not given (the sweep reads it once).
export async function moderateMessage(
  supabase: Admin,
  m: MessageRow,
  mode?: ModerationMode,
): Promise<Verdict> {
  if (!(m.status === "pending" || (m.status === "visible" && m.moderated_at === null))) {
    return { status: m.status === "visible" ? "published" : m.status };
  }
  const moderation = mode ?? (await messagingMode(supabase));
  if (!moderation) return { status: "pending", error: "settings unavailable" };
  let imageUrl: string | null = null;
  if (m.image_path) {
    imageUrl = await messageImageUrl(m.image_path);
    if (!imageUrl) return { status: "pending", error: "image unavailable" };
  }
  const verdict = await moderateItem(messageModerationInput(m, moderation), imageUrl);
  if (!verdict) return { status: "pending", error: "moderation unavailable" };
  const now = new Date().toISOString();
  let write = supabase
    .from("messages")
    .update(
      verdict.flagged
        ? { status: "hidden", moderation_reason: verdict.reason, moderated_at: now }
        : { status: "visible", moderated_at: now },
    )
    .eq("id", m.id)
    .eq("status", m.status)
    .is("moderated_at", null);
  write = m.edited_at === null ? write.is("edited_at", null) : write.eq("edited_at", m.edited_at);
  const { data, error } = await write.select("id");
  // Nothing matched: deleted, edited or moderated meanwhile; the newer state wins.
  if (error || !data || data.length === 0) return { status: "pending" };
  // Hidden first, then the file: a lost race leaves it for the next verdict.
  if (verdict.flagged && m.image_path && verdict.categories.includes("sexual/minors")) {
    await removeImage(supabase, MESSAGE_IMAGES_BUCKET, m.image_path, {
      mandatory: true,
      label: `message ${m.id}`,
    });
  }
  return verdict.flagged ? { status: "rejected", reason: verdict.reason } : { status: "published" };
}

// Inbox rows name their group when inbox has the column; no inbox module, no row.
async function notifyCreator(
  supabase: Admin,
  userId: string | null,
  kind: "group_approved" | "group_field_rejected",
  groupId: string,
): Promise<void> {
  if (!userId) return;
  let { error } = await supabase
    .from("notifications")
    .insert({ user_id: userId, kind, conversation_id: groupId });
  if (error && isMissingColumn(error.code)) {
    ({ error } = await supabase.from("notifications").insert({ user_id: userId, kind }));
  }
  if (error && error.code !== "42P01" && error.code !== "PGRST205") {
    console.error("group notification failed", kind, groupId, error.message);
  }
}

// Each pending field is judged on its own; the result is applied all or nothing (see
// nextGroupState). An approved image is copied from the private pending bucket to the
// public one under the group's folder. Allowed while no field waits for the creator's fix.
export async function moderateGroup(
  supabase: Admin,
  g: GroupRow,
): Promise<{ status: string; rejected: string[]; error?: string }> {
  const fields = groupFieldsToModerate(g);
  const done = { status: g.status, rejected: g.rejected_fields };
  if (g.status === "deleted" || fields.length === 0 || g.rejected_fields.length > 0) return done;

  const verdicts = await Promise.all(
    fields.map(async ({ field, value }) => {
      if (field !== "image") return { field, verdict: await moderateItem(value, null) };
      const url = await signedImageUrl(GROUP_IMAGES_PENDING_BUCKET, value);
      return { field, verdict: url ? await moderateItem("", url) : null };
    }),
  );
  if (verdicts.some((v) => !v.verdict)) return { ...done, error: "moderation unavailable" };
  const flagged = new Set(verdicts.filter((v) => v.verdict!.flagged).map((v) => v.field));
  const pendingImage = g.pending_image_path;
  const imageVerdict = verdicts.find((v) => v.field === "image")?.verdict;

  const update = nextGroupState(g, flagged);
  if (update.image_path) {
    const ext = update.image_path.split(".").pop();
    const finalPath = `${g.conversation_id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from(GROUP_IMAGES_PENDING_BUCKET)
      .copy(update.image_path, finalPath, { destinationBucket: GROUP_IMAGES_BUCKET });
    if (error) {
      console.error("group image copy failed", g.conversation_id, error.message);
      return { ...done, error: "image copy failed" };
    }
    update.image_path = finalPath;
  }

  let write = supabase
    .from("groups")
    .update(update)
    .eq("conversation_id", g.conversation_id)
    .eq("status", g.status)
    .eq("rejected_fields", "{}");
  for (const col of ["pending_name", "pending_description", "pending_image_path"] as const) {
    write = g[col] === null ? write.is(col, null) : write.eq(col, g[col]);
  }
  const { data, error } = await write.select("conversation_id");
  if (error || !data || data.length === 0) {
    // Edited or deleted meanwhile: the new values get their own run.
    if (update.image_path) await removeImage(supabase, GROUP_IMAGES_BUCKET, update.image_path);
    return { ...done, error: error ? "write failed" : undefined };
  }

  // After the write: a rejected or copied pending image is referenced no more.
  if (pendingImage && update.pending_image_path === null) {
    await removeImage(supabase, GROUP_IMAGES_PENDING_BUCKET, pendingImage, {
      mandatory: imageVerdict?.categories.includes("sexual/minors"),
      label: `group ${g.conversation_id}`,
    });
  }
  if (update.image_path && g.image_path) {
    await removeImage(supabase, GROUP_IMAGES_BUCKET, g.image_path);
  }
  if (update.rejected_fields.length > 0) {
    await notifyCreator(supabase, g.created_by, "group_field_rejected", g.conversation_id);
  } else if (g.status === "pending") {
    await notifyCreator(supabase, g.created_by, "group_approved", g.conversation_id);
  }
  // Approved values are live here: the translation pipeline hooks in at this point.
  return { status: update.status ?? g.status, rejected: update.rejected_fields };
}
