// Shared translation logic for translate-one, daily-translation, notify-comment
// and broadcast-post. One OpenAI structured-output call per item returns the
// detected source language and every target locale at once; rows are written
// with the service role. Pure parts (parseTranslationResponse,
// resolveTargetLocale, languageOf) are unit-tested in translation_test.ts.
//
// Secrets:
//   COMMUNITY_TRANSLATION_LOCALES  required when the module is on, e.g. "en,es-ES,es-419,it,pl,pt-PT,pt-BR"
//   COMMUNITY_TRANSLATION_MODEL    optional, default below
//   COMMUNITY_TRANSLATION_STYLE    optional per-app voice instruction
//   OPENAI_API_KEY                 shared with moderation

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const TARGET_LOCALES: string[] = (Deno.env.get("COMMUNITY_TRANSLATION_LOCALES") ?? "")
  .split(",")
  .map((l) => l.trim())
  .filter(Boolean);
export const TRANSLATION_MODEL = Deno.env.get("COMMUNITY_TRANSLATION_MODEL") ?? "gpt-5-mini";
export const TRANSLATION_STYLE = Deno.env.get("COMMUNITY_TRANSLATION_STYLE") ?? "";
export const ENGINE = `openai:${TRANSLATION_MODEL}`;

export type TranslationRow = { locale: string; source_locale: string; content: string };
export type ParsedTranslation = {
  sourceLocale: string;
  translations: Record<string, { content: string; options: string[] }>;
};

export function languageOf(locale: string): string {
  return locale.split("-")[0].toLowerCase();
}

/** Exact target, else the first target of the same language, else null. */
export function resolveTargetLocale(
  profileLocale: string | null | undefined,
  targets: string[] = TARGET_LOCALES,
): string | null {
  if (!profileLocale) return null;
  if (targets.includes(profileLocale)) return profileLocale;
  const lang = languageOf(profileLocale);
  return targets.find((t) => languageOf(t) === lang) ?? null;
}

const SOURCE_LOCALE_RE = /^[a-z]{2,3}$/;

export function parseTranslationResponse(
  raw: unknown,
  targets: string[],
  optionCount: number,
): ParsedTranslation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { source_locale?: unknown; translations?: unknown };
  if (typeof r.source_locale !== "string") return null;
  const sourceLocale = r.source_locale.trim().toLowerCase();
  if (!SOURCE_LOCALE_RE.test(sourceLocale)) return null;
  if (!r.translations || typeof r.translations !== "object") return null;
  const out: ParsedTranslation["translations"] = {};
  for (const [locale, value] of Object.entries(r.translations as Record<string, unknown>)) {
    if (!targets.includes(locale)) continue;
    if (languageOf(locale) === sourceLocale) continue;
    if (!value || typeof value !== "object") continue;
    const v = value as { content?: unknown; options?: unknown };
    if (typeof v.content !== "string" || v.content.trim().length === 0) continue;
    const options = Array.isArray(v.options) ? v.options : [];
    if (options.length !== optionCount || !options.every((o) => typeof o === "string")) continue;
    out[locale] = { content: v.content, options: options as string[] };
  }
  return { sourceLocale, translations: out };
}

/** One OpenAI call. Returns null on any failure (caller writes nothing). */
export async function translateItem(input: {
  content: string;
  options: string[];
  targets: string[];
}): Promise<ParsedTranslation | null> {
  const perLocale: Record<string, unknown> = {};
  for (const l of input.targets) {
    perLocale[l] = {
      type: "object",
      properties: {
        content: { type: "string" },
        options: { type: "array", items: { type: "string" } },
      },
      required: ["content", "options"],
      additionalProperties: false,
    };
  }
  const schema = {
    type: "object",
    properties: {
      source_locale: {
        type: "string",
        description: "ISO 639-1 language code of the ORIGINAL text",
      },
      translations: {
        type: "object",
        properties: perLocale,
        required: input.targets,
        additionalProperties: false,
      },
    },
    required: ["source_locale", "translations"],
    additionalProperties: false,
  };
  const instructions = [
    "You translate short social posts and comments from a mobile app community.",
    `Detect the language of the original text (ISO 639-1 code, e.g. en, es, pt) and return it as source_locale.`,
    `Translate the text into every target locale listed (${input.targets.join(", ")}). For a target whose language equals the source language, copy the original text unchanged.`,
    "Respect regional variants (es-ES vs es-419, pt-PT vs pt-BR). Keep emojis, line breaks, register and approximate length. Never add, summarise, moderate or explain.",
    input.options.length > 0
      ? `The text is a poll: also translate the ${input.options.length} option labels, in the same order and count, into "options". Return an empty options array when there are none.`
      : "Return an empty options array for every locale.",
    TRANSLATION_STYLE ? `App voice: ${TRANSLATION_STYLE}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TRANSLATION_MODEL,
        instructions,
        input: JSON.stringify({ text: input.content, options: input.options }),
        text: {
          format: { type: "json_schema", name: "translations", strict: true, schema },
        },
        store: false,
      }),
    });
    if (!res.ok) {
      console.error("translation api error", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    // Responses API: the JSON text lives in output[].content[].text, on "message" items only
    // ("reasoning" items have no output_text content and must never be picked); output_text is
    // the convenience join for the common case.
    const text: string | undefined =
      data.output_text ??
      data.output
        ?.filter((o: { type?: string }) => o.type === "message")
        .flatMap((o: { content?: { type?: string; text?: string }[] }) => o.content ?? [])
        .find((c: { type?: string; text?: string }) => c.type === "output_text")?.text;
    if (!text) return null;
    return parseTranslationResponse(JSON.parse(text), input.targets, input.options.length);
  } catch (e) {
    console.error("translation failed", e);
    return null;
  }
}

/** Targets not already present in `have`, and (once a source is known) not the same language as it. */
export function missingLocales(have: TranslationRow[], targets: string[]): string[] {
  const knownSource = have[0]?.source_locale;
  return targets.filter(
    (l) => !have.some((h) => h.locale === l) && (!knownSource || languageOf(l) !== knownSource),
  );
}

/**
 * Translate `kind`/`id` into every missing target locale and upsert the rows.
 * Returns the rows now present for the item (possibly empty when the item is
 * in a target language), or null when translation failed (nothing written).
 * Idempotent: complete items make no API call.
 */
export async function ensureTranslations(
  supabase: SupabaseClient,
  kind: "post" | "comment",
  id: string,
): Promise<TranslationRow[] | null> {
  if (TARGET_LOCALES.length === 0) {
    console.log("community-sdk: COMMUNITY_TRANSLATION_LOCALES not set, skipping translation");
    return [];
  }
  const table = kind === "post" ? "posts" : "comments";
  const tTable = kind === "post" ? "post_translations" : "comment_translations";
  const fk = kind === "post" ? "post_id" : "comment_id";

  const { data: row, error: rowError } = await supabase
    .from(table)
    .select("id, content, status")
    .eq("id", id)
    .single();
  if (rowError) {
    if (rowError.code === "PGRST116") return []; // not found
    console.error("translation item lookup failed", rowError.message);
    return null;
  }
  if (!row || row.status !== "visible") return [];

  const { data: existing, error: existingError } = await supabase
    .from(tTable)
    .select("locale, source_locale, content")
    .eq(fk, id);
  if (existingError) {
    console.error("translation existing rows lookup failed", existingError.message);
    return null;
  }
  const have = (existing ?? []) as TranslationRow[];
  const missing = missingLocales(have, TARGET_LOCALES);
  if (missing.length === 0) return have;

  let options: { id: string; idx: number; label: string }[] = [];
  if (kind === "post") {
    const { data, error } = await supabase
      .from("poll_options")
      .select("id, idx, label")
      .eq("post_id", id)
      .order("idx");
    if (error) {
      console.error("poll options lookup failed", error.message);
      return null;
    }
    if (data) options = data as typeof options;
  }

  const parsed = await translateItem({
    content: row.content,
    options: options.map((o) => o.label),
    targets: missing,
  });
  if (!parsed) return null;

  const incomplete = missing.filter(
    (l) => languageOf(l) !== parsed.sourceLocale && !(l in parsed.translations),
  );
  if (incomplete.length > 0) {
    console.error("translation response missing locales", incomplete.join(", "));
    return null;
  }

  // Poll option rows are written first: if they fail, nothing lands, so the item
  // stays fully "missing" and the sweep (which only checks post_translations) can retry it.
  if (kind === "post" && options.length > 0) {
    const optionRows = Object.entries(parsed.translations).flatMap(([locale, t]) =>
      t.options.map((content, i) => ({ option_id: options[i].id, locale, content })),
    );
    if (optionRows.length > 0) {
      const { error } = await supabase
        .from("poll_option_translations")
        .upsert(optionRows, { onConflict: "option_id,locale" });
      if (error) {
        console.error("poll option translation upsert failed", error.message);
        return null;
      }
    }
  }

  const rows = Object.entries(parsed.translations).map(([locale, t]) => ({
    [fk]: id,
    locale,
    source_locale: parsed.sourceLocale,
    content: t.content,
    engine: ENGINE,
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from(tTable).upsert(rows, { onConflict: `${fk},locale` });
    if (error) {
      console.error("translation upsert failed", error.message);
      return null;
    }
  }
  return [
    ...have,
    ...rows.map((r) => ({ locale: r.locale, source_locale: r.source_locale, content: r.content })),
  ];
}
