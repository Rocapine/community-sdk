// Portuguese (Portugal) catalog for @rocapine/community-ui.
//
// Ported from Eve's Rhythm's i18n/pt-PT/community.json (eden-s-rythm repo —
// comment only, no runtime dependency on that app), flattened to the same
// dot-key scheme as en.ts (see task-9-report.md for the key-rename table:
// prayedForYou.* -> reaction.*, aSister -> someone, _one/_other ->
// .one/.other). Degendered in-language ("irmã(s)" -> neutral phrasing) and
// de-branded ("Eve" / "Eve's Rhythm" removed) to match en.ts's neutral
// meaning. Keys en.ts added that Eve's JSON lacks (menu.cancel, menu.delete,
// profile.save) were translated fresh from the app-wide common.json values
// (Cancelar / Eliminar / Guardar) and reaction.* was translated fresh from
// the en value (Eve's JSON only has prayer-flavored copy there).
export const ptPT: Record<string, string> = {
  title: "Comunidade",

  "topics.news": "Notícias",
  "topics.general": "Geral",
  "topics.prayer": "Oração",
  "topics.prayerRequest": "Pedido de oração",
  "topics.testimony": "Testemunho",
  "topics.question": "Pergunta",
  "topics.encouragement": "Encorajamento",
  "topics.cycleBody": "Ciclo e corpo",
  "topics.fertility": "Fertilidade",
  "topics.faith": "Fé",
  "topics.relationships": "Relações",

  "feed.all": "Todas",
  "feed.searchPlaceholder": "Procurar publicações…",
  "feed.composePrompt": "Partilha com a comunidade…",
  "feed.unreachableRetry":
    "Neste momento não é possível aceder à comunidade. Puxa para tentar de novo.",
  "feed.unreachable": "Neste momento não é possível aceder à comunidade.",
  "feed.noSearchResults": "Nenhuma publicação corresponde à tua pesquisa.",
  "feed.newsEmpty": "Os anúncios da equipa vão aparecer aqui.",
  "feed.empty": "Ainda não há publicações por aqui. Partilha a primeira.",
  "feed.loadMore": "Carregar mais",
  "feed.newPosts.one": "{count} publicação nova",
  "feed.newPosts.other": "{count} publicações novas",

  // Compact relative-time labels (see en.ts's comment on this section for
  // why these aren't `.one`/`.other` pluralized).
  "time.now": "agora",
  "time.minutes": "{count} min",
  "time.hours": "{count} h",
  "time.days": "{count} d",

  "post.pinned": "Fixado",
  "post.viewMore": "Ver mais",
  "post.viewLess": "Ver menos",
  "post.reaction.received": "{name} reagiu à tua publicação",
  "post.reaction.anonymous.one": "Alguém reagiu à tua publicação",
  "post.reaction.anonymous.other": "{count} pessoas reagiram à tua publicação",
  "post.reaction.withOthers.one": "{name} e mais {count} pessoa reagiram à tua publicação",
  "post.reaction.withOthers.other": "{name} e mais {count} pessoas reagiram à tua publicação",

  "thread.comments.one": "{count} comentário",
  "thread.comments.other": "{count} comentários",
  "thread.loadingComments": "A carregar comentários…",
  "thread.emptyComments": "Deixa a primeira palavra amiga.",
  "thread.commentPlaceholder": "Deixa uma palavra amiga…",

  "composer.placeholder": "Partilha um pensamento, uma história, uma palavra de encorajamento…",
  "composer.pollPlaceholder": "Faz a tua pergunta…",
  "composer.option": "Opção {number}",
  "composer.addOption": "Adicionar opção",
  "composer.poll": "Sondagem",
  "composer.removePoll": "Remover sondagem",
  "composer.post": "PUBLICAR",

  "poll.votes.one": "{count} voto",
  "poll.votes.other": "{count} votos",
  "poll.tapToVote": "Toca numa opção para votar",

  "rules.title": "Normas da comunidade",
  "rules.kind": "Sê gentil. Este é um espaço de encorajamento para todas.",
  "rules.medical": "Nada de conselhos médicos. Partilha experiências, não receitas.",
  "rules.hateful":
    "Nada de conteúdo de ódio, assédio ou conteúdo explícito. É removido e pode levar a uma expulsão.",
  "rules.report":
    "Viste algo estranho? Denuncia ou bloqueia quem escreveu. Analisamos todas as denúncias.",
  "rules.accept": "Concordo, quero entrar",

  "notice.errorTitle": "Algo correu mal",
  "notice.rejectedTitle": "Vamos manter a gentileza",
  "notice.errorBody":
    "Não conseguimos chegar à comunidade agora. Verifica a tua ligação e tenta de novo.",
  "notice.rejectedPostBody":
    "A tua publicação não pôde ser partilhada porque vai contra as normas da nossa comunidade. Este é um espaço de bondade, encorajamento e graça. Agradecemos por ajudares a mantê-lo seguro para todas.",
  "notice.rejectedCommentBody":
    "O teu comentário não pôde ser partilhado porque vai contra as normas da nossa comunidade. Este é um espaço de bondade, encorajamento e graça. Agradecemos por ajudares a mantê-lo seguro para todas.",
  "notice.gotIt": "Entendido",

  "menu.cancel": "Cancelar",
  "menu.delete": "Eliminar",
  "menu.deletePostTitle": "Apagar esta publicação?",
  "menu.deletePostBody": "Vai desaparecer da comunidade.",
  "menu.deleteCommentTitle": "Apagar este comentário?",
  "menu.reportPost": "Denunciar publicação",
  "menu.reportComment": "Denunciar comentário",
  "menu.block": "Bloquear",
  "menu.blockUser": "Bloquear {name}",
  "menu.blockUserConfirmTitle": "Bloquear {name}?",
  "menu.blockUserConfirmBody":
    "Nunca mais vais ver as publicações nem os comentários desta pessoa.",

  "report.title": "Denunciar este conteúdo",
  "report.reasons.spam": "Spam",
  "report.reasons.harassment": "Assédio",
  "report.reasons.hate": "Conteúdo de ódio",
  "report.reasons.inappropriate": "Impróprio",
  "report.reasons.other": "Outra coisa",
  "report.detailsPlaceholder": "Há algo que devamos saber? (opcional)",
  "report.send": "Enviar denúncia",
  "report.sentTitle": "Agradecemos",
  "report.sentBody": "A tua denúncia foi enviada. A nossa equipa analisa todas as denúncias.",
  "report.errorTitle": "Não foi possível enviar a denúncia",
  "report.errorBody": "Verifica a tua ligação e tenta de novo.",

  "profile.postsSection": "publicações",
  "profile.editProfile": "Editar perfil",
  "profile.emptyOwn": "Ainda não partilhaste nada.",
  "profile.emptyOther": "Ainda não há publicações para mostrar.",
  "profile.changePhoto": "Mudar a foto",
  "profile.bioLabel": "Bio",
  "profile.bioPlaceholder": "Conta um pouco de ti à comunidade",
  "profile.usernameLabel": "Nome de utilizador",
  "profile.usernamePlaceholder": "oteunome",
  "profile.usernameHelper": "3 a 20 caracteres, letras, números e hífenes.",
  "profile.photoRejected": "Esta foto não foi aceite. Escolhe outra, por favor.",
  "profile.bioRejected": "Este texto não foi aceite pela moderação.",
  "profile.usernameRejected": "Este nome de utilizador não foi aceite pela moderação.",
  "profile.usernameTaken": "Este nome de utilizador já está ocupado.",
  "profile.usernameInvalid":
    "Apenas letras minúsculas, números e hífenes, entre 3 e 20 caracteres.",
  "profile.genericError": "Algo correu mal. Tenta de novo, por favor.",
  "profile.save": "Guardar",

  "inbox.title": "Notificações",
  "inbox.empty":
    "Ainda não há nada por aqui. Quando alguém reagir, gostar ou comentar as tuas publicações, vai aparecer aqui.",
  "inbox.someone": "Alguém",
  "inbox.liked": "{name} gostou da tua publicação",
  "inbox.commented": "{name} comentou a tua publicação",
  "inbox.reacted": "{name} reagiu à tua publicação",
  "inbox.news": "Notícias de {name}",
  "inbox.supportReply": "A equipa de apoio respondeu-te",
};
