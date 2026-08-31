// Spanish (Spain) catalog for @rocapine/community-ui.
//
// Ported from Eve's Rhythm's i18n/es-ES/community.json (eden-s-rythm repo —
// comment only, no runtime dependency on that app), flattened to the same
// dot-key scheme as en.ts (see task-9-report.md for the key-rename table:
// prayedForYou.* -> reaction.*, aSister -> someone, _one/_other ->
// .one/.other). Degendered in-language ("hermana(s)" -> neutral phrasing)
// and de-branded ("Eve" / "Eve's Rhythm" removed) to match en.ts's neutral
// meaning. Keys en.ts added that Eve's JSON lacks (menu.cancel, menu.delete,
// profile.save) were translated fresh from the app-wide common.json values
// (Cancelar / Eliminar / Guardar) and reaction.* was translated fresh from
// the en value (Eve's JSON only has prayer-flavored copy there).
export const esES: Record<string, string> = {
  title: "Comunidad",

  "topics.news": "Noticias",
  "topics.general": "General",
  "topics.prayer": "Oración",
  "topics.prayerRequest": "Petición de oración",
  "topics.testimony": "Testimonio",
  "topics.question": "Pregunta",
  "topics.encouragement": "Ánimo",
  "topics.cycleBody": "Ciclo y cuerpo",
  "topics.fertility": "Fertilidad",
  "topics.faith": "Fe",
  "topics.relationships": "Relaciones",

  "feed.all": "Todas",
  "feed.searchPlaceholder": "Buscar publicaciones…",
  "feed.composePrompt": "Comparte con la comunidad…",
  "feed.unreachableRetry":
    "Ahora mismo no podemos conectar con la comunidad. Desliza para reintentar.",
  "feed.unreachable": "Ahora mismo no podemos conectar con la comunidad.",
  "feed.noSearchResults": "Ninguna publicación coincide con tu búsqueda.",
  "feed.newsEmpty": "Los anuncios del equipo aparecerán aquí.",
  "feed.empty": "Aún no hay publicaciones aquí. Comparte la primera.",
  "feed.loadMore": "Cargar más",
  "feed.newPosts.one": "{count} publicación nueva",
  "feed.newPosts.other": "{count} publicaciones nuevas",

  "post.pinned": "Fijado",
  "post.viewMore": "Ver más",
  "post.viewLess": "Ver menos",
  "post.reaction.received": "{name} ha reaccionado a tu publicación",
  "post.reaction.anonymous.one": "Alguien ha reaccionado a tu publicación",
  "post.reaction.anonymous.other": "{count} personas han reaccionado a tu publicación",
  "post.reaction.withOthers.one": "{name} y {count} persona más han reaccionado a tu publicación",
  "post.reaction.withOthers.other":
    "{name} y {count} personas más han reaccionado a tu publicación",

  "thread.comments.one": "{count} comentario",
  "thread.comments.other": "{count} comentarios",
  "thread.loadingComments": "Cargando comentarios…",
  "thread.emptyComments": "Deja las primeras palabras bonitas.",
  "thread.commentPlaceholder": "Deja unas palabras bonitas…",

  "composer.placeholder": "Comparte un pensamiento, una historia, un ánimo…",
  "composer.pollPlaceholder": "Escribe tu pregunta…",
  "composer.option": "Opción {number}",
  "composer.addOption": "Añadir opción",
  "composer.poll": "Encuesta",
  "composer.removePoll": "Quitar encuesta",
  "composer.post": "PUBLICAR",

  "poll.votes.one": "{count} voto",
  "poll.votes.other": "{count} votos",
  "poll.tapToVote": "Toca una opción para votar",

  "rules.title": "Normas de la comunidad",
  "rules.kind": "Sé amable. Este es un espacio de ánimo para todas.",
  "rules.medical": "Nada de consejos médicos. Comparte experiencias, no recetas.",
  "rules.hateful":
    "Nada de contenido de odio, acoso o contenido explícito. Se retira y puede suponer una expulsión.",
  "rules.report":
    "¿Ves algo raro? Denúncialo o bloquea a quien lo escribió. Revisamos todas las denuncias.",
  "rules.accept": "Estoy de acuerdo, quiero entrar",

  "notice.errorTitle": "Algo ha salido mal",
  "notice.rejectedTitle": "Mantengamos la dulzura",
  "notice.errorBody":
    "No hemos podido conectar con la comunidad. Comprueba tu conexión y vuelve a intentarlo.",
  "notice.rejectedPostBody":
    "Tu publicación no se ha podido compartir porque va en contra de las normas de nuestra comunidad. Este es un espacio de bondad, ánimo y gracia. Gracias por ayudar a que sea seguro para todas.",
  "notice.rejectedCommentBody":
    "Tu comentario no se ha podido compartir porque va en contra de las normas de nuestra comunidad. Este es un espacio de bondad, ánimo y gracia. Gracias por ayudar a que sea seguro para todas.",
  "notice.gotIt": "Entendido",

  "menu.cancel": "Cancelar",
  "menu.delete": "Eliminar",
  "menu.deletePostTitle": "¿Borrar esta publicación?",
  "menu.deletePostBody": "Desaparecerá de la comunidad.",
  "menu.deleteCommentTitle": "¿Borrar este comentario?",
  "menu.reportPost": "Denunciar publicación",
  "menu.reportComment": "Denunciar comentario",
  "menu.block": "Bloquear",
  "menu.blockUser": "Bloquear a {name}",
  "menu.blockUserConfirmTitle": "¿Bloquear a {name}?",
  "menu.blockUserConfirmBody": "No volverás a ver sus publicaciones ni sus comentarios.",

  "report.title": "Denunciar este contenido",
  "report.reasons.spam": "Spam",
  "report.reasons.harassment": "Acoso",
  "report.reasons.hate": "Contenido de odio",
  "report.reasons.inappropriate": "Inapropiado",
  "report.reasons.other": "Otra cosa",
  "report.detailsPlaceholder": "¿Algo que debamos saber? (opcional)",
  "report.send": "Enviar denuncia",
  "report.sentTitle": "Gracias",
  "report.sentBody": "Tu denuncia se ha enviado. Nuestro equipo revisa todas las denuncias.",
  "report.errorTitle": "No se ha podido enviar la denuncia",
  "report.errorBody": "Comprueba tu conexión y vuelve a intentarlo.",

  "profile.postsSection": "publicaciones",
  "profile.editProfile": "Editar perfil",
  "profile.emptyOwn": "Todavía no has compartido nada.",
  "profile.emptyOther": "Aún no hay publicaciones que mostrar.",
  "profile.changePhoto": "Cambiar foto",
  "profile.bioLabel": "Bio",
  "profile.bioPlaceholder": "Cuéntale a la comunidad un poco sobre ti",
  "profile.usernameLabel": "Nombre de usuario",
  "profile.usernamePlaceholder": "tunombre",
  "profile.usernameHelper": "De 3 a 20 caracteres: letras, números y guiones.",
  "profile.photoRejected": "Esta foto no se ha aceptado. Elige otra, por favor.",
  "profile.bioRejected": "La moderación no ha aceptado este texto.",
  "profile.usernameRejected": "La moderación no ha aceptado este nombre de usuario.",
  "profile.usernameTaken": "Este nombre de usuario ya está en uso.",
  "profile.usernameInvalid": "Solo minúsculas, números y guiones, de 3 a 20 caracteres.",
  "profile.genericError": "Algo ha salido mal. Vuelve a intentarlo, por favor.",
  "profile.save": "Guardar",

  "inbox.title": "Notificaciones",
  "inbox.empty":
    "Aún no hay nada por aquí. Cuando alguien reaccione, le dé me gusta o comente tus publicaciones, aparecerá aquí.",
  "inbox.someone": "Alguien",
  "inbox.liked": "A {name} le ha gustado tu publicación",
  "inbox.commented": "{name} ha comentado tu publicación",
  "inbox.reacted": "{name} ha reaccionado a tu publicación",
  "inbox.news": "Noticias de {name}",
  "inbox.supportReply": "El equipo de soporte te ha respondido",
};
