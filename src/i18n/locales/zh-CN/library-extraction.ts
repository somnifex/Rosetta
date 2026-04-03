export default {
  document_info: {
    sections: {
      metadata: "元数据",
    },
  },
  batch: {
    extract: "提取字段",
  },
  extraction: {
    dialog: {
      single_title: "提取元数据字段",
      batch_title: "为 {{count}} 个文档提取元数据",
      single_description: "对当前文档的解析内容运行所选模板。",
      batch_description: "对所选文档的解析内容批量运行所选模板。",
      provider_label: "Provider",
      provider_placeholder: "选择 Provider",
      provider_hint: "本次提取将使用 {{provider}}。",
      provider_empty: "当前没有可用的 Chat Provider。",
      fields_label: "提取字段",
      fields_hint: "这里只显示已启用的模板。每个模板只提取一个字段。",
      select_all: "全选",
      clear: "清空",
      no_templates: "当前没有可用的提取模板，请先到设置页启用或创建模板。",
      running: "提取中...",
      confirm: "开始提取",
    },
    metadata: {
      title: "已提取元数据",
      description: "这些值会保存到文档库数据库，并同步写入文档目录中的 meta.json。",
      extract: "提取字段",
      empty_title: "还没有提取任何元数据",
      empty_description: "可以先提取作者、DOI、期刊等信息，再在文档库中展示和复用。",
      extracted_at: "更新于 {{time}}",
      not_found: "本次提取没有找到这个字段的值。",
    },
    toast: {
      single_success: "元数据提取完成",
      single_success_desc: "已更新 {{count}} 个字段结果。",
      batch_success: "批量元数据提取完成",
      batch_partial: "批量元数据提取已完成，但有部分失败",
      run_error: "元数据提取失败",
      field_deleted: "元数据字段已删除",
      field_delete_error: "删除元数据字段失败",
    },
  },
}
