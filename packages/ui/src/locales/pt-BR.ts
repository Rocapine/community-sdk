// Portuguese (Brazil) catalog for @rocapine/community-ui.
//
// Ported from Eve's Rhythm's i18n/pt-BR/community.json (source app's repo —
// comment only, no runtime dependency on that app), flattened to the same
// dot-key scheme as en.ts (see the internal port notes for the key-rename table:
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
  "time.seconds": "{count} s",
  "time.months.one": "{count} mês",
  "time.months.other": "{count} meses",
  "time.years.one": "{count} ano",
  "time.years.other": "{count} anos",

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
  "composer.removeOption": "Remover opção",
  "composer.poll": "Enquete",
  "composer.removePoll": "Remover enquete",
  "composer.post": "PUBLICAR",
  "composer.chooseTopic": "Publicar em",

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
  "profile.usernameLabel": "Identificador",
  "profile.usernamePlaceholder": "seunome",
  "profile.usernameHelper": "De 3 a 20 caracteres, letras, números e hifens.",
  "profile.photoRejected": "Essa foto não foi aceita. Escolha outra, por favor.",
  "profile.bioRejected": "Esse texto não foi aceito pela moderação.",
  "profile.usernameRejected": "Esse identificador não foi aceito pela moderação.",
  "profile.usernameTaken": "Esse identificador já está em uso.",
  "profile.usernameInvalid": "Somente letras minúsculas, números e hifens, de 3 a 20 caracteres.",
  "profile.usernameSuggestion": "@{handle} já está em uso. Use @{suggestion} ou escolha outro.",
  "profile.useSuggestion": "Usar @{suggestion}",
  "profile.displayNameLabel": "Nome de exibição",
  "profile.displayNameHelper": "De 2 a 24 caracteres, aparece nas suas publicações e comentários.",
  "profile.displayNameRejected": "Esse nome não foi aceito pela moderação.",
  "profile.displayNameInvalid": "Entre 2 e 24 caracteres.",
  "profile.nameReserved": "Esse nome é reservado. Escolha outro, por favor.",
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
  "inbox.newsFromTeam": "Novidades da equipe",
  "inbox.supportReply": "A equipe de suporte respondeu a você",

  "translation.translatedFrom": "Traduzido do {language}",
  "translation.original": "Original",
  "translation.showOriginal": "Ver original",
  "translation.showTranslation": "Ver tradução",
  "language.en": "inglês",
  "language.es": "espanhol",
  "language.pt": "português",
  "language.it": "italiano",
  "language.pl": "polonês",
  "language.fr": "francês",
  "language.de": "alemão",
  "language.ko": "coreano",
  "language.ro": "romeno",
  "language.uk": "ucraniano",
  // Accessibility labels of icon-only buttons (screen readers).
  "a11y.back": "Voltar",
  "a11y.more": "Mais opções",
  "a11y.send": "Enviar",
  "a11y.search": "Pesquisar",
  "a11y.closeSearch": "Fechar pesquisa",
  "a11y.clearSearch": "Limpar pesquisa",
  "a11y.myProfile": "Meu perfil",
  "composer.addImage": "Adicionar uma imagem",
  "composer.removeImage": "Remover imagem",
  "image.photo": "📷 Foto",
  "a11y.openImage": "Abrir imagem",
  "a11y.closeImage": "Fechar",
};
