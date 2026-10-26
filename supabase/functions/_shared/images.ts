// Post/comment images (optional `images` module): bucket name, public URL and
// the soft-failing lookups the moderation functions share.

import { adminClient, SUPABASE_URL } from "./client.ts";

type Admin = ReturnType<typeof adminClient>;

export const POST_IMAGES_BUCKET = "post-images";

export function postImageUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${POST_IMAGES_BUCKET}/${path}`;
}

// Postgres' undefined_column (42703) or PostgREST's own "column not found"
// (PGRST204): the install has no images module. Any other error is a transient
// failure, never "no image".
const isMissingColumn = (code: string | undefined) => code === "42703" || code === "PGRST204";

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
