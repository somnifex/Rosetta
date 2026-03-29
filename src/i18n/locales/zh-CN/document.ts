export default {
  loading: "正在加载文档...",
  not_found: "未找到文档",
  btn: {
    index: "索引文档",
    indexing: "索引中...",
    export: "导出",
    exporting: "导出中...",
    delete: "删除",
    start_parsing: "开始解析",
    start_translation: "开始翻译",
    starting: "启动中...",
  },
  overview: {
    title: "概览",
    file_size: "文件大小",
    pages: "页数",
    parse_status: "解析状态",
    translation_status: "翻译状态",
    index_status: "索引状态",
    languages: "语言",
    auto: "自动",
    not_set: "未设置",
  },
  tabs: {
    preview: "预览",
    parsed: "解析内容",
    translated: "翻译",
    comparison: "对照",
    structure: "结构",
    chunks: "分块",
  },
  parsed: {
    in_progress: "正在解析...",
    not_started: "文档尚未解析",
  },
  translated: {
    in_progress: "正在翻译...",
    needs_parsing: "文档需要先完成解析才能翻译",
    not_started: "文档尚未翻译",
  },
  comparison: {
    original: "原文",
    translation: "译文",
    unavailable: "需要完成解析和翻译后才能查看对照",
  },
  placeholder: {
    preview: "预览不可用，请先解析文档。",
    structure: "文档结构树将在此显示",
    chunks: "未找到分块，请先索引文档。",
  },
  category: {
    select: "选择分类",
    none: "无分类",
  },
  tags: {
    add: "添加标签",
    search: "搜索标签...",
    no_available: "没有可用标签",
  },
  chunks: {
    page: "页",
  },
  chat: {
    title: "文档对话",
    clear: "清除",
    empty: "向 AI 提问关于这篇文档的问题",
    input_placeholder: "提问关于这篇文档的问题...",
    no_provider: "未配置活跃的对话服务",
    no_embed_provider: "未配置活跃的 embedding 服务",
    error: "对话错误",
  },
  sources: {
    label: "来源",
    chunk: "分块 {{index}}",
  },
  selection: {
    ask_ai: "问 AI",
    translate: "翻译",
    ask_about: "解释这段文字",
    translate_text: "翻译这段文字",
  },
  delete_confirm: {
    title: "删除文档",
    description: "确定要删除此文档吗？此操作无法撤销。",
  },
  info_dialog: {
    author_empty: "未填写作者",
    pages_uploaded: "{{pages}}页 · 上传于 {{date}}",
    translation_complete: "翻译完成",
    translation_incomplete: "未翻译",
    btn: {
      continue_view: "继续查看原版",
      view_original: "查看原版",
      retranslate: "重新翻译",
    },
    outputs: {
      title: "输出结果",
      subtitle: "基于原版 PDF 自动生成",
      translated_pdf: "翻译版 PDF",
      markdown: "Markdown",
      generated: "已生成",
      extracted: "已提取",
      not_generated: "未生成",
      btn_view: "查看",
      btn_export: "导出",
    },
    more: {
      title: "更多操作",
      replace_original: "替换原版 PDF",
      replace_translated: "替换翻译版 PDF",
      replace_markdown: "替换 Markdown",
    },
    menu: {
      delete: "删除文档",
    },
  },
  toast: {
    parse_started: {
      title: "解析已开始",
      description: "文档解析已启动",
    },
    parse_error: {
      title: "启动解析失败",
    },
    translation_started: {
      title: "翻译已开始",
      description: "文档翻译已启动",
    },
    translation_error: {
      title: "启动翻译失败",
    },
    index_started: {
      title: "索引已开始",
      description: "文档索引已启动",
    },
    index_error: {
      title: "启动索引失败",
    },
    export_success: {
      title: "导出成功",
      description: "文档已导出到 {{path}}",
    },
    export_error: {
      title: "导出失败",
    },
    delete_success: {
      title: "文档已删除",
    },
    delete_error: {
      title: "删除文档失败",
    },
  },
}
