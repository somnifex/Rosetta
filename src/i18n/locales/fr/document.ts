export default {
  loading: "Chargement du document...",
  not_found: "Document introuvable",
  btn: {
    index: "Indexer le document",
    indexing: "Indexation...",
    export: "Exporter",
    exporting: "Exportation...",
    delete: "Supprimer",
    start_parsing: "Lancer l'analyse",
    start_translation: "Lancer la traduction",
    starting: "Démarrage...",
  },
  overview: {
    title: "Vue d'ensemble",
    file_size: "Taille du fichier",
    pages: "Pages",
    parse_status: "Statut de l'analyse",
    translation_status: "Statut de la traduction",
    index_status: "Statut de l'index",
    languages: "Langues",
    auto: "Auto",
    not_set: "Non défini",
  },
  tabs: {
    preview: "Aperçu",
    parsed: "Contenu analysé",
    translated: "Traduction",
    comparison: "Côte à côte",
    structure: "Structure",
    chunks: "Fragments",
  },
  parsed: {
    in_progress: "Analyse en cours...",
    not_started: "Le document n'a pas encore été analysé",
  },
  translated: {
    in_progress: "Traduction en cours...",
    needs_parsing: "Le document doit être analysé avant la traduction",
    not_started: "Le document n'a pas encore été traduit",
  },
  comparison: {
    original: "Original",
    translation: "Traduction",
    unavailable: "L'analyse et la traduction doivent être terminées pour afficher la comparaison",
  },
  placeholder: {
    preview: "Aperçu indisponible. Analysez d'abord le document.",
    structure: "L'arborescence de structure du document s'affichera ici",
    chunks: "Aucun fragment trouvé. Indexez d'abord le document.",
  },
  category: {
    select: "Sélectionner une catégorie",
    none: "Aucune catégorie",
  },
  tags: {
    add: "Ajouter un tag",
    search: "Rechercher des tags...",
    no_available: "Aucun tag disponible",
  },
  chunks: {
    page: "Page",
  },
  chat: {
    title: "Chat du document",
    clear: "Effacer",
    empty: "Posez des questions sur ce document",
    input_placeholder: "Posez une question sur ce document...",
    no_provider: "Aucun fournisseur de chat actif configuré",
    no_embed_provider: "Aucun fournisseur d'embedding actif configuré",
    error: "Erreur de chat",
  },
  sources: {
    label: "Sources",
    chunk: "Fragment {{index}}",
  },
  selection: {
    ask_ai: "Demander à l'IA",
    translate: "Traduire",
    ask_about: "Expliquer ce texte",
    translate_text: "Traduire ce texte",
  },
  reader_highlight: {
    save: "Enregistrer les surlignages",
    saved: "Enregistré",
    unsaved: "Non enregistré",
    undo: "Annuler",
    redo: "Rétablir",
    zoom_in: "Zoom avant",
    zoom_out: "Zoom arrière",
    add_highlight: "Ajouter un surlignage",
    shortcuts_hint: "Ctrl/Cmd+S Enregistrer · Ctrl/Cmd+Z Annuler · Ctrl/Cmd+Shift+Z Rétablir",
    toast: {
      save_success: "Surlignages enregistrés",
      save_error: "Impossible d'enregistrer les surlignages",
    },
  },
  reader: {
    modes: {
      original: "Original",
      translated: "Traduction",
      compare: "Comparer",
      ask: "Demander",
    },
    toolbar: {
      back: "Retour",
      zoom_out: "Zoom arrière",
      zoom_in: "Zoom avant",
      ask_open: "Demander",
      ask_close: "Fermer",
    },
    compare: {
      original: "Original",
      translated: "Traduction",
      sync_scroll: "Synchroniser le défilement",
      parsed_notice: "Le mode comparaison utilise par défaut le contenu original analysé et le contenu traduit.",
      swap_order: "Inverser l'ordre",
    },
    empty: {
      original_title: "Le contenu original n'est pas encore disponible",
      original_description: "Terminez d'abord l'analyse ou vérifiez si le fichier original est toujours disponible.",
      translated_title: "Le contenu traduit n'est pas encore prêt",
      translated_description: "Générez les résultats de traduction depuis la page d'actions du document ou téléversez un PDF traduit.",
    },
    detail: {
      ask_explain_template: "Veuillez expliquer ce passage dans le contexte du document actuel :\n\n{{text}}",
      translate_explain_template: "Veuillez traduire et expliquer ce passage :\n\n{{text}}",
      not_found: "Document introuvable",
      compare_not_ready_title: "La vue côte à côte n'est pas encore prête",
      compare_not_ready_description:
        "Une fois l'analyse et la traduction terminées, cette zone passera automatiquement à la lecture côte à côte.",
      back_to_actions: "Retour aux actions du document",
    },
  },
  delete_confirm: {
    title: "Supprimer le document",
    description: "Voulez-vous vraiment supprimer ce document ? Cette action est irréversible.",
  },
  info_dialog: {
    author_empty: "Aucun auteur",
    pages_uploaded: "{{pages}} pages · Téléversé le {{date}}",
    translation_complete: "Traduction terminée",
    translation_incomplete: "Non traduit",
    btn: {
      continue_view: "Continuer la lecture",
      view_original: "Voir l'original",
      retranslate: "Traduire à nouveau",
    },
    outputs: {
      title: "Résultats de sortie",
      subtitle: "Généré automatiquement à partir du PDF original",
      translated_pdf: "PDF traduit",
      markdown: "Markdown",
      generated: "Généré",
      extracted: "Extrait",
      not_generated: "Non généré",
      btn_view: "Voir",
      btn_export: "Exporter",
    },
    more: {
      title: "Plus d'opérations",
      replace_original: "Remplacer le PDF original",
      replace_translated: "Remplacer le PDF traduit",
      replace_markdown: "Remplacer le Markdown",
    },
    menu: {
      delete: "Supprimer le document",
    },
  },
  toast: {
    parse_started: {
      title: "Analyse démarrée",
      description: "L'analyse du document a été lancée",
    },
    parse_error: {
      title: "Impossible de démarrer l'analyse",
    },
    translation_started: {
      title: "Traduction démarrée",
      description: "La traduction du document a été lancée",
    },
    translation_error: {
      title: "Impossible de démarrer la traduction",
    },
    index_started: {
      title: "Indexation démarrée",
      description: "L'indexation du document a été lancée",
    },
    index_error: {
      title: "Impossible de démarrer l'indexation",
    },
    export_success: {
      title: "Export réussi",
      description: "Document exporté vers {{path}}",
    },
    export_error: {
      title: "Échec de l'export",
    },
    delete_success: {
      title: "Document supprimé",
    },
    delete_error: {
      title: "Impossible de supprimer le document",
    },
  },
}
