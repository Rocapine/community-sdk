// Pure merge-behavior test for the injectable icon set (see `icons.ts` /
// `icons-default.ts`). `defaultIcons`' entries are plain function
// references — importing them, or merging over them, never touches
// phosphor-react-native or React Native rendering (the lazy phosphor
// `require` only runs once a default icon actually renders, which this
// test never does). No mocking needed to keep this a pure merge test.
import { describe, expect, it } from "vitest";
import { defaultIcons, mergeIcons } from "../icons-default";
import type { CommunityIconName, CommunityIconProps, CommunityIconSet } from "../icons";

function FakeIcon(_props: CommunityIconProps) {
  return null;
}

const allNames = Object.keys(defaultIcons) as CommunityIconName[];

describe("mergeIcons", () => {
  it("returns the defaults unchanged when called with no overrides", () => {
    expect(mergeIcons()).toEqual(defaultIcons);
    expect(mergeIcons({})).toEqual(defaultIcons);
  });

  it("overrides exactly the given icon name, every other name falls back to default", () => {
    const merged = mergeIcons({ like: FakeIcon });
    expect(merged.like).toBe(FakeIcon);
    for (const name of allNames) {
      if (name === "like") continue;
      expect(merged[name]).toBe(defaultIcons[name]);
    }
  });

  it("overrides multiple icon names independently", () => {
    const merged = mergeIcons({ menu: FakeIcon, close: FakeIcon });
    expect(merged.menu).toBe(FakeIcon);
    expect(merged.close).toBe(FakeIcon);
    expect(merged.like).toBe(defaultIcons.like);
    expect(merged.warning).toBe(defaultIcons.warning);
  });

  it("a full override replaces the entire set", () => {
    const full = Object.fromEntries(allNames.map((name) => [name, FakeIcon])) as CommunityIconSet;
    const merged = mergeIcons(full);
    for (const name of allNames) {
      expect(merged[name]).toBe(FakeIcon);
    }
  });

  it("defaultIcons has exactly the CommunityIconName role set, one component per role", () => {
    const expectedNames: CommunityIconName[] = [
      "like",
      "reaction",
      "comment",
      "menu",
      "back",
      "close",
      "send",
      "bell",
      "search",
      "officialSeal",
      "pin",
      "announcement",
      "checkmark",
      "poll",
      "add",
      "warning",
    ];
    expect(allNames.sort()).toEqual([...expectedNames].sort());
    for (const name of allNames) {
      expect(typeof defaultIcons[name]).toBe("function");
    }
  });
});
