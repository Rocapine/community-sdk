// French catalog, formal register ("vous"), for @rocapine/community-ui.
//
// Same key set and same gender-neutrality techniques as fr.ts (the "tu"
// catalog) — only the register changes: every reader-addressing "tu/ton/ta/
// tes" becomes "vous/votre/vos", imperatives take the vous form, and the
// predicate-adjective pitfalls stay avoided the same way (gender-invariant
// verb + object rather than an adjective agreeing with the reader).
//
// A host whose app speaks to its users with "vous" passes
// `translations.locale = "fr-vous"`; any key missing here falls back to fr,
// then en (see i18n.ts: "fr-vous" → base language "fr").
export const frVous: Record<string, string> = {
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
  "feed.composePrompt": "Partagez avec la communauté…",
  "feed.unreachableRetry":
    "La communauté est injoignable pour le moment. Tirez vers le bas pour réessayer.",
  "feed.unreachable": "La communauté est injoignable pour le moment.",
  "feed.noSearchResults": "Aucune publication ne correspond à votre recherche.",
  "feed.newsEmpty": "Les annonces de l'équipe apparaîtront ici.",
  "feed.empty": "Aucune publication pour l'instant. Lancez la conversation.",
  "feed.loadMore": "Charger plus",
  "feed.newPosts.one": "{count} nouvelle publication",
  "feed.newPosts.other": "{count} nouvelles publications",

  "time.now": "maintenant",
  "time.minutes": "{count} min",
  "time.hours": "{count} h",
  "time.days": "{count} j",
  "time.seconds": "{count} s",
  "time.months.one": "{count} mois",
  "time.months.other": "{count} mois",
  "time.years.one": "{count} an",
  "time.years.other": "{count} ans",

  "post.pinned": "Épinglé",
  "post.viewMore": "Voir plus",
  "post.viewLess": "Voir moins",
  "post.reaction.received": "{name} a réagi à votre publication",
  "post.reaction.anonymous.one": "Quelqu'un a réagi à votre publication",
  "post.reaction.anonymous.other": "{count} personnes ont réagi à votre publication",
  "post.reaction.withOthers.one": "{name} et {count} autre personne ont réagi à votre publication",
  "post.reaction.withOthers.other":
    "{name} et {count} autres personnes ont réagi à votre publication",

  "thread.comments.one": "{count} commentaire",
  "thread.comments.other": "{count} commentaires",
  "thread.loadingComments": "Chargement des commentaires…",
  "thread.emptyComments": "Laissez le premier mot gentil.",
  "thread.commentPlaceholder": "Ajoutez un mot gentil…",
  "thread.replyingTo": "En réponse à {name}",
  "a11y.like": "J'aime",
  "a11y.reply": "Répondre",
  "a11y.cancelReply": "Annuler la réponse",

  "composer.placeholder": "Partagez une pensée, une histoire, un encouragement…",
  "composer.pollPlaceholder": "Posez votre question…",
  "composer.option": "Option {number}",
  "composer.addOption": "Ajouter une option",
  "composer.removeOption": "Supprimer l’option",
  "composer.poll": "Sondage",
  "composer.removePoll": "Retirer le sondage",
  "composer.post": "PUBLIER",
  "composer.chooseTopic": "Publier dans",
  "composer.cancel": "Annuler",
  "composer.discardTitle": "Supprimer ce post ?",
  "composer.discard": "Supprimer",
  "composer.keepEditing": "Continuer à écrire",
  "feed.compose": "Nouveau post",

  "poll.votes.one": "{count} vote",
  "poll.votes.other": "{count} votes",
  "poll.tapToVote": "Touchez une option pour voter",

  "rules.title": "Règles de la communauté",
  "rules.kind":
    "Faites preuve de bienveillance. Cet espace est fait pour encourager tout le monde.",
  "rules.medical": "Pas de conseils médicaux. Partagez des expériences, pas des prescriptions.",
  "rules.hateful":
    "Aucun contenu haineux, harcelant ou explicite n'est toléré. Il est retiré et peut entraîner une exclusion.",
  "rules.report":
    "Vous voyez un souci ? Signalez-le, ou bloquez la personne qui l'a publié. Nous examinons chaque signalement.",
  "rules.accept": "J'accepte, laissez-moi entrer",

  "notice.errorTitle": "Une erreur s'est produite",
  "notice.rejectedTitle": "Restons bienveillants",
  "notice.errorBody":
    "Nous n'avons pas pu joindre la communauté à l'instant. Vérifiez votre connexion et réessayez.",
  "notice.rejectedPostBody":
    "Votre publication n'a pas pu être partagée car elle va à l'encontre des règles de notre communauté. Cet espace est fait de bonté, d'encouragement et de grâce. Merci de nous aider à le garder sûr pour tout le monde.",
  "notice.rejectedCommentBody":
    "Votre commentaire n'a pas pu être partagé car il va à l'encontre des règles de notre communauté. Cet espace est fait de bonté, d'encouragement et de grâce. Merci de nous aider à le garder sûr pour tout le monde.",
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
  "menu.blockUserConfirmBody": "Vous ne verrez plus jamais ses publications ni ses commentaires.",

  "report.title": "Signaler ce contenu",
  "report.reasons.spam": "Spam",
  "report.reasons.harassment": "Harcèlement",
  "report.reasons.hate": "Contenu haineux",
  "report.reasons.inappropriate": "Inapproprié",
  "report.reasons.other": "Autre chose",
  "report.detailsPlaceholder": "Quelque chose à nous signaler ? (facultatif)",
  "report.send": "Envoyer le signalement",
  "report.sentTitle": "Merci",
  "report.sentBody": "Votre signalement a été envoyé. Notre équipe examine chaque signalement.",
  "report.errorTitle": "Impossible d'envoyer le signalement",
  "report.errorBody": "Vérifiez votre connexion et réessayez.",

  "profile.postsSection": "publications",
  "profile.editProfile": "Modifier le profil",
  "profile.emptyOwn": "Vous n'avez encore rien partagé.",
  "profile.emptyOther": "Encore aucune publication à afficher.",
  "profile.changePhoto": "Changer la photo",
  "profile.bioLabel": "Bio",
  "profile.bioPlaceholder": "Parlez un peu de vous à la communauté",
  "profile.usernameLabel": "Identifiant",
  "profile.usernamePlaceholder": "votrepseudo",
  "profile.usernameHelper": "De 3 à 20 caractères : lettres, chiffres et tirets.",
  "profile.photoRejected":
    "Cette photo n'a pas été acceptée. Choisissez-en une autre, s'il vous plaît.",
  "profile.bioRejected": "Ce texte n'a pas été accepté par la modération.",
  "profile.usernameRejected": "Cet identifiant n'a pas été accepté par la modération.",
  "profile.usernameTaken": "Cet identifiant est déjà pris.",
  "profile.usernameInvalid":
    "Seulement des minuscules, des chiffres et des tirets, de 3 à 20 caractères.",
  "profile.usernameSuggestion":
    "@{handle} est déjà pris. Utilisez @{suggestion} ou choisissez-en un autre.",
  "profile.useSuggestion": "Utiliser @{suggestion}",
  "profile.displayNameLabel": "Nom affiché",
  "profile.displayNameHelper":
    "De 2 à 24 caractères, affiché sur vos publications et commentaires.",
  "profile.displayNameRejected": "Ce nom n'a pas été accepté par la modération.",
  "profile.displayNameInvalid": "Entre 2 et 24 caractères.",
  "profile.nameReserved": "Ce nom est réservé. Choisissez-en un autre, s'il vous plaît.",
  "profile.genericError": "Une erreur s'est produite. Réessayez, s'il vous plaît.",
  "profile.save": "Enregistrer",

  "inbox.title": "Notifications",
  "inbox.empty":
    "Rien pour l'instant. Quand quelqu'un réagit à vos publications, les aime ou les commente, ça s'affichera ici.",
  "inbox.someone": "Quelqu'un",
  "inbox.liked": "{name} a aimé votre publication",
  "inbox.commented": "{name} a commenté votre publication",
  "inbox.replied": "{name} a répondu à votre commentaire",
  "inbox.markAllRead": "Tout marquer comme lu",
  "inbox.reacted": "{name} a réagi à votre publication",
  "inbox.news": "Actualités de {name}",
  "inbox.newsFromTeam": "Actualités de l'équipe",
  "inbox.supportReply": "L'équipe support vous a répondu",

  "translation.translatedFrom": "Traduit {language}",
  "translation.original": "Original",
  "translation.showOriginal": "Voir l'original",
  "translation.showTranslation": "Voir la traduction",
  "language.en": "de l'anglais",
  "language.es": "de l'espagnol",
  "language.pt": "du portugais",
  "language.it": "de l'italien",
  "language.pl": "du polonais",
  "language.fr": "du français",
  "language.de": "de l'allemand",
  "language.ko": "du coréen",
  "language.ro": "du roumain",
  "language.uk": "de l'ukrainien",
  // Accessibility labels of icon-only buttons (screen readers).
  "a11y.back": "Retour",
  "a11y.more": "Plus d'options",
  "a11y.send": "Envoyer",
  "a11y.search": "Rechercher",
  "a11y.closeSearch": "Fermer la recherche",
  "a11y.clearSearch": "Effacer la recherche",
  "a11y.myProfile": "Mon profil",
  "composer.addImage": "Ajouter une image",
  "composer.removeImage": "Retirer l'image",
  "image.photo": "📷 Photo",
  "a11y.openImage": "Ouvrir l'image",
  "a11y.closeImage": "Fermer",
};
