import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import { sendTyping, subscribeConversation } from "../realtime";

vi.mock("../service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../service")>()),
  requireUid: vi.fn(async () => "uid1"),
}));

type Binding = { type: string; filter: Record<string, unknown>; cb: (p: unknown) => void };

function fakeChannel(topic: string, opts: unknown) {
  const ch = {
    topic,
    opts,
    bindings: [] as Binding[],
    status: null as null | ((s: string) => void),
    send: vi.fn(async () => "ok"),
    on(type: string, filter: Record<string, unknown>, cb: (p: unknown) => void) {
      ch.bindings.push({ type, filter, cb });
      return ch;
    },
    subscribe(cb: (s: string) => void) {
      ch.status = cb;
      return ch;
    },
    fire(type: string, payload: unknown) {
      for (const b of ch.bindings.filter((x) => x.type === type)) b.cb(payload);
    },
  };
  return ch;
}

function setup() {
  const channels: ReturnType<typeof fakeChannel>[] = [];
  const order: string[] = [];
  const client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: "uid1" }, access_token: "tok" } },
      })),
    },
    realtime: { setAuth: vi.fn(async (t: string) => void order.push(`setAuth:${t}`)) },
    channel: vi.fn((topic: string, opts: unknown) => {
      order.push(`channel:${topic}`);
      const ch = fakeChannel(topic, opts);
      const subscribe = ch.subscribe;
      ch.subscribe = (cb) => {
        order.push("subscribe");
        return subscribe(cb);
      };
      channels.push(ch);
      return ch;
    }),
    removeChannel: vi.fn(async () => "ok"),
  };
  const cfg = resolveConfig({
    supabase: client as never,
    appName: "t",
    topics: [],
    modules: { polls: false, push: false, inbox: false, reaction: false, groups: {} },
  });
  return { client, cfg, channels, order };
}

const handlers = () => ({ onChange: vi.fn(), onTyping: vi.fn() });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("opens one private channel per conversation, authorised before it subscribes", async () => {
  const { cfg, client, channels, order } = setup();
  const stop = subscribeConversation(cfg, "c1", handlers());
  await vi.advanceTimersByTimeAsync(0);
  expect(client.channel).toHaveBeenCalledTimes(1);
  expect(channels[0]!.topic).toBe("conversation:c1");
  expect(channels[0]!.opts).toEqual({ config: { private: true } });
  expect(order).toEqual(["setAuth:tok", "channel:conversation:c1", "subscribe"]);
  const changes = channels[0]!.bindings.filter((b) => b.type === "postgres_changes");
  expect(changes.map((b) => b.filter)).toEqual([
    { event: "*", schema: "public", table: "messages", filter: "conversation_id=eq.c1" },
  ]);
  expect(channels[0]!.bindings.some((b) => b.type === "broadcast" && b.filter.event === "typing"));
  stop();
});

it("returns an unsubscribe that removes the channel", async () => {
  const { cfg, client, channels } = setup();
  const stop = subscribeConversation(cfg, "c1", handlers());
  await vi.advanceTimersByTimeAsync(0);
  stop();
  await vi.advanceTimersByTimeAsync(2000);
  expect(client.removeChannel).toHaveBeenCalledWith(channels[0]);
});

it("shares one channel between subscribers and survives a StrictMode remount", async () => {
  const { cfg, client } = setup();
  const a = subscribeConversation(cfg, "c1", handlers());
  const b = subscribeConversation(cfg, "c1", handlers());
  await vi.advanceTimersByTimeAsync(0);
  a();
  b();
  const again = subscribeConversation(cfg, "c1", handlers()); // remount in the same tick
  await vi.advanceTimersByTimeAsync(5000);
  expect(client.channel).toHaveBeenCalledTimes(1);
  expect(client.removeChannel).not.toHaveBeenCalled();
  again();
  await vi.advanceTimersByTimeAsync(5000);
  expect(client.removeChannel).toHaveBeenCalledTimes(1);
});

it("debounces database changes into one onChange", async () => {
  const { cfg, channels } = setup();
  const h = handlers();
  const stop = subscribeConversation(cfg, "c1", h);
  await vi.advanceTimersByTimeAsync(0);
  channels[0]!.fire("postgres_changes", { eventType: "INSERT" });
  channels[0]!.fire("postgres_changes", { eventType: "UPDATE" });
  await vi.advanceTimersByTimeAsync(100);
  channels[0]!.fire("postgres_changes", { eventType: "UPDATE" });
  expect(h.onChange).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(150);
  expect(h.onChange).toHaveBeenCalledTimes(1);
  stop();
});

it("forwards typing broadcasts with their user id", async () => {
  const { cfg, channels } = setup();
  const h = handlers();
  const stop = subscribeConversation(cfg, "c1", h);
  await vi.advanceTimersByTimeAsync(0);
  channels[0]!.fire("broadcast", { event: "typing", payload: { userId: "u2" } });
  channels[0]!.fire("broadcast", { event: "typing", payload: {} });
  expect(h.onTyping).toHaveBeenCalledTimes(1);
  expect(h.onTyping).toHaveBeenCalledWith("u2");
  stop();
});

it("a (re)join refetches: every SUBSCRIBED calls onChange", async () => {
  const { cfg, channels } = setup();
  const h = handlers();
  const stop = subscribeConversation(cfg, "c1", h);
  await vi.advanceTimersByTimeAsync(0);
  channels[0]!.status!("SUBSCRIBED");
  await vi.advanceTimersByTimeAsync(200);
  channels[0]!.status!("CHANNEL_ERROR");
  channels[0]!.status!("SUBSCRIBED"); // reconnected after a drop or a sleeping tab
  await vi.advanceTimersByTimeAsync(200);
  expect(h.onChange).toHaveBeenCalledTimes(2);
  stop();
});

it("sends typing at most once per 3 s, only once joined", async () => {
  const { cfg, channels } = setup();
  const stop = subscribeConversation(cfg, "c1", handlers());
  await vi.advanceTimersByTimeAsync(0);
  sendTyping(cfg, "c1");
  expect(channels[0]!.send).not.toHaveBeenCalled(); // not joined yet
  channels[0]!.status!("SUBSCRIBED");
  sendTyping(cfg, "c1");
  sendTyping(cfg, "c1");
  expect(channels[0]!.send).toHaveBeenCalledTimes(1);
  expect(channels[0]!.send).toHaveBeenCalledWith({
    type: "broadcast",
    event: "typing",
    payload: { userId: "uid1" },
  });
  await vi.advanceTimersByTimeAsync(3000);
  sendTyping(cfg, "c1");
  expect(channels[0]!.send).toHaveBeenCalledTimes(2);
  stop();
});

it("does nothing when the groups module is off", async () => {
  const { client } = setup();
  const off = resolveConfig({
    supabase: client as never,
    appName: "t",
    topics: [],
    modules: { polls: false, push: false, inbox: false, reaction: false },
  });
  const stop = subscribeConversation(off, "c1", handlers());
  await vi.advanceTimersByTimeAsync(0);
  expect(client.channel).not.toHaveBeenCalled();
  stop();
});

it("a moderation hide (broadcast `changed`, messaging/004) calls onChange", async () => {
  const { cfg, channels } = setup();
  const h = handlers();
  const stop = subscribeConversation(cfg, "c1", h);
  await vi.advanceTimersByTimeAsync(0);
  channels[0]!.fire("broadcast", { event: "changed", payload: { id: "m2" } });
  await vi.advanceTimersByTimeAsync(150);
  expect(h.onChange).toHaveBeenCalledTimes(1);
  expect(h.onTyping).not.toHaveBeenCalled();
  stop();
});

it("re-opening while the old channel is closing waits for it, then opens a live one", async () => {
  const { cfg, client, channels } = setup();
  let closed!: (v: string) => void;
  client.removeChannel.mockImplementationOnce(() => new Promise((r) => (closed = r)));
  const stop = subscribeConversation(cfg, "c1", handlers());
  await vi.advanceTimersByTimeAsync(0);
  stop();
  await vi.advanceTimersByTimeAsync(1000); // released: removeChannel in flight
  expect(client.removeChannel).toHaveBeenCalledTimes(1);
  const h = handlers();
  const again = subscribeConversation(cfg, "c1", h);
  await vi.advanceTimersByTimeAsync(0);
  expect(client.channel).toHaveBeenCalledTimes(1); // not on top of the closing one
  closed("ok");
  await vi.advanceTimersByTimeAsync(0);
  expect(client.channel).toHaveBeenCalledTimes(2);
  channels[1]!.status!("SUBSCRIBED");
  await vi.advanceTimersByTimeAsync(150);
  expect(h.onChange).toHaveBeenCalledTimes(1);
  again();
});
