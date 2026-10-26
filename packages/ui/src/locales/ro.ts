// Romanian catalog for @rocapine/community-ui.
//
// Written from en.ts (no source app). Register: "tu", the register the
// Rocapine apps use app-wide. Degendered like en.ts: imperatives that would
// need a gendered adjective ("fii primul/prima") are rephrased around a
// gender-invariant verb ("Începe tu.", "Poartă-te cu blândețe.").
//
// Romanian plurals: the runtime picks the CLDR category (`pluralCategory` in
// i18n.ts) — `.one` (1), `.few` (0, 2–19 and any count whose last two digits
// are 02–19) and `.other` (20, 21, 100…), where the noun takes the "de"
// genitive link: "20 de postări".
export const ro: Record<string, string> = {
  title: "Comunitate",

  "topics.news": "Noutăți",
  "topics.general": "General",
  "topics.prayer": "Rugăciune",
  "topics.prayerRequest": "Cerere de rugăciune",
  "topics.testimony": "Mărturie",
  "topics.question": "Întrebare",
  "topics.encouragement": "Încurajare",
  "topics.cycleBody": "Ciclu și corp",
  "topics.fertility": "Fertilitate",
  "topics.faith": "Credință",
  "topics.relationships": "Relații",

  "feed.all": "Toate",
  "feed.searchPlaceholder": "Caută postări…",
  "feed.composePrompt": "Împărtășește cu comunitatea…",
  "feed.unreachableRetry": "Comunitatea nu este disponibilă acum. Trage în jos pentru a reîncerca.",
  "feed.unreachable": "Comunitatea nu este disponibilă acum.",
  "feed.noSearchResults": "Nicio postare nu se potrivește căutării tale.",
  "feed.newsEmpty": "Anunțurile echipei vor apărea aici.",
  "feed.empty": "Nicio postare încă. Începe tu.",
  "feed.loadMore": "Încarcă mai multe",
  "feed.newPosts.one": "{count} postare nouă",
  "feed.newPosts.few": "{count} postări noi",
  "feed.newPosts.other": "{count} de postări noi",

  // Compact relative-time labels (see en.ts).
  "time.now": "acum",
  "time.minutes": "{count} min",
  "time.hours": "{count} h",
  "time.days": "{count} z",

  "post.pinned": "Fixată",
  "post.viewMore": "Vezi mai mult",
  "post.viewLess": "Vezi mai puțin",
  "post.reaction.received": "{name} a reacționat la postarea ta",
  "post.reaction.anonymous.one": "Cineva a reacționat la postarea ta",
  "post.reaction.anonymous.few": "{count} persoane au reacționat la postarea ta",
  "post.reaction.anonymous.other": "{count} de persoane au reacționat la postarea ta",
  "post.reaction.withOthers.one": "{name} și încă o persoană au reacționat la postarea ta",
  "post.reaction.withOthers.few": "{name} și încă {count} persoane au reacționat la postarea ta",
  "post.reaction.withOthers.other":
    "{name} și încă {count} de persoane au reacționat la postarea ta",

  "thread.comments.one": "{count} comentariu",
  "thread.comments.few": "{count} comentarii",
  "thread.comments.other": "{count} de comentarii",
  "thread.loadingComments": "Se încarcă comentariile…",
  "thread.emptyComments": "Lasă tu primul cuvânt bun.",
  "thread.commentPlaceholder": "Adaugă un cuvânt bun…",

  "composer.placeholder": "Împărtășește un gând, o poveste, o încurajare…",
  "composer.pollPlaceholder": "Pune întrebarea ta…",
  "composer.option": "Opțiunea {number}",
  "composer.addOption": "Adaugă o opțiune",
  "composer.removeOption": "Elimină opțiunea",
  "composer.poll": "Sondaj",
  "composer.removePoll": "Elimină sondajul",
  "composer.post": "PUBLICĂ",
  "composer.chooseTopic": "Publică în",

  "poll.votes.one": "{count} vot",
  "poll.votes.few": "{count} voturi",
  "poll.votes.other": "{count} de voturi",
  "poll.tapToVote": "Atinge o opțiune pentru a vota",

  "rules.title": "Regulile comunității",
  "rules.kind": "Poartă-te cu blândețe. Acesta este un spațiu de încurajare pentru toți.",
  "rules.medical": "Fără sfaturi medicale. Împărtășește experiențe, nu rețete.",
  "rules.hateful":
    "Fără conținut jignitor, hărțuitor sau explicit. Este eliminat și poate duce la blocare.",
  "rules.report":
    "Vezi ceva nepotrivit? Raportează sau blochează autorul. Analizăm fiecare raportare.",
  "rules.accept": "Sunt de acord, intru",

  "notice.errorTitle": "Ceva n-a mers",
  "notice.rejectedTitle": "Să păstrăm blândețea",
  "notice.errorBody":
    "Nu am putut ajunge la comunitate acum. Verifică conexiunea și încearcă din nou.",
  "notice.rejectedPostBody":
    "Postarea ta nu a putut fi publicată pentru că încalcă regulile comunității. Acesta este un spațiu de bunătate, încurajare și har; îți mulțumim că ajuți să rămână sigur pentru toți.",
  "notice.rejectedCommentBody":
    "Comentariul tău nu a putut fi publicat pentru că încalcă regulile comunității. Acesta este un spațiu de bunătate, încurajare și har; îți mulțumim că ajuți să rămână sigur pentru toți.",
  "notice.gotIt": "Am înțeles",

  "menu.cancel": "Anulează",
  "menu.delete": "Șterge",
  "menu.deletePostTitle": "Ștergi această postare?",
  "menu.deletePostBody": "Va dispărea din comunitate.",
  "menu.deleteCommentTitle": "Ștergi acest comentariu?",
  "menu.reportPost": "Raportează postarea",
  "menu.reportComment": "Raportează comentariul",
  "menu.block": "Blochează",
  "menu.blockUser": "Blochează {name}",
  "menu.blockUserConfirmTitle": "Blochezi {name}?",
  "menu.blockUserConfirmBody": "Nu îi vei mai vedea niciodată postările sau comentariile.",

  "report.title": "Raportează acest conținut",
  "report.reasons.spam": "Spam",
  "report.reasons.harassment": "Hărțuire",
  "report.reasons.hate": "Conținut jignitor",
  "report.reasons.inappropriate": "Nepotrivit",
  "report.reasons.other": "Altceva",
  "report.detailsPlaceholder": "Ceva ce ar trebui să știm? (opțional)",
  "report.send": "Trimite raportarea",
  "report.sentTitle": "Mulțumim",
  "report.sentBody": "Raportarea ta a fost trimisă. Echipa noastră analizează fiecare raportare.",
  "report.errorTitle": "Raportarea nu a putut fi trimisă",
  "report.errorBody": "Verifică conexiunea și încearcă din nou.",

  "profile.postsSection": "postări",
  "profile.editProfile": "Editează profilul",
  "profile.emptyOwn": "Nu ai împărtășit nimic încă.",
  "profile.emptyOther": "Nicio postare de afișat încă.",
  "profile.changePhoto": "Schimbă fotografia",
  "profile.bioLabel": "Despre mine",
  "profile.bioPlaceholder": "Spune-i comunității câte ceva despre tine",
  "profile.usernameLabel": "Identificator",
  "profile.usernamePlaceholder": "numeletau",
  "profile.usernameHelper": "Între 3 și 20 de caractere: litere, cifre și cratime.",
  "profile.photoRejected": "Această fotografie nu a fost acceptată. Alege alta.",
  "profile.bioRejected": "Acest text nu a fost acceptat de moderare.",
  "profile.usernameRejected": "Acest identificator nu a fost acceptat de moderare.",
  "profile.usernameTaken": "Acest identificator este deja folosit.",
  "profile.usernameInvalid": "Doar litere mici, cifre și cratime, între 3 și 20 de caractere.",
  "profile.usernameSuggestion":
    "@{handle} este deja folosit. Folosește @{suggestion} sau alege altul.",
  "profile.useSuggestion": "Folosește @{suggestion}",
  "profile.displayNameLabel": "Nume afișat",
  "profile.displayNameHelper":
    "Între 2 și 24 de caractere, apare la postările și comentariile tale.",
  "profile.displayNameRejected": "Acest nume nu a fost acceptat de moderare.",
  "profile.displayNameInvalid": "Între 2 și 24 de caractere.",
  "profile.nameReserved": "Acest nume este rezervat. Te rugăm să alegi altul.",
  "profile.genericError": "Ceva n-a mers. Încearcă din nou.",
  "profile.save": "Salvează",

  "inbox.title": "Notificări",
  "inbox.empty":
    "Nimic aici încă. Când cineva reacționează, apreciază sau comentează la postările tale, vei vedea aici.",
  "inbox.someone": "Cineva",
  "inbox.liked": "{name} a apreciat postarea ta",
  "inbox.commented": "{name} a comentat la postarea ta",
  "inbox.reacted": "{name} a reacționat la postarea ta",
  "inbox.news": "Noutăți de la {name}",
  "inbox.newsFromTeam": "Noutăți de la echipă",
  "inbox.supportReply": "Echipa de asistență ți-a răspuns",

  "translation.translatedFrom": "Tradus din {language}",
  "translation.original": "Original",
  "translation.showOriginal": "Vezi originalul",
  "translation.showTranslation": "Vezi traducerea",
  "language.en": "engleză",
  "language.es": "spaniolă",
  "language.pt": "portugheză",
  "language.it": "italiană",
  "language.pl": "poloneză",
  "language.fr": "franceză",
  "language.de": "germană",
  "language.ko": "coreeană",
  "language.ro": "română",
  "language.uk": "ucraineană",
  // Accessibility labels of icon-only buttons (screen readers).
  "a11y.back": "Înapoi",
  "a11y.more": "Mai multe opțiuni",
  "a11y.send": "Trimite",
  "a11y.search": "Caută",
  "a11y.closeSearch": "Închide căutarea",
  "a11y.clearSearch": "Șterge căutarea",
  "composer.addImage": "Adaugă o imagine",
  "composer.removeImage": "Elimină imaginea",
  "image.photo": "📷 Fotografie",
  "a11y.openImage": "Deschide imaginea",
  "a11y.closeImage": "Închide",
};
