// update-profile: the ONLY write path for profiles.handle / bio / avatar_url.
// JWT-authenticated: uid comes from the caller's anon session token, never the
// body. Text fields run through OpenAI omni-moderation (same category logic
// as moderate-one); avatarPath runs image moderation on the object's public
// URL. Fail closed: if moderation is unreachable, nothing is written.
//
// Fields are applied sequentially (handle, then bio, then avatar); the first
// failure aborts and reports its field. The app's editors send one field at a
// time, so partial application is not observable in practice.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { adminClient, json, SUPABASE_URL } from "../_shared/client.ts";
import { assertModerationConfigured, moderateInput } from "../_shared/moderation.ts";

assertModerationConfigured();

const admin = adminClient();

Deno.serve(async (req) => {
  const caller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData } = await caller.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return json({ status: "error", error: "unauthorized" }, 401);

  let body: { handle?: unknown; bio?: unknown; avatarPath?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ status: "error", error: "bad request" }, 400);
  }
  const { handle, bio, avatarPath } = body;
  if (handle === undefined && bio === undefined && avatarPath === undefined) {
    return json({ status: "error", error: "bad request" }, 400);
  }
  if (
    (handle !== undefined && typeof handle !== "string") ||
    (bio !== undefined && typeof bio !== "string") ||
    (avatarPath !== undefined && typeof avatarPath !== "string")
  ) {
    return json({ status: "error", error: "bad request" }, 400);
  }

  // ============ HANDLE ============
  if (handle !== undefined) {
    const h = (handle as string).trim().toLowerCase();
    if (!/^[a-z0-9-]{3,20}$/.test(h)) {
      return json({ status: "error", error: "invalid_handle" }, 400);
    }
    const verdict = await moderateInput(h);
    if (!verdict) return json({ status: "error", error: "moderation unavailable" }, 503);
    if (verdict.flagged) {
      return json({ status: "rejected", field: "handle", reason: verdict.reason });
    }
    const { error } = await admin.from("profiles").update({ handle: h }).eq("id", uid);
    if (error) {
      if (error.code === "23505") {
        return json({ status: "error", code: "handle_taken" }, 409);
      }
      return json({ status: "error", error: error.message }, 500);
    }
  }

  // ============ BIO ============
  if (bio !== undefined) {
    const b = (bio as string).trim();
    if (b.length > 300) {
      return json({ status: "error", error: "bio_too_long" }, 400);
    }
    if (b !== "") {
      const verdict = await moderateInput(b);
      if (!verdict) return json({ status: "error", error: "moderation unavailable" }, 503);
      if (verdict.flagged) {
        return json({ status: "rejected", field: "bio", reason: verdict.reason });
      }
    }
    // Clearing the bio (empty string -> null) needs no moderation.
    const { error } = await admin
      .from("profiles")
      .update({ bio: b === "" ? null : b })
      .eq("id", uid);
    if (error) return json({ status: "error", error: error.message }, 500);
  }

  // ============ AVATAR ============
  if (avatarPath !== undefined) {
    const path = avatarPath as string;
    if (!path.startsWith(`${uid}/`) || path.includes("..")) {
      return json({ status: "error", error: "forbidden_path" }, 403);
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`;
    const verdict = await moderateInput([{ type: "image_url", image_url: { url: publicUrl } }]);
    if (!verdict) return json({ status: "error", error: "moderation unavailable" }, 503);
    if (verdict.flagged) {
      await admin.storage.from("avatars").remove([path]);
      return json({ status: "rejected", field: "avatar", reason: verdict.reason });
    }

    const { data: prevProfile } = await admin
      .from("profiles")
      .select("avatar_url")
      .eq("id", uid)
      .single();
    const { error } = await admin.from("profiles").update({ avatar_url: publicUrl }).eq("id", uid);
    if (error) return json({ status: "error", error: error.message }, 500);

    const previousUrl = prevProfile?.avatar_url as string | null | undefined;
    if (previousUrl && previousUrl !== publicUrl) {
      const marker = "/object/public/avatars/";
      const idx = previousUrl.indexOf(marker);
      if (idx !== -1) {
        // Best-effort: replacement cleanup should never block the response.
        await admin.storage.from("avatars").remove([previousUrl.slice(idx + marker.length)]);
      }
    }
  }

  // ============ SUCCESS ============
  const { data: profile } = await admin
    .from("profiles")
    .select("handle, bio, avatar_url")
    .eq("id", uid)
    .single();
  return json({
    status: "ok",
    handle: profile?.handle ?? null,
    bio: profile?.bio ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  });
});
