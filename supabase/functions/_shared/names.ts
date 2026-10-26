// Display name / handle rules shared by update-profile and the daily sweep:
// the app's own name is reserved (no "Unchaind Team" impersonating the app),
// a few staff-sounding handles too, and a taken handle gets a free suggestion.

const APP_NAME = Deno.env.get("COMMUNITY_APP_NAME") ?? "";

/** Lowercase, accents stripped, letters and digits only. */
function collapse(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** True when `value` contains the app's name. Short names (< 4 chars, "Eve") only match a whole word so "Steve" stays allowed. */
export function containsAppName(value: string, appName: string = APP_NAME): boolean {
  const app = collapse(appName);
  if (app === "") return false;
  if (app.length >= 4) return collapse(value).includes(app);
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .includes(app);
}

const RESERVED_HANDLES = ["admin", "support", "official", "team", "moderator"];

export function isReservedHandle(handle: string, appName: string = APP_NAME): boolean {
  return RESERVED_HANDLES.includes(handle) || containsAppName(handle, appName);
}

/**
 * A free handle on `handle`'s base: "superuser" -> "superuser-4821". Same
 * digit widening as generate_handle (core/009). `isFree` checks the table.
 */
export async function suggestHandle(
  handle: string,
  isFree: (candidate: string) => Promise<boolean>,
): Promise<string | null> {
  const base = handle.replace(/-[0-9]+$/, "").slice(0, 15) || "user";
  for (let tries = 0; tries < 10; tries++) {
    const digits =
      tries < 5
        ? Math.floor(Math.random() * 9000) + 1000
        : Math.floor(Math.random() * 900000) + 100000;
    const candidate = `${base}-${digits}`;
    if (await isFree(candidate)) return candidate;
  }
  return null;
}
