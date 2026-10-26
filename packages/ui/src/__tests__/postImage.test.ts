import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { makeT } from "../i18n";
import {
  __setModuleLoader,
  imageFrame,
  imagesSupported,
  inboxExcerpt,
  pickImage,
  prepareImage,
} from "../utils/postImage";

afterEach(() => __setModuleLoader(null));

describe("imageFrame", () => {
  it("caps portrait at 4:5", () => {
    expect(imageFrame({ width: 1200, height: 1600 }, 300)).toEqual({ width: 300, height: 375 });
    expect(imageFrame({ width: 1000, height: 3000 }, 300)).toEqual({ width: 300, height: 375 });
  });
  it("keeps landscape whole", () => {
    expect(imageFrame({ width: 1600, height: 1200 }, 300)).toEqual({ width: 300, height: 225 });
  });
  it("floors panoramas at 1.91:1", () => {
    expect(imageFrame({ width: 10000, height: 1000 }, 300)).toEqual({ width: 300, height: 157 });
  });
});

// A fake manipulator: `rendered` is the post-orientation size of the source.
function fakeManipulator(rendered: { width: number; height: number }, fail = false) {
  const calls: { resize?: unknown; save?: unknown; log: string[] } = { log: [] };
  const mod = {
    ImageManipulator: {
      manipulate: () => ({
        resize(size: unknown) {
          calls.resize = size;
          return this;
        },
        renderAsync: async () => {
          if (fail) throw new Error("boom");
          calls.log.push(calls.resize ? "render resized" : "render");
          const out = calls.resize
            ? (() => {
                const s = calls.resize as { width?: number; height?: number };
                const k = s.width ? s.width / rendered.width : (s.height ?? 1) / rendered.height;
                return {
                  width: Math.round(rendered.width * k),
                  height: Math.round(rendered.height * k),
                };
              })()
            : rendered;
          return {
            ...out,
            release: () => calls.log.push(`release ${out.width}`),
            saveAsync: async (o: unknown) => {
              calls.save = o;
              return { uri: "file://out.jpg" };
            },
          };
        },
      }),
    },
    SaveFormat: { JPEG: "jpeg" },
  };
  return { mod, calls };
}

describe("manipulator absent", () => {
  it("prepareImage resolves null and imagesSupported is false", async () => {
    __setModuleLoader(() => null);
    expect(imagesSupported()).toBe(false);
    expect(await prepareImage("file://a.jpg")).toBeNull();
  });
});

describe("prepareImage", () => {
  it("resizes the long edge to 1600 (landscape: width) and returns the rendered size", async () => {
    const { mod, calls } = fakeManipulator({ width: 4000, height: 3000 });
    __setModuleLoader(() => mod);
    expect(await prepareImage("file://a.jpg")).toEqual({
      url: "file://out.jpg",
      width: 1600,
      height: 1200,
    });
    expect(calls.resize).toEqual({ width: 1600 });
    expect(calls.save).toEqual({ compress: 0.8, format: "jpeg" });
    // The full-resolution ref is freed before the second decode.
    expect(calls.log).toEqual(["render", "release 4000", "render resized"]);
  });
  it("uses the rendered (oriented) size: portrait resizes by height", async () => {
    const { mod, calls } = fakeManipulator({ width: 3000, height: 4000 });
    __setModuleLoader(() => mod);
    expect(await prepareImage("file://a.jpg")).toEqual({
      url: "file://out.jpg",
      width: 1200,
      height: 1600,
    });
    expect(calls.resize).toEqual({ height: 1600 });
  });
  it("never upscales", async () => {
    const { mod, calls } = fakeManipulator({ width: 800, height: 600 });
    __setModuleLoader(() => mod);
    expect(await prepareImage("file://a.jpg")).toEqual({
      url: "file://out.jpg",
      width: 800,
      height: 600,
    });
    expect(calls.resize).toBeUndefined();
  });
  it("returns null (never the original) on failure", async () => {
    __setModuleLoader(() => fakeManipulator({ width: 10, height: 10 }, true).mod);
    expect(await prepareImage("file://a.jpg")).toBeNull();
  });
});

describe("pickImage", () => {
  it("resolves null when the picker is cancelled", async () => {
    __setModuleLoader(() => ({
      launchImageLibraryAsync: async () => ({ canceled: true, assets: null }),
    }));
    expect(await pickImage()).toBeNull();
  });
  it("passes the asset through prepareImage", async () => {
    const { mod } = fakeManipulator({ width: 400, height: 300 });
    let opts: unknown;
    __setModuleLoader((id) =>
      id === "expo-image-picker"
        ? {
            launchImageLibraryAsync: async (o: unknown) => {
              opts = o;
              return { canceled: false, assets: [{ uri: "file://p.jpg" }] };
            },
          }
        : mod,
    );
    expect(await pickImage()).toEqual({ url: "file://out.jpg", width: 400, height: 300 });
    expect(opts).toEqual({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 1,
      exif: false,
    });
  });
});

describe("inboxExcerpt", () => {
  const t = makeT("en");
  it("labels an image-only item as a photo", () => {
    expect(inboxExcerpt("", t)).toBe(t("image.photo"));
  });
  it("keeps text and returns null when absent", () => {
    expect(inboxExcerpt("hi", t)).toBe("hi");
    expect(inboxExcerpt(null, t)).toBeNull();
    expect(inboxExcerpt(undefined, t)).toBeNull();
  });
});

describe("module loading", () => {
  // Metro only bundles `require("literal")`; a variable id is never resolved.
  it("uses only string-literal requires", () => {
    const src = readFileSync(new URL("../utils/postImage.ts", import.meta.url), "utf8");
    // The ambient `declare function require(id: string)` is a signature, not a call.
    const calls = src.replace(/declare function require\(.*\n/, "");
    expect(src).toContain('require("expo-image-manipulator")');
    expect(src).toContain('require("expo-image-picker")');
    expect(calls).not.toMatch(/require\(\s*[a-zA-Z_]/);
  });
});
