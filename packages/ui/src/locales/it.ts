// Italian catalog for @rocapine/community-ui.
//
// Ported from Eve's Rhythm's i18n/it/community.json (source app's repo —
// comment only, no runtime dependency on that app), flattened to the same
// dot-key scheme as en.ts (see the internal port notes for the key-rename table:
// prayedForYou.* -> reaction.*, aSister -> someone, _one/_other ->
// .one/.other). Degendered in-language ("sorella/sorelle" -> neutral
// phrasing) and de-branded ("Eve's News" / "Eve's Rhythm" removed) to match
// en.ts's neutral meaning. Keys en.ts added that Eve's JSON lacks
// (menu.cancel, menu.delete, profile.save) were translated fresh from the
// app-wide common.json values (Annulla / Elimina / Salva) and reaction.* was
// translated fresh from the en value (Eve's JSON only has prayer-flavored
// copy there).
export const it: Record<string, string> = {
  title: "Comunità",

  "topics.news": "Novità",
  "topics.general": "Generale",
  "topics.prayer": "Preghiera",
  "topics.prayerRequest": "Richiesta di preghiera",
  "topics.testimony": "Testimonianza",
  "topics.question": "Domanda",
  "topics.encouragement": "Incoraggiamento",
  "topics.cycleBody": "Ciclo e corpo",
  "topics.fertility": "Fertilità",
  "topics.faith": "Fede",
  "topics.relationships": "Relazioni",

  "feed.all": "Tutto",
  "feed.searchPlaceholder": "Cerca tra i post…",
  "feed.composePrompt": "Condividi con la comunità…",
  "feed.unreachableRetry": "La comunità non è raggiungibile in questo momento. Tira per riprovare.",
  "feed.unreachable": "La comunità non è raggiungibile in questo momento.",
  "feed.noSearchResults": "Nessun post corrisponde alla tua ricerca.",
  "feed.newsEmpty": "Gli annunci del team compariranno qui.",
  "feed.empty": "Ancora nessun post qui. Condividi il primo.",
  "feed.loadMore": "Carica altri",
  "feed.newPosts.one": "{count} nuovo post",
  "feed.newPosts.other": "{count} nuovi post",

  // Compact relative-time labels (see en.ts's comment on this section for
  // why these aren't `.one`/`.other` pluralized). "g" for days ("giorni"),
  // not "d" — Italian has no word starting with "d" for a day.
  "time.now": "ora",
  "time.minutes": "{count} min",
  "time.hours": "{count} h",
  "time.days": "{count} g",

  "post.pinned": "In evidenza",
  "post.viewMore": "Mostra di più",
  "post.viewLess": "Mostra meno",
  "post.reaction.received": "{name} ha reagito al tuo post",
  "post.reaction.anonymous.one": "Qualcuno ha reagito al tuo post",
  "post.reaction.anonymous.other": "{count} persone hanno reagito al tuo post",
  "post.reaction.withOthers.one": "{name} e {count} altra persona hanno reagito al tuo post",
  "post.reaction.withOthers.other": "{name} e altre {count} persone hanno reagito al tuo post",

  "thread.comments.one": "{count} commento",
  "thread.comments.other": "{count} commenti",
  "thread.loadingComments": "Caricamento dei commenti…",
  "thread.emptyComments": "Lascia la prima parola gentile.",
  "thread.commentPlaceholder": "Aggiungi una parola gentile…",

  "composer.placeholder": "Condividi un pensiero, una storia, un incoraggiamento…",
  "composer.pollPlaceholder": "Fai la tua domanda…",
  "composer.option": "Opzione {number}",
  "composer.addOption": "Aggiungi opzione",
  "composer.poll": "Sondaggio",
  "composer.removePoll": "Rimuovi sondaggio",
  "composer.post": "PUBBLICA",

  "poll.votes.one": "{count} voto",
  "poll.votes.other": "{count} voti",
  "poll.tapToVote": "Tocca un'opzione per votare",

  "rules.title": "Linee guida della comunità",
  "rules.kind": "Sii gentile. Questo è uno spazio di incoraggiamento per tutte.",
  "rules.medical": "Nessun consiglio medico. Condividi esperienze, non prescrizioni.",
  "rules.hateful":
    "Nessun contenuto offensivo, molesto o esplicito. Viene rimosso e può portare a un blocco.",
  "rules.report":
    "Noti qualcosa che non va? Segnalalo, o blocca chi l'ha scritto. Esaminiamo ogni segnalazione.",
  "rules.accept": "Sono d'accordo, entriamo",

  "notice.errorTitle": "Qualcosa è andato storto",
  "notice.rejectedTitle": "Manteniamo la delicatezza",
  "notice.errorBody":
    "Non siamo riusciti a raggiungere la comunità in questo momento. Controlla la connessione e riprova.",
  "notice.rejectedPostBody":
    "Il tuo post non è stato condiviso perché va contro le linee guida della comunità. Questo è uno spazio di gentilezza, incoraggiamento e grazia. Grazie per aiutarci a custodirlo sicuro per tutte.",
  "notice.rejectedCommentBody":
    "Il tuo commento non è stato condiviso perché va contro le linee guida della comunità. Questo è uno spazio di gentilezza, incoraggiamento e grazia. Grazie per aiutarci a custodirlo sicuro per tutte.",
  "notice.gotIt": "Ho capito",

  "menu.cancel": "Annulla",
  "menu.delete": "Elimina",
  "menu.deletePostTitle": "Eliminare questo post?",
  "menu.deletePostBody": "Sparirà dalla comunità.",
  "menu.deleteCommentTitle": "Eliminare questo commento?",
  "menu.reportPost": "Segnala il post",
  "menu.reportComment": "Segnala il commento",
  "menu.block": "Blocca",
  "menu.blockUser": "Blocca {name}",
  "menu.blockUserConfirmTitle": "Bloccare {name}?",
  "menu.blockUserConfirmBody": "Non vedrai più i suoi post né i suoi commenti.",

  "report.title": "Segnala questo contenuto",
  "report.reasons.spam": "Spam",
  "report.reasons.harassment": "Molestie",
  "report.reasons.hate": "Contenuto offensivo",
  "report.reasons.inappropriate": "Inappropriato",
  "report.reasons.other": "Altro",
  "report.detailsPlaceholder": "C'è qualcosa che dovremmo sapere? (facoltativo)",
  "report.send": "Invia la segnalazione",
  "report.sentTitle": "Grazie",
  "report.sentBody":
    "La tua segnalazione è stata inviata. Il nostro team esamina ogni segnalazione.",
  "report.errorTitle": "Impossibile inviare la segnalazione",
  "report.errorBody": "Controlla la connessione e riprova.",

  "profile.postsSection": "post",
  "profile.editProfile": "Modifica profilo",
  "profile.emptyOwn": "Non hai ancora condiviso nulla.",
  "profile.emptyOther": "Ancora nessun post da mostrare.",
  "profile.changePhoto": "Cambia foto",
  "profile.bioLabel": "Bio",
  "profile.bioPlaceholder": "Racconta alla comunità qualcosa di te",
  "profile.usernameLabel": "Nome utente",
  "profile.usernamePlaceholder": "iltuonome",
  "profile.usernameHelper": "Da 3 a 20 caratteri, lettere, numeri e trattini.",
  "profile.photoRejected": "Questa foto non è stata accettata. Scegline un'altra.",
  "profile.bioRejected": "Questo testo non è stato accettato dalla moderazione.",
  "profile.usernameRejected": "Questo nome utente non è stato accettato dalla moderazione.",
  "profile.usernameTaken": "Questo nome utente è già in uso.",
  "profile.usernameInvalid": "Solo lettere minuscole, numeri e trattini, da 3 a 20 caratteri.",
  "profile.genericError": "Qualcosa è andato storto. Riprova.",
  "profile.save": "Salva",

  "inbox.title": "Notifiche",
  "inbox.empty":
    "Ancora nulla qui. Quando qualcuno reagirà, metterà mi piace o commenterà i tuoi post, lo troverai qui.",
  "inbox.someone": "Qualcuno",
  "inbox.liked": "A {name} piace il tuo post",
  "inbox.commented": "{name} ha commentato il tuo post",
  "inbox.reacted": "{name} ha reagito al tuo post",
  "inbox.news": "Novità da {name}",
  "inbox.supportReply": "Il team di supporto ti ha risposto",
};
