export default {
  title: "Центр задач",
  subtitle: "Мониторинг задач анализа и перевода",
  tabs: {
    all: "Все задачи",
    parsing: "Анализ",
    translation: "Перевод",
    indexing: "Индексация",
  },
  columns: {
    document: "Документ",
    type: "Тип",
    status: "Статус",
    progress: "Прогресс",
    created: "Создано",
    duration: "Длительность",
    error: "Ошибка",
  },
  status: {
    pending: "Ожидание",
    parsing: "Анализ",
    translating: "Перевод",
    indexing: "Индексация",
    completed: "Завершено",
    failed: "Ошибка",
    partial: "Частично",
  },
  type: {
    parse: "Анализ",
    translation: "Перевод",
    index: "Индексация",
  },
  actions: {
    viewDocument: "Просмотр документа",
    retry: "Повторить",
    cancelTask: "Остановить задачу",
    deleteTask: "Удалить задачу",
  },
  empty: {
    all: {
      title: "Нет активных задач",
      description: "Задачи появятся здесь при начале обработки документов",
    },
    parsing: {
      title: "Нет задач анализа",
      description: "Импортируйте PDF для начала анализа",
    },
    translation: {
      title: "Нет задач перевода",
      description: "Начните задачу перевода, чтобы увидеть задачи здесь",
    },
    indexing: {
      title: "Нет задач индексации",
      description: "Включите индексацию, чтобы увидеть задачи здесь",
    },
  },
}
