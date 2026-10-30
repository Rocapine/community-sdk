// The shared relative-time clocks: a row that switches from the per-second
// clock to the per-minute one (its label turning "59s" → "1m") must not read
// an older time than the one it just showed.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@rocapine/community-core", () => ({}));
const { makeClocks } = await import("../utils/time");

afterEach(() => vi.useRealTimers());

describe("makeClocks", () => {
  it("the minute clock never lags behind the second clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const clocks = makeClocks();
    const offMinute = clocks.subscribe("minute", () => {});
    const offSecond = clocks.subscribe("second", () => {});
    vi.advanceTimersByTime(45_000);
    expect(clocks.get("second")).toBe(45_000);
    expect(clocks.get("minute")).toBe(45_000);
    offSecond();
    offMinute();
  });

  it("stops each interval with its last subscriber", () => {
    vi.useFakeTimers();
    const clocks = makeClocks();
    const off = clocks.subscribe("second", () => {});
    off();
    expect(vi.getTimerCount()).toBe(0);
  });
});
