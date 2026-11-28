import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import { REFUSED_RETRY_MAX_MS, sendTyping, subscribeConversation, subscribeDms } from "../realtime";

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
    status: null as null | ((s: string, err?: Error) => void),
    send: vi.fn(async () => "ok"),
    on(type: string, filter: Record<string, unknown>, cb: (p: unknown) => void) {
      ch.bindings.push({ type, filter, cb });
      return ch;
    },
    subscribe(cb: (s: string, err?: Error) => void) {
      ch.status = cb;
      return ch;
    },
    fire(type: string, payload: unknown) {
      // A broadcast binding hears only its event, like realtime-js.
      const event = (payload as { event?: unknown } | null)?.event;
      for (const b of ch.bindings.filter(
        (x) => x.type === type && (type !== "broadcast" || x.filter.event === event),
      ))
        b.cb(payload);
    },
  };
  return ch;
}

function setup(modules: Record<string, unknown> = { groups: {} }) {
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
    modules: { polls: false, push: false, inbox: false, reaction: false, ...modules },
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

it("a member count change (broadcast `members`, groups/004) calls onMembers only", async () => {
  const { cfg, channels } = setup();
  const h = { ...handlers(), onMembers: vi.fn() };
  const stop = subscribeConversation(cfg, "c1", h);
  const bare = handlers(); // a listener without onMembers is skipped
  const stopBare = subscribeConversation(cfg, "c1", bare);
  await vi.advanceTimersByTimeAsync(0);
  channels[0]!.fire("broadcast", { event: "members", payload: { id: "c1" } });
  await vi.advanceTimersByTimeAsync(150);
  expect(h.onMembers).toHaveBeenCalledTimes(1);
  expect(h.onChange).not.toHaveBeenCalled();
  expect(bare.onTyping).not.toHaveBeenCalled();
  stop();
  stopBare();
});

it("a read mark (broadcast `read`, dms/003) calls onRead only", async () => {
  const { cfg, channels } = setup();
  const h = { ...handlers(), onRead: vi.fn() };
  const stop = subscribeConversation(cfg, "c1", h);
  await vi.advanceTimersByTimeAsync(0);
  channels[0]!.fire("broadcast", { event: "read", payload: { id: "c1" } });
  await vi.advanceTimersByTimeAsync(150);
  expect(h.onRead).toHaveBeenCalledTimes(1);
  expect(h.onChange).not.toHaveBeenCalled();
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

it("dms/005: one private channel of my own, whose `changed` calls onChange", async () => {
  const { cfg, client, channels } = setup({ dms: {} });
  const onChange = vi.fn();
  const other = vi.fn();
  const stop = subscribeDms(cfg, "uid1", onChange);
  const stopOther = subscribeDms(cfg, "uid1", other); // the badge and the list share it
  await vi.advanceTimersByTimeAsync(0);
  expect(client.channel).toHaveBeenCalledTimes(1);
  expect(channels[0]!.topic).toBe("dms:uid1");
  expect(channels[0]!.opts).toEqual({ config: { private: true } });
  expect(channels[0]!.bindings.map((b) => [b.type, b.filter.event])).toEqual([
    ["broadcast", "changed"],
  ]);
  channels[0]!.fire("broadcast", { event: "changed", payload: { id: "c1" } });
  channels[0]!.fire("broadcast", { event: "changed", payload: { id: "c2" } });
  await vi.advanceTimersByTimeAsync(150);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(other).toHaveBeenCalledTimes(1);
  stop();
  stopOther();
  await vi.advanceTimersByTimeAsync(2000);
  expect(client.removeChannel).toHaveBeenCalledWith(channels[0]);
});

it("dms/005: no channel of my own without the dms module", async () => {
  const { cfg, client } = setup();
  const stop = subscribeDms(cfg, "uid1", vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(client.channel).not.toHaveBeenCalled();
  stop();
});

it("dms/005: another signed-in member gets their own channel, never the previous one's", async () => {
  const { cfg, client, channels } = setup({ dms: {} });
  const stop = subscribeDms(cfg, "uid1", vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  stop(); // the account switch unmounts the watcher...
  const stale = subscribeDms(cfg, "uid0", vi.fn()); // ...a subscriber still on the old id
  const next = subscribeDms(cfg, "uid1", vi.fn()); // same tick: the first channel is reused
  await vi.advanceTimersByTimeAsync(2000);
  // The session is uid1: the stale id opens nothing.
  expect(channels.map((c) => c.topic)).toEqual(["dms:uid1"]);
  expect(client.removeChannel).not.toHaveBeenCalled();
  stale();
  next();
});

const refusal = new Error(
  "Unauthorized: You do not have permissions to read from this Channel topic: conversation:c1",
);

it("a DM's join refused for authorisation is closed, not retried, until a DM changes", async () => {
  const { cfg, client, channels } = setup({ dms: {} }); // without groups, every conversation is a DM
  const h = handlers();
  const stop = subscribeConversation(cfg, "c1", h); // a cold-opened blocked DM
  const stopDms = subscribeDms(cfg, "uid1", vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  const [conversation, mine] = channels;
  conversation!.status!("CHANNEL_ERROR", refusal);
  await vi.advanceTimersByTimeAsync(0);
  expect(client.removeChannel).toHaveBeenCalledWith(conversation);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(client.channel).toHaveBeenCalledTimes(2);
  // An unblock: dms/006 says `changed` on my channel, so the DM asks once more.
  mine!.fire("broadcast", { event: "changed", payload: { id: "c1" } });
  await vi.advanceTimersByTimeAsync(0);
  expect(channels.map((c) => c.topic)).toEqual(["conversation:c1", "dms:uid1", "conversation:c1"]);
  channels[2]!.status!("SUBSCRIBED");
  await vi.advanceTimersByTimeAsync(150);
  expect(h.onChange).toHaveBeenCalledTimes(1); // the rejoin refetches
  // A later `changed` leaves a joined channel alone.
  mine!.fire("broadcast", { event: "changed", payload: { id: "c2" } });
  await vi.advanceTimersByTimeAsync(0);
  expect(client.channel).toHaveBeenCalledTimes(3);
  stop();
  stopDms();
});

it("a refused join asks again when the screen opens again; other errors keep retrying", async () => {
  const { cfg, client, channels } = setup();
  const stop = subscribeConversation(cfg, "c1", handlers());
  await vi.advanceTimersByTimeAsync(0);
  channels[0]!.status!("CHANNEL_ERROR", new Error("connection lost"));
  await vi.advanceTimersByTimeAsync(0);
  expect(client.removeChannel).not.toHaveBeenCalled(); // realtime-js rejoins it
  channels[0]!.status!("CHANNEL_ERROR", refusal);
  await vi.advanceTimersByTimeAsync(0);
  expect(client.removeChannel).toHaveBeenCalledTimes(1);
  const again = subscribeConversation(cfg, "c1", handlers());
  await vi.advanceTimersByTimeAsync(0);
  expect(client.channel).toHaveBeenCalledTimes(2);
  stop();
  again();
});

it("a refused group join retries after 12 s, doubling up to 5 min, until it joins", async () => {
  const { cfg, client, channels } = setup({ groups: {}, dms: {} });
  const h = handlers();
  const stop = subscribeConversation(cfg, "g1", h); // a removed member's screen
  await vi.advanceTimersByTimeAsync(0);
  const refuse = async () => {
    channels.at(-1)!.status!("CHANNEL_ERROR", refusal);
    await vi.advanceTimersByTimeAsync(0);
  };
  const opensAfter = async (ms: number) => {
    const before = client.channel.mock.calls.length;
    await vi.advanceTimersByTimeAsync(ms - 1);
    expect(client.channel).toHaveBeenCalledTimes(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.channel).toHaveBeenCalledTimes(before + 1);
  };
  await refuse();
  await opensAfter(12_000);
  await refuse();
  await opensAfter(24_000);
  for (let i = 0; i < 6; i++)
    (await refuse(), await vi.advanceTimersByTimeAsync(REFUSED_RETRY_MAX_MS));
  await refuse();
  await opensAfter(REFUSED_RETRY_MAX_MS); // capped
  // Readmitted: it joins and refetches; a later refusal starts again at 12 s.
  channels.at(-1)!.status!("SUBSCRIBED");
  await vi.advanceTimersByTimeAsync(150);
  expect(h.onChange).toHaveBeenCalledTimes(1);
  await refuse();
  await opensAfter(12_000);
  stop();
  await vi.advanceTimersByTimeAsync(1000);
  await refuse(); // closed meanwhile: the callback of a removed channel is ignored
  const opened = client.channel.mock.calls.length;
  await vi.advanceTimersByTimeAsync(REFUSED_RETRY_MAX_MS);
  expect(client.channel).toHaveBeenCalledTimes(opened);
});

it("with groups on, a conversation the screen knows is a DM waits instead of retrying", async () => {
  const { cfg, client, channels } = setup({ groups: {}, dms: {} });
  const stop = subscribeConversation(cfg, "c1", handlers(), { dm: true });
  const stopDms = subscribeDms(cfg, "uid1", vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  channels[0]!.status!("CHANNEL_ERROR", refusal);
  await vi.advanceTimersByTimeAsync(REFUSED_RETRY_MAX_MS * 2);
  expect(client.channel).toHaveBeenCalledTimes(2); // the DM channel and my own
  channels[1]!.fire("broadcast", { event: "changed", payload: { id: "c1" } });
  await vi.advanceTimersByTimeAsync(0);
  expect(client.channel).toHaveBeenCalledTimes(3);
  stop();
  stopDms();
});

it("a DM learnt late (the screen confirms it) stops a pending group retry", async () => {
  const { cfg, client, channels } = setup({ groups: {}, dms: {} });
  const unsure = subscribeConversation(cfg, "c1", handlers()); // kind not known yet
  await vi.advanceTimersByTimeAsync(0);
  const sure = subscribeConversation(cfg, "c1", handlers(), { dm: true });
  unsure();
  channels[0]!.status!("CHANNEL_ERROR", refusal);
  await vi.advanceTimersByTimeAsync(REFUSED_RETRY_MAX_MS * 2);
  expect(client.channel).toHaveBeenCalledTimes(1);
  sure();
});
