export default {
  title: "البحث الدلالي",
  subtitle: "ابحث في جميع المستندات المفهرسة",
  labels: {
    settings: "الإعدادات",
    combined_results: "النتائج المجمعة",
  },
  input: {
    placeholder: "أدخل استعلام البحث...",
  },
  btn: {
    search: "بحث",
    searching: "جارٍ البحث...",
    go_to_settings: "الانتقال إلى الإعدادات",
  },
  options: {
    title: "إعدادات البحث المدمج",
    include_documents: "مطابقة المستندات العامة",
    include_settings: "البحث في الإعدادات",
    include_semantic: "البحث الدلالي",
    priority: "الأولوية",
    global_first: "العام أولاً",
    semantic_first: "الدلالي أولاً",
    max_global_results: "الحد الأقصى للنتائج العامة",
    max_semantic_results: "الحد الأقصى للنتائج الدلالية",
    min_semantic_score: "العتبة الدلالية (0-1)",
  },
  results: {
    count: "تم العثور على {{count}} نتيجة",
    view_document: "عرض المستند",
    no_results: "لم يتم العثور على نتائج",
    type_global_document: "عام - مستند",
    type_global_setting: "عام - إعداد",
    type_semantic: "دلالي",
  },
  toast: {
    empty_query: {
      title: "الاستعلام فارغ",
      description: "يرجى إدخال استعلام بحث",
    },
    global_only: {
      title: "اكتمل البحث العام",
      description: "يتطلب البحث الدلالي موفر تضمين نشطاً",
    },
    search_error: {
      title: "فشل البحث",
    },
  },
}
