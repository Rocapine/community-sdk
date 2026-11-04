// Badge toggles read hidden_badges then write it back: two quick toggles on one
// device must run one after the other, or the second overwrites the first.
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { resolveConfig, STREAK_BADGES } from "../config";
import { badgeVisibilityMutationOptions } from "../hooks";
import * as service from "../service";

vi.mock("../service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../service")>()),
  setBadgeVisibility: vi.fn(),
}));

it("runs badge toggles one at a time", async () => {
  const cfg = resolveConfig({
    supabase: null,
    appName: "t",
    topics: [],
    modules: { polls: false, push: false, inbox: false, reaction: false, badges: STREAK_BADGES },
  });
  const qc = new QueryClient();
  const order: string[] = [];
  let release!: () => void;
  vi.mocked(service.setBadgeVisibility).mockImplementation(async (_cfg, input) => {
    order.push(`start ${input.key}`);
    if (input.key === "streak") await new Promise<void>((r) => (release = r));
    order.push(`end ${input.key}`);
  });
  const first = new MutationObserver(qc, badgeVisibilityMutationOptions(cfg, qc)).mutate({
    key: "streak",
    visible: false,
  });
  const second = new MutationObserver(qc, badgeVisibilityMutationOptions(cfg, qc)).mutate({
    key: "bestStreak",
    visible: false,
  });
  await vi.waitFor(() => expect(order).toEqual(["start streak"]));
  release();
  await Promise.all([first, second]);
  expect(order).toEqual(["start streak", "end streak", "start bestStreak", "end bestStreak"]);
});
