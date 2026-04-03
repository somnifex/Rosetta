export default {
  title: "Búsqueda semántica",
  subtitle: "Busca en todos los documentos indexados",
  labels: {
    settings: "Configuración",
    combined_results: "Resultados combinados",
  },
  input: {
    placeholder: "Introduce tu consulta de búsqueda...",
  },
  btn: {
    search: "Buscar",
    searching: "Buscando...",
    go_to_settings: "Ir a Configuración",
  },
  options: {
    title: "Configuración de búsqueda combinada",
    include_documents: "Coincidencia global de documentos",
    include_settings: "Búsqueda en configuración",
    include_semantic: "Búsqueda semántica",
    priority: "Prioridad",
    global_first: "Global primero",
    semantic_first: "Semántico primero",
    max_global_results: "Límite de resultados globales",
    max_semantic_results: "Límite de resultados semánticos",
    min_semantic_score: "Umbral semántico (0-1)",
  },
  results: {
    count: "{{count}} resultados encontrados",
    view_document: "Ver documento",
    no_results: "No se encontraron resultados",
    type_global_document: "Global - Documento",
    type_global_setting: "Global - Configuración",
    type_semantic: "Semántico",
  },
  toast: {
    empty_query: {
      title: "Consulta vacía",
      description: "Introduce una consulta de búsqueda",
    },
    global_only: {
      title: "Búsqueda global completada",
      description: "La búsqueda semántica requiere un proveedor de embeddings activo",
    },
    search_error: {
      title: "La búsqueda falló",
    },
  },
}
