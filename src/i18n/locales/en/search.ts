export default {
  title: "Semantic Search",
  subtitle: "Search across all indexed documents",
  labels: {
    settings: "Settings",
    combined_results: "Combined Results",
  },
  input: {
    placeholder: "Enter your search query...",
  },
  btn: {
    search: "Search",
    searching: "Searching...",
    go_to_settings: "Go to Settings",
  },
  options: {
    title: "Combined Search Settings",
    include_documents: "Document Global Match",
    include_settings: "Setting Search",
    include_semantic: "Semantic Search",
    priority: "Priority",
    global_first: "Global First",
    semantic_first: "Semantic First",
    max_global_results: "Global Result Limit",
    max_semantic_results: "Semantic Result Limit",
    min_semantic_score: "Semantic Threshold (0-1)",
  },
  results: {
    count: "Found {{count}} results",
    view_document: "View Document",
    no_results: "No results found",
    type_global_document: "Global - Document",
    type_global_setting: "Global - Setting",
    type_semantic: "Semantic",
  },
  toast: {
    empty_query: {
      title: "Empty query",
      description: "Please enter a search query",
    },
    global_only: {
      title: "Global search completed",
      description: "Semantic search requires an active embedding provider",
    },
    search_error: {
      title: "Search failed",
    },
  },
}
