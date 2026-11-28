import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGroup,
  fetchGroup,
  fetchGroupOnlineCounts,
  fetchGroupRemovals,
  searchGroups,
} from "../groups-service";
import { fetchConversations } from "../messaging-service";
import { resetIdentity } from "../identity";
import { cfgWith, fakeClient, rpcArgs } from "./fakeSupabase";

const searchRow = {
  group_id: "g1",
  name: "Nom",
  description: "Desc",
  image_path: "g1/a.jpg",
  member_count: 3,
  last_activity_at: "2026-11-27T10:00:00Z",
  is_member: false,
};

beforeEach(() => {
  resetIdentity();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("searchGroups", () => {
  it("sends the reader locale and no cursor on the first page", async () => {
    const client = fakeClient({ rpc: () => ({ data: [searchRow], error: null }) });
    const cfg = cfgWith(client, { translation: { locales: ["en", "fr"] } });
    const [group] = await searchGroups(cfg, { query: " prière " });
    expect(client.rpc).toHaveBeenCalledWith("search_groups", {
      p_query: "prière",
      p_locale: "fr",
      p_limit: 30,
    });
    expect(group).toMatchObject({ id: "g1", imageUrl: "https://cdn/group-images/g1/a.jpg" });
  });

  it("sends both cursor values together", async () => {
    const client = fakeClient({ rpc: () => ({ data: [], error: null }) });
    await searchGroups(cfgWith(client), {
      before: { id: "g9", lastActivityAt: "2026-11-01T00:00:00Z" },
    });
    expect(rpcArgs(client, "search_groups")).toMatchObject({
      p_locale: null,
      p_before_activity: "2026-11-01T00:00:00Z",
      p_before_id: "g9",
    });
  });
});

describe("fetchGroupOnlineCounts", () => {
  it("returns {} without calling the RPC when presence is off", async () => {
    const client = fakeClient({});
    expect(await fetchGroupOnlineCounts(cfgWith(client), ["g1"])).toEqual({});
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("maps the RPC rows when presence is on", async () => {
    const client = fakeClient({
      rpc: () => ({ data: [{ group_id: "g1", online: 2 }], error: null }),
    });
    const cfg = cfgWith(client, { presence: {} });
    expect(await fetchGroupOnlineCounts(cfg, ["g1"])).toEqual({ g1: 2 });
  });
});

describe("fetchGroup", () => {
  it("tells a removed member they were removed", async () => {
    const client = fakeClient({
      tables: {
        groups: {
          data: {
            conversation_id: "g1",
            name: "Nom",
            description: "Desc",
            image_path: null,
            status: "visible",
            created_by: "other",
            member_count: 3,
            last_activity_at: "2026-11-27T10:00:00Z",
          },
          error: null,
        },
        conversation_members: { data: { state: "removed", role: "member" }, error: null },
      },
    });
    expect(await fetchGroup(cfgWith(client), "g1")).toMatchObject({
      removed: true,
      isMember: false,
      myRole: null,
    });
  });

  it("never selects the hidden columns, and shows its creator the review state", async () => {
    const client = fakeClient({
      tables: {
        groups: {
          data: {
            conversation_id: "g1",
            name: null,
            description: null,
            image_path: null,
            status: "pending",
            created_by: "uid1",
            member_count: 1,
            last_activity_at: "2026-11-27T10:00:00Z",
          },
          error: null,
        },
        conversation_members: { data: { state: "active", role: "creator" }, error: null },
      },
      rpc: () => ({
        data: [
          {
            pending_name: "Mine",
            pending_description: "Mine too",
            pending_image_path: null,
            rejected_fields: ["name"],
            status: "pending",
          },
        ],
        error: null,
      }),
    });
    const group = await fetchGroup(cfgWith(client), "g1");
    const select = client.queries.groups![0]!.calls.find(([m]) => m === "select")![1][0] as string;
    expect(select).not.toMatch(/\*|pending_|rejected_fields/);
    expect(client.rpc).toHaveBeenCalledWith("my_group_review", { p_group: "g1" });
    expect(group).toMatchObject({
      name: "Mine",
      status: "pending",
      rejectedFields: ["name"],
      isCreator: true,
      creatorId: "uid1",
      myRole: "creator",
      isMember: true,
      removed: false,
    });
  });

  it("keeps a moderator-hidden group hidden, never pending (R13)", async () => {
    const client = fakeClient({
      tables: {
        groups: {
          data: {
            conversation_id: "g1",
            name: "Live",
            description: "D",
            image_path: null,
            status: "hidden",
            created_by: "other",
            member_count: 4,
            last_activity_at: "2026-11-27T10:00:00Z",
          },
          error: null,
        },
        conversation_members: { data: { state: "removed", role: "creator" }, error: null },
      },
    });
    expect(await fetchGroup(cfgWith(client), "g1")).toMatchObject({
      status: "hidden",
      isMember: false,
      myRole: null,
    });
  });

  it("is null for a deleted group", async () => {
    const client = fakeClient({
      tables: { groups: { data: { conversation_id: "g1", status: "deleted" }, error: null } },
    });
    expect(await fetchGroup(cfgWith(client), "g1")).toBeNull();
  });
});

describe("createGroup", () => {
  it("uploads the image to the pending bucket, creates, then moderates the group", async () => {
    const client = fakeClient({ rpc: () => ({ data: "g1", error: null }) });
    const id = await createGroup(cfgWith(client), {
      name: "N",
      description: "D",
      imageUri: "file:///a.jpg",
    });
    expect(id).toBe("g1");
    expect(client.order[0]).toMatch(
      /^upload:group-images-pending:uid1\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/,
    );
    expect(client.order.slice(1)).toEqual([
      "rpc:create_group",
      'fn:moderate-one:{"kind":"group","id":"g1"}',
    ]);
  });
});

describe("fetchConversations", () => {
  it("maps a group's live title, picture and status (groups/003)", async () => {
    const row = {
      conversation_id: "g1",
      kind: "group",
      last_message_at: null,
      last_message_id: null,
      last_body: null,
      last_author_id: null,
      unread: 2,
      notify: false,
      role: "member",
    };
    const client = fakeClient({
      rpc: () => ({
        data: [
          { ...row, title: "Nom", image_path: "g1/a.jpg", group_status: "hidden" },
          { ...row, conversation_id: "g2" },
        ],
        error: null,
      }),
    });
    const [a, b] = await fetchConversations(cfgWith(client));
    expect(a).toMatchObject({
      title: "Nom",
      imageUrl: "https://cdn/group-images/g1/a.jpg",
      groupStatus: "hidden",
    });
    // An older backend (messaging/001 only) answers without the new columns.
    expect(b).toMatchObject({ title: null, imageUrl: null, groupStatus: null });
  });
});

describe("fetchGroupRemovals", () => {
  it("reads the group's removals and filters them by username", async () => {
    const client = fakeClient({
      tables: {
        group_removals: {
          data: [
            { user_id: "u1", removed_at: "2026-11-27T10:00:00Z", profiles: { username: "Ana" } },
            { user_id: "u2", removed_at: "2026-11-26T10:00:00Z", profiles: { username: "Marc" } },
          ],
          error: null,
        },
      },
    });
    const removed = await fetchGroupRemovals(cfgWith(client), "g1", " an ");
    expect(removed).toEqual([{ userId: "u1", username: "Ana", removedAt: "2026-11-27T10:00:00Z" }]);
  });
});

describe("notification preferences", () => {
  it("reads and writes the group-message switch only with the groups module", async () => {
    const { fetchNotificationPreferences, setNotificationPreference } = await import("../service");
    const withGroups = fakeClient({ tables: { push_tokens: { data: null, error: null } } });
    await fetchNotificationPreferences(cfgWith(withGroups));
    expect(withGroups.queries.push_tokens[0].calls[0]).toEqual([
      "select",
      ["notify_likes,notify_comments,notify_reactions,notify_group_messages"],
    ]);

    const without = fakeClient({ tables: { push_tokens: { data: null, error: null } } });
    const cfg = cfgWith(without, { groups: false });
    await fetchNotificationPreferences(cfg);
    expect(without.queries.push_tokens[0].calls[0]).toEqual([
      "select",
      ["notify_likes,notify_comments,notify_reactions"],
    ]);
    await expect(setNotificationPreference(cfg, "notify_group_messages", false)).rejects.toThrow(
      "groups module",
    );
    await expect(setNotificationPreference(cfg, "notify_dms", false)).rejects.toThrow("dms module");
  });

  it("lists the DM switch only with the dms module", async () => {
    const { notificationPreferenceKeys } = await import("../service");
    expect(notificationPreferenceKeys({ modules: { groups: {} } })).not.toContain("notify_dms");
    expect(notificationPreferenceKeys({ modules: { dms: {} } })).toEqual([
      "notify_likes",
      "notify_comments",
      "notify_reactions",
      "notify_dms",
    ]);
    expect(notificationPreferenceKeys({ modules: { groups: {}, dms: false } })).not.toContain(
      "notify_dms",
    );
  });
});
