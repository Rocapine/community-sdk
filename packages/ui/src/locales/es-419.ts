// Spanish (Latin America) catalog for @rocapine/community-ui.
//
// Ported from Eve's Rhythm's i18n/es-419/community.json (source app's repo —
// comment only, no runtime dependency on that app), flattened to the same
// dot-key scheme as en.ts (see the internal port notes for the key-rename table:
// prayedForYou.* -> reaction.*, aSister -> someone, _one/_other ->
// .one/.other). Degendered in-language ("hermana(s)" -> neutral phrasing)
// and de-branded ("Eve" / "Eve's Rhythm" removed) to match en.ts's neutral
// meaning. Keys en.ts added that Eve's JSON lacks (menu.cancel, menu.delete,
// profile.save) were translated fresh from the app-wide common.json values
// (Cancelar / Eliminar / Guardar) and reaction.* was translated fresh from
// the en value (Eve's JSON only has prayer-flavored copy there).
export const es419: Record<string, string> = {
  title: "Comunidad",

  "topics.news": "Novedades",
  "topics.general": "General",
  "topics.prayer": "Oración",
  "topics.prayerRequest": "Pedido de oración",
  "topics.testimony": "Testimonio",
  "topics.question": "Pregunta",
  "topics.encouragement": "Aliento",
  "topics.cycleBody": "Ciclo y cuerpo",
  "topics.fertility": "Fertilidad",
  "topics.faith": "Fe",
  "topics.relationships": "Relaciones",

  "feed.all": "Todas",
  "feed.searchPlaceholder": "Buscar publicaciones…",
  "feed.composePrompt": "Comparte con la comunidad…",
  "feed.unreachableRetry":
    "No pudimos conectar con la comunidad. Desliza hacia abajo para reintentar.",
  "feed.unreachable": "No pudimos conectar con la comunidad en este momento.",
  "feed.noSearchResults": "No hay publicaciones que coincidan con tu búsqueda.",
  "feed.newsEmpty": "Acá van a aparecer los anuncios del equipo.",
  "feed.empty": "Todavía no hay publicaciones acá. Comparte la primera.",
  "feed.loadMore": "Cargar más",
  "feed.newPosts.one": "{count} publicación nueva",
  "feed.newPosts.other": "{count} publicaciones nuevas",

  // Compact relative-time labels (see en.ts's comment on this section for
  // why these aren't `.one`/`.other` pluralized). "min"/"h"/"d" over a bare
  // "m" for minutes: an unspaced "m" reads as "meters" in Spanish.
  "time.now": "ahora",
  "time.minutes": "{count} min",
  "time.hours": "{count} h",
  "time.days": "{count} d",

  "post.pinned": "Fijado",
  "post.viewMore": "Ver más",
  "post.viewLess": "Ver menos",
  "post.reaction.received": "{name} reaccionó a tu publicación",
  "post.reaction.anonymous.one": "Alguien reaccionó a tu publicación",
  "post.reaction.anonymous.other": "{count} personas reaccionaron a tu publicación",
  "post.reaction.withOthers.one": "{name} y {count} persona más reaccionaron a tu publicación",
  "post.reaction.withOthers.other": "{name} y {count} personas más reaccionaron a tu publicación",

  "thread.comments.one": "{count} comentario",
  "thread.comments.other": "{count} comentarios",
  "thread.loadingComments": "Cargando comentarios…",
  "thread.emptyComments": "Deja las primeras palabras lindas.",
  "thread.commentPlaceholder": "Deja unas palabras lindas…",

  "composer.placeholder": "Comparte un pensamiento, una historia, un aliento…",
  "composer.pollPlaceholder": "Haz tu pregunta…",
  "composer.option": "Opción {number}",
  "composer.addOption": "Agregar opción",
  "composer.poll": "Encuesta",
  "composer.removePoll": "Eliminar encuesta",
  "composer.post": "PUBLICAR",

  "poll.votes.one": "{count} voto",
  "poll.votes.other": "{count} votos",
  "poll.tapToVote": "Toca una opción para votar",

  "rules.title": "Reglas de la comunidad",
  "rules.kind": "Sé amable. Este es un espacio de aliento para todas.",
  "rules.medical": "Sin consejos médicos. Comparte experiencias, no recetas.",
  "rules.hateful":
    "Nada de contenido de odio, acoso o contenido explícito. Se elimina y puede llevar a una suspensión.",
  "rules.report":
    "¿Ves algo raro? Repórtalo o bloquea a quien lo escribió. Revisamos cada reporte.",
  "rules.accept": "Acepto, quiero entrar",

  "notice.errorTitle": "Algo salió mal",
  "notice.rejectedTitle": "Cuidemos la ternura",
  "notice.errorBody":
    "No pudimos conectar con la comunidad. Revisa tu conexión y vuelve a intentar.",
  "notice.rejectedPostBody":
    "Tu publicación no se pudo compartir porque va en contra de las reglas de nuestra comunidad. Este es un espacio de bondad, aliento y gracia. Gracias por ayudar a que sea seguro para todas.",
  "notice.rejectedCommentBody":
    "Tu comentario no se pudo compartir porque va en contra de las reglas de nuestra comunidad. Este es un espacio de bondad, aliento y gracia. Gracias por ayudar a que sea seguro para todas.",
  "notice.gotIt": "Entendido",

  "menu.cancel": "Cancelar",
  "menu.delete": "Eliminar",
  "menu.deletePostTitle": "¿Eliminar esta publicación?",
  "menu.deletePostBody": "Va a desaparecer de la comunidad.",
  "menu.deleteCommentTitle": "¿Eliminar este comentario?",
  "menu.reportPost": "Reportar publicación",
  "menu.reportComment": "Reportar comentario",
  "menu.block": "Bloquear",
  "menu.blockUser": "Bloquear a {name}",
  "menu.blockUserConfirmTitle": "¿Bloquear a {name}?",
  "menu.blockUserConfirmBody": "No vas a volver a ver sus publicaciones ni sus comentarios.",

  "report.title": "Reportar este contenido",
  "report.reasons.spam": "Spam",
  "report.reasons.harassment": "Acoso",
  "report.reasons.hate": "Contenido de odio",
  "report.reasons.inappropriate": "Inapropiado",
  "report.reasons.other": "Otro motivo",
  "report.detailsPlaceholder": "¿Hay algo que debamos saber? (opcional)",
  "report.send": "Enviar reporte",
  "report.sentTitle": "Gracias",
  "report.sentBody": "Tu reporte fue enviado. Nuestro equipo revisa cada reporte.",
  "report.errorTitle": "No se pudo enviar el reporte",
  "report.errorBody": "Revisa tu conexión y vuelve a intentar.",

  "profile.postsSection": "publicaciones",
  "profile.editProfile": "Editar perfil",
  "profile.emptyOwn": "Todavía no compartiste nada.",
  "profile.emptyOther": "Todavía no hay publicaciones para mostrar.",
  "profile.changePhoto": "Cambiar foto",
  "profile.bioLabel": "Bio",
  "profile.bioPlaceholder": "Cuéntale a la comunidad un poquito de ti",
  "profile.usernameLabel": "Nombre de usuario",
  "profile.usernamePlaceholder": "tunombre",
  "profile.usernameHelper": "Entre 3 y 20 caracteres: letras, números y guiones.",
  "profile.photoRejected": "Esta foto no fue aceptada. Elige otra, por favor.",
  "profile.bioRejected": "La moderación no aceptó este texto.",
  "profile.usernameRejected": "La moderación no aceptó este nombre de usuario.",
  "profile.usernameTaken": "Ese nombre de usuario ya está en uso.",
  "profile.usernameInvalid": "Solo letras minúsculas, números y guiones, entre 3 y 20 caracteres.",
  "profile.genericError": "Algo salió mal. Intenta de nuevo, por favor.",
  "profile.save": "Guardar",

  "inbox.title": "Notificaciones",
  "inbox.empty":
    "Todavía no hay nada por acá. Cuando alguien reaccione, le dé me gusta o comente tus publicaciones, va a aparecer acá.",
  "inbox.someone": "Alguien",
  "inbox.liked": "A {name} le gustó tu publicación",
  "inbox.commented": "{name} comentó tu publicación",
  "inbox.reacted": "{name} reaccionó a tu publicación",
  "inbox.news": "Novedades de {name}",
  "inbox.supportReply": "El equipo de soporte te respondió",
};
