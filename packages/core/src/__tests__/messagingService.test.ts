import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetIdentity } from "../identity";
import { fetchMessages, MessagingError, messageImageUrl, sendMessage } from "../messaging-service";
import { reportContent } from "../service";
import { cfgWith, fakeClient, rpcArgs } from "./fakeSupabase";

const messageRow = (over: object = {}) => ({
  id: "m1",
  conversation_id: "c1",
  author_id: "uid1",
  body: "hi",
  image_path: null,
  attachment_type: null,
  attachment_id: null,
  reply_to_id: null,
  status: "visible",
  deleted_by: null,
  edited_at: null,
  created_at: "2026-11-27T10:00:00Z",
  like_count: 0,
  reply_to: null,
  ...over,
});

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

describe("sendMessage", () => {
  it("maps a raised rate_limited to MessagingError('rate_limited')", async () => {
    const client = fakeClient({
      rpc: () => ({ data: null, error: { code: "P0001", message: "rate_limited" } }),
    });
    const err = await sendMessage(cfgWith(client), { conversationId: "c1", body: "hi" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MessagingError);
    expect((err as MessagingError).code).toBe("rate_limited");
  });

  it("maps an unknown error to code 'unknown'", async () => {
    const client = fakeClient({ rpc: () => ({ data: null, error: { message: "boom" } }) });
    const err = await sendMessage(cfgWith(client), { conversationId: "c1", body: "hi" }).catch(
      (e: unknown) => e,
    );
    expect((err as MessagingError).code).toBe("unknown");
  });

  it("uploads the image first and sends the uploaded path", async () => {
    const client = fakeClient({
      rpc: () => ({ data: { id: "m1", status: "pending", moderated_at: null }, error: null }),
      tables: { messages: { data: messageRow({ status: "pending" }), error: null } },
    });
    await sendMessage(cfgWith(client), { conversationId: "c1", imageUri: "file:///a.jpg" });
    const upload = client.order[0]!;
    expect(upload).toMatch(/^upload:message-images:c1\/uid1\/[0-9a-f-]{36}\.jpg$/);
    expect(client.order[1]).toBe("rpc:send_message");
    const args = rpcArgs(client, "send_message")!;
    expect(`upload:message-images:${String(args.p_image_path)}`).toBe(upload);
  });

  it("awaits moderate-one with kind 'message' for a pending message", async () => {
    const client = fakeClient({
      rpc: () => ({ data: { id: "m1", status: "pending", moderated_at: null }, error: null }),
      tables: { messages: { data: messageRow(), error: null } },
    });
    let release = () => {};
    client.functions.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: { status: "published" }, error: null });
        }),
    );
    let settled = false;
    const sending = sendMessage(cfgWith(client), { conversationId: "c1", body: "hi" }).then((m) => {
      settled = true;
      return m;
    });
    await vi.waitFor(() =>
      expect(client.functions.invoke).toHaveBeenCalledWith("moderate-one", {
        body: { kind: "message", id: "m1" },
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    // Still waiting on the verdict: no read-back yet, not resolved.
    expect(settled).toBe(false);
    expect(client.order).not.toContain("from:messages");
    release();
    const message = await sending;
    expect(client.order).toContain("from:messages");
    expect(message.status).toBe("visible");
  });

  it("checks a visible, unmoderated message in the background (post mode)", async () => {
    const client = fakeClient({
      rpc: () => ({ data: { id: "m1", status: "visible", moderated_at: null }, error: null }),
      tables: { messages: { data: messageRow(), error: null } },
    });
    let release = () => {};
    client.functions.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: { status: "published" }, error: null });
        }),
    );
    const message = await sendMessage(cfgWith(client), { conversationId: "c1", body: "hi" });
    expect(message.id).toBe("m1"); // resolved while moderation is still running
    expect(client.functions.invoke).toHaveBeenCalledWith("moderate-one", {
      body: { kind: "message", id: "m1" },
    });
    release();
  });

  it("never calls moderation for reportOnly text (moderated_at already set)", async () => {
    const client = fakeClient({
      rpc: () => ({
        data: { id: "m1", status: "visible", moderated_at: "2026-11-27T10:00:00Z" },
        error: null,
      }),
      tables: { messages: { data: messageRow(), error: null } },
    });
    await sendMessage(cfgWith(client), { conversationId: "c1", body: "hi" });
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });

  it("does nothing when the groups module is off", async () => {
    const client = fakeClient({});
    await expect(
      sendMessage(cfgWith(client, { groups: false }), { conversationId: "c1", body: "hi" }),
    ).rejects.toThrow("groups module is not enabled");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("sendMessage attachment", () => {
  it("refuses a type the app doesn't attach with MessagingError('invalid_attachment')", async () => {
    const client = fakeClient({});
    const err = await sendMessage(cfgWith(client), {
      conversationId: "c1",
      attachment: { type: "video", id: "v1" },
    }).catch((e: unknown) => e);
    expect((err as MessagingError).code).toBe("invalid_attachment");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("fetchMessages", () => {
  it("pages with a (created_at, id) keyset, so equal timestamps cross a page boundary", async () => {
    const client = fakeClient({ tables: { messages: { data: [], error: null } } });
    const at = "2026-11-27T10:00:00.123+00:00";
    await fetchMessages(cfgWith(client), "c1", { before: { createdAt: at, id: "m5" } });
    const calls = client.queries.messages![0]!.calls;
    expect(calls).toContainEqual([
      "or",
      [`created_at.lt."${at}",and(created_at.eq."${at}",id.lt.m5)`],
    ]);
    expect(calls.filter(([m]) => m === "order").map(([, a]) => a[0])).toEqual(["created_at", "id"]);
  });

  it("sends no cursor on the first page", async () => {
    const client = fakeClient({ tables: { messages: { data: [], error: null } } });
    await fetchMessages(cfgWith(client), "c1");
    expect(client.queries.messages![0]!.calls.map(([m]) => m)).not.toContain("or");
  });
});

describe("messageImageUrl", () => {
  it("caches per member and drops the cache on an identity change", async () => {
    const client = fakeClient({});
    const signed = vi.fn(async (path: string) => ({
      data: { signedUrl: `https://signed/${path}?n=${signed.mock.calls.length}` },
      error: null,
    }));
    client.storage.from.mockImplementation(() => ({ createSignedUrl: signed }) as never);
    const cfg = cfgWith(client);
    const first = await messageImageUrl(cfg, "c1/u/a.jpg");
    expect(await messageImageUrl(cfg, "c1/u/a.jpg")).toBe(first);
    expect(signed).toHaveBeenCalledTimes(1);

    resetIdentity();
    client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "uid2" } } } });
    expect(await messageImageUrl(cfg, "c1/u/a.jpg")).not.toBe(first);
    expect(signed).toHaveBeenCalledTimes(2);
  });
});

describe("reportContent", () => {
  it("sends message_id / group_id only when set", async () => {
    const client = fakeClient({ tables: { reports: { data: null, error: null } } });
    const cfg = cfgWith(client);
    await reportContent(cfg, { reportedUserId: "u2", postId: "p1", reason: "spam" });
    await reportContent(cfg, { reportedUserId: "u2", messageId: "m1", reason: "spam" });
    const inserted = client.queries.reports!.map(
      (q) => q.calls.find(([m]) => m === "insert")![1][0] as Record<string, unknown>,
    );
    expect(inserted[0]).not.toHaveProperty("message_id");
    expect(inserted[0]).not.toHaveProperty("group_id");
    expect(inserted[1]).toMatchObject({ message_id: "m1" });
  });
});
