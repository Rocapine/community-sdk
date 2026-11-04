import { afterEach, describe, expect, it, vi } from "vitest";

// The built core pulls in JSX; canAttach and resolveConfig are plain TS.
vi.mock("@rocapine/community-core", async () => import("../../../core/src/config"));
const { resolveConfig } = await import("../../../core/src/config");
const { allowedAttachment } = await import("../utils/attachment");

const base = {
  supabase: null,
  appName: "t",
  topics: [],
  modules: { polls: false, push: false, inbox: false, reaction: false as const },
};
const cfg = (membersCanAttach: boolean) =>
  resolveConfig({
    ...base,
    modules: { ...base.modules, attachments: { types: ["verse"], membersCanAttach } },
  });
const verse = { type: "verse", id: "43.3.16" };

afterEach(() => vi.restoreAllMocks());

describe("allowedAttachment", () => {
  it("keeps it for members when the app allows them, and for officials", () => {
    expect(allowedAttachment(cfg(true), false, verse)).toEqual(verse);
    expect(allowedAttachment(cfg(false), true, verse)).toEqual(verse);
  });

  it("drops it, with one warning, for a member when only officials attach", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(allowedAttachment(cfg(false), false, verse)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("drops a type the app did not enable, and everything without the module", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(allowedAttachment(cfg(true), false, { type: "recipe", id: "1" })).toBeNull();
    expect(allowedAttachment(resolveConfig(base), true, verse)).toBeNull();
    expect(allowedAttachment(cfg(true), false, undefined)).toBeNull();
  });
});
