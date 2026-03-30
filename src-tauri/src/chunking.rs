/// 分片策略配置
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

    pub fn with_defaults() -> Self {
        Self::new(ChunkingConfig::default())
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
            let end_pos =
                chars[..end].iter().map(|c| c.len_utf8()).sum::<usize>();

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
                if trimmed.starts_with(marker) && trimmed.ends_with(marker) && trimmed.len() > marker.len() * 2 {
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
            let cut = self.find_soft_boundary(&chars, start, max_end, min_end, prefer_newline)
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
        trimmed == "$$"
            || trimmed.starts_with("\\[")
            || trimmed.starts_with("\\begin{")
    }

    fn is_math_block_end(&self, trimmed: &str) -> bool {
        trimmed == "$$"
            || trimmed.ends_with("\\]")
            || trimmed.starts_with("\\end{")
    }

    fn is_table_line(&self, trimmed: &str) -> bool {
        if trimmed.is_empty() || trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            return false;
        }

        let bars = trimmed.chars().filter(|ch| *ch == '|').count();
        bars >= 2
    }

    fn is_image_line(&self, trimmed: &str) -> bool {
        trimmed.starts_with("![")
            || trimmed.contains("![")
            || trimmed.contains("<img")
    }

    /// 按句子分割文本
    fn split_sentences(&self, text: &str) -> Vec<String> {
        // 简单的句子分割：按。！？等标点
        let mut sentences = Vec::new();
        let mut current = String::new();

        for ch in text.chars() {
            current.push(ch);
            if matches!(ch, '。' | '！' | '？' | '.' | '!' | '?') {
                let trimmed = current.trim().to_string();
                if !trimmed.is_empty() {
                    sentences.push(trimmed);
                }
                current.clear();
            }
        }

        if !current.trim().is_empty() {
            sentences.push(current.trim().to_string());
        }

        sentences
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_chunking() {
        let text = "这是第一句。这是第二句。这是第三句。";
        let chunker = TextChunker::with_defaults();
        let chunks = chunker.chunk(text);
        assert!(!chunks.is_empty());
        for chunk in &chunks {
            assert!(!chunk.text.is_empty());
        }
    }

    #[test]
    fn test_empty_text() {
        let text = "";
        let chunker = TextChunker::with_defaults();
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
}
