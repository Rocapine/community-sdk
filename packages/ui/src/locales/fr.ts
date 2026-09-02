// French catalog for @rocapine/community-ui.
//
// Translated from en.ts (this package's canonical key set — there is no
// "Eve's Rhythm" French port to draw from, unlike the first 7 catalogs;
// this one and de.ts are authored fresh against en.ts's meaning and the
// same degendering/de-branding rules as every other catalog here).
//
// French gender-neutrality notes: French inflects far more than English —
// predicate adjectives after "être" and past participles after "être" (not
// "avoir") agree with the subject's grammatical gender, so a naive
// translation of an imperative like "Be the first to share" bakes in a
// feminine or masculine reader ("Sois la première" / "Sois le premier").
// Techniques used throughout, matching the existing es/it/pt catalogs:
//  - Rewriting a gendered "be the first" imperative around a
//    gender-invariant verb + object instead of a gendered predicate
//    adjective, e.g. `feed.empty` -> "Lance la conversation." (not "Sois la
//    première à partager."), `thread.emptyComments` -> "Laisse le premier
//    mot gentil." (the adjective "premier" agrees with the masculine noun
//    "mot", not with the reader).
//  - `rules.report`/`menu.blockUserConfirmBody`: "la personne qui l'a
//    publié" / a noun phrase instead of a gendered 3rd-person pronoun for
//    an unknown-gender author.
//  - Past participles after "avoir" with no preceding direct object don't
//    agree with the subject at all (`tu as partagé`, `a réagi`), so most
//    action-completed sentences ("{name} a réagi à ta publication") need no
//    special handling — the agreement pitfall is narrower than it first
//    looks, limited to predicate adjectives and "être"-auxiliary participles.
//  - "nous"-voiced collective lines (`notice.rejectedTitle`) keep the
//    standard unmarked masculine-plural agreement ("Restons bienveillants")
//    — this is French's ordinary neutral default for a mixed/unknown
//    group, distinct from the reader-targeting singular problem above.
//
// Compact time units: "min"/"h"/"j" (not a spelled-out "minute(s)" etc.),
// matching the "reads the same at any count" rule the other catalogs'
// time.* section follows (see en.ts's comment on that section).
export const fr: Record<string, string> = {
  title: "Communauté",

  "topics.news": "Actualités",
  "topics.general": "Général",
  "topics.prayer": "Prière",
  "topics.prayerRequest": "Demande de prière",
  "topics.testimony": "Témoignage",
  "topics.question": "Question",
  "topics.encouragement": "Encouragement",
  "topics.cycleBody": "Cycle et corps",
  "topics.fertility": "Fertilité",
  "topics.faith": "Foi",
  "topics.relationships": "Relations",

  "feed.all": "Tout",
  "feed.searchPlaceholder": "Rechercher des publications…",
  "feed.composePrompt": "Partage avec la communauté…",
  "feed.unreachableRetry":
    "La communauté est injoignable pour le moment. Tire vers le bas pour réessayer.",
  "feed.unreachable": "La communauté est injoignable pour le moment.",
  "feed.noSearchResults": "Aucune publication ne correspond à ta recherche.",
  "feed.newsEmpty": "Les annonces de l'équipe apparaîtront ici.",
  "feed.empty": "Aucune publication pour l'instant. Lance la conversation.",
  "feed.loadMore": "Charger plus",
  "feed.newPosts.one": "{count} nouvelle publication",
  "feed.newPosts.other": "{count} nouvelles publications",

  // Compact relative-time labels (see en.ts's comment on this section for
  // why these aren't `.one`/`.other` pluralized).
  "time.now": "maintenant",
  "time.minutes": "{count} min",
  "time.hours": "{count} h",
  "time.days": "{count} j",

  "post.pinned": "Épinglé",
  "post.viewMore": "Voir plus",
  "post.viewLess": "Voir moins",
  "post.reaction.received": "{name} a réagi à ta publication",
  "post.reaction.anonymous.one": "Quelqu'un a réagi à ta publication",
  "post.reaction.anonymous.other": "{count} personnes ont réagi à ta publication",
  "post.reaction.withOthers.one": "{name} et {count} autre personne ont réagi à ta publication",
  "post.reaction.withOthers.other": "{name} et {count} autres personnes ont réagi à ta publication",

  "thread.comments.one": "{count} commentaire",
  "thread.comments.other": "{count} commentaires",
  "thread.loadingComments": "Chargement des commentaires…",
  "thread.emptyComments": "Laisse le premier mot gentil.",
  "thread.commentPlaceholder": "Ajoute un mot gentil…",

  "composer.placeholder": "Partage une pensée, une histoire, un encouragement…",
  "composer.pollPlaceholder": "Pose ta question…",
  "composer.option": "Option {number}",
  "composer.addOption": "Ajouter une option",
  "composer.poll": "Sondage",
  "composer.removePoll": "Retirer le sondage",
  "composer.post": "PUBLIER",

  "poll.votes.one": "{count} vote",
  "poll.votes.other": "{count} votes",
  "poll.tapToVote": "Touche une option pour voter",

  "rules.title": "Règles de la communauté",
  "rules.kind": "Fais preuve de bienveillance. Cet espace est fait pour encourager tout le monde.",
  "rules.medical": "Pas de conseils médicaux. Partage des expériences, pas des prescriptions.",
  "rules.hateful":
    "Aucun contenu haineux, harcelant ou explicite n'est toléré. Il est retiré et peut entraîner une exclusion.",
  "rules.report":
    "Tu vois un souci ? Signale-le, ou bloque la personne qui l'a publié. Nous examinons chaque signalement.",
  "rules.accept": "J'accepte, laisse-moi entrer",

  "notice.errorTitle": "Une erreur s'est produite",
  "notice.rejectedTitle": "Restons bienveillants",
  "notice.errorBody":
    "Nous n'avons pas pu joindre la communauté à l'instant. Vérifie ta connexion et réessaie.",
  "notice.rejectedPostBody":
    "Ta publication n'a pas pu être partagée car elle va à l'encontre des règles de notre communauté. Cet espace est fait de bonté, d'encouragement et de grâce. Merci de nous aider à le garder sûr pour tout le monde.",
  "notice.rejectedCommentBody":
    "Ton commentaire n'a pas pu être partagé car il va à l'encontre des règles de notre communauté. Cet espace est fait de bonté, d'encouragement et de grâce. Merci de nous aider à le garder sûr pour tout le monde.",
  "notice.gotIt": "Compris",

  "menu.cancel": "Annuler",
  "menu.delete": "Supprimer",
  "menu.deletePostTitle": "Supprimer cette publication ?",
  "menu.deletePostBody": "Elle disparaîtra de la communauté.",
  "menu.deleteCommentTitle": "Supprimer ce commentaire ?",
  "menu.reportPost": "Signaler la publication",
  "menu.reportComment": "Signaler le commentaire",
  "menu.block": "Bloquer",
  "menu.blockUser": "Bloquer {name}",
  "menu.blockUserConfirmTitle": "Bloquer {name} ?",
  "menu.blockUserConfirmBody": "Tu ne verras plus jamais ses publications ni ses commentaires.",

  "report.title": "Signaler ce contenu",
  "report.reasons.spam": "Spam",
  "report.reasons.harassment": "Harcèlement",
  "report.reasons.hate": "Contenu haineux",
  "report.reasons.inappropriate": "Inapproprié",
  "report.reasons.other": "Autre chose",
  "report.detailsPlaceholder": "Quelque chose à nous signaler ? (facultatif)",
  "report.send": "Envoyer le signalement",
  "report.sentTitle": "Merci",
  "report.sentBody": "Ton signalement a été envoyé. Notre équipe examine chaque signalement.",
  "report.errorTitle": "Impossible d'envoyer le signalement",
  "report.errorBody": "Vérifie ta connexion et réessaie.",

  "profile.postsSection": "publications",
  "profile.editProfile": "Modifier le profil",
  "profile.emptyOwn": "Tu n'as encore rien partagé.",
  "profile.emptyOther": "Encore aucune publication à afficher.",
  "profile.changePhoto": "Changer la photo",
  "profile.bioLabel": "Bio",
  "profile.bioPlaceholder": "Parle un peu de toi à la communauté",
  "profile.usernameLabel": "Nom d'utilisateur",
  "profile.usernamePlaceholder": "tonpseudo",
  "profile.usernameHelper": "De 3 à 20 caractères : lettres, chiffres et tirets.",
  "profile.photoRejected": "Cette photo n'a pas été acceptée. Choisis-en une autre, s'il te plaît.",
  "profile.bioRejected": "Ce texte n'a pas été accepté par la modération.",
  "profile.usernameRejected": "Ce nom d'utilisateur n'a pas été accepté par la modération.",
  "profile.usernameTaken": "Ce nom d'utilisateur est déjà pris.",
  "profile.usernameInvalid":
    "Seulement des minuscules, des chiffres et des tirets, de 3 à 20 caractères.",
  "profile.genericError": "Une erreur s'est produite. Réessaie, s'il te plaît.",
  "profile.save": "Enregistrer",

  "inbox.title": "Notifications",
  "inbox.empty":
    "Rien pour l'instant. Quand quelqu'un réagit à tes publications, les aime ou les commente, ça s'affichera ici.",
  "inbox.someone": "Quelqu'un",
  "inbox.liked": "{name} a aimé ta publication",
  "inbox.commented": "{name} a commenté ta publication",
  "inbox.reacted": "{name} a réagi à ta publication",
  "inbox.news": "Actualités de {name}",
  "inbox.supportReply": "L'équipe support t'a répondu",
};
