// Polish catalog for @rocapine/community-ui.
//
// Ported from Eve's Rhythm's i18n/pl/community.json (eden-s-rythm repo —
// comment only, no runtime dependency on that app), flattened to the same
// dot-key scheme as en.ts (see task-9-report.md for the key-rename table:
// prayedForYou.* -> reaction.*, aSister -> someone, _one/_other ->
// .one/.other). Degendered ("siostra/siostry" -> neutral phrasing) and
// de-branded ("Eve's News" / "Eve's Rhythm" removed) to match en.ts's
// neutral meaning.
//
// Polish plurals: Eve's source uses the full CLDR one/few/many/other set
// (e.g. `newPosts_one/_few/_many/_other`), but this package's runtime only
// supports a binary one/other split (count === 1 ? "one" : "other", see
// i18n.ts). `.other` here is filled from Eve's `_many` form (correct for 0
// and 5+, the most common non-1 counts in this UI; grammatically a step off
// for 2-4, a known limitation of the binary scheme — see task-14-report.md).
//
// Polish gendering note: unlike the other 5 ported locales, Polish past-tense
// verbs conjugate for the subject's grammatical gender (e.g. "polubiła" vs
// "polubił"), so Eve's assumption of an all-female audience is baked into
// the verb forms themselves, not just nouns like "siostra". Degendering
// required real restructuring, not word substitution:
//  - single-named-subject verbs (post.reaction.received, inbox.liked/
//    commented/reacted) use the "-(a)" dual-gender suffix convention
//    (standard practice in Polish software localization for gender-unknown
//    subjects), e.g. "polubił(a)".
//  - "{name} + N others" compound subjects and reaction counts are phrased
//    with a quantity-agreement or present-tense construction instead
//    (grammatically gender-invariant), e.g. "{count} osób zareagowało".
//  - gendered imperative adjectives ("Bądź pierwszą") and 2nd-person past
//    tense ("podzieliłaś") are rephrased around gender-invariant imperative
//    verbs and present tense ("Zacznij od siebie.", "Nie masz tu jeszcze
//    żadnych postów.").
//  - "autorkę"/"jej" (feminine author/her) replaced with the neutral role
//    phrase "osobę, która to napisała" / "tej osoby".
// Keys en.ts added that Eve's JSON lacks (menu.cancel, menu.delete,
// profile.save) were translated fresh from the app-wide common.json values
// (Anuluj / Usuń / Zapisz).
export const pl: Record<string, string> = {
  title: "Wspólnota",

  "topics.news": "Nowości",
  "topics.general": "Ogólne",
  "topics.prayer": "Modlitwa",
  "topics.prayerRequest": "Prośba o modlitwę",
  "topics.testimony": "Świadectwo",
  "topics.question": "Pytanie",
  "topics.encouragement": "Zachęta",
  "topics.cycleBody": "Cykl i ciało",
  "topics.fertility": "Płodność",
  "topics.faith": "Wiara",
  "topics.relationships": "Relacje",

  "feed.all": "Wszystko",
  "feed.searchPlaceholder": "Szukaj w postach…",
  "feed.composePrompt": "Podziel się ze wspólnotą…",
  "feed.unreachableRetry": "Wspólnota jest teraz nieosiągalna. Pociągnij, aby spróbować ponownie.",
  "feed.unreachable": "Wspólnota jest teraz nieosiągalna.",
  "feed.noSearchResults": "Żaden post nie odpowiada twojemu wyszukiwaniu.",
  "feed.newsEmpty": "Ogłoszenia od zespołu pojawią się tutaj.",
  "feed.empty": "Jeszcze nie ma tu postów. Zacznij od siebie.",
  "feed.loadMore": "Wczytaj więcej",
  "feed.newPosts.one": "{count} nowy post",
  "feed.newPosts.other": "{count} nowych postów",

  "post.pinned": "Przypięty",
  "post.viewMore": "Pokaż więcej",
  "post.viewLess": "Pokaż mniej",
  "post.reaction.received": "{name} zareagował(a) na twój post",
  "post.reaction.anonymous.one": "Ktoś zareagował(a) na twój post",
  "post.reaction.anonymous.other": "{count} osób zareagowało na twój post",
  "post.reaction.withOthers.one": "{name} i jeszcze {count} osoba reagują na twój post",
  "post.reaction.withOthers.other": "{name} i jeszcze {count} osób reagują na twój post",

  "thread.comments.one": "{count} komentarz",
  "thread.comments.other": "{count} komentarzy",
  "thread.loadingComments": "Wczytywanie komentarzy…",
  "thread.emptyComments": "Jeszcze nikt nie zostawił miłego słowa. Zacznij od siebie.",
  "thread.commentPlaceholder": "Dodaj dobre słowo…",

  "composer.placeholder": "Podziel się myślą, historią, słowem zachęty…",
  "composer.pollPlaceholder": "Zadaj swoje pytanie…",
  "composer.option": "Opcja {number}",
  "composer.addOption": "Dodaj opcję",
  "composer.poll": "Ankieta",
  "composer.removePoll": "Usuń ankietę",
  "composer.post": "OPUBLIKUJ",

  "poll.votes.one": "{count} głos",
  "poll.votes.other": "{count} głosów",
  "poll.tapToVote": "Dotknij opcji, aby zagłosować",

  "rules.title": "Zasady wspólnoty",
  "rules.kind": "Zachowaj życzliwość. To przestrzeń wzajemnej zachęty dla wszystkich.",
  "rules.medical": "Bez porad medycznych. Dziel się doświadczeniem, nie zaleceniami.",
  "rules.hateful":
    "Bez treści nienawistnych, nękających ani dosłownych. Są usuwane i mogą prowadzić do blokady.",
  "rules.report":
    "Widzisz coś niewłaściwego? Zgłoś to albo zablokuj osobę, która to napisała. Sprawdzamy każde zgłoszenie.",
  "rules.accept": "Zgadzam się, wejdźmy",

  "notice.errorTitle": "Coś poszło nie tak",
  "notice.rejectedTitle": "Zachowajmy łagodność",
  "notice.errorBody":
    "Nie udało się teraz połączyć ze wspólnotą. Sprawdź połączenie i spróbuj ponownie.",
  "notice.rejectedPostBody":
    "Twój post nie mógł zostać opublikowany, ponieważ jest sprzeczny z zasadami wspólnoty. To przestrzeń życzliwości, zachęty i łaski. Dziękujemy, że pomagasz utrzymać ją bezpieczną dla wszystkich.",
  "notice.rejectedCommentBody":
    "Twój komentarz nie mógł zostać opublikowany, ponieważ jest sprzeczny z zasadami wspólnoty. To przestrzeń życzliwości, zachęty i łaski. Dziękujemy, że pomagasz utrzymać ją bezpieczną dla wszystkich.",
  "notice.gotIt": "Rozumiem",

  "menu.cancel": "Anuluj",
  "menu.delete": "Usuń",
  "menu.deletePostTitle": "Usunąć ten post?",
  "menu.deletePostBody": "Zniknie ze wspólnoty.",
  "menu.deleteCommentTitle": "Usunąć ten komentarz?",
  "menu.reportPost": "Zgłoś post",
  "menu.reportComment": "Zgłoś komentarz",
  "menu.block": "Zablokuj",
  "menu.blockUser": "Zablokuj {name}",
  "menu.blockUserConfirmTitle": "Zablokować {name}?",
  "menu.blockUserConfirmBody": "Nigdy więcej nie zobaczysz postów ani komentarzy tej osoby.",

  "report.title": "Zgłoś tę treść",
  "report.reasons.spam": "Spam",
  "report.reasons.harassment": "Nękanie",
  "report.reasons.hate": "Treść nienawistna",
  "report.reasons.inappropriate": "Niewłaściwa treść",
  "report.reasons.other": "Coś innego",
  "report.detailsPlaceholder": "Czy jest coś, co powinniśmy wiedzieć? (opcjonalnie)",
  "report.send": "Wyślij zgłoszenie",
  "report.sentTitle": "Dziękujemy",
  "report.sentBody": "Twoje zgłoszenie zostało wysłane. Nasz zespół sprawdza każde zgłoszenie.",
  "report.errorTitle": "Nie udało się wysłać zgłoszenia",
  "report.errorBody": "Sprawdź połączenie i spróbuj ponownie.",

  "profile.postsSection": "posty",
  "profile.editProfile": "Edytuj profil",
  "profile.emptyOwn": "Nie masz tu jeszcze żadnych postów.",
  "profile.emptyOther": "Nie ma jeszcze postów do pokazania.",
  "profile.changePhoto": "Zmień zdjęcie",
  "profile.bioLabel": "O mnie",
  "profile.bioPlaceholder": "Powiedz wspólnocie coś o sobie",
  "profile.usernameLabel": "Nazwa użytkownika",
  "profile.usernamePlaceholder": "twojanazwa",
  "profile.usernameHelper": "Od 3 do 20 znaków, litery, cyfry i myślniki.",
  "profile.photoRejected": "To zdjęcie nie zostało przyjęte. Wybierz inne.",
  "profile.bioRejected": "Ten tekst nie został przyjęty przez moderację.",
  "profile.usernameRejected": "Ta nazwa użytkownika nie została przyjęta przez moderację.",
  "profile.usernameTaken": "Ta nazwa użytkownika jest już zajęta.",
  "profile.usernameInvalid": "Tylko małe litery, cyfry i myślniki, od 3 do 20 znaków.",
  "profile.genericError": "Coś poszło nie tak. Spróbuj ponownie.",
  "profile.save": "Zapisz",

  "inbox.title": "Powiadomienia",
  "inbox.empty":
    "Jeszcze nic tu nie ma. Gdy ktoś zareaguje, polubi lub skomentuje twoje posty, zobaczysz to tutaj.",
  "inbox.someone": "Ktoś",
  "inbox.liked": "{name} polubił(a) twój post",
  "inbox.commented": "{name} skomentował(a) twój post",
  "inbox.reacted": "{name} zareagował(a) na twój post",
  "inbox.news": "Nowości od {name}",
  "inbox.supportReply": "Zespół wsparcia ci odpowiedział",
};
