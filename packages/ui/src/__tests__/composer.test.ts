// `canPublish` is a pure export of ComposerCard.tsx; the component's native
// imports are stubbed so the module loads under vitest (no react-native here).
import { describe, expect, it, vi } from "vitest";

vi.mock("@rocapine/community-core", () => ({}));
vi.mock("react-native", () => ({}));
vi.mock("expo-image", () => ({}));
vi.mock("../Sheet", () => ({}));
vi.mock("../components/AnimatedHeight", () => ({}));
vi.mock("../components/PressableScale", () => ({}));
vi.mock("../components/RulesSheet", () => ({}));

const { canPublish } = await import("../components/ComposerCard");

const base = {
  text: "",
  image: null,
  pollInvalid: false,
  pending: false,
  gating: false,
  preparing: false,
};
const image = { url: "file:///a.jpg", width: 1200, height: 900 };

describe("canPublish", () => {
  it("an image alone is publishable", () => {
    expect(canPublish({ ...base, image })).toBe(true);
  });

  it("empty (or blank) text and no image is not", () => {
    expect(canPublish(base)).toBe(false);
    expect(canPublish({ ...base, text: "   " })).toBe(false);
  });

  it("text alone is publishable", () => {
    expect(canPublish({ ...base, text: "hi" })).toBe(true);
  });

  it("an invalid poll blocks it even with an image", () => {
    expect(canPublish({ ...base, image, pollInvalid: true })).toBe(false);
  });

  it("pending or gating blocks it", () => {
    expect(canPublish({ ...base, image, pending: true })).toBe(false);
    expect(canPublish({ ...base, text: "hi", gating: true })).toBe(false);
  });

  it("a photo still being prepared blocks it, even with text", () => {
    expect(canPublish({ ...base, text: "hi", preparing: true })).toBe(false);
    expect(canPublish({ ...base, image, preparing: true })).toBe(false);
  });
});
