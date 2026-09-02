// German catalog for @rocapine/community-ui.
//
// Translated from en.ts (this package's canonical key set — like fr.ts,
// authored fresh against en.ts's meaning, no "Eve's Rhythm" German port to
// draw from), following the same degendering/de-branding rules as every
// other catalog here.
//
// German gender-neutrality notes: German is structurally easier here than
// French/Polish — predicate adjectives after "sein" (e.g. "Sei freundlich.")
// and past participles never inflect for the subject's gender at all, so
// most sentences need no special handling. The real pitfall is 3rd-person
// possessive pronouns ("sein"/"ihr" for "his"/"her") when referring to an
// unknown-gender {name} or post author:
//  - `menu.blockUserConfirmBody` restructures around a noun instead of a
//    gendered possessive: "die Beiträge und Kommentare dieser Person" (not
//    "seine/ihre Beiträge und Kommentare").
//  - `rules.report` uses "die Person, die es gepostet hat" for the same
//    reason.
// "Be the first to ..." imperatives use a neutral direct-object
// construction (task brief's own example): `feed.empty` -> "Schreib den
// ersten Beitrag.", `thread.emptyComments` -> "Schreib das erste
// freundliche Wort." — an imperative verb form, invariant regardless of
// the reader's gender.
//
// Compact time units: "Min."/"Std."/"T." (not a spelled-out
// "Minute(n)"/"Stunde(n)"/"Tag(e)"), matching the "reads the same at any
// count" rule the other catalogs' time.* section follows (see en.ts's
// comment on that section) — German's plural noun forms do change with
// count, which these abbreviations sidestep.
export const de: Record<string, string> = {
  title: "Gemeinschaft",

  "topics.news": "Neuigkeiten",
  "topics.general": "Allgemein",
  "topics.prayer": "Gebet",
  "topics.prayerRequest": "Gebetsanliegen",
  "topics.testimony": "Zeugnis",
  "topics.question": "Frage",
  "topics.encouragement": "Ermutigung",
  "topics.cycleBody": "Zyklus und Körper",
  "topics.fertility": "Fruchtbarkeit",
  "topics.faith": "Glaube",
  "topics.relationships": "Beziehungen",

  "feed.all": "Alle",
  "feed.searchPlaceholder": "Beiträge durchsuchen…",
  "feed.composePrompt": "Teile etwas mit der Gemeinschaft…",
  "feed.unreachableRetry":
    "Die Gemeinschaft ist gerade nicht erreichbar. Ziehe nach unten, um es erneut zu versuchen.",
  "feed.unreachable": "Die Gemeinschaft ist gerade nicht erreichbar.",
  "feed.noSearchResults": "Keine Beiträge entsprechen deiner Suche.",
  "feed.newsEmpty": "Ankündigungen vom Team erscheinen hier.",
  "feed.empty": "Hier gibt es noch keine Beiträge. Schreib den ersten Beitrag.",
  "feed.loadMore": "Mehr laden",
  "feed.newPosts.one": "{count} neuer Beitrag",
  "feed.newPosts.other": "{count} neue Beiträge",

  // Compact relative-time labels (see en.ts's comment on this section for
  // why these aren't `.one`/`.other` pluralized). "Min."/"Std."/"T." over a
  // bare "m"/"h"/"d": a single unspaced letter isn't a recognized German
  // abbreviation for these units the way it is in English.
  "time.now": "jetzt",
  "time.minutes": "{count} Min.",
  "time.hours": "{count} Std.",
  "time.days": "{count} T.",

  "post.pinned": "Angeheftet",
  "post.viewMore": "Mehr anzeigen",
  "post.viewLess": "Weniger anzeigen",
  "post.reaction.received": "{name} hat auf deinen Beitrag reagiert",
  "post.reaction.anonymous.one": "Jemand hat auf deinen Beitrag reagiert",
  "post.reaction.anonymous.other": "{count} Personen haben auf deinen Beitrag reagiert",
  "post.reaction.withOthers.one":
    "{name} und {count} weitere Person haben auf deinen Beitrag reagiert",
  "post.reaction.withOthers.other":
    "{name} und {count} weitere Personen haben auf deinen Beitrag reagiert",

  "thread.comments.one": "{count} Kommentar",
  "thread.comments.other": "{count} Kommentare",
  "thread.loadingComments": "Kommentare werden geladen…",
  "thread.emptyComments": "Schreib das erste freundliche Wort.",
  "thread.commentPlaceholder": "Ein freundliches Wort hinzufügen…",

  "composer.placeholder": "Teile einen Gedanken, eine Geschichte, eine Ermutigung…",
  "composer.pollPlaceholder": "Stell deine Frage…",
  "composer.option": "Option {number}",
  "composer.addOption": "Option hinzufügen",
  "composer.poll": "Umfrage",
  "composer.removePoll": "Umfrage entfernen",
  "composer.post": "VERÖFFENTLICHEN",

  "poll.votes.one": "{count} Stimme",
  "poll.votes.other": "{count} Stimmen",
  "poll.tapToVote": "Tippe auf eine Option, um abzustimmen",

  "rules.title": "Gemeinschaftsrichtlinien",
  "rules.kind": "Sei freundlich. Das ist ein Raum der Ermutigung für alle.",
  "rules.medical": "Keine medizinischen Ratschläge. Teile Erfahrungen, keine Verschreibungen.",
  "rules.hateful":
    "Keine hasserfüllten, belästigenden oder expliziten Inhalte. Sie werden entfernt und können zu einer Sperre führen.",
  "rules.report":
    "Etwas stimmt nicht? Melde es, oder blockiere die Person, die es gepostet hat. Wir prüfen jede Meldung.",
  "rules.accept": "Einverstanden, ich bin dabei",

  "notice.errorTitle": "Etwas ist schiefgelaufen",
  "notice.rejectedTitle": "Bleiben wir sanft",
  "notice.errorBody":
    "Wir konnten die Gemeinschaft gerade nicht erreichen. Bitte überprüfe deine Verbindung und versuche es erneut.",
  "notice.rejectedPostBody":
    "Dein Beitrag konnte nicht veröffentlicht werden, da er gegen unsere Gemeinschaftsrichtlinien verstößt. Dies ist ein Raum für Freundlichkeit, Ermutigung und Gnade. Danke, dass du hilfst, ihn für alle sicher zu halten.",
  "notice.rejectedCommentBody":
    "Dein Kommentar konnte nicht veröffentlicht werden, da er gegen unsere Gemeinschaftsrichtlinien verstößt. Dies ist ein Raum für Freundlichkeit, Ermutigung und Gnade. Danke, dass du hilfst, ihn für alle sicher zu halten.",
  "notice.gotIt": "Verstanden",

  "menu.cancel": "Abbrechen",
  "menu.delete": "Löschen",
  "menu.deletePostTitle": "Diesen Beitrag löschen?",
  "menu.deletePostBody": "Er wird aus der Gemeinschaft entfernt.",
  "menu.deleteCommentTitle": "Diesen Kommentar löschen?",
  "menu.reportPost": "Beitrag melden",
  "menu.reportComment": "Kommentar melden",
  "menu.block": "Blockieren",
  "menu.blockUser": "{name} blockieren",
  "menu.blockUserConfirmTitle": "{name} blockieren?",
  "menu.blockUserConfirmBody":
    "Du wirst die Beiträge und Kommentare dieser Person nie wieder sehen.",

  "report.title": "Diesen Inhalt melden",
  "report.reasons.spam": "Spam",
  "report.reasons.harassment": "Belästigung",
  "report.reasons.hate": "Hassinhalte",
  "report.reasons.inappropriate": "Unangemessen",
  "report.reasons.other": "Etwas anderes",
  "report.detailsPlaceholder": "Möchtest du uns noch etwas mitteilen? (optional)",
  "report.send": "Meldung senden",
  "report.sentTitle": "Danke",
  "report.sentBody": "Deine Meldung wurde gesendet. Unser Team prüft jede Meldung.",
  "report.errorTitle": "Meldung konnte nicht gesendet werden",
  "report.errorBody": "Bitte überprüfe deine Verbindung und versuche es erneut.",

  "profile.postsSection": "Beiträge",
  "profile.editProfile": "Profil bearbeiten",
  "profile.emptyOwn": "Du hast noch nichts geteilt.",
  "profile.emptyOther": "Noch keine Beiträge zum Anzeigen.",
  "profile.changePhoto": "Foto ändern",
  "profile.bioLabel": "Bio",
  "profile.bioPlaceholder": "Erzähl der Gemeinschaft ein wenig über dich",
  "profile.usernameLabel": "Benutzername",
  "profile.usernamePlaceholder": "deinname",
  "profile.usernameHelper": "3 bis 20 Zeichen: Buchstaben, Zahlen und Bindestriche.",
  "profile.photoRejected": "Dieses Foto wurde nicht akzeptiert. Bitte wähle ein anderes.",
  "profile.bioRejected": "Dieser Text wurde von der Moderation nicht akzeptiert.",
  "profile.usernameRejected": "Dieser Benutzername wurde von der Moderation nicht akzeptiert.",
  "profile.usernameTaken": "Dieser Benutzername ist bereits vergeben.",
  "profile.usernameInvalid": "Nur Kleinbuchstaben, Zahlen und Bindestriche, 3 bis 20 Zeichen.",
  "profile.genericError": "Etwas ist schiefgelaufen. Bitte versuche es erneut.",
  "profile.save": "Speichern",

  "inbox.title": "Benachrichtigungen",
  "inbox.empty":
    "Hier ist noch nichts los. Wenn jemand auf deine Beiträge reagiert, sie mag oder kommentiert, erscheint es hier.",
  "inbox.someone": "Jemand",
  "inbox.liked": "{name} gefällt dein Beitrag",
  "inbox.commented": "{name} hat deinen Beitrag kommentiert",
  "inbox.reacted": "{name} hat auf deinen Beitrag reagiert",
  "inbox.news": "Neuigkeiten von {name}",
  "inbox.supportReply": "Das Support-Team hat dir geantwortet",
};
