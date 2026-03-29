export default {
  title: "Centre de tâches",
  subtitle: "Surveiller les travaux d'analyse et de traduction",
  tabs: {
    all: "Toutes les tâches",
    parsing: "Analyse",
    translation: "Traduction",
    indexing: "Indexation",
  },
  columns: {
    document: "Document",
    type: "Type",
    status: "Statut",
    progress: "Progression",
    created: "Créé",
    duration: "Durée",
    error: "Erreur",
  },
  status: {
    pending: "En attente",
    parsing: "Analyse en cours",
    translating: "Traduction en cours",
    indexing: "Indexation en cours",
    completed: "Terminé",
    failed: "Échoué",
    partial: "Partiel",
  },
  type: {
    parse: "Analyse",
    translation: "Traduction",
    index: "Indexation",
  },
  actions: {
    viewDocument: "Voir le document",
    retry: "Réessayer",
    cancelTask: "Arrêter la tâche",
    deleteTask: "Supprimer la tâche",
  },
  empty: {
    all: {
      title: "Aucune tâche active",
      description: "Les tâches apparaîtront ici lorsque vous commencerez à traiter des documents",
    },
    parsing: {
      title: "Aucune tâche d'analyse",
      description: "Importez un PDF pour commencer l'analyse",
    },
    translation: {
      title: "Aucune tâche de traduction",
      description: "Lancez un travail de traduction pour voir les tâches ici",
    },
    indexing: {
      title: "Aucune tâche d'indexation",
      description: "Activez l'indexation pour voir les tâches ici",
    },
  },
}
