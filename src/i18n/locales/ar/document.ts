export default {
  loading: "جارٍ تحميل المستند...",
  not_found: "المستند غير موجود",
  btn: {
    index: "فهرسة المستند",
    indexing: "جارٍ الفهرسة...",
    export: "تصدير",
    exporting: "جارٍ التصدير...",
    delete: "حذف",
    start_parsing: "بدء التحليل",
    start_translation: "بدء الترجمة",
    starting: "جارٍ البدء...",
  },
  overview: {
    title: "نظرة عامة",
    file_size: "حجم الملف",
    pages: "الصفحات",
    parse_status: "حالة التحليل",
    translation_status: "حالة الترجمة",
    index_status: "حالة الفهرسة",
    languages: "اللغات",
    auto: "تلقائي",
    not_set: "غير محدد",
  },
  tabs: {
    preview: "معاينة PDF",
    parsed: "المحتوى المحلل",
    translated: "الترجمة",
    comparison: "جنباً إلى جنب",
    structure: "الهيكل",
    chunks: "الأجزاء",
  },
  parsed: {
    in_progress: "جارٍ التحليل...",
    not_started: "لم يتم تحليل المستند بعد",
  },
  translated: {
    in_progress: "جارٍ الترجمة...",
    needs_parsing: "يجب تحليل المستند قبل الترجمة",
    not_started: "لم تتم ترجمة المستند بعد",
  },
  comparison: {
    original: "النص الأصلي",
    translation: "الترجمة",
    unavailable: "يجب إكمال التحليل والترجمة لعرض المقارنة",
  },
  placeholder: {
    preview: "المعاينة غير متاحة. قم بتحليل المستند أولاً.",
    structure: "ستظهر شجرة هيكل المستند هنا",
    chunks: "لم يتم العثور على أجزاء. قم بفهرسة المستند أولاً.",
  },
  category: {
    select: "اختر الفئة",
    none: "بدون فئة",
  },
  tags: {
    add: "إضافة علامة",
    search: "البحث في العلامات...",
    no_available: "لا توجد علامات متاحة",
  },
  chunks: {
    page: "صفحة",
  },
  chat: {
    title: "محادثة المستند",
    clear: "مسح",
    empty: "اطرح أسئلة حول هذا المستند",
    input_placeholder: "اسأل عن هذا المستند...",
    no_provider: "لم يتم تكوين موفر محادثة نشط",
    error: "خطأ في المحادثة",
  },
  selection: {
    ask_ai: "اسأل الذكاء الاصطناعي",
    translate: "ترجمة",
    ask_about: "شرح هذا النص",
    translate_text: "ترجمة هذا النص",
  },
  delete_confirm: {
    title: "حذف المستند",
    description: "هل أنت متأكد أنك تريد حذف هذا المستند؟ لا يمكن التراجع عن هذا الإجراء.",
  },
  info_dialog: {
    author_empty: "بدون مؤلف",
    pages_uploaded: "{{pages}} صفحات · تم الرفع {{date}}",
    translation_complete: "اكتملت الترجمة",
    translation_incomplete: "لم تتم الترجمة",
    btn: {
      continue_view: "متابعة العرض",
      view_original: "عرض الأصل",
      retranslate: "إعادة الترجمة",
    },
    outputs: {
      title: "النتائج",
      subtitle: "تم إنشاؤه تلقائياً من ملف PDF الأصلي",
      translated_pdf: "PDF المترجم",
      markdown: "Markdown",
      generated: "تم الإنشاء",
      extracted: "تم الاستخراج",
      not_generated: "لم يتم الإنشاء",
      btn_view: "عرض",
      btn_export: "تصدير",
    },
    more: {
      title: "المزيد من العمليات",
      replace_original: "استبدال PDF الأصلي",
      replace_translated: "استبدال PDF المترجم",
      replace_markdown: "استبدال Markdown",
    },
    menu: {
      delete: "حذف المستند",
    },
  },
  toast: {
    parse_started: {
      title: "بدأ التحليل",
      description: "تم بدء تحليل المستند",
    },
    parse_error: {
      title: "فشل بدء التحليل",
    },
    translation_started: {
      title: "بدأت الترجمة",
      description: "تم بدء ترجمة المستند",
    },
    translation_error: {
      title: "فشل بدء الترجمة",
    },
    index_started: {
      title: "بدأت الفهرسة",
      description: "تم بدء فهرسة المستند",
    },
    index_error: {
      title: "فشل بدء الفهرسة",
    },
    export_success: {
      title: "تم التصدير بنجاح",
      description: "تم تصدير المستند إلى {{path}}",
    },
    export_error: {
      title: "فشل التصدير",
    },
    delete_success: {
      title: "تم حذف المستند",
    },
    delete_error: {
      title: "فشل حذف المستند",
    },
  },
}
