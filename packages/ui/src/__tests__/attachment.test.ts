import { afterEach, describe, expect, it, vi } from "vitest";

// The built core pulls in JSX; canAttach and resolveConfig are plain TS.
vi.mock("@rocapine/community-core", async () => import("../../../core/src/config"));
const { resolveConfig } = await import("../../../core/src/config");
const { allowedAttachment, attachmentRenderer, attachmentVariant } =
  await import("../utils/attachment");

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
  it("keeps it for members when the app allows them, and for admins", () => {
    expect(allowedAttachment(cfg(true), false, verse)).toEqual(verse);
    expect(allowedAttachment(cfg(false), true, verse)).toEqual(verse);
  });

  it("drops it, with one warning, for a member when only admins attach", () => {
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

describe("the group card", () => {
  const card = { type: "group", id: "g1" };
  const groups = resolveConfig({ ...base, modules: { ...base.modules, groups: {} } });

  it("goes out with the groups module even when attachments are off", () => {
    expect(allowedAttachment(groups, false, card)).toEqual(card);
    expect(allowedAttachment(resolveConfig(base), false, card)).toBeNull();
  });

  it("is drawn by the SDK when the host renderer returns null, by the host when not", () => {
    expect(attachmentRenderer("group", null, true)).toBe("group");
    expect(attachmentRenderer("group", undefined, true)).toBe("group");
    expect(attachmentRenderer("group", "host card", true)).toBe("host");
    expect(attachmentRenderer("group", null, false)).toBeNull();
    expect(attachmentRenderer("verse", null, true)).toBeNull();
    expect(attachmentRenderer("verse", "host card", false)).toBe("host");
  });

  it("follows shareCardLayout in posts and stays compact in bubbles", () => {
    expect(attachmentVariant("group", "card", "banner")).toBe("banner");
    expect(attachmentVariant("group", "card", "card")).toBe("card");
    expect(attachmentVariant("group", "compact", "banner")).toBe("compact");
    expect(attachmentVariant("verse", "card", "banner")).toBe("card");
    expect(attachmentVariant("group", "card", null)).toBe("card");
  });
});
