import type { ResolvedCommunityConfig } from "./config";

export function languageOf(locale: string): string {
  return locale.split("-")[0]?.toLowerCase() ?? "";
}

/**
 * The locale translations are read in: the host's locale resolved against
 * `modules.translation.locales` — exact match, else the first declared locale
 * of the same language, else null (originals only). Null when the module is off.
 */
export function readerLocale(cfg: ResolvedCommunityConfig): string | null {
  const module = cfg.modules.translation;
  if (!module || module.locales.length === 0) return null;
  const host = cfg.host.getLocale();
  if (module.locales.includes(host)) return host;
  const lang = languageOf(host);
  return module.locales.find((l) => languageOf(l) === lang) ?? null;
}
