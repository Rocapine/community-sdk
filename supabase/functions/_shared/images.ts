// Post/comment images (optional `images` module): bucket name, public URL and
// the soft-failing lookups the moderation functions share.

import { adminClient, SUPABASE_URL } from "./client.ts";

type Admin = ReturnType<typeof adminClient>;

export const POST_IMAGES_BUCKET = "post-images";
export const MESSAGE_IMAGES_BUCKET = "message-images";
export const GROUP_IMAGES_BUCKET = "group-images";
export const GROUP_IMAGES_PENDING_BUCKET = "group-images-pending";

export function postImageUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${POST_IMAGES_BUCKET}/${path}`;
}

// A 10-minute URL to an object of a private bucket, for OpenAI to fetch. Null when
// it can't be signed (missing object, storage error): the caller fails closed.
export async function signedImageUrl(bucket: string, path: string): Promise<string | null> {
  const { data, error } = await adminClient().storage.from(bucket).createSignedUrl(path, 600);
  if (error || !data) {
    console.error("signed url failed", bucket, path, error?.message);
    return null;
  }
  return data.signedUrl;
}

export const messageImageUrl = (path: string) => signedImageUrl(MESSAGE_IMAGES_BUCKET, path);

// Postgres' undefined_column (42703) or PostgREST's own "column not found"
// (PGRST204): the install has no images module. Any other error is a transient
// failure, never "no image".
export const isMissingColumn = (code: string | undefined) =>
  code === "42703" || code === "PGRST204";

// Separate select (never part of a wider one) so an install without the images
// module keeps its text-only behavior: only a missing column means "no image".
// Any other error is `ok: false` and the caller must fail closed, otherwise an
// unchecked image could be published.
export async function fetchImagePath(
  supabase: Admin,
  table: "posts" | "comments",
  id: string,
): Promise<{ ok: true; path: string | null } | { ok: false }> {
  const { data, error } = await supabase.from(table).select("image_path").eq("id", id).single();
  if (error) return isMissingColumn(error.code) ? { ok: true, path: null } : { ok: false };
  return { ok: true, path: (data as { image_path: string | null } | null)?.image_path ?? null };
}

// Batch variant for the daily sweep, chunked so a backlog can't build an
// over-long URL. `paths` holds the rows that have an image; `failedIds` the
// rows whose chunk errored (caller must not process them this run). A missing
// column ends the lookup: no images module, nobody has an image.
export async function fetchImagePaths(
  supabase: Admin,
  table: "posts" | "comments",
  ids: string[],
  chunkSize = 100,
): Promise<{ paths: Map<string, string>; failedIds: Set<string> }> {
  const paths = new Map<string, string>();
  const failedIds = new Set<string>();
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from(table)
      .select("id, image_path")
      .in("id", chunk)
      .not("image_path", "is", null);
    if (error) {
      if (isMissingColumn(error.code)) return { paths: new Map(), failedIds: new Set() };
      chunk.forEach((id) => failedIds.add(id));
      continue;
    }
    for (const r of (data ?? []) as { id: string; image_path: string }[]) {
      paths.set(r.id, r.image_path);
    }
  }
  return { paths, failedIds };
}

// Group pictures and chat images nothing needs any more (groups/005): every file of a
// deleted group, and uploads no row points at after a day. Removed bucket by bucket;
// a missing RPC (no groups module) is a silent no-op. Returns how many files went, and
// the first error (surfaced in the Slack summary).
export async function sweepMessagingImages(
  supabase: Admin,
  limit = 500,
): Promise<{ removed: number; error?: string }> {
  const { data, error } = await supabase.rpc("messaging_images_unreferenced", { p_limit: limit });
  if (error) {
    const missing = error.code === "42883" || error.code === "PGRST202";
    if (!missing) console.error("messaging image sweep: list failed", error.message);
    return missing ? { removed: 0 } : { removed: 0, error: error.message };
  }
  const byBucket = new Map<string, string[]>();
  for (const { bucket, name } of (data ?? []) as { bucket: string; name: string }[]) {
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), name]);
  }
  let removed = 0;
  let firstError: string | undefined;
  for (const [bucket, names] of byBucket) {
    const { data: gone, error: removeError } = await supabase.storage.from(bucket).remove(names);
    if (removeError) {
      console.error("messaging image sweep: remove failed", bucket, removeError.message);
      firstError ??= removeError.message;
    } else removed += gone?.length ?? 0;
  }
  return firstError ? { removed, error: firstError } : { removed };
}
