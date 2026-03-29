export default {
  title: "任务中心",
  subtitle: "监控解析和翻译任务",
  tabs: {
    all: "所有任务",
    parsing: "解析",
    translation: "翻译",
    indexing: "索引",
  },
  columns: {
    document: "文档",
    type: "类型",
    status: "状态",
    progress: "进度",
    created: "创建时间",
    duration: "耗时",
    error: "错误",
  },
  status: {
    pending: "等待中",
    parsing: "解析中",
    translating: "翻译中",
    indexing: "索引中",
    completed: "已完成",
    failed: "失败",
    partial: "部分完成",
  },
  type: {
    parse: "解析",
    translation: "翻译",
    index: "索引",
  },
  actions: {
    viewDocument: "查看文档",
    retry: "重试",
    cancelTask: "终止任务",
    deleteTask: "删除任务",
  },
  empty: {
    all: {
      title: "暂无活动任务",
      description: "开始处理文档后任务将在此显示",
    },
    parsing: {
      title: "暂无解析任务",
      description: "导入 PDF 开始解析",
    },
    translation: {
      title: "暂无翻译任务",
      description: "启动翻译任务后将在此显示",
    },
    indexing: {
      title: "暂无索引任务",
      description: "启用索引后将在此显示",
    },
  },
}
