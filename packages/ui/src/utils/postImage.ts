// Post/comment image helpers: pick, re-encode on device (no EXIF/GPS leaves the
// phone) and size the display frame.
//
// `expo-image-manipulator` is an OPTIONAL peer, required once `modules.images`
// is on (lazy ambient `require`, same pattern as `avatar.ts`). Unlike
// `resizeAvatar`, this NEVER falls back to the original uri: the original may
// carry GPS EXIF, so no manipulator / any failure => null.
import type { LocalImage } from "@rocapine/community-core";
import type { TFn } from "../i18n";

// Ambient `require` — see `icons-default.ts` for why this isn't an `import`.
declare function require(id: string): unknown;
declare const __DEV__: boolean | undefined;

export const IMAGE_MAX_EDGE = 1600;
export const IMAGE_MIN_RATIO = 4 / 5;
export const IMAGE_MAX_RATIO = 1.91;

type ImageRef = {
  width: number;
  height: number;
  saveAsync(options: { compress?: number; format?: string }): Promise<{ uri: string }>;
  // SharedObject.release(): frees the native bitmap without waiting for GC.
  release?(): void;
};
type Manipulation = {
  resize(size: { width?: number; height?: number }): Manipulation;
  renderAsync(): Promise<ImageRef>;
};
type ManipulatorModule = {
  ImageManipulator?: { manipulate(uri: string): Manipulation };
  SaveFormat?: { JPEG: string };
};
type PickerModule = {
  launchImageLibraryAsync(options: Record<string, unknown>): Promise<{
    canceled: boolean;
    assets?: { uri: string }[] | null;
  }>;
};

type Loader = (id: string) => unknown;
let override: Loader | null = null;

/** Test seam: replaces the module loader (null restores the real `require`). */
export function __setModuleLoader(loader: Loader | null): void {
  override = loader;
  warned = false;
}

// Metro only bundles `require` calls with a string-literal argument, so each
// module gets its own literal `require` (a variable id is never resolved).
function loadManipulator(): ManipulatorModule | null {
  try {
    return (
      ((override ? override("expo-image-manipulator") : require("expo-image-manipulator")) as
        ManipulatorModule | undefined) ?? null
    );
  } catch {
    return null;
  }
}

function loadPicker(): PickerModule | null {
  try {
    return (
      ((override ? override("expo-image-picker") : require("expo-image-picker")) as
        PickerModule | undefined) ?? null
    );
  } catch {
    return null;
  }
}

let warned = false;

/** True when `expo-image-manipulator` is installed (the images module needs it). */
export function imagesSupported(): boolean {
  const ok = !!loadManipulator()?.ImageManipulator;
  if (!ok && !warned && typeof __DEV__ !== "undefined" && __DEV__) {
    warned = true;
    console.warn(
      "[community-ui] The images module needs `expo-image-manipulator`; image buttons are hidden until it is installed.",
    );
  }
  return ok;
}

/** Display aspect ratio (w:h): the image's own, clamped to 4:5 .. 1.91:1. */
export function imageRatio(image: { width: number; height: number }): number {
  return Math.min(Math.max(image.width / image.height, IMAGE_MIN_RATIO), IMAGE_MAX_RATIO);
}

/** Display frame: full `maxWidth`, aspect kept but clamped to 4:5 .. 1.91:1. */
export function imageFrame(
  image: { width: number; height: number },
  maxWidth: number,
): { width: number; height: number } {
  return { width: maxWidth, height: Math.round(maxWidth / imageRatio(image)) };
}

/** Inbox row excerpt: an image-only post/comment has an empty excerpt, shown
 * as the localized "Photo"; anything that isn't a string means no excerpt. */
export function inboxExcerpt(excerpt: unknown, t: TFn): string | null {
  if (typeof excerpt !== "string") return null;
  return excerpt === "" ? t("image.photo") : excerpt;
}

/** Re-encodes to JPEG @0.8 with the long edge <= `IMAGE_MAX_EDGE` (never
 * upscaled). Returns the rendered (post-orientation) size, or null — never the
 * original uri. */
export async function prepareImage(uri: string): Promise<LocalImage | null> {
  const mod = loadManipulator();
  if (!mod?.ImageManipulator) return null;
  try {
    let ref = await mod.ImageManipulator.manipulate(uri).renderAsync();
    const long = Math.max(ref.width, ref.height);
    if (long > IMAGE_MAX_EDGE) {
      // One dimension only keeps the aspect ratio.
      const size = ref.width >= ref.height ? { width: IMAGE_MAX_EDGE } : { height: IMAGE_MAX_EDGE };
      // Free the full-resolution bitmap before decoding the source a second time.
      ref.release?.();
      ref = await mod.ImageManipulator.manipulate(uri).resize(size).renderAsync();
    }
    const saved = await ref.saveAsync({ compress: 0.8, format: mod.SaveFormat?.JPEG ?? "jpeg" });
    return { url: saved.uri, width: ref.width, height: ref.height };
  } catch {
    return null;
  }
}

/** Opens the photo library and returns the prepared image, or null (cancelled,
 * no asset, picker missing, or `prepareImage` failed). */
export async function pickImage(): Promise<LocalImage | null> {
  const picker = loadPicker();
  if (!picker) return null;
  try {
    const res = await picker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 1,
      exif: false,
    });
    const asset = res.canceled ? undefined : res.assets?.[0];
    return asset ? await prepareImage(asset.uri) : null;
  } catch {
    return null;
  }
}
