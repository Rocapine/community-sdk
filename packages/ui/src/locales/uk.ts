// Ukrainian catalog for @rocapine/community-ui.
//
// Written from en.ts (no source app). Register: "ти", the register the
// Rocapine apps use app-wide. Degendered like pl.ts: Ukrainian past-tense
// verbs agree with the subject's gender, so a named subject uses the
// "-в(ла)" dual suffix ("вподобав(ла)"), and 2nd-person past tense is
// avoided in favour of imperatives or present tense ("Почни з себе.",
// "У тебе тут ще немає дописів.").
//
// Ukrainian plurals: the runtime picks the CLDR category (`pluralCategory`
// in i18n.ts) — `.one` (1, 21, 31…), `.few` (2–4, 22–24…) and `.other`
// (0, 5–20, 25–30…). `post.reaction.anonymous.one` therefore also serves
// 21/31 reactions, where "Хтось" reads oddly; same trade-off as en.ts's
// "Someone", accepted for a count that rarely lands.
export const uk: Record<string, string> = {
  title: "Спільнота",

  "topics.news": "Новини",
  "topics.general": "Загальне",
  "topics.prayer": "Молитва",
  "topics.prayerRequest": "Прохання про молитву",
  "topics.testimony": "Свідчення",
  "topics.question": "Запитання",
  "topics.encouragement": "Підбадьорення",
  "topics.cycleBody": "Цикл і тіло",
  "topics.fertility": "Фертильність",
  "topics.faith": "Віра",
  "topics.relationships": "Стосунки",

  "feed.all": "Усе",
  "feed.searchPlaceholder": "Пошук дописів…",
  "feed.composePrompt": "Поділися зі спільнотою…",
  "feed.unreachableRetry": "Спільнота зараз недоступна. Потягни, щоб спробувати ще раз.",
  "feed.unreachable": "Спільнота зараз недоступна.",
  "feed.noSearchResults": "Жоден допис не відповідає твоєму запиту.",
  "feed.newsEmpty": "Оголошення від команди з'являтимуться тут.",
  "feed.empty": "Тут ще немає дописів. Почни з себе.",
  "feed.loadMore": "Завантажити більше",
  "feed.newPosts.one": "{count} новий допис",
  "feed.newPosts.few": "{count} нові дописи",
  "feed.newPosts.other": "{count} нових дописів",

  // Compact relative-time labels (see en.ts); "хв"/"год"/"дн" are the
  // conventional short forms and read the same at any count.
  "time.now": "щойно",
  "time.minutes": "{count} хв",
  "time.hours": "{count} год",
  "time.days": "{count} дн",

  "post.pinned": "Закріплено",
  "post.viewMore": "Показати більше",
  "post.viewLess": "Згорнути",
  "post.reaction.received": "{name} відреагував(ла) на твій допис",
  "post.reaction.anonymous.one": "Хтось відреагував на твій допис",
  "post.reaction.anonymous.few": "{count} людини відреагували на твій допис",
  "post.reaction.anonymous.other": "{count} людей відреагували на твій допис",
  "post.reaction.withOthers.one": "{name} і ще {count} людина відреагували на твій допис",
  "post.reaction.withOthers.few": "{name} і ще {count} людини відреагували на твій допис",
  "post.reaction.withOthers.other": "{name} і ще {count} людей відреагували на твій допис",

  "thread.comments.one": "{count} коментар",
  "thread.comments.few": "{count} коментарі",
  "thread.comments.other": "{count} коментарів",
  "thread.loadingComments": "Завантажуємо коментарі…",
  "thread.emptyComments": "Залиш перше добре слово.",
  "thread.commentPlaceholder": "Додай добре слово…",

  "composer.placeholder": "Поділися думкою, історією, словом підтримки…",
  "composer.pollPlaceholder": "Постав своє запитання…",
  "composer.option": "Варіант {number}",
  "composer.addOption": "Додати варіант",
  "composer.removeOption": "Видалити варіант",
  "composer.poll": "Опитування",
  "composer.removePoll": "Прибрати опитування",
  "composer.post": "ОПУБЛІКУВАТИ",
  "composer.chooseTopic": "Опублікувати в",

  "poll.votes.one": "{count} голос",
  "poll.votes.few": "{count} голоси",
  "poll.votes.other": "{count} голосів",
  "poll.tapToVote": "Торкнись варіанта, щоб проголосувати",

  "rules.title": "Правила спільноти",
  "rules.kind": "Стався з добротою. Це простір підтримки для всіх.",
  "rules.medical": "Без медичних порад. Ділися досвідом, а не рецептами.",
  "rules.hateful":
    "Без образливого, цькувального чи відвертого контенту. Його видаляють, і це може призвести до блокування.",
  "rules.report":
    "Бачиш щось недоречне? Поскаржся або заблокуй автора. Ми розглядаємо кожну скаргу.",
  "rules.accept": "Погоджуюся, впусти мене",

  "notice.errorTitle": "Щось пішло не так",
  "notice.rejectedTitle": "Залишаймося лагідними",
  "notice.errorBody": "Не вдалося зв'язатися зі спільнотою. Перевір з'єднання та спробуй ще раз.",
  "notice.rejectedPostBody":
    "Твій допис не вдалося опублікувати, бо він суперечить правилам спільноти. Це простір доброти, підтримки й благодаті. Дякуємо, що допомагаєш зберігати його безпечним для всіх.",
  "notice.rejectedCommentBody":
    "Твій коментар не вдалося опублікувати, бо він суперечить правилам спільноти. Це простір доброти, підтримки й благодаті. Дякуємо, що допомагаєш зберігати його безпечним для всіх.",
  "notice.gotIt": "Зрозуміло",

  "menu.cancel": "Скасувати",
  "menu.delete": "Видалити",
  "menu.deletePostTitle": "Видалити цей допис?",
  "menu.deletePostBody": "Він зникне зі спільноти.",
  "menu.deleteCommentTitle": "Видалити цей коментар?",
  "menu.reportPost": "Поскаржитися на допис",
  "menu.reportComment": "Поскаржитися на коментар",
  "menu.block": "Заблокувати",
  "menu.blockUser": "Заблокувати {name}",
  "menu.blockUserConfirmTitle": "Заблокувати {name}?",
  "menu.blockUserConfirmBody": "Ти більше ніколи не побачиш дописів чи коментарів цієї людини.",

  "report.title": "Поскаржитися на цей контент",
  "report.reasons.spam": "Спам",
  "report.reasons.harassment": "Цькування",
  "report.reasons.hate": "Образливий контент",
  "report.reasons.inappropriate": "Недоречний контент",
  "report.reasons.other": "Інше",
  "report.detailsPlaceholder": "Є щось, що нам варто знати? (необов'язково)",
  "report.send": "Надіслати скаргу",
  "report.sentTitle": "Дякуємо",
  "report.sentBody": "Твою скаргу надіслано. Наша команда розглядає кожну скаргу.",
  "report.errorTitle": "Не вдалося надіслати скаргу",
  "report.errorBody": "Перевір з'єднання та спробуй ще раз.",

  "profile.postsSection": "дописи",
  "profile.editProfile": "Редагувати профіль",
  "profile.emptyOwn": "У тебе тут ще немає дописів.",
  "profile.emptyOther": "Поки що немає дописів.",
  "profile.changePhoto": "Змінити фото",
  "profile.bioLabel": "Про мене",
  "profile.bioPlaceholder": "Розкажи спільноті трохи про себе",
  "profile.usernameLabel": "Ідентифікатор",
  // Usernames are ASCII-only (profile.usernameInvalid), so the example stays Latin.
  "profile.usernamePlaceholder": "yourname",
  "profile.usernameHelper": "Від 3 до 20 символів: латинські літери, цифри та дефіси.",
  "profile.photoRejected": "Це фото не прийнято. Обери інше.",
  "profile.bioRejected": "Цей текст не пройшов модерацію.",
  "profile.usernameRejected": "Цей ідентифікатор не пройшов модерацію.",
  "profile.usernameTaken": "Цей ідентифікатор уже зайнятий.",
  "profile.usernameInvalid": "Лише малі латинські літери, цифри та дефіси, від 3 до 20 символів.",
  "profile.usernameSuggestion": "@{handle} уже зайнятий. Візьми @{suggestion} або вибери інший.",
  "profile.useSuggestion": "Використати @{suggestion}",
  "profile.displayNameLabel": "Відображуване ім'я",
  "profile.displayNameHelper": "Від 2 до 24 символів, видно біля твоїх дописів і коментарів.",
  "profile.displayNameRejected": "Це ім'я не пройшло модерацію.",
  "profile.displayNameInvalid": "Від 2 до 24 символів.",
  "profile.nameReserved": "Це ім'я зарезервоване. Вибери інше, будь ласка.",
  "profile.genericError": "Щось пішло не так. Спробуй ще раз.",
  "profile.save": "Зберегти",

  "inbox.title": "Сповіщення",
  "inbox.empty":
    "Тут поки що порожньо. Коли хтось відреагує, вподобає або прокоментує твої дописи, ти побачиш це тут.",
  "inbox.someone": "Хтось",
  "inbox.liked": "{name} вподобав(ла) твій допис",
  "inbox.commented": "{name} прокоментував(ла) твій допис",
  "inbox.reacted": "{name} відреагував(ла) на твій допис",
  "inbox.news": "Новини від {name}",
  "inbox.newsFromTeam": "Новини від команди",
  "inbox.supportReply": "Команда підтримки відповіла тобі",

  "translation.translatedFrom": "Перекладено з {language}",
  "translation.original": "Оригінал",
  "translation.showOriginal": "Показати оригінал",
  "translation.showTranslation": "Показати переклад",
  "language.en": "англійської",
  "language.es": "іспанської",
  "language.pt": "португальської",
  "language.it": "італійської",
  "language.pl": "польської",
  "language.fr": "французької",
  "language.de": "німецької",
  "language.ko": "корейської",
  "language.ro": "румунської",
  "language.uk": "української",
  // Accessibility labels of icon-only buttons (screen readers).
  "a11y.back": "Назад",
  "a11y.more": "Більше опцій",
  "a11y.send": "Надіслати",
  "a11y.search": "Пошук",
  "a11y.closeSearch": "Закрити пошук",
  "a11y.clearSearch": "Очистити пошук",
  "a11y.myProfile": "Мій профіль",
  "composer.addImage": "Додати зображення",
  "composer.removeImage": "Видалити зображення",
  "image.photo": "📷 Фото",
  "a11y.openImage": "Відкрити зображення",
  "a11y.closeImage": "Закрити",
};
