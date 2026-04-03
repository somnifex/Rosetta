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
    parse_status: "Estado del análisis",
    translation_status: "Estado de la traducción",
    index_status: "Estado del índice",
    languages: "Idiomas",
    auto: "Automático",
    not_set: "Sin definir",
  },
  tabs: {
    preview: "Vista previa",
    parsed: "Contenido analizado",
    translated: "Traducción",
    comparison: "Comparación lado a lado",
    structure: "Estructura",
    chunks: "Fragmentos",
  },
  parsed: {
    in_progress: "Análisis en curso...",
    not_started: "El documento aún no se ha analizado",
  },
  translated: {
    in_progress: "Traducción en curso...",
    needs_parsing: "El documento debe analizarse antes de traducirse",
    not_started: "El documento aún no se ha traducido",
  },
  comparison: {
    original: "Original",
    translation: "Traducción",
    unavailable: "El análisis y la traducción deben completarse para ver la comparación",
  },
  placeholder: {
    preview: "La vista previa no está disponible. Analiza primero el documento.",
    structure: "Aquí se mostrará el árbol de estructura del documento",
    chunks: "No se encontraron fragmentos. Indexa primero el documento.",
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
    empty: "Haz preguntas sobre este documento",
    input_placeholder: "Pregunta sobre este documento...",
    no_provider: "No hay un proveedor de chat activo configurado",
    no_embed_provider: "No hay un proveedor de embeddings activo configurado",
    error: "Error del chat",
  },
  sources: {
    label: "Fuentes",
    chunk: "Fragmento {{index}}",
  },
  selection: {
    ask_ai: "Preguntar a la IA",
    translate: "Traducir",
    ask_about: "Explicar este texto",
    translate_text: "Traducir este texto",
  },
  reader_highlight: {
    save: "Guardar resaltados",
    saved: "Guardado",
    unsaved: "Sin guardar",
    undo: "Deshacer",
    redo: "Rehacer",
    zoom_in: "Acercar",
    zoom_out: "Alejar",
    add_highlight: "Agregar resaltado",
    shortcuts_hint: "Ctrl/Cmd+S Guardar · Ctrl/Cmd+Z Deshacer · Ctrl/Cmd+Shift+Z Rehacer",
    toast: {
      save_success: "Resaltados guardados",
      save_error: "No se pudieron guardar los resaltados",
    },
  },
  reader: {
    modes: {
      original: "Original",
      translated: "Traducción",
      compare: "Comparar",
      ask: "Preguntar",
    },
    toolbar: {
      back: "Volver",
      zoom_out: "Alejar",
      zoom_in: "Acercar",
      ask_open: "Preguntar",
      ask_close: "Cerrar",
    },
    compare: {
      original: "Original",
      translated: "Traducción",
      sync_scroll: "Sincronizar desplazamiento",
      parsed_notice: "El modo de comparación usa por defecto el contenido original analizado y el contenido traducido.",
      swap_order: "Intercambiar orden",
    },
    empty: {
      original_title: "El contenido original aún no está disponible",
      original_description: "Termina primero el análisis o comprueba si el archivo original sigue disponible.",
      translated_title: "El contenido traducido aún no está listo",
      translated_description: "Genera los resultados de traducción desde la página de acciones del documento o sube un PDF traducido.",
    },
    detail: {
      ask_explain_template: "Explica este pasaje en el contexto del documento actual:\n\n{{text}}",
      translate_explain_template: "Traduce y explica este pasaje:\n\n{{text}}",
      not_found: "Documento no encontrado",
      compare_not_ready_title: "La vista lado a lado aún no está lista",
      compare_not_ready_description:
        "Cuando terminen el análisis y la traducción, esta área cambiará automáticamente al modo de lectura lado a lado.",
      back_to_actions: "Volver a acciones del documento",
    },
  },
  delete_confirm: {
    title: "Eliminar documento",
    description: "¿Seguro que quieres eliminar este documento? Esta acción no se puede deshacer.",
  },
  info_dialog: {
    author_empty: "Sin autor",
    pages_uploaded: "{{pages}} páginas · Subido el {{date}}",
    translation_complete: "Traducción completa",
    translation_incomplete: "Sin traducir",
    btn: {
      continue_view: "Seguir leyendo",
      view_original: "Ver original",
      retranslate: "Traducir de nuevo",
    },
    outputs: {
      title: "Resultados de salida",
      subtitle: "Generado automáticamente a partir del PDF original",
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
      title: "No se pudo iniciar el análisis",
    },
    translation_started: {
      title: "Traducción iniciada",
      description: "Se ha iniciado la traducción del documento",
    },
    translation_error: {
      title: "No se pudo iniciar la traducción",
    },
    index_started: {
      title: "Indexación iniciada",
      description: "Se ha iniciado la indexación del documento",
    },
    index_error: {
      title: "No se pudo iniciar la indexación",
    },
    export_success: {
      title: "Exportación correcta",
      description: "Documento exportado a {{path}}",
    },
    export_error: {
      title: "La exportación falló",
    },
    delete_success: {
      title: "Documento eliminado",
    },
    delete_error: {
      title: "No se pudo eliminar el documento",
    },
  },
}
