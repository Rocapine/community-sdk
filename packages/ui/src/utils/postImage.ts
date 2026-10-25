// Post/comment image helpers: pick, re-encode on device (no EXIF/GPS leaves the
// phone) and size the display frame.
//
// `expo-image-manipulator` is an OPTIONAL peer, required once `modules.images`
// is on (lazy ambient `require`, same pattern as `avatar.ts`). Unlike
// `resizeAvatar`, this NEVER falls back to the original uri: the original may
// carry GPS EXIF, so no manipulator / any failure => null.
import type { LocalImage } from "@rocapine/community-core";

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

function load<T>(id: string): T | null {
  try {
    return ((override ? override(id) : require(id)) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

let warned = false;

/** True when `expo-image-manipulator` is installed (the images module needs it). */
export function imagesSupported(): boolean {
  const ok = !!load<ManipulatorModule>("expo-image-manipulator")?.ImageManipulator;
  if (!ok && !warned && typeof __DEV__ !== "undefined" && __DEV__) {
    warned = true;
    console.warn(
      "[community-ui] The images module needs `expo-image-manipulator`; image buttons are hidden until it is installed.",
    );
  }
  return ok;
}

/** Display frame: full `maxWidth`, aspect kept but clamped to 4:5 .. 1.91:1. */
export function imageFrame(
  image: { width: number; height: number },
  maxWidth: number,
): { width: number; height: number } {
  const ratio = Math.min(Math.max(image.width / image.height, IMAGE_MIN_RATIO), IMAGE_MAX_RATIO);
  return { width: maxWidth, height: Math.round(maxWidth / ratio) };
}

/** Re-encodes to JPEG @0.8 with the long edge <= `IMAGE_MAX_EDGE` (never
 * upscaled). Returns the rendered (post-orientation) size, or null — never the
 * original uri. */
export async function prepareImage(uri: string): Promise<LocalImage | null> {
  const mod = load<ManipulatorModule>("expo-image-manipulator");
  if (!mod?.ImageManipulator) return null;
  try {
    let ref = await mod.ImageManipulator.manipulate(uri).renderAsync();
    const long = Math.max(ref.width, ref.height);
    if (long > IMAGE_MAX_EDGE) {
      // One dimension only keeps the aspect ratio.
      const size = ref.width >= ref.height ? { width: IMAGE_MAX_EDGE } : { height: IMAGE_MAX_EDGE };
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
  const picker = load<PickerModule>("expo-image-picker");
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
