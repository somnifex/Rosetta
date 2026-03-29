export default {
  loading: "Loading document...",
  not_found: "Document not found",
  btn: {
    index: "Index Document",
    indexing: "Indexing...",
    export: "Export",
    exporting: "Exporting...",
    delete: "Delete",
    start_parsing: "Start Parsing",
    start_translation: "Start Translation",
    starting: "Starting...",
  },
  overview: {
    title: "Overview",
    file_size: "File Size",
    pages: "Pages",
    parse_status: "Parse Status",
    translation_status: "Translation Status",
    index_status: "Index Status",
    languages: "Languages",
    auto: "Auto",
    not_set: "Not set",
  },
  tabs: {
    preview: "Preview",
    parsed: "Parsed Content",
    translated: "Translation",
    comparison: "Side-by-Side",
    structure: "Structure",
    chunks: "Chunks",
  },
  parsed: {
    in_progress: "Parsing in progress...",
    not_started: "Document has not been parsed yet",
  },
  translated: {
    in_progress: "Translation in progress...",
    needs_parsing: "Document must be parsed before translation",
    not_started: "Document has not been translated yet",
  },
  comparison: {
    original: "Original",
    translation: "Translation",
    unavailable: "Both parsing and translation must be completed to view comparison",
  },
  placeholder: {
    preview: "Preview not available. Parse the document first.",
    structure: "Document structure tree will be displayed here",
    chunks: "No chunks found. Index the document first.",
  },
  category: {
    select: "Select category",
    none: "No category",
  },
  tags: {
    add: "Add Tag",
    search: "Search tags...",
    no_available: "No tags available",
  },
  chunks: {
    page: "Page",
  },
  chat: {
    title: "Document Chat",
    clear: "Clear",
    empty: "Ask questions about this document",
    input_placeholder: "Ask about this document...",
    no_provider: "No active chat provider configured",
    no_embed_provider: "No active embedding provider configured",
    error: "Chat error",
  },
  sources: {
    label: "Sources",
    chunk: "Chunk {{index}}",
  },
  selection: {
    ask_ai: "Ask AI",
    translate: "Translate",
    ask_about: "Explain this text",
    translate_text: "Translate this text",
  },
  delete_confirm: {
    title: "Delete Document",
    description: "Are you sure you want to delete this document? This action cannot be undone.",
  },
  info_dialog: {
    author_empty: "No author",
    pages_uploaded: "{{pages}} pages · Uploaded {{date}}",
    translation_complete: "Translation complete",
    translation_incomplete: "Not translated",
    btn: {
      continue_view: "Continue Viewing",
      view_original: "View Original",
      retranslate: "Re-translate",
    },
    outputs: {
      title: "Output Results",
      subtitle: "Auto-generated from original PDF",
      translated_pdf: "Translated PDF",
      markdown: "Markdown",
      generated: "Generated",
      extracted: "Extracted",
      not_generated: "Not generated",
      btn_view: "View",
      btn_export: "Export",
    },
    more: {
      title: "More Operations",
      replace_original: "Replace Original PDF",
      replace_translated: "Replace Translated PDF",
      replace_markdown: "Replace Markdown",
    },
    menu: {
      delete: "Delete Document",
    },
  },
  toast: {
    parse_started: {
      title: "Parsing started",
      description: "Document parsing has been initiated",
    },
    parse_error: {
      title: "Failed to start parsing",
    },
    translation_started: {
      title: "Translation started",
      description: "Document translation has been initiated",
    },
    translation_error: {
      title: "Failed to start translation",
    },
    index_started: {
      title: "Indexing started",
      description: "Document indexing has been initiated",
    },
    index_error: {
      title: "Failed to start indexing",
    },
    export_success: {
      title: "Export successful",
      description: "Document exported to {{path}}",
    },
    export_error: {
      title: "Export failed",
    },
    delete_success: {
      title: "Document deleted",
    },
    delete_error: {
      title: "Failed to delete document",
    },
  },
}
