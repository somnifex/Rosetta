use std::cmp::Ordering;

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
        overlap_chars: usize,
        chunks: &mut Vec<Chunk>,
    ) {
        let sentences = self.split_sentences(text);
        let mut current_chunk = String::new();
        let mut current_start_pos = 0;
        let mut index = 0;

        for (i, sentence) in sentences.iter().enumerate() {
            let tentative_len = current_chunk.len() + sentence.len();

            match tentative_len.cmp(&chunk_chars) {
                Ordering::Less | Ordering::Equal => {
                    if i > 0 && !current_chunk.is_empty() {
                        current_chunk.push(' ');
                    }
                    current_chunk.push_str(sentence);
                }
                Ordering::Greater => {
                    // 当前chunk已满，保存并开始新chunk
                    if !current_chunk.is_empty() {
                        let end_pos = current_start_pos + current_chunk.len();
                        chunks.push(Chunk {
                            index,
                            text: current_chunk.clone(),
                            start_pos: current_start_pos,
                            end_pos,
                        });
                        index += 1;

                        // 计算重叠部分
                        let overlap_start = end_pos.saturating_sub(overlap_chars);
                        let overlap_text = &chunks[index - 1].text;
                        let overlap = if overlap_start < end_pos {
                            let skip_chars = (end_pos - overlap_start) / 2;
                            if skip_chars < overlap_text.len() {
                                overlap_text[overlap_text.len() - skip_chars..].to_string()
                            } else {
                                String::new()
                            }
                        } else {
                            String::new()
                        };

                        current_start_pos = overlap_start;
                        current_chunk = overlap;
                    }
                    current_chunk.push_str(sentence);
                }
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
}
