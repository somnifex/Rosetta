export default {
  loading: "Загрузка документа...",
  not_found: "Документ не найден",
  btn: {
    index: "Индексировать документ",
    indexing: "Индексация...",
    export: "Экспорт",
    exporting: "Экспорт...",
    delete: "Удалить",
    start_parsing: "Начать анализ",
    start_translation: "Начать перевод",
    starting: "Запуск...",
  },
  overview: {
    title: "Обзор",
    file_size: "Размер файла",
    pages: "Страницы",
    parse_status: "Статус анализа",
    translation_status: "Статус перевода",
    index_status: "Статус индексации",
    languages: "Языки",
    auto: "Авто",
    not_set: "Не задано",
  },
  tabs: {
    preview: "Предпросмотр PDF",
    parsed: "Проанализированное содержимое",
    translated: "Перевод",
    comparison: "Сравнение",
    structure: "Структура",
    chunks: "Фрагменты",
  },
  parsed: {
    in_progress: "Анализ выполняется...",
    not_started: "Документ ещё не проанализирован",
  },
  translated: {
    in_progress: "Перевод выполняется...",
    needs_parsing: "Документ должен быть проанализирован перед переводом",
    not_started: "Документ ещё не переведён",
  },
  comparison: {
    original: "Оригинал",
    translation: "Перевод",
    unavailable: "Для просмотра сравнения необходимо завершить анализ и перевод",
  },
  placeholder: {
    preview: "Предпросмотр недоступен. Сначала проанализируйте документ.",
    structure: "Здесь будет отображено дерево структуры документа",
    chunks: "Фрагменты не найдены. Сначала индексируйте документ.",
  },
  category: {
    select: "Выбрать категорию",
    none: "Без категории",
  },
  tags: {
    add: "Добавить метку",
    search: "Поиск меток...",
    no_available: "Нет доступных меток",
  },
  chunks: {
    page: "Страница",
  },
  chat: {
    title: "Чат с документом",
    clear: "Очистить",
    empty: "Задавайте вопросы по этому документу",
    input_placeholder: "Спросите о документе...",
    no_provider: "Активный провайдер чата не настроен",
    error: "Ошибка чата",
  },
  selection: {
    ask_ai: "Спросить ИИ",
    translate: "Перевести",
    ask_about: "Объяснить этот текст",
    translate_text: "Перевести этот текст",
  },
  delete_confirm: {
    title: "Удалить документ",
    description: "Вы уверены, что хотите удалить этот документ? Это действие нельзя отменить.",
  },
  info_dialog: {
    author_empty: "Автор не указан",
    pages_uploaded: "{{pages}} стр. · Загружено {{date}}",
    translation_complete: "Перевод завершён",
    translation_incomplete: "Не переведено",
    btn: {
      continue_view: "Продолжить просмотр",
      view_original: "Смотреть оригинал",
      retranslate: "Перевести заново",
    },
    outputs: {
      title: "Результаты",
      subtitle: "Автоматически создано из оригинального PDF",
      translated_pdf: "Переведённый PDF",
      markdown: "Markdown",
      generated: "Создано",
      extracted: "Извлечено",
      not_generated: "Не создано",
      btn_view: "Просмотр",
      btn_export: "Экспорт",
    },
    more: {
      title: "Дополнительные операции",
      replace_original: "Заменить оригинальный PDF",
      replace_translated: "Заменить переведённый PDF",
      replace_markdown: "Заменить Markdown",
    },
    menu: {
      delete: "Удалить документ",
    },
  },
  toast: {
    parse_started: {
      title: "Анализ начат",
      description: "Анализ документа инициирован",
    },
    parse_error: {
      title: "Не удалось начать анализ",
    },
    translation_started: {
      title: "Перевод начат",
      description: "Перевод документа инициирован",
    },
    translation_error: {
      title: "Не удалось начать перевод",
    },
    index_started: {
      title: "Индексация начата",
      description: "Индексация документа инициирована",
    },
    index_error: {
      title: "Не удалось начать индексацию",
    },
    export_success: {
      title: "Экспорт успешен",
      description: "Документ экспортирован в {{path}}",
    },
    export_error: {
      title: "Ошибка экспорта",
    },
    delete_success: {
      title: "Документ удалён",
    },
    delete_error: {
      title: "Не удалось удалить документ",
    },
  },
}
