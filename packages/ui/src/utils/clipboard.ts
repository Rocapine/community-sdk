// Copying a message's text. Web: the browser clipboard. Native: `expo-clipboard`, an
// OPTIONAL peer (lazy `require`, see `postImage.ts`); without it there is no Copy.
import { Platform } from "react-native";

// Ambient `require` — see `icons-default.ts` for why this isn't an `import`.
declare function require(id: string): unknown;

type ClipboardModule = { setStringAsync?(text: string): Promise<boolean> };

function loadClipboard(): ClipboardModule | null {
  try {
    return (require("expo-clipboard") as ClipboardModule | undefined) ?? null;
  } catch {
    return null;
  }
}

const webClipboard = () =>
  Platform.OS === "web"
    ? (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } })
        .navigator?.clipboard
    : undefined;

export function canCopy(): boolean {
  return !!webClipboard() || !!loadClipboard()?.setStringAsync;
}

export function copyText(text: string): void {
  const web = webClipboard();
  const run = web ? web.writeText(text) : loadClipboard()?.setStringAsync?.(text);
  run?.catch(() => {});
}
