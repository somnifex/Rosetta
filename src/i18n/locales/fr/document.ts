export default {
  loading: "Chargement du document...",
  not_found: "Document non trouvé",
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
    title: "Aperçu",
    file_size: "Taille du fichier",
    pages: "Pages",
    parse_status: "État de l'analyse",
    translation_status: "État de la traduction",
    index_status: "État de l'indexation",
    languages: "Langues",
    auto: "Auto",
    not_set: "Non défini",
  },
  tabs: {
    preview: "Aperçu PDF",
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
    unavailable: "L'analyse et la traduction doivent être terminées pour voir la comparaison",
  },
  placeholder: {
    preview: "Aperçu non disponible. Analysez d'abord le document.",
    structure: "L'arborescence de la structure du document s'affichera ici",
    chunks: "Aucun fragment trouvé. Indexez d'abord le document.",
  },
  category: {
    select: "Sélectionner une catégorie",
    none: "Aucune catégorie",
  },
  tags: {
    add: "Ajouter une étiquette",
    search: "Rechercher des étiquettes...",
    no_available: "Aucune étiquette disponible",
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
    error: "Erreur de chat",
  },
  selection: {
    ask_ai: "Demander à l'IA",
    translate: "Traduire",
    ask_about: "Expliquer ce texte",
    translate_text: "Traduire ce texte",
  },
  delete_confirm: {
    title: "Supprimer le document",
    description: "Êtes-vous sûr de vouloir supprimer ce document ? Cette action est irréversible.",
  },
  info_dialog: {
    author_empty: "Aucun auteur",
    pages_uploaded: "{{pages}} pages · Importé le {{date}}",
    translation_complete: "Traduction terminée",
    translation_incomplete: "Non traduit",
    btn: {
      continue_view: "Continuer à voir",
      view_original: "Voir l'original",
      retranslate: "Retraduire",
    },
    outputs: {
      title: "Résultats",
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
      title: "Analyse lancée",
      description: "L'analyse du document a été initiée",
    },
    parse_error: {
      title: "Échec du lancement de l'analyse",
    },
    translation_started: {
      title: "Traduction lancée",
      description: "La traduction du document a été initiée",
    },
    translation_error: {
      title: "Échec du lancement de la traduction",
    },
    index_started: {
      title: "Indexation lancée",
      description: "L'indexation du document a été initiée",
    },
    index_error: {
      title: "Échec du lancement de l'indexation",
    },
    export_success: {
      title: "Exportation réussie",
      description: "Document exporté vers {{path}}",
    },
    export_error: {
      title: "Échec de l'exportation",
    },
    delete_success: {
      title: "Document supprimé",
    },
    delete_error: {
      title: "Échec de la suppression du document",
    },
  },
}
