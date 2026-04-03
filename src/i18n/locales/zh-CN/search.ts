export default {
  title: "语义搜索",
  subtitle: "搜索所有已建立索引的文档",
  labels: {
    settings: "设置",
    combined_results: "综合结果",
  },
  input: {
    placeholder: "输入搜索内容...",
  },
  btn: {
    search: "搜索",
    searching: "搜索中...",
    go_to_settings: "前往设置",
  },
  options: {
    title: "综合搜索设置",
    include_documents: "文档全局匹配",
    include_settings: "设置项检索",
    include_semantic: "语义检索",
    priority: "优先级",
    global_first: "全局优先",
    semantic_first: "语义优先",
    max_global_results: "全局结果上限",
    max_semantic_results: "语义结果上限",
    min_semantic_score: "语义阈值（0-1）",
  },
  results: {
    count: "找到 {{count}} 条结果",
    view_document: "查看文档",
    no_results: "未找到结果",
    type_global_document: "全局-文档",
    type_global_setting: "全局-设置",
    type_semantic: "语义",
  },
  toast: {
    empty_query: {
      title: "搜索内容为空",
      description: "请输入搜索内容",
    },
    global_only: {
      title: "已完成全局搜索",
      description: "语义搜索需要激活 embedding provider",
    },
    search_error: {
      title: "搜索失败",
    },
  },
}
