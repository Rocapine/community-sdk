// Locale-aware push copy for notify-comment / notify-like / notify-reaction.
//
// Every string below is a neutral built-in for the 9 locales the UI package
// ships. An app with its own voice overrides ANY of them — per locale, per
// key — through ONE JSON secret instead of forking the function bodies (the
// way one host app had to before this existed):
//
//   supabase secrets set COMMUNITY_PUSH_COPY='{
//     "fallbackName":  { "en": "A sister", "pt-PT": "Uma irmã" },
//     "comment.title": { "pl": "Otrzymałaś komentarz" },
//     "like.one":      { "pl": "{name} polubiła twój post" },
//     "reaction.one":  { "en": "{name} prayed for you 🙏" },
//     "reaction.many": { "en": "{name} and {count} others prayed for you 🙏",
//                        "pl": { "one": "…", "few": "…", "many": "…" } }
//   }'
//
// Placeholders: `{name}` (actor display name) and `{count}` (the number of
// OTHER people in a coalesced push). A `*.many` value is either a string or a
// `{ one, few, many, other }` object picked by the CLDR plural category of
// `{count}` for the recipient's locale (Polish needs all three; French treats
// 0 like 1; everything else is one/other).
//
// Legacy single-string secrets still apply, below the JSON and above the
// built-ins: COMMUNITY_FALLBACK_NAME (every locale's fallbackName) and
// COMMUNITY_REACTION_PUSH_TEXT (every locale's reaction.one).

type Forms = { one?: string; few?: string; many?: string; other?: string };
type CopyValue = string | Forms;
type LocaleCopy = Record<string, CopyValue>;

export type PushCopyKey =
  "fallbackName" | "comment.title" | "like.one" | "like.many" | "reaction.one" | "reaction.many";

const BUILTIN: Record<string, LocaleCopy> = {
  en: {
    fallbackName: "Someone",
    "comment.title": "You received a comment",
    "like.one": "{name} liked your post",
    "like.many": {
      one: "{name} and {count} other liked your post",
      other: "{name} and {count} others liked your post",
    },
    "reaction.one": "{name} is thinking of you",
    "reaction.many": {
      one: "{name} and {count} other are thinking of you",
      other: "{name} and {count} others are thinking of you",
    },
  },
  "pt-PT": {
    fallbackName: "Alguém",
    "comment.title": "Recebeste um comentário",
    "like.one": "{name} gostou da tua publicação",
    "like.many": {
      one: "{name} e mais {count} pessoa gostou da tua publicação",
      other: "{name} e mais {count} pessoas gostaram da tua publicação",
    },
    "reaction.one": "{name} está a pensar em ti",
    "reaction.many": {
      one: "{name} e mais {count} pessoa está a pensar em ti",
      other: "{name} e mais {count} pessoas estão a pensar em ti",
    },
  },
  "pt-BR": {
    fallbackName: "Alguém",
    "comment.title": "Você recebeu um comentário",
    "like.one": "{name} curtiu seu post",
    "like.many": {
      one: "{name} e mais {count} pessoa curtiu seu post",
      other: "{name} e mais {count} pessoas curtiram seu post",
    },
    "reaction.one": "{name} está pensando em você",
    "reaction.many": {
      one: "{name} e mais {count} pessoa está pensando em você",
      other: "{name} e mais {count} pessoas estão pensando em você",
    },
  },
  "es-ES": {
    fallbackName: "Alguien",
    "comment.title": "Has recibido un comentario",
    "like.one": "A {name} le ha gustado tu publicación",
    "like.many": {
      one: "A {name} y a {count} persona más les ha gustado tu publicación",
      other: "A {name} y a {count} personas más les ha gustado tu publicación",
    },
    "reaction.one": "{name} está pensando en ti",
    "reaction.many": {
      one: "{name} y {count} persona más está pensando en ti",
      other: "{name} y {count} personas más están pensando en ti",
    },
  },
  "es-419": {
    fallbackName: "Alguien",
    "comment.title": "Recibiste un comentario",
    "like.one": "A {name} le gustó tu publicación",
    "like.many": {
      one: "A {name} y a {count} persona más les gustó tu publicación",
      other: "A {name} y a {count} personas más les gustó tu publicación",
    },
    "reaction.one": "{name} está pensando en ti",
    "reaction.many": {
      one: "{name} y {count} persona más está pensando en ti",
      other: "{name} y {count} personas más están pensando en ti",
    },
  },
  it: {
    fallbackName: "Qualcuno",
    "comment.title": "Hai ricevuto un commento",
    "like.one": "A {name} piace il tuo post",
    "like.many": {
      one: "A {name} e ad altra {count} persona piace il tuo post",
      other: "A {name} e ad altre {count} persone piace il tuo post",
    },
    "reaction.one": "{name} sta pensando a te",
    "reaction.many": {
      one: "{name} e altra {count} persona sta pensando a te",
      other: "{name} e altre {count} persone stanno pensando a te",
    },
  },
  pl: {
    fallbackName: "Ktoś",
    "comment.title": "Masz nowy komentarz",
    "like.one": "{name} polubił(a) twój post",
    "like.many": {
      one: "{name} i {count} inna osoba polubiły twój post",
      few: "{name} i {count} inne osoby polubiły twój post",
      many: "{name} i {count} innych osób polubiło twój post",
    },
    "reaction.one": "{name} myśli o tobie",
    "reaction.many": {
      one: "{name} i {count} inna osoba myśli o tobie",
      few: "{name} i {count} inne osoby myślą o tobie",
      many: "{name} i {count} innych osób myśli o tobie",
    },
  },
  fr: {
    fallbackName: "Quelqu'un",
    "comment.title": "Tu as reçu un commentaire",
    "like.one": "{name} a aimé ta publication",
    "like.many": {
      one: "{name} et {count} autre personne ont aimé ta publication",
      other: "{name} et {count} autres personnes ont aimé ta publication",
    },
    "reaction.one": "{name} pense à toi",
    "reaction.many": {
      one: "{name} et {count} autre personne pensent à toi",
      other: "{name} et {count} autres personnes pensent à toi",
    },
  },
  de: {
    fallbackName: "Jemand",
    "comment.title": "Du hast einen Kommentar erhalten",
    "like.one": "{name} gefällt dein Beitrag",
    "like.many": {
      one: "{name} und {count} weiterer Person gefällt dein Beitrag",
      other: "{name} und {count} weiteren Personen gefällt dein Beitrag",
    },
    "reaction.one": "{name} denkt an dich",
    "reaction.many": {
      one: "{name} und {count} weitere Person denken an dich",
      other: "{name} und {count} weitere Personen denken an dich",
    },
  },
};

// Same rule set as the UI package's `pluralCategory` (packages/ui/src/i18n.ts).
export function pluralCategory(locale: string, n: number): keyof Forms {
  const lang = locale.split("-")[0]?.toLowerCase();
  if (lang === "pl") {
    if (n === 1) return "one";
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return "few";
    return "many";
  }
  if (lang === "fr") return n === 0 || n === 1 ? "one" : "other";
  return n === 1 ? "one" : "other";
}

function parseOverrides(): Record<string, Record<string, CopyValue>> {
  const raw = Deno.env.get("COMMUNITY_PUSH_COPY");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (e) {
    console.error("community-sdk: COMMUNITY_PUSH_COPY is not valid JSON, ignoring it", e);
    return {};
  }
}

const OVERRIDES = parseOverrides();
const LEGACY_FALLBACK_NAME = Deno.env.get("COMMUNITY_FALLBACK_NAME");
const LEGACY_REACTION_ONE = Deno.env.get("COMMUNITY_REACTION_PUSH_TEXT");

/** `es-MX` → `es-ES`, `pt-AO` → `pt-PT`, `fr-CA` → `fr`; unknown → `en`. */
function resolveLocale(locale: string | null | undefined): string {
  if (!locale) return "en";
  if (BUILTIN[locale]) return locale;
  const lang = locale.split("-")[0].toLowerCase();
  if (BUILTIN[lang]) return lang;
  if (lang === "es") return "es-ES";
  if (lang === "pt") return "pt-PT";
  return "en";
}

function pick(key: PushCopyKey, locale: string, exact: string | null | undefined): CopyValue {
  const overrideByLocale = OVERRIDES[key] ?? {};
  // Override lookup: exact locale as sent by the client, then the resolved one.
  const override =
    (exact ? overrideByLocale[exact] : undefined) ??
    overrideByLocale[locale] ??
    overrideByLocale[locale.split("-")[0]];
  if (override !== undefined) return override;
  if (key === "fallbackName" && LEGACY_FALLBACK_NAME) return LEGACY_FALLBACK_NAME;
  if (key === "reaction.one" && LEGACY_REACTION_ONE) return LEGACY_REACTION_ONE;
  return BUILTIN[locale][key] ?? BUILTIN.en[key];
}

function fill(template: string, params: { name?: string; count?: number }): string {
  return template
    .replace(/\{name\}/g, params.name ?? "")
    .replace(/\{count\}/g, params.count === undefined ? "" : String(params.count));
}

/** Copy resolver for one recipient (`profiles.locale`). */
export function pushCopy(recipientLocale: string | null | undefined) {
  const locale = resolveLocale(recipientLocale);
  const text = (key: PushCopyKey, params: { name?: string; count?: number } = {}): string => {
    const value = pick(key, locale, recipientLocale);
    if (typeof value === "string") return fill(value, params);
    const category = pluralCategory(locale, params.count ?? 0);
    const form =
      value[category] ??
      value.other ??
      value.many ??
      value.one ??
      // A partial override object: fall through to the built-in forms.
      (() => {
        const builtin = BUILTIN[locale][key] ?? BUILTIN.en[key];
        return typeof builtin === "string"
          ? builtin
          : (builtin[category] ?? builtin.other ?? builtin.many ?? builtin.one ?? "");
      })();
    return fill(form, params);
  };
  return { locale, fallbackName: text("fallbackName"), text };
}
