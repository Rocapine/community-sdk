// Avatar downscale before upload: a square-cropped picker photo is still full
// camera resolution (several MB), uploaded as-is and shown at 30-64pt. Eve's
// pre-migration picker resized to 512px JPEG @0.8; this restores that.
//
// `expo-image-manipulator` is an OPTIONAL peer (same lazy-require pattern as
// phosphor in `icons-default.ts`): without it the photo is uploaded unchanged,
// so a host that skipped the peer keeps working.

// Ambient `require` — see `icons-default.ts` for why this isn't an `import`.
declare function require(id: string): unknown;

export const AVATAR_SIZE = 512;

type ImageRef = {
  saveAsync(options: { compress?: number; format?: string }): Promise<{ uri: string }>;
};
type ManipulatorModule = {
  ImageManipulator?: {
    manipulate(uri: string): {
      resize(size: { width: number; height: number }): { renderAsync(): Promise<ImageRef> };
    };
  };
  SaveFormat?: { JPEG: string };
};

function loadManipulator(): ManipulatorModule | null {
  try {
    return require("expo-image-manipulator") as ManipulatorModule;
  } catch {
    return null;
  }
}

/** Resizes a (square-cropped) picked photo to `AVATAR_SIZE` JPEG @0.8 and
 * returns the new file uri, or the original uri when `expo-image-manipulator`
 * isn't installed or the resize fails. Never throws. */
export async function resizeAvatar(uri: string): Promise<string> {
  const mod = loadManipulator();
  if (!mod?.ImageManipulator) return uri;
  try {
    const ref = await mod.ImageManipulator.manipulate(uri)
      .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE })
      .renderAsync();
    const saved = await ref.saveAsync({ compress: 0.8, format: mod.SaveFormat?.JPEG ?? "jpeg" });
    return saved.uri;
  } catch {
    return uri;
  }
}
