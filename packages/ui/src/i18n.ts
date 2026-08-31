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
 * Resolution order for a given key: `overrides` -> `catalog[locale]` ->
 * `catalog.en` -> the key itself.
 * A numeric `params.count` selects between the `<key>.one` / `<key>.other`
 * suffixed keys (each resolved through the same fallback chain) before
 * falling back to the bare key.
 */
export function makeT(locale: string, overrides?: Record<string, string>): TFn {
  const localeCatalog = catalog[locale];

  function lookup(key: string): string | undefined {
    if (overrides && has(overrides, key)) return overrides[key];
    if (localeCatalog && has(localeCatalog, key)) return localeCatalog[key];
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
