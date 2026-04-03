export default {
  title: "Recherche sémantique",
  subtitle: "Recherchez dans tous les documents indexés",
  labels: {
    settings: "Paramètres",
    combined_results: "Résultats combinés",
  },
  input: {
    placeholder: "Saisissez votre requête...",
  },
  btn: {
    search: "Rechercher",
    searching: "Recherche...",
    go_to_settings: "Aller aux paramètres",
  },
  options: {
    title: "Paramètres de recherche combinée",
    include_documents: "Correspondance globale des documents",
    include_settings: "Recherche dans les paramètres",
    include_semantic: "Recherche sémantique",
    priority: "Priorité",
    global_first: "Global d'abord",
    semantic_first: "Sémantique d'abord",
    max_global_results: "Limite de résultats globaux",
    max_semantic_results: "Limite de résultats sémantiques",
    min_semantic_score: "Seuil sémantique (0-1)",
  },
  results: {
    count: "{{count}} résultats trouvés",
    view_document: "Voir le document",
    no_results: "Aucun résultat trouvé",
    type_global_document: "Global - Document",
    type_global_setting: "Global - Paramètre",
    type_semantic: "Sémantique",
  },
  toast: {
    empty_query: {
      title: "Requête vide",
      description: "Veuillez saisir une requête",
    },
    global_only: {
      title: "Recherche globale terminée",
      description: "La recherche sémantique nécessite un fournisseur d'embedding actif",
    },
    search_error: {
      title: "Échec de la recherche",
    },
  },
}
