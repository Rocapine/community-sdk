import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canAttach, resolveConfig, type CommunityConfig } from "../config";
import { mapPostRow } from "../models";
import { buildFeedSelect, createPost } from "../service";

const base = {
  supabase: null,
  appName: "t",
  topics: [{ id: "general" }],
  modules: { polls: true, push: false, inbox: false, reaction: false as const },
};

function fakeClient(inserted: { row?: Record<string, unknown> }): SupabaseClient {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: "uid1" } } } }) },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.row = row;
        return { select: () => ({ single: async () => ({ data: { id: "p1" }, error: null }) }) };
      },
    }),
  } as unknown as SupabaseClient;
}

const withAttachments = (
  supabase: SupabaseClient | null,
  membersCanAttach = true,
): CommunityConfig => ({
  ...base,
  supabase,
  modules: { ...base.modules, images: true, attachments: { types: ["verse"], membersCanAttach } },
});

const verse = { type: "verse", id: "43.3.16" };

describe("attachments", () => {
  it("selects the attachment only with the module", () => {
    expect(buildFeedSelect(undefined)).not.toContain("attachment");
    expect(buildFeedSelect(undefined, false, false, false, false, true)).toContain(", attachment");
  });

  it("maps a post's attachment, null without", () => {
    const row = {
      id: "p1",
      author_id: "u1",
      content: "",
      topic: null,
      status: "visible",
      created_at: "2026-11-01T00:00:00Z",
      pinned_at: null,
      profiles: null,
      likes: [],
      comments: [],
    };
    expect(
      mapPostRow({ ...row, attachment: verse } as never, "me", "x", [], new Set()).attachment,
    ).toEqual(verse);
    expect(mapPostRow(row as never, "me", "x", [], new Set()).attachment).toBeNull();
  });

  it("sends the attachment with the post", async () => {
    const inserted: { row?: Record<string, unknown> } = {};
    const cfg = resolveConfig(withAttachments(fakeClient(inserted)));
    await createPost(cfg, { topic: "general", body: "", attachment: verse });
    expect(inserted.row).toMatchObject({ content: "", attachment: verse });
  });

  it("refuses a type the app did not enable, or the module off", async () => {
    const cfg = resolveConfig(withAttachments(fakeClient({})));
    await expect(
      createPost(cfg, { topic: "general", body: "", attachment: { type: "recipe", id: "1" } }),
    ).rejects.toThrow("attachment type not enabled");
    await expect(
      createPost(resolveConfig({ ...base, supabase: fakeClient({}) }), {
        topic: "general",
        body: "",
        attachment: verse,
      }),
    ).rejects.toThrow("attachments module is not enabled");
  });

  it("refuses an attachment with a poll or an image", async () => {
    const cfg = resolveConfig(withAttachments(fakeClient({})));
    await expect(
      createPost(cfg, { topic: "general", body: "x", attachment: verse, pollOptions: ["a", "b"] }),
    ).rejects.toThrow("a post cannot have both an attachment and a poll or an image");
    await expect(
      createPost(cfg, {
        topic: "general",
        body: "x",
        attachment: verse,
        image: { path: "a/b.jpg", width: 1, height: 1 },
      }),
    ).rejects.toThrow("a post cannot have both an attachment and a poll or an image");
  });

  it("lets admins attach always, members when the app allows it", () => {
    const allowed = resolveConfig(withAttachments(null, true));
    const adminsOnly = resolveConfig(withAttachments(null, false));
    expect(canAttach(allowed, false)).toBe(true);
    expect(canAttach(adminsOnly, false)).toBe(false);
    expect(canAttach(adminsOnly, true)).toBe(true);
    expect(canAttach(resolveConfig(base), true)).toBe(false);
  });
});
