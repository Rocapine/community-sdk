import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchDmFlags,
  fetchDmRequests,
  fetchPeerRead,
  searchMembers,
  startDm,
} from "../dms-service";
import { resetIdentity } from "../identity";
import { fetchConversations, MessagingError } from "../messaging-service";
import { cfgWith, fakeClient, rpcArgs } from "./fakeSupabase";

beforeEach(() => resetIdentity());
afterEach(() => vi.restoreAllMocks());

const dmsOnly = { groups: false as const, dms: {} };

describe("startDm", () => {
  it.each(["dms_off", "declined_recently", "too_many_requests", "blocked", "account_required"])(
    "maps a raised %s to its MessagingError code",
    async (code) => {
      const client = fakeClient({
        rpc: () => ({ data: null, error: { code: "P0001", message: code } }),
      });
      const err = await startDm(cfgWith(client, dmsOnly), "u2").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MessagingError);
      expect((err as MessagingError).code).toBe(code);
    },
  );

  it("returns the conversation id", async () => {
    const client = fakeClient({ rpc: () => ({ data: "c9", error: null }) });
    await expect(startDm(cfgWith(client, dmsOnly), "u2")).resolves.toBe("c9");
    expect(rpcArgs(client, "start_dm")).toEqual({ p_recipient: "u2" });
  });

  it("refuses when the dms module is off", async () => {
    const client = fakeClient({});
    await expect(startDm(cfgWith(client), "u2")).rejects.toThrow("dms module is not enabled");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

const row = (id: string, kind: "dm" | "group") => ({
  conversation_id: id,
  kind,
  last_message_at: null,
  last_message_id: null,
  last_body: null,
  last_author_id: null,
  unread: 0,
  notify: true,
  role: "member",
});

describe("fetchConversations with dms", () => {
  it("attaches peerId and requestState to DMs", async () => {
    const client = fakeClient({
      rpc: (fn) =>
        fn === "list_conversations"
          ? { data: [row("c1", "dm"), row("c2", "group"), row("c3", "dm")], error: null }
          : { data: [{ conversation_id: "c1", peer_id: "u2", my_state: "active" }], error: null },
    });
    const list = await fetchConversations(cfgWith(client, { dms: {} }));
    expect(list.map((c) => [c.id, c.peerId, c.requestState])).toEqual([
      ["c1", "u2", "active"],
      ["c2", null, null],
      ["c3", null, null], // blocked peer: dm_peers leaves it out
    ]);
  });

  it("works with dms alone and adds no query without dms", async () => {
    const dms = fakeClient({ rpc: () => ({ data: [], error: null }) });
    await fetchConversations(cfgWith(dms, dmsOnly));
    expect(dms.order).toEqual(["rpc:list_conversations", "rpc:dm_peers"]);
    const groups = fakeClient({ rpc: () => ({ data: [row("c2", "group")], error: null }) });
    const [c] = await fetchConversations(cfgWith(groups));
    expect(groups.order).toEqual(["rpc:list_conversations"]);
    expect([c!.peerId, c!.requestState]).toEqual([null, null]);
  });
});

describe("fetchDmRequests", () => {
  it("maps list_dm_requests", async () => {
    const client = fakeClient({
      rpc: () => ({
        data: [
          {
            conversation_id: "c1",
            sender_id: "u2",
            last_body: "hey",
            last_has_image: false,
            last_at: "2026-11-28T10:00:00Z",
            groups_in_common: 2,
            common_group_names: ["A", "B"],
            member_since: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      }),
    });
    expect(await fetchDmRequests(cfgWith(client, dmsOnly))).toEqual([
      {
        conversationId: "c1",
        senderId: "u2",
        lastBody: "hey",
        lastHasImage: false,
        lastAt: "2026-11-28T10:00:00Z",
        groupsInCommon: 2,
        commonGroupNames: ["A", "B"],
        memberSince: "2026-01-01T00:00:00Z",
      },
    ]);
  });
});

describe("fetchPeerRead", () => {
  it("is null without a query when read receipts are off", async () => {
    const client = fakeClient({ rpc: () => ({ data: "2026-11-28T10:00:00Z", error: null }) });
    expect(await fetchPeerRead(cfgWith(client, dmsOnly), "c1")).toBeNull();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("reads dm_peer_read when they are on", async () => {
    const client = fakeClient({ rpc: () => ({ data: "2026-11-28T10:00:00Z", error: null }) });
    const cfg = cfgWith(client, { ...dmsOnly, dms: { readReceipts: true } });
    expect(await fetchPeerRead(cfg, "c1")).toBe("2026-11-28T10:00:00Z");
    expect(rpcArgs(client, "dm_peer_read")).toEqual({ p_conversation: "c1" });
  });
});

describe("fetchDmFlags", () => {
  it("lists the members I may start a DM with", async () => {
    const flags = [
      { user_id: "u2", accepts_dms: true, has_account: true },
      { user_id: "u3", accepts_dms: false, has_account: true },
      { user_id: "u4", accepts_dms: true, has_account: false },
    ];
    const client = fakeClient({ rpc: () => ({ data: flags, error: null }) });
    expect(await fetchDmFlags(cfgWith(client, dmsOnly), ["u2", "u3", "u4", "u5"])).toEqual([
      "u2",
      "u4",
    ]);
    const strict = fakeClient({ rpc: () => ({ data: flags, error: null }) });
    const cfg = cfgWith(strict, { ...dmsOnly, dms: { requireAccount: true } });
    expect(await fetchDmFlags(cfg, ["u2", "u3", "u4"])).toEqual(["u2"]);
  });
});

describe("searchMembers", () => {
  it("searches usernames and keeps those who take DMs", async () => {
    const client = fakeClient({
      tables: {
        profiles: {
          data: [
            {
              id: "u2",
              username: "Ann",
              handle: "ann",
              is_admin: false,
              bio: null,
              avatar_url: null,
            },
            {
              id: "u3",
              username: "Anna",
              handle: "anna",
              is_admin: false,
              bio: null,
              avatar_url: null,
            },
          ],
          error: null,
        },
      },
      rpc: () => ({ data: [{ user_id: "u2", accepts_dms: true, has_account: true }], error: null }),
    });
    const found = await searchMembers(cfgWith(client, dmsOnly), "  an ");
    expect(found.map((p) => p.id)).toEqual(["u2"]);
    const calls = client.queries.profiles![0]!.calls;
    expect(calls[0]![1]![0]).not.toContain("*");
    expect(calls).toContainEqual(["ilike", ["username", "%an%"]]);
    expect(calls).toContainEqual(["neq", ["id", "uid1"]]);
  });

  it("returns nothing for an empty query", async () => {
    const client = fakeClient({});
    expect(await searchMembers(cfgWith(client, dmsOnly), " ")).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });
});
