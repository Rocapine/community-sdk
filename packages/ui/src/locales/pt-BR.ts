// Portuguese (Brazil) catalog for @rocapine/community-ui.
//
// Ported from Eve's Rhythm's i18n/pt-BR/community.json (eden-s-rythm repo —
// comment only, no runtime dependency on that app), flattened to the same
// dot-key scheme as en.ts (see task-9-report.md for the key-rename table:
// prayedForYou.* -> reaction.*, aSister -> someone, _one/_other ->
// .one/.other). Degendered in-language ("irmã(s)" -> neutral phrasing) and
// de-branded ("Eve" / "Eve's Rhythm" removed) to match en.ts's neutral
// meaning. Keys en.ts added that Eve's JSON lacks (menu.cancel, menu.delete,
// profile.save) were translated fresh from the app-wide common.json values
// (Cancelar / Excluir / Salvar) and reaction.* was translated fresh from
// the en value (Eve's JSON only has prayer-flavored copy there).
export const ptBR: Record<string, string> = {
  title: "Comunidade",

  "topics.news": "Novidades",
  "topics.general": "Geral",
  "topics.prayer": "Oração",
  "topics.prayerRequest": "Pedido de oração",
  "topics.testimony": "Testemunho",
  "topics.question": "Pergunta",
  "topics.encouragement": "Encorajamento",
  "topics.cycleBody": "Ciclo e corpo",
  "topics.fertility": "Fertilidade",
  "topics.faith": "Fé",
  "topics.relationships": "Relacionamentos",

  "feed.all": "Todas",
  "feed.searchPlaceholder": "Buscar publicações…",
  "feed.composePrompt": "Compartilhe com a comunidade…",
  "feed.unreachableRetry": "Não foi possível acessar a comunidade agora. Puxe para tentar de novo.",
  "feed.unreachable": "Não foi possível acessar a comunidade agora.",
  "feed.noSearchResults": "Nenhuma publicação corresponde à sua busca.",
  "feed.newsEmpty": "Os anúncios da equipe vão aparecer aqui.",
  "feed.empty": "Ainda não tem publicações por aqui. Compartilhe a primeira.",
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
  "post.reaction.received": "{name} reagiu à sua publicação",
  "post.reaction.anonymous.one": "Alguém reagiu à sua publicação",
  "post.reaction.anonymous.other": "{count} pessoas reagiram à sua publicação",
  "post.reaction.withOthers.one": "{name} e mais {count} pessoa reagiram à sua publicação",
  "post.reaction.withOthers.other": "{name} e mais {count} pessoas reagiram à sua publicação",

  "thread.comments.one": "{count} comentário",
  "thread.comments.other": "{count} comentários",
  "thread.loadingComments": "Carregando comentários…",
  "thread.emptyComments": "Deixe a primeira palavra de carinho.",
  "thread.commentPlaceholder": "Deixe uma palavra de carinho…",

  "composer.placeholder": "Compartilhe um pensamento, uma história, uma palavra de ânimo…",
  "composer.pollPlaceholder": "Faça sua pergunta…",
  "composer.option": "Opção {number}",
  "composer.addOption": "Adicionar opção",
  "composer.poll": "Enquete",
  "composer.removePoll": "Remover enquete",
  "composer.post": "PUBLICAR",

  "poll.votes.one": "{count} voto",
  "poll.votes.other": "{count} votos",
  "poll.tapToVote": "Toque em uma opção para votar",

  "rules.title": "Regras da comunidade",
  "rules.kind": "Seja gentil. Este é um espaço de encorajamento para todas.",
  "rules.medical": "Nada de conselhos médicos. Compartilhe experiências, não receitas.",
  "rules.hateful":
    "Nada de conteúdo de ódio, assédio ou conteúdo explícito. Esse conteúdo é removido e pode levar a banimento.",
  "rules.report":
    "Viu algo estranho? Denuncie ou bloqueie quem escreveu. Nós analisamos cada denúncia.",
  "rules.accept": "Concordo, quero participar",

  "notice.errorTitle": "Algo deu errado",
  "notice.rejectedTitle": "Vamos manter o carinho",
  "notice.errorBody":
    "Não conseguimos acessar a comunidade agora. Verifique sua conexão e tente de novo.",
  "notice.rejectedPostBody":
    "Sua publicação não pôde ser compartilhada porque vai contra as regras da nossa comunidade. Este é um espaço de bondade, encorajamento e graça. Agradecemos por ajudar a mantê-lo seguro para todas.",
  "notice.rejectedCommentBody":
    "Seu comentário não pôde ser compartilhado porque vai contra as regras da nossa comunidade. Este é um espaço de bondade, encorajamento e graça. Agradecemos por ajudar a mantê-lo seguro para todas.",
  "notice.gotIt": "Entendi",

  "menu.cancel": "Cancelar",
  "menu.delete": "Excluir",
  "menu.deletePostTitle": "Excluir esta publicação?",
  "menu.deletePostBody": "Ela vai desaparecer da comunidade.",
  "menu.deleteCommentTitle": "Excluir este comentário?",
  "menu.reportPost": "Denunciar publicação",
  "menu.reportComment": "Denunciar comentário",
  "menu.block": "Bloquear",
  "menu.blockUser": "Bloquear {name}",
  "menu.blockUserConfirmTitle": "Bloquear {name}?",
  "menu.blockUserConfirmBody":
    "Você nunca mais vai ver as publicações nem os comentários dessa pessoa.",

  "report.title": "Denunciar este conteúdo",
  "report.reasons.spam": "Spam",
  "report.reasons.harassment": "Assédio",
  "report.reasons.hate": "Conteúdo de ódio",
  "report.reasons.inappropriate": "Inapropriado",
  "report.reasons.other": "Outro motivo",
  "report.detailsPlaceholder": "Tem algo que a gente deva saber? (opcional)",
  "report.send": "Enviar denúncia",
  "report.sentTitle": "Agradecemos",
  "report.sentBody": "Sua denúncia foi enviada. Nossa equipe analisa cada denúncia.",
  "report.errorTitle": "Não deu para enviar a denúncia",
  "report.errorBody": "Verifique sua conexão e tente de novo.",

  "profile.postsSection": "publicações",
  "profile.editProfile": "Editar perfil",
  "profile.emptyOwn": "Você ainda não compartilhou nada.",
  "profile.emptyOther": "Ainda não tem publicações para mostrar.",
  "profile.changePhoto": "Trocar foto",
  "profile.bioLabel": "Bio",
  "profile.bioPlaceholder": "Conte um pouco de você para a comunidade",
  "profile.usernameLabel": "Nome de usuário",
  "profile.usernamePlaceholder": "seunome",
  "profile.usernameHelper": "De 3 a 20 caracteres, letras, números e hifens.",
  "profile.photoRejected": "Essa foto não foi aceita. Escolha outra, por favor.",
  "profile.bioRejected": "Esse texto não foi aceito pela moderação.",
  "profile.usernameRejected": "Esse nome de usuário não foi aceito pela moderação.",
  "profile.usernameTaken": "Esse nome de usuário já está em uso.",
  "profile.usernameInvalid": "Somente letras minúsculas, números e hifens, de 3 a 20 caracteres.",
  "profile.genericError": "Algo deu errado. Tente de novo, por favor.",
  "profile.save": "Salvar",

  "inbox.title": "Notificações",
  "inbox.empty":
    "Ainda não tem nada por aqui. Quando alguém reagir, curtir ou comentar suas publicações, vai aparecer aqui.",
  "inbox.someone": "Alguém",
  "inbox.liked": "{name} curtiu sua publicação",
  "inbox.commented": "{name} comentou na sua publicação",
  "inbox.reacted": "{name} reagiu à sua publicação",
  "inbox.news": "Novidades de {name}",
  "inbox.supportReply": "A equipe de suporte respondeu a você",
};
