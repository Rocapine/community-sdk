// Locale-aware push copy for notify-comment / notify-like / notify-reaction.
//
// Every string below is a neutral built-in for each of the 23 locales the UI
// package ships. An app with its own voice overrides ANY of them — per locale, per
// key — through ONE JSON secret instead of forking the function bodies (the
// way one host app had to before this existed):
//
//   supabase secrets set COMMUNITY_PUSH_COPY='{
//     "fallbackName":  { "en": "A sister", "pt-PT": "Uma irmã" },
//     "comment.title": { "pl": "Otrzymałaś komentarz" },
//     "like.one":      { "pl": "{name} polubiła twój post" },
//     "reaction.one":  { "en": "{name} prayed for you 🙏" },
//     "photo":         { "en": "📷 A picture" },
//     "reaction.many": { "en": "{name} and {count} others prayed for you 🙏",
//                        "pl": { "one": "…", "few": "…", "many": "…" } }
//   }'
//
// Placeholders: `{name}` (actor display name) and `{count}` (the number of
// OTHER people in a coalesced push). A `*.many` value is either a string or a
// `{ one, few, many, other }` object picked by the CLDR plural category of
// `{count}` for the recipient's locale (Polish needs all three; Ukrainian,
// Russian, Croatian, Czech, Slovak and Romanian one/few/other; French treats 0
// like 1; everything else is one/other).
//
// Legacy single-string secrets still apply, below the JSON and above the
// built-ins: COMMUNITY_FALLBACK_NAME (every locale's fallbackName) and
// COMMUNITY_REACTION_PUSH_TEXT (every locale's reaction.one).

type Forms = { one?: string; few?: string; many?: string; other?: string };
type CopyValue = string | Forms;
type LocaleCopy = Record<string, CopyValue>;

export type PushCopyKey =
  | "fallbackName"
  | "comment.title"
  | "reply.title"
  | "like.one"
  | "like.many"
  | "reaction.one"
  | "reaction.many"
  | "photo";

const BUILTIN: Record<string, LocaleCopy> = {
  en: {
    fallbackName: "Someone",
    photo: "📷 Photo",
    "comment.title": "You received a comment",
    "reply.title": "You received a reply",
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
    photo: "📷 Foto",
    "comment.title": "Recebeste um comentário",
    "reply.title": "Recebeste uma resposta",
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
    photo: "📷 Foto",
    "comment.title": "Você recebeu um comentário",
    "reply.title": "Você recebeu uma resposta",
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
    photo: "📷 Foto",
    "comment.title": "Has recibido un comentario",
    "reply.title": "Has recibido una respuesta",
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
    photo: "📷 Foto",
    "comment.title": "Recibiste un comentario",
    "reply.title": "Recibiste una respuesta",
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
    photo: "📷 Foto",
    "comment.title": "Hai ricevuto un commento",
    "reply.title": "Hai ricevuto una risposta",
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
    photo: "📷 Zdjęcie",
    "comment.title": "Masz nowy komentarz",
    "reply.title": "Masz nową odpowiedź",
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
    photo: "📷 Photo",
    "comment.title": "Tu as reçu un commentaire",
    "reply.title": "Tu as reçu une réponse",
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
    photo: "📷 Foto",
    "comment.title": "Du hast einen Kommentar erhalten",
    "reply.title": "Du hast eine Antwort erhalten",
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
  "fr-vous": {
    fallbackName: "Quelqu'un",
    photo: "📷 Photo",
    "comment.title": "Vous avez reçu un commentaire",
    "reply.title": "Vous avez reçu une réponse",
    "like.one": "{name} a aimé votre publication",
    "like.many": {
      one: "{name} et {count} autre personne ont aimé votre publication",
      other: "{name} et {count} autres personnes ont aimé votre publication",
    },
    "reaction.one": "{name} pense à vous",
    "reaction.many": {
      one: "{name} et {count} autre personne pensent à vous",
      other: "{name} et {count} autres personnes pensent à vous",
    },
  },
  ko: {
    fallbackName: "누군가",
    photo: "📷 사진",
    "comment.title": "새 댓글이 달렸어요",
    "reply.title": "새 답글이 달렸어요",
    "like.one": "{name}님이 내 게시글을 좋아해요",
    "like.many": {
      one: "{name}님 외 {count}명이 내 게시글을 좋아해요",
      other: "{name}님 외 {count}명이 내 게시글을 좋아해요",
    },
    "reaction.one": "{name}님이 나를 생각하고 있어요",
    "reaction.many": {
      one: "{name}님 외 {count}명이 나를 생각하고 있어요",
      other: "{name}님 외 {count}명이 나를 생각하고 있어요",
    },
  },
  ro: {
    fallbackName: "Cineva",
    photo: "📷 Fotografie",
    "comment.title": "Ai primit un comentariu",
    "reply.title": "Ai primit un răspuns",
    "like.one": "{name} a apreciat postarea ta",
    "like.many": {
      one: "{name} și încă o persoană au apreciat postarea ta",
      few: "{name} și încă {count} persoane au apreciat postarea ta",
      other: "{name} și încă {count} de persoane au apreciat postarea ta",
    },
    "reaction.one": "{name} se gândește la tine",
    "reaction.many": {
      one: "{name} și încă o persoană se gândesc la tine",
      few: "{name} și încă {count} persoane se gândesc la tine",
      other: "{name} și încă {count} de persoane se gândesc la tine",
    },
  },
  uk: {
    fallbackName: "Хтось",
    photo: "📷 Фото",
    "comment.title": "У тебе новий коментар",
    "reply.title": "У тебе нова відповідь",
    "like.one": "{name} вподобав(ла) твій допис",
    "like.many": {
      one: "{name} і ще {count} людина вподобали твій допис",
      few: "{name} і ще {count} людини вподобали твій допис",
      other: "{name} і ще {count} людей вподобали твій допис",
    },
    "reaction.one": "{name} думає про тебе",
    "reaction.many": {
      one: "{name} і ще {count} людина думають про тебе",
      few: "{name} і ще {count} людини думають про тебе",
      other: "{name} і ще {count} людей думають про тебе",
    },
  },
  nl: {
    fallbackName: "Iemand",
    photo: "📷 Foto",
    "comment.title": "Je hebt een reactie ontvangen",
    "reply.title": "Je hebt een antwoord ontvangen",
    "like.one": "{name} vindt je post leuk",
    "like.many": {
      one: "{name} en {count} ander vinden je post leuk",
      other: "{name} en {count} anderen vinden je post leuk",
    },
    "reaction.one": "{name} denkt aan je",
    "reaction.many": {
      one: "{name} en {count} ander denken aan je",
      other: "{name} en {count} anderen denken aan je",
    },
  },
  ru: {
    fallbackName: "Кто-то",
    photo: "📷 Фото",
    "comment.title": "У тебя новый комментарий",
    "reply.title": "У тебя новый ответ",
    "like.one": "{name} оценил(а) твой пост",
    "like.many": {
      one: "{name} и ещё {count} человек оценили твой пост",
      few: "{name} и ещё {count} человека оценили твой пост",
      other: "{name} и ещё {count} человек оценили твой пост",
    },
    "reaction.one": "{name} думает о тебе",
    "reaction.many": {
      one: "{name} и ещё {count} человек думают о тебе",
      few: "{name} и ещё {count} человека думают о тебе",
      other: "{name} и ещё {count} человек думают о тебе",
    },
  },
  el: {
    fallbackName: "Κάποιος",
    photo: "📷 Φωτογραφία",
    "comment.title": "Έλαβες ένα σχόλιο",
    "reply.title": "Έλαβες μια απάντηση",
    "like.one": "{name} έκανε like στη δημοσίευσή σου",
    "like.many": {
      one: "{name} και {count} ακόμα άτομο έκαναν like στη δημοσίευσή σου",
      other: "{name} και {count} ακόμα άτομα έκαναν like στη δημοσίευσή σου",
    },
    "reaction.one": "{name} σε σκέφτεται",
    "reaction.many": {
      one: "{name} και {count} ακόμα άτομο σε σκέφτονται",
      other: "{name} και {count} ακόμα άτομα σε σκέφτονται",
    },
  },
  hu: {
    fallbackName: "Valaki",
    photo: "📷 Fotó",
    "comment.title": "Hozzászólást kaptál",
    "reply.title": "Választ kaptál",
    "like.one": "{name} kedvelte a bejegyzésedet",
    "like.many": {
      one: "{name} és még {count} ember kedvelte a bejegyzésedet",
      other: "{name} és még {count} ember kedvelte a bejegyzésedet",
    },
    "reaction.one": "{name} gondol rád",
    "reaction.many": {
      one: "{name} és még {count} ember gondol rád",
      other: "{name} és még {count} ember gondol rád",
    },
  },
  sv: {
    fallbackName: "Någon",
    photo: "📷 Foto",
    "comment.title": "Du har fått en kommentar",
    "reply.title": "Du har fått ett svar",
    "like.one": "{name} gillade ditt inlägg",
    "like.many": {
      one: "{name} och {count} annan gillade ditt inlägg",
      other: "{name} och {count} andra gillade ditt inlägg",
    },
    "reaction.one": "{name} tänker på dig",
    "reaction.many": {
      one: "{name} och {count} annan tänker på dig",
      other: "{name} och {count} andra tänker på dig",
    },
  },
  nb: {
    fallbackName: "Noen",
    photo: "📷 Bilde",
    "comment.title": "Du har fått en kommentar",
    "reply.title": "Du har fått et svar",
    "like.one": "{name} likte innlegget ditt",
    "like.many": {
      one: "{name} og {count} annen likte innlegget ditt",
      other: "{name} og {count} andre likte innlegget ditt",
    },
    "reaction.one": "{name} tenker på deg",
    "reaction.many": {
      one: "{name} og {count} annen tenker på deg",
      other: "{name} og {count} andre tenker på deg",
    },
  },
  da: {
    fallbackName: "Nogen",
    photo: "📷 Foto",
    "comment.title": "Du har fået en kommentar",
    "reply.title": "Du har fået et svar",
    "like.one": "{name} synes godt om dit opslag",
    "like.many": {
      one: "{name} og {count} anden synes godt om dit opslag",
      other: "{name} og {count} andre synes godt om dit opslag",
    },
    "reaction.one": "{name} tænker på dig",
    "reaction.many": {
      one: "{name} og {count} anden tænker på dig",
      other: "{name} og {count} andre tænker på dig",
    },
  },
  hr: {
    fallbackName: "Netko",
    photo: "📷 Fotografija",
    "comment.title": "Imaš novi komentar",
    "reply.title": "Imaš novi odgovor",
    "like.one": "{name} je lajkao/la tvoju objavu",
    "like.many": {
      one: "{name} i još {count} osoba lajkali su tvoju objavu",
      few: "{name} i još {count} osobe lajkali su tvoju objavu",
      other: "{name} i još {count} osoba lajkali su tvoju objavu",
    },
    "reaction.one": "{name} misli na tebe",
    "reaction.many": {
      one: "{name} i još {count} osoba misle na tebe",
      few: "{name} i još {count} osobe misle na tebe",
      other: "{name} i još {count} osoba misle na tebe",
    },
  },
  sk: {
    fallbackName: "Niekto",
    photo: "📷 Fotka",
    "comment.title": "Máš nový komentár",
    "reply.title": "Máš novú odpoveď",
    "like.one": "{name} dal(a) like tvojmu príspevku",
    "like.many": {
      one: "{name} a {count} ďalší dali like tvojmu príspevku",
      few: "{name} a {count} ďalší dali like tvojmu príspevku",
      other: "{name} a {count} ďalších dali like tvojmu príspevku",
    },
    "reaction.one": "{name} myslí na teba",
    "reaction.many": {
      one: "{name} a {count} ďalší myslia na teba",
      few: "{name} a {count} ďalší myslia na teba",
      other: "{name} a {count} ďalších myslia na teba",
    },
  },
  cs: {
    fallbackName: "Někdo",
    photo: "📷 Fotka",
    "comment.title": "Máš nový komentář",
    "reply.title": "Máš novou odpověď",
    "like.one": "{name} ocenil(a) tvůj příspěvek",
    "like.many": {
      one: "{name} a {count} další ocenili tvůj příspěvek",
      few: "{name} a {count} další ocenili tvůj příspěvek",
      other: "{name} a {count} dalších ocenili tvůj příspěvek",
    },
    "reaction.one": "{name} myslí na tebe",
    "reaction.many": {
      one: "{name} a {count} další myslí na tebe",
      few: "{name} a {count} další myslí na tebe",
      other: "{name} a {count} dalších myslí na tebe",
    },
  },
};

// Same rule set as the UI package's `pluralCategory` (packages/ui/src/i18n.ts).
export function pluralCategory(locale: string, n: number): keyof Forms {
  const lang = locale.split("-")[0]?.toLowerCase();
  const m10 = n % 10;
  const m100 = n % 100;
  if (lang === "pl") {
    if (n === 1) return "one";
    if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return "few";
    return "many";
  }
  if (lang === "uk" || lang === "ru" || lang === "hr") {
    if (m10 === 1 && m100 !== 11) return "one";
    if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return "few";
    return "other";
  }
  if (lang === "cs" || lang === "sk") {
    if (n === 1) return "one";
    if (n >= 2 && n <= 4) return "few";
    return "other";
  }
  if (lang === "ro") {
    if (n === 1) return "one";
    if (n === 0 || (m100 >= 2 && m100 <= 19)) return "few";
    return "other";
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

/** `es-MX` → `es-ES`, `pt-AO` → `pt-PT`, `fr-CA` → `fr`, `no` → `nb`; unknown → `en`. */
function resolveLocale(locale: string | null | undefined): string {
  if (!locale) return "en";
  if (BUILTIN[locale]) return locale;
  const lang = locale.split("-")[0].toLowerCase();
  if (BUILTIN[lang]) return lang;
  if (lang === "es") return "es-ES";
  if (lang === "pt") return "pt-PT";
  if (lang === "no") return "nb";
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

/** Push/inbox excerpt: the first 140 characters, or `photo` for an image-only item. */
export function excerptOrPhoto(content: string, photo: string): string {
  if (!content.trim()) return photo;
  return content.length > 140 ? `${content.slice(0, 137)}...` : content;
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
