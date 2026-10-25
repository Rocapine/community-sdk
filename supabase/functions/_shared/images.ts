// Post/comment images (optional `images` module): bucket name, public URL and
// the soft-failing lookups the moderation functions share.

import { adminClient, SUPABASE_URL } from "./client.ts";

type Admin = ReturnType<typeof adminClient>;

export const POST_IMAGES_BUCKET = "post-images";

export function postImageUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${POST_IMAGES_BUCKET}/${path}`;
}

// Separate select (never part of a wider one) so an install without the images
// module — where image_path doesn't exist — keeps its text-only behavior: any
// error means "no image".
export async function fetchImagePath(
  supabase: Admin,
  table: "posts" | "comments",
  id: string,
): Promise<string | null> {
  const { data, error } = await supabase.from(table).select("image_path").eq("id", id).single();
  if (error) return null;
  return (data as { image_path: string | null } | null)?.image_path ?? null;
}
