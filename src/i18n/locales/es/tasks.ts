export default {
  title: "Centro de tareas",
  subtitle: "Monitorear trabajos de análisis y traducción",
  tabs: {
    all: "Todas las tareas",
    parsing: "Análisis",
    translation: "Traducción",
    indexing: "Indexación",
  },
  columns: {
    document: "Documento",
    type: "Tipo",
    status: "Estado",
    progress: "Progreso",
    created: "Creado",
    duration: "Duración",
    error: "Error",
  },
  status: {
    pending: "Pendiente",
    parsing: "Analizando",
    translating: "Traduciendo",
    indexing: "Indexando",
    completed: "Completado",
    failed: "Fallido",
    partial: "Parcial",
  },
  type: {
    parse: "Análisis",
    translation: "Traducción",
    index: "Indexación",
  },
  actions: {
    viewDocument: "Ver documento",
    retry: "Reintentar",
    cancelTask: "Detener tarea",
    deleteTask: "Eliminar tarea",
  },
  empty: {
    all: {
      title: "Sin tareas activas",
      description: "Las tareas aparecerán aquí cuando comience a procesar documentos",
    },
    parsing: {
      title: "Sin tareas de análisis",
      description: "Importe un PDF para comenzar el análisis",
    },
    translation: {
      title: "Sin tareas de traducción",
      description: "Inicie un trabajo de traducción para ver tareas aquí",
    },
    indexing: {
      title: "Sin tareas de indexación",
      description: "Active la indexación para ver tareas aquí",
    },
  },
}
