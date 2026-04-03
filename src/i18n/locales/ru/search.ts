export default {
  title: "Семантический поиск",
  subtitle: "Ищите по всем проиндексированным документам",
  labels: {
    settings: "Настройки",
    combined_results: "Объединённые результаты",
  },
  input: {
    placeholder: "Введите поисковый запрос...",
  },
  btn: {
    search: "Искать",
    searching: "Поиск...",
    go_to_settings: "Перейти к настройкам",
  },
  options: {
    title: "Настройки объединённого поиска",
    include_documents: "Глобальное совпадение по документам",
    include_settings: "Поиск по настройкам",
    include_semantic: "Семантический поиск",
    priority: "Приоритет",
    global_first: "Сначала глобальный",
    semantic_first: "Сначала семантический",
    max_global_results: "Лимит глобальных результатов",
    max_semantic_results: "Лимит семантических результатов",
    min_semantic_score: "Семантический порог (0-1)",
  },
  results: {
    count: "Найдено результатов: {{count}}",
    view_document: "Открыть документ",
    no_results: "Ничего не найдено",
    type_global_document: "Глобальный - Документ",
    type_global_setting: "Глобальный - Настройка",
    type_semantic: "Семантический",
  },
  toast: {
    empty_query: {
      title: "Пустой запрос",
      description: "Введите поисковый запрос",
    },
    global_only: {
      title: "Глобальный поиск завершён",
      description: "Для семантического поиска требуется активный провайдер эмбеддингов",
    },
    search_error: {
      title: "Ошибка поиска",
    },
  },
}
