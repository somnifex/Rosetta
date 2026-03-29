export default {
  loading: "Cargando documento...",
  not_found: "Documento no encontrado",
  btn: {
    index: "Indexar documento",
    indexing: "Indexando...",
    export: "Exportar",
    exporting: "Exportando...",
    delete: "Eliminar",
    start_parsing: "Iniciar análisis",
    start_translation: "Iniciar traducción",
    starting: "Iniciando...",
  },
  overview: {
    title: "Resumen",
    file_size: "Tamaño del archivo",
    pages: "Páginas",
    parse_status: "Estado de análisis",
    translation_status: "Estado de traducción",
    index_status: "Estado de indexación",
    languages: "Idiomas",
    auto: "Auto",
    not_set: "No configurado",
  },
  tabs: {
    preview: "Vista previa PDF",
    parsed: "Contenido analizado",
    translated: "Traducción",
    comparison: "Lado a lado",
    structure: "Estructura",
    chunks: "Fragmentos",
  },
  parsed: {
    in_progress: "Análisis en progreso...",
    not_started: "El documento aún no ha sido analizado",
  },
  translated: {
    in_progress: "Traducción en progreso...",
    needs_parsing: "El documento debe ser analizado antes de traducir",
    not_started: "El documento aún no ha sido traducido",
  },
  comparison: {
    original: "Original",
    translation: "Traducción",
    unavailable: "El análisis y la traducción deben completarse para ver la comparación",
  },
  placeholder: {
    preview: "Vista previa no disponible. Analice el documento primero.",
    structure: "El árbol de estructura del documento se mostrará aquí",
    chunks: "No se encontraron fragmentos. Indexe el documento primero.",
  },
  category: {
    select: "Seleccionar categoría",
    none: "Sin categoría",
  },
  tags: {
    add: "Agregar etiqueta",
    search: "Buscar etiquetas...",
    no_available: "No hay etiquetas disponibles",
  },
  chunks: {
    page: "Página",
  },
  chat: {
    title: "Chat del documento",
    clear: "Limpiar",
    empty: "Haga preguntas sobre este documento",
    input_placeholder: "Pregunte sobre este documento...",
    no_provider: "No hay proveedor de chat activo configurado",
    error: "Error de chat",
  },
  selection: {
    ask_ai: "Preguntar a IA",
    translate: "Traducir",
    ask_about: "Explicar este texto",
    translate_text: "Traducir este texto",
  },
  delete_confirm: {
    title: "Eliminar documento",
    description: "¿Está seguro de que desea eliminar este documento? Esta acción no se puede deshacer.",
  },
  info_dialog: {
    author_empty: "Sin autor",
    pages_uploaded: "{{pages}} páginas · Subido {{date}}",
    translation_complete: "Traducción completa",
    translation_incomplete: "No traducido",
    btn: {
      continue_view: "Continuar viendo",
      view_original: "Ver original",
      retranslate: "Retraducir",
    },
    outputs: {
      title: "Resultados",
      subtitle: "Generado automáticamente desde el PDF original",
      translated_pdf: "PDF traducido",
      markdown: "Markdown",
      generated: "Generado",
      extracted: "Extraído",
      not_generated: "No generado",
      btn_view: "Ver",
      btn_export: "Exportar",
    },
    more: {
      title: "Más operaciones",
      replace_original: "Reemplazar PDF original",
      replace_translated: "Reemplazar PDF traducido",
      replace_markdown: "Reemplazar Markdown",
    },
    menu: {
      delete: "Eliminar documento",
    },
  },
  toast: {
    parse_started: {
      title: "Análisis iniciado",
      description: "Se ha iniciado el análisis del documento",
    },
    parse_error: {
      title: "Error al iniciar el análisis",
    },
    translation_started: {
      title: "Traducción iniciada",
      description: "Se ha iniciado la traducción del documento",
    },
    translation_error: {
      title: "Error al iniciar la traducción",
    },
    index_started: {
      title: "Indexación iniciada",
      description: "Se ha iniciado la indexación del documento",
    },
    index_error: {
      title: "Error al iniciar la indexación",
    },
    export_success: {
      title: "Exportación exitosa",
      description: "Documento exportado a {{path}}",
    },
    export_error: {
      title: "Error de exportación",
    },
    delete_success: {
      title: "Documento eliminado",
    },
    delete_error: {
      title: "Error al eliminar el documento",
    },
  },
}
