// Framework-free i18n runtime for @rocapine/community-ui — no i18next.
// Stays free of React/React Native imports so it (and its tests) run in
// plain node.

import { en } from "./locales/en";
import { esES } from "./locales/es-ES";
import { es419 } from "./locales/es-419";
import { it } from "./locales/it";
import { pl } from "./locales/pl";
import { ptPT } from "./locales/pt-PT";
import { ptBR } from "./locales/pt-BR";

export type TFn = (key: string, params?: Record<string, string | number>) => string;

type LocaleCatalog = Record<string, string>;

const catalog: Record<string, LocaleCatalog> = {
  en,
  "es-ES": esES,
  "es-419": es419,
  it,
  pl,
  "pt-PT": ptPT,
  "pt-BR": ptBR,
};

/**
 * Designated base catalog for a bare/unlisted regional variant of a
 * language family that ships more than one regional catalog. `es` and `pt`
 * both ship two regional catalogs (`es-ES`/`es-419`, `pt-PT`/`pt-BR`), so an
 * unlisted variant (`es-MX`, `pt-AO`, or the bare `es`/`pt`) needs a pick:
 * `es-ES` and `pt-PT` win. Every other language has exactly one catalog,
 * keyed by its bare language code (`it`, `pl`) — those resolve to themselves
 * with no entry needed here (see `baseLocaleFor`).
 */
const BASE_LOCALE: Record<string, string> = {
  es: "es-ES",
  pt: "pt-PT",
};

/** The language subtag of `locale` (e.g. "es-MX" -> "es"), mapped through
 * `BASE_LOCALE` when that language ships more than one regional catalog. */
function baseLocaleFor(locale: string): string | undefined {
  const lang = locale.split("-")[0]?.toLowerCase();
  if (!lang) return undefined;
  return BASE_LOCALE[lang] ?? lang;
}

function has(record: LocaleCatalog, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Builds a translate function for `locale`.
 * Resolution order for a given key: `overrides` -> `catalog[locale]` (exact
 * match) -> `catalog[baseLocaleFor(locale)]` (base-language match, e.g.
 * "es-MX"/"pt-AO"/bare "es" or "pt" fall back to `es-ES`/`pt-PT`, and any
 * other unlisted variant like "it-CH" falls back to its bare language
 * catalog `it`) -> `catalog.en` -> the key itself.
 * A numeric `params.count` selects between the `<key>.one` / `<key>.other`
 * suffixed keys (each resolved through the same fallback chain) before
 * falling back to the bare key.
 */
export function makeT(locale: string, overrides?: Record<string, string>): TFn {
  const localeCatalog = catalog[locale];
  const baseLocale = baseLocaleFor(locale);
  const baseCatalog = baseLocale && baseLocale !== locale ? catalog[baseLocale] : undefined;

  function lookup(key: string): string | undefined {
    if (overrides && has(overrides, key)) return overrides[key];
    if (localeCatalog && has(localeCatalog, key)) return localeCatalog[key];
    if (baseCatalog && has(baseCatalog, key)) return baseCatalog[key];
    if (has(catalog.en, key)) return catalog.en[key];
    return undefined;
  }

  return function t(key: string, params?: Record<string, string | number>): string {
    let value: string | undefined;
    const count = params?.count;
    if (typeof count === "number") {
      const suffix = count === 1 ? "one" : "other";
      value = lookup(`${key}.${suffix}`);
    }
    if (value === undefined) {
      value = lookup(key);
    }
    if (value === undefined) {
      value = key;
    }
    return interpolate(value, params);
  };
}
