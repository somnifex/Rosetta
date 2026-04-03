/// 分片策略配置
use serde_json::Value;
use std::cmp::Ordering;

#[derive(Debug, Clone)]
pub struct ChunkingConfig {
    /// 单个分片的最大tokens（估算值）
    pub max_tokens_per_chunk: usize,
    /// 分片间的重叠tokens
    pub overlap_tokens: usize,
    /// 是否保留句子边界
    pub preserve_sentences: bool,
    /// 估算的平均tokens/字符比例
    pub tokens_per_char_estimate: f32,
}

impl Default for ChunkingConfig {
    fn default() -> Self {
        Self {
            max_tokens_per_chunk: 2048,
            overlap_tokens: 128,
            preserve_sentences: true,
            tokens_per_char_estimate: 0.25, // 平均每个字符约0.25个tokens
        }
    }
}

impl ChunkingConfig {
    /// 创建用于translate的配置（保守估计，防止超长请求）
    pub fn for_translate() -> Self {
        Self {
            max_tokens_per_chunk: 4000,
            overlap_tokens: 256,
            preserve_sentences: true,
            tokens_per_char_estimate: 0.25,
        }
    }

    /// 创建用于embed的配置
    pub fn for_embed() -> Self {
        Self {
            max_tokens_per_chunk: 8192,
            overlap_tokens: 256,
            preserve_sentences: true,
            tokens_per_char_estimate: 0.25,
        }
    }
}

/// 分片结果，包含序号用于追踪
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranslationChunkStrategy {
    Token,
    ParsedContent,
}

impl Default for TranslationChunkStrategy {
    fn default() -> Self {
        Self::Token
    }
}

impl TranslationChunkStrategy {
    pub fn from_value(value: Option<&str>) -> Self {
        match value
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "parsed_content" | "parsed" | "mineru" | "structure" => Self::ParsedContent,
            _ => Self::Token,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Token => "token",
            Self::ParsedContent => "parsed_content",
        }
    }
}

#[derive(Debug, Clone)]
pub struct PreparedTranslationChunks {
    pub chunks: Vec<Chunk>,
    pub strategy_used: TranslationChunkStrategy,
}

#[derive(Debug, Clone)]
struct ParsedPartition {
    page_index: i64,
    top: f64,
    left: f64,
    order: usize,
    text: String,
}

pub fn prepare_translation_chunks(
    markdown_content: &str,
    parsed_json: Option<&str>,
    structure_json: Option<&str>,
    config: &ChunkingConfig,
    strategy: TranslationChunkStrategy,
) -> PreparedTranslationChunks {
    if strategy == TranslationChunkStrategy::ParsedContent {
        if let Some(chunks) =
            prepare_chunks_from_parsed_sources(parsed_json, structure_json, config)
        {
            if !chunks.is_empty() {
                return PreparedTranslationChunks {
                    chunks,
                    strategy_used: TranslationChunkStrategy::ParsedContent,
                };
            }
        }
    }

    PreparedTranslationChunks {
        chunks: TextChunker::new(config.clone()).chunk(markdown_content),
        strategy_used: TranslationChunkStrategy::Token,
    }
}

fn prepare_chunks_from_parsed_sources(
    parsed_json: Option<&str>,
    structure_json: Option<&str>,
    config: &ChunkingConfig,
) -> Option<Vec<Chunk>> {
    [structure_json, parsed_json]
        .into_iter()
        .flatten()
        .find_map(|raw| prepare_chunks_from_parsed_json(raw, config))
}

fn prepare_chunks_from_parsed_json(raw: &str, config: &ChunkingConfig) -> Option<Vec<Chunk>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let value = serde_json::from_str::<Value>(trimmed).ok()?;
    let partitions = extract_parsed_partitions(&value);
    if partitions.is_empty() {
        return None;
    }

    let chunker = TextChunker::new(config.clone());
    let mut chunks = Vec::new();
    let mut cursor = 0usize;

    for partition in partitions {
        let normalized = normalize_partition_text(&partition.text);
        if normalized.is_empty() {
            continue;
        }

        let partition_chunks = chunker.chunk(&normalized);
        if partition_chunks.is_empty() {
            continue;
        }

        for item in partition_chunks {
            chunks.push(Chunk {
                index: chunks.len(),
                text: item.text,
                start_pos: cursor + item.start_pos,
                end_pos: cursor + item.end_pos,
            });
        }
        cursor += normalized.len();
    }

    if chunks.is_empty() {
        None
    } else {
        Some(chunks)
    }
}

fn extract_parsed_partitions(value: &Value) -> Vec<ParsedPartition> {
    if let Some(items) = value.as_array() {
        return extract_content_list_partitions(items);
    }

    if let Some(pdf_info) = value.get("pdf_info").and_then(Value::as_array) {
        return extract_layout_partitions(pdf_info);
    }

    if let Some(content_list) = value.get("content_list").and_then(Value::as_array) {
        return extract_content_list_partitions(content_list);
    }

    Vec::new()
}

fn extract_content_list_partitions(items: &[Value]) -> Vec<ParsedPartition> {
    let mut partitions = items
        .iter()
        .enumerate()
        .filter_map(|(order, item)| {
            let item_type = value_string(item.get("type")).unwrap_or("text");
            if matches!(item_type, "header" | "footer") {
                return None;
            }

            let text = extract_content_list_text(item)?;
            let (left, top) = extract_bbox_position(item.get("bbox"));
            Some(ParsedPartition {
                page_index: value_i64(item.get("page_idx")).unwrap_or(0),
                top,
                left,
                order,
                text,
            })
        })
        .collect::<Vec<_>>();

    sort_partitions(&mut partitions);
    partitions
}

fn extract_layout_partitions(pages: &[Value]) -> Vec<ParsedPartition> {
    let mut partitions = Vec::new();
    let mut order = 0usize;

    for (page_order, page) in pages.iter().enumerate() {
        let page_index = value_i64(page.get("page_idx")).unwrap_or(page_order as i64);
        if let Some(para_blocks) = page.get("para_blocks").and_then(Value::as_array) {
            collect_layout_partitions(para_blocks, page_index, false, &mut order, &mut partitions);
        }
    }

    sort_partitions(&mut partitions);
    partitions
}

fn collect_layout_partitions(
    blocks: &[Value],
    page_index: i64,
    discarded: bool,
    order: &mut usize,
    out: &mut Vec<ParsedPartition>,
) {
    for block in blocks {
        if let Some(nested_blocks) = block.get("blocks").and_then(Value::as_array) {
            collect_layout_partitions(nested_blocks, page_index, discarded, order, out);
            continue;
        }

        let block_type = value_string(block.get("type")).unwrap_or("text");
        if discarded || matches!(block_type, "header" | "footer") {
            continue;
        }

        let Some(text) = extract_layout_text(block) else {
            continue;
        };
        let (left, top) = extract_bbox_position(block.get("bbox"));
        out.push(ParsedPartition {
            page_index,
            top,
            left,
            order: *order,
            text,
        });
        *order += 1;
    }
}

fn sort_partitions(partitions: &mut [ParsedPartition]) {
    partitions.sort_by(|left, right| {
        left.page_index
            .cmp(&right.page_index)
            .then_with(|| compare_f64(left.top, right.top))
            .then_with(|| compare_f64(left.left, right.left))
            .then_with(|| left.order.cmp(&right.order))
    });
}

fn compare_f64(left: f64, right: f64) -> Ordering {
    left.partial_cmp(&right).unwrap_or(Ordering::Equal)
}

fn extract_content_list_text(item: &Value) -> Option<String> {
    let item_type = value_string(item.get("type")).unwrap_or("text");
    let mut parts = Vec::new();

    if item_type == "list" {
        if let Some(list) = format_list_items(item.get("list_items")) {
            push_unique_text(&mut parts, list);
        }
    } else if item_type == "image" {
        append_field_strings(&mut parts, item.get("image_caption"));
        append_field_strings(&mut parts, item.get("image_footnote"));
        if parts.is_empty() {
            if let Some(path) = value_string(item.get("img_path")) {
                push_unique_text(&mut parts, format!("![image]({path})"));
            }
        }
    } else if item_type == "table" {
        append_field_strings(&mut parts, item.get("table_caption"));
        append_field_strings(&mut parts, item.get("table_body"));
        append_field_strings(&mut parts, item.get("table_footnote"));
    }

    for key in ["text", "content", "html", "latex", "equation", "formula"] {
        append_field_strings(&mut parts, item.get(key));
    }

    join_partition_parts(parts)
}

fn extract_layout_text(block: &Value) -> Option<String> {
    let mut parts = Vec::new();

    if let Some(lines) = block.get("lines").and_then(Value::as_array) {
        for line in lines {
            if let Some(text) = extract_layout_line_text(line) {
                push_unique_text(&mut parts, text);
            }
        }
    }

    for key in ["content", "text"] {
        append_field_strings(&mut parts, block.get(key));
    }

    if let Some(html) = find_first_string_by_keys(block, &["html"]) {
        push_unique_text(&mut parts, html.to_string());
    }

    if parts.is_empty() {
        if let Some(path) = find_first_string_by_keys(block, &["image_path", "img_path"]) {
            push_unique_text(&mut parts, format!("![image]({path})"));
        }
    }

    join_partition_parts(parts)
}

fn extract_layout_line_text(line: &Value) -> Option<String> {
    if let Some(text) = line.as_str() {
        return normalize_inline_text(text);
    }

    if let Some(spans) = line.get("spans").and_then(Value::as_array) {
        let text = spans
            .iter()
            .filter_map(|span| value_string(span.get("content")))
            .collect::<String>();
        if let Some(normalized) = normalize_inline_text(&text) {
            return Some(normalized);
        }
    }

    for key in ["content", "text"] {
        if let Some(text) = value_string(line.get(key)) {
            if let Some(normalized) = normalize_inline_text(text) {
                return Some(normalized);
            }
        }
    }

    None
}

fn find_first_string_by_keys<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    if let Some(array) = value.as_array() {
        for item in array {
            if let Some(found) = find_first_string_by_keys(item, keys) {
                return Some(found);
            }
        }
        return None;
    }

    let object = value.as_object()?;

    for key in keys {
        if let Some(found) = object.get(*key).and_then(Value::as_str) {
            if !found.trim().is_empty() {
                return Some(found);
            }
        }
    }

    for child in object.values() {
        if let Some(found) = find_first_string_by_keys(child, keys) {
            return Some(found);
        }
    }

    None
}

fn format_list_items(value: Option<&Value>) -> Option<String> {
    let Some(value) = value else {
        return None;
    };

    let mut lines = value_strings(value)
        .into_iter()
        .filter_map(|item| normalize_inline_text(&item))
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>();

    lines.dedup();
    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn append_field_strings(parts: &mut Vec<String>, value: Option<&Value>) {
    let Some(value) = value else {
        return;
    };

    for item in value_strings(value) {
        push_unique_text(parts, item);
    }
}

fn push_unique_text(parts: &mut Vec<String>, candidate: String) {
    let Some(normalized) = normalize_inline_text(&candidate) else {
        return;
    };

    if !parts.iter().any(|existing| existing == &normalized) {
        parts.push(normalized);
    }
}

fn normalize_inline_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn join_partition_parts(parts: Vec<String>) -> Option<String> {
    if parts.is_empty() {
        return None;
    }

    Some(parts.join("\n"))
}

fn normalize_partition_text(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut normalized = trimmed.to_string();
    if !normalized.ends_with("\n\n") {
        if !normalized.ends_with('\n') {
            normalized.push('\n');
        }
        normalized.push('\n');
    }
    normalized
}

fn value_strings(value: &Value) -> Vec<String> {
    match value {
        Value::String(text) => vec![text.to_string()],
        Value::Array(items) => items.iter().flat_map(value_strings).collect(),
        Value::Object(map) => {
            let mut collected = Vec::new();
            for key in ["text", "content", "html", "caption", "footnote", "latex"] {
                if let Some(value) = map.get(key) {
                    collected.extend(value_strings(value));
                }
            }
            collected
        }
        _ => Vec::new(),
    }
}

fn extract_bbox_position(value: Option<&Value>) -> (f64, f64) {
    let Some(value) = value else {
        return (0.0, 0.0);
    };

    if let Some(parts) = value.as_array() {
        let left = parts.first().and_then(value_f64).unwrap_or(0.0);
        let top = parts.get(1).and_then(value_f64).unwrap_or(0.0);
        return (left, top);
    }

    if let Some(raw) = value.as_str() {
        let numbers = raw
            .split(|ch: char| ch == ',' || ch.is_whitespace())
            .filter(|part| !part.is_empty())
            .filter_map(|part| part.parse::<f64>().ok())
            .collect::<Vec<_>>();
        if numbers.len() >= 2 {
            return (numbers[0], numbers[1]);
        }
    }

    (0.0, 0.0)
}

fn value_string(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn value_i64(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    if let Some(number) = value.as_i64() {
        return Some(number);
    }
    value.as_str()?.trim().parse::<i64>().ok()
}

fn value_f64(value: &Value) -> Option<f64> {
    if let Some(number) = value.as_f64() {
        return Some(number);
    }
    value.as_str()?.trim().parse::<f64>().ok()
}

#[derive(Debug, Clone)]
pub struct Chunk {
    /// 分片的序号
    pub index: usize,
    /// 分片的文本内容
    pub text: String,
    /// 从原文本的起始位置
    pub start_pos: usize,
    /// 在原文本的结束位置
    pub end_pos: usize,
}

impl Chunk {
    /// 估算该分片的tokens数
    #[allow(dead_code)]
    pub fn estimate_tokens(&self, tokens_per_char: f32) -> usize {
        (self.text.len() as f32 * tokens_per_char).ceil() as usize
    }
}

/// 智能文本分片器
pub struct TextChunker {
    config: ChunkingConfig,
}

#[derive(Debug, Clone)]
struct TextUnit {
    text: String,
    protected: bool,
}

impl TextChunker {
    pub fn new(config: ChunkingConfig) -> Self {
        Self { config }
    }

    /// 根据tokens大小分片文本，保留句子边界
    pub fn chunk(&self, text: &str) -> Vec<Chunk> {
        if text.is_empty() {
            return Vec::new();
        }

        let mut chunks = Vec::new();
        let estimated_total_chars = (self.config.max_tokens_per_chunk as f32
            / self.config.tokens_per_char_estimate)
            .ceil() as usize;

        // 确定合理的字符级分片大小
        let target_chunk_chars = estimated_total_chars.max(256);
        let overlap_chars = (self.config.overlap_tokens as f32
            / self.config.tokens_per_char_estimate)
            .ceil() as usize;

        if self.config.preserve_sentences {
            self.chunk_with_sentences(text, target_chunk_chars, overlap_chars, &mut chunks);
        } else {
            self.chunk_by_chars(text, target_chunk_chars, overlap_chars, &mut chunks);
        }

        chunks
    }

    /// 按字符分片（简单方式）
    fn chunk_by_chars(
        &self,
        text: &str,
        chunk_chars: usize,
        overlap_chars: usize,
        chunks: &mut Vec<Chunk>,
    ) {
        let chars: Vec<char> = text.chars().collect();
        let mut start = 0;
        let mut index = 0;

        while start < chars.len() {
            let end = (start + chunk_chars).min(chars.len());
            let chunk_text: String = chars[start..end].iter().collect();
            let start_pos = chars[..start].iter().map(|c| c.len_utf8()).sum();
            let end_pos = chars[..end].iter().map(|c| c.len_utf8()).sum::<usize>();

            chunks.push(Chunk {
                index,
                text: chunk_text,
                start_pos,
                end_pos,
            });

            if end >= chars.len() {
                break;
            }

            start += chunk_chars.saturating_sub(overlap_chars);
            index += 1;
        }
    }

    /// 按句子分片，尝试保留句子边界
    fn chunk_with_sentences(
        &self,
        text: &str,
        chunk_chars: usize,
        _overlap_chars: usize,
        chunks: &mut Vec<Chunk>,
    ) {
        let units = self.split_structural_units(text);
        let mut current_chunk = String::new();
        let mut current_start_pos = 0usize;
        let mut cursor = 0usize;
        let mut index = 0;

        for unit in units {
            let segments = self.segment_unit(&unit, chunk_chars);
            for segment in segments {
                if current_chunk.is_empty() {
                    current_start_pos = cursor;
                }

                let tentative_len = current_chunk.chars().count() + segment.chars().count();
                if !current_chunk.is_empty() && tentative_len > chunk_chars {
                    let end_pos = current_start_pos + current_chunk.len();
                    chunks.push(Chunk {
                        index,
                        text: current_chunk.clone(),
                        start_pos: current_start_pos,
                        end_pos,
                    });
                    index += 1;
                    current_chunk.clear();
                    current_start_pos = cursor;
                }

                current_chunk.push_str(&segment);
                cursor += segment.len();
            }
        }

        // 保存最后一个chunk
        if !current_chunk.is_empty() {
            let end_pos = current_start_pos + current_chunk.len();
            chunks.push(Chunk {
                index,
                text: current_chunk,
                start_pos: current_start_pos,
                end_pos,
            });
        }
    }

    /// 将原文拆成结构化单元，避免拆断表格/图片/公式等内容
    fn split_structural_units(&self, text: &str) -> Vec<TextUnit> {
        let mut units = Vec::new();
        let mut prose = String::new();
        let mut protected = String::new();
        let mut in_fence = false;
        let mut in_math = false;
        let mut in_table = false;
        let mut fence_marker = "";

        for line in text.split_inclusive('\n') {
            let trimmed = line.trim();

            if in_fence {
                protected.push_str(line);
                if trimmed.starts_with(fence_marker) {
                    in_fence = false;
                    fence_marker = "";
                    if !protected.is_empty() {
                        units.push(TextUnit {
                            text: std::mem::take(&mut protected),
                            protected: true,
                        });
                    }
                }
                continue;
            }

            if in_math {
                protected.push_str(line);
                if self.is_math_block_end(trimmed) {
                    in_math = false;
                    if !protected.is_empty() {
                        units.push(TextUnit {
                            text: std::mem::take(&mut protected),
                            protected: true,
                        });
                    }
                }
                continue;
            }

            if in_table {
                if self.is_table_line(trimmed) {
                    protected.push_str(line);
                    continue;
                }

                in_table = false;
                if !protected.is_empty() {
                    units.push(TextUnit {
                        text: std::mem::take(&mut protected),
                        protected: true,
                    });
                }
            }

            if let Some(marker) = self.fence_marker(trimmed) {
                if !prose.is_empty() {
                    units.push(TextUnit {
                        text: std::mem::take(&mut prose),
                        protected: false,
                    });
                }

                in_fence = true;
                fence_marker = marker;
                protected.push_str(line);
                if trimmed.len() > marker.len() && trimmed[marker.len()..].trim().is_empty() {
                    continue;
                }
                if trimmed == marker {
                    continue;
                }
                if trimmed.starts_with(marker)
                    && trimmed.ends_with(marker)
                    && trimmed.len() > marker.len() * 2
                {
                    in_fence = false;
                    fence_marker = "";
                    units.push(TextUnit {
                        text: std::mem::take(&mut protected),
                        protected: true,
                    });
                }
                continue;
            }

            if self.is_math_block_start(trimmed) {
                if !prose.is_empty() {
                    units.push(TextUnit {
                        text: std::mem::take(&mut prose),
                        protected: false,
                    });
                }

                protected.push_str(line);
                if self.is_math_block_end(trimmed) {
                    units.push(TextUnit {
                        text: std::mem::take(&mut protected),
                        protected: true,
                    });
                } else {
                    in_math = true;
                }
                continue;
            }

            if self.is_table_line(trimmed) {
                if !prose.is_empty() {
                    units.push(TextUnit {
                        text: std::mem::take(&mut prose),
                        protected: false,
                    });
                }
                in_table = true;
                protected.push_str(line);
                continue;
            }

            if self.is_image_line(trimmed) {
                if !prose.is_empty() {
                    units.push(TextUnit {
                        text: std::mem::take(&mut prose),
                        protected: false,
                    });
                }
                units.push(TextUnit {
                    text: line.to_string(),
                    protected: true,
                });
                continue;
            }

            prose.push_str(line);
            if trimmed.is_empty() && !prose.is_empty() {
                units.push(TextUnit {
                    text: std::mem::take(&mut prose),
                    protected: false,
                });
            }
        }

        if !protected.is_empty() {
            units.push(TextUnit {
                text: protected,
                protected: true,
            });
        }

        if !prose.is_empty() {
            units.push(TextUnit {
                text: prose,
                protected: false,
            });
        }

        units
    }

    fn segment_unit(&self, unit: &TextUnit, chunk_chars: usize) -> Vec<String> {
        if unit.text.chars().count() <= chunk_chars {
            return vec![unit.text.clone()];
        }

        // 结构化内容优先按换行处切分，普通段落按软边界切分
        if unit.protected {
            return self.split_with_soft_boundaries(&unit.text, chunk_chars, true);
        }

        self.split_with_soft_boundaries(&unit.text, chunk_chars, false)
    }

    fn split_with_soft_boundaries(
        &self,
        text: &str,
        chunk_chars: usize,
        prefer_newline: bool,
    ) -> Vec<String> {
        let chars: Vec<char> = text.chars().collect();
        if chars.len() <= chunk_chars {
            return vec![text.to_string()];
        }

        let mut start = 0usize;
        let mut pieces = Vec::new();
        while start < chars.len() {
            let max_end = (start + chunk_chars).min(chars.len());
            if max_end >= chars.len() {
                pieces.push(chars[start..].iter().collect());
                break;
            }

            let min_end = start + chunk_chars / 2;
            let cut = self
                .find_soft_boundary(&chars, start, max_end, min_end, prefer_newline)
                .unwrap_or(max_end)
                .max(start + 1);

            pieces.push(chars[start..cut].iter().collect());
            start = cut;
        }

        pieces
    }

    fn find_soft_boundary(
        &self,
        chars: &[char],
        start: usize,
        max_end: usize,
        min_end: usize,
        prefer_newline: bool,
    ) -> Option<usize> {
        if max_end <= start + 1 {
            return None;
        }

        let search_start = min_end.min(max_end).max(start + 1);

        if prefer_newline {
            for i in (search_start..max_end).rev() {
                if chars[i - 1] == '\n' && chars[i] == '\n' {
                    return Some(i + 1);
                }
            }
            for i in (search_start..max_end).rev() {
                if chars[i] == '\n' {
                    return Some(i + 1);
                }
            }
        }

        for i in (search_start..max_end).rev() {
            if matches!(chars[i], '。' | '！' | '？' | '.' | '!' | '?' | ';' | '；') {
                return Some(i + 1);
            }
        }

        for i in (search_start..max_end).rev() {
            if chars[i].is_whitespace() {
                return Some(i + 1);
            }
        }

        None
    }

    fn fence_marker<'a>(&self, trimmed: &'a str) -> Option<&'a str> {
        if trimmed.starts_with("```") {
            Some("```")
        } else if trimmed.starts_with("~~~") {
            Some("~~~")
        } else {
            None
        }
    }

    fn is_math_block_start(&self, trimmed: &str) -> bool {
        trimmed == "$$" || trimmed.starts_with("\\[") || trimmed.starts_with("\\begin{")
    }

    fn is_math_block_end(&self, trimmed: &str) -> bool {
        trimmed == "$$" || trimmed.ends_with("\\]") || trimmed.starts_with("\\end{")
    }

    fn is_table_line(&self, trimmed: &str) -> bool {
        if trimmed.is_empty() || trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            return false;
        }

        let bars = trimmed.chars().filter(|ch| *ch == '|').count();
        bars >= 2
    }

    fn is_image_line(&self, trimmed: &str) -> bool {
        trimmed.starts_with("![") || trimmed.contains("![") || trimmed.contains("<img")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_basic_chunking() {
        let text = "这是第一句。这是第二句。这是第三句。";
        let chunker = TextChunker::new(ChunkingConfig::default());
        let chunks = chunker.chunk(text);
        assert!(!chunks.is_empty());
        for chunk in &chunks {
            assert!(!chunk.text.is_empty());
        }
    }

    #[test]
    fn test_empty_text() {
        let text = "";
        let chunker = TextChunker::new(ChunkingConfig::default());
        let chunks = chunker.chunk(text);
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_chunk_indices() {
        let text = "A。B。C。D。E。";
        let chunker = TextChunker::new(ChunkingConfig {
            max_tokens_per_chunk: 64,
            ..Default::default()
        });
        let chunks = chunker.chunk(text);
        for (i, chunk) in chunks.iter().enumerate() {
            assert_eq!(chunk.index, i);
        }
    }

    #[test]
    fn test_protect_markdown_table() {
        let text = "段落A。\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n段落B。";
        let chunker = TextChunker::new(ChunkingConfig {
            max_tokens_per_chunk: 8,
            overlap_tokens: 0,
            preserve_sentences: true,
            tokens_per_char_estimate: 1.0,
        });

        let chunks = chunker.chunk(text);
        let merged = chunks.iter().map(|c| c.text.as_str()).collect::<String>();
        assert_eq!(merged, text);
        assert!(chunks.iter().any(|c| c.text.contains("| A | B |")));
        assert!(chunks.iter().any(|c| c.text.contains("| 1 | 2 |")));
    }

    #[test]
    fn test_protect_formula_and_image_blocks() {
        let text = "前言。\n$$\nE = mc^2\n$$\n\n![img](x.png)\n\n后记。";
        let chunker = TextChunker::new(ChunkingConfig {
            max_tokens_per_chunk: 10,
            overlap_tokens: 0,
            preserve_sentences: true,
            tokens_per_char_estimate: 1.0,
        });

        let chunks = chunker.chunk(text);
        let merged = chunks.iter().map(|c| c.text.as_str()).collect::<String>();
        assert_eq!(merged, text);
        assert!(chunks.iter().any(|c| c.text.contains("E = mc^2")));
        assert!(chunks.iter().any(|c| c.text.contains("![img](x.png)")));
    }

    #[test]
    fn test_prepare_translation_chunks_uses_content_list_partitions() {
        let parsed = json!([
            {
                "page_idx": 0,
                "bbox": [0, 0, 10, 10],
                "type": "text",
                "text": "第一段"
            },
            {
                "page_idx": 0,
                "bbox": [0, 20, 10, 30],
                "type": "text",
                "text": "第二段"
            }
        ])
        .to_string();

        let prepared = prepare_translation_chunks(
            "第一段\n\n第二段",
            Some(&parsed),
            None,
            &ChunkingConfig {
                max_tokens_per_chunk: 64,
                overlap_tokens: 0,
                preserve_sentences: true,
                tokens_per_char_estimate: 1.0,
            },
            TranslationChunkStrategy::ParsedContent,
        );

        assert_eq!(
            prepared.strategy_used,
            TranslationChunkStrategy::ParsedContent
        );
        assert_eq!(prepared.chunks.len(), 2);
        assert!(prepared.chunks[0].text.contains("第一段"));
        assert!(prepared.chunks[1].text.contains("第二段"));
    }

    #[test]
    fn test_prepare_translation_chunks_supports_layout_pdf_info() {
        let layout = json!({
            "pdf_info": [
                {
                    "page_idx": 0,
                    "para_blocks": [
                        {
                            "bbox": [0, 40, 100, 60],
                            "type": "text",
                            "lines": [{ "content": "正文" }]
                        },
                        {
                            "bbox": [0, 0, 100, 20],
                            "type": "title",
                            "lines": [{ "content": "标题" }]
                        }
                    ]
                }
            ]
        })
        .to_string();

        let prepared = prepare_translation_chunks(
            "# 标题\n\n正文",
            Some(&layout),
            None,
            &ChunkingConfig {
                max_tokens_per_chunk: 64,
                overlap_tokens: 0,
                preserve_sentences: true,
                tokens_per_char_estimate: 1.0,
            },
            TranslationChunkStrategy::ParsedContent,
        );

        assert_eq!(
            prepared.strategy_used,
            TranslationChunkStrategy::ParsedContent
        );
        assert_eq!(prepared.chunks.len(), 2);
        assert!(prepared.chunks[0].text.contains("标题"));
        assert!(prepared.chunks[1].text.contains("正文"));
    }

    #[test]
    fn test_prepare_translation_chunks_falls_back_to_token_when_structure_invalid() {
        let prepared = prepare_translation_chunks(
            "Alpha.\n\nBeta.",
            Some("not json"),
            None,
            &ChunkingConfig {
                max_tokens_per_chunk: 64,
                overlap_tokens: 0,
                preserve_sentences: true,
                tokens_per_char_estimate: 1.0,
            },
            TranslationChunkStrategy::ParsedContent,
        );

        assert_eq!(prepared.strategy_used, TranslationChunkStrategy::Token);
        assert_eq!(prepared.chunks.len(), 1);
        assert!(prepared.chunks[0].text.contains("Alpha."));
        assert!(prepared.chunks[0].text.contains("Beta."));
    }
}
