import type {
  MineruLayoutBlock,
  MineruLayoutPage,
  MineruLayoutTextLine,
} from "@/lib/mineru-layout"

const NON_TRANSLATABLE_BLOCK_TYPES = new Set(["header", "footer"])

interface MarkdownSegment {
  raw: string
  weight: number
}

function linesFromText(text: string): MineruLayoutTextLine[] {
  if (!text.trim()) return []

  return text.split(/\r?\n/).map((line) => ({
    fragments: [{ type: "text", content: line }],
  }))
}

function getBlockText(block: MineruLayoutBlock) {
  return block.lines
    .map((line) => line.fragments.map((fragment) => fragment.content).join(""))
    .join("\n")
    .trim()
}

function isFenceStart(trimmed: string) {
  if (trimmed.startsWith("```")) return "```"
  if (trimmed.startsWith("~~~")) return "~~~"
  return null
}

function isMathBlockStart(trimmed: string) {
  return trimmed === "$$" || trimmed.startsWith("\\[") || trimmed.startsWith("\\begin{")
}

function isMathBlockEnd(trimmed: string) {
  return trimmed === "$$" || trimmed.endsWith("\\]") || trimmed.startsWith("\\end{")
}

function isMarkdownTableLine(trimmed: string) {
  if (!trimmed) return false
  const pipeCount = [...trimmed].filter((char) => char === "|").length
  return pipeCount >= 2
}

function splitMarkdownSegments(markdown: string): MarkdownSegment[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const segments: string[] = []
  let buffer: string[] = []
  let inFence = false
  let fenceMarker = ""
  let inMath = false

  const flush = () => {
    const raw = buffer.join("\n").trim()
    if (raw) segments.push(raw)
    buffer = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (inFence) {
      buffer.push(line)
      if (trimmed.startsWith(fenceMarker)) {
        inFence = false
        fenceMarker = ""
        flush()
      }
      continue
    }

    if (inMath) {
      buffer.push(line)
      if (isMathBlockEnd(trimmed)) {
        inMath = false
        flush()
      }
      continue
    }

    const fence = isFenceStart(trimmed)
    if (fence) {
      flush()
      buffer.push(line)
      if (trimmed !== fence && trimmed.endsWith(fence)) {
        flush()
      } else {
        inFence = true
        fenceMarker = fence
      }
      continue
    }

    if (isMathBlockStart(trimmed)) {
      flush()
      buffer.push(line)
      if (isMathBlockEnd(trimmed)) {
        flush()
      } else {
        inMath = true
      }
      continue
    }

    if (!trimmed) {
      flush()
      continue
    }

    if (isMarkdownTableLine(trimmed) && buffer.length > 0) {
      const currentIsTable = buffer.every((entry) => isMarkdownTableLine(entry.trim()))
      if (!currentIsTable) {
        flush()
      }
    }

    buffer.push(line)
  }

  flush()

  return segments.map((raw) => ({
    raw,
    weight: Math.max(normalizeMarkdownToText(raw).replace(/\s+/g, "").length, 1),
  }))
}

function normalizeMarkdownToText(markdown: string) {
  let normalized = markdown.replace(/\r\n/g, "\n")

  normalized = normalized.replace(/^```[^\n]*$/gm, "")
  normalized = normalized.replace(/^~~~[^\n]*$/gm, "")
  normalized = normalized.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
  normalized = normalized.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  normalized = normalized.replace(/<[^>]+>/g, " ")
  normalized = normalized.replace(/^#{1,6}\s+/gm, "")
  normalized = normalized.replace(/^>\s?/gm, "")
  normalized = normalized.replace(/^[-*+]\s+/gm, "")
  normalized = normalized.replace(/^\d+\.\s+/gm, "")
  normalized = normalized.replace(/^\|/gm, "")
  normalized = normalized.replace(/\|$/gm, "")
  normalized = normalized.replace(/^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/gm, "")
  normalized = normalized.replace(/[*_~`]/g, "")
  normalized = normalized.replace(/[ \t]+\n/g, "\n")
  normalized = normalized.replace(/\n{3,}/g, "\n\n")

  return normalized.trim()
}

function isTranslatableBlock(block: MineruLayoutBlock) {
  if (block.discarded || NON_TRANSLATABLE_BLOCK_TYPES.has(block.type)) return false
  return Boolean(getBlockText(block) || block.html || block.imagePath)
}

function getBlockWeight(block: MineruLayoutBlock) {
  const text = getBlockText(block)
  if (text) {
    return Math.max(normalizeMarkdownToText(text).replace(/\s+/g, "").length, 1)
  }

  if (block.html) return 120
  if (block.imagePath) return 36
  return 1
}

function clearTranslatedBlock(block: MineruLayoutBlock): MineruLayoutBlock {
  if (block.imagePath) {
    return {
      ...block,
      lines: [],
      html: undefined,
    }
  }

  return {
    ...block,
    lines: [],
    html: undefined,
    imagePath: undefined,
  }
}

function looksLikeTableContent(raw: string) {
  return raw.includes("<table") || raw.split("\n").filter((line) => isMarkdownTableLine(line.trim())).length >= 2
}

function applyTranslatedSegment(block: MineruLayoutBlock, raw: string): MineruLayoutBlock {
  const normalizedText = normalizeMarkdownToText(raw)

  if (block.imagePath) {
    return {
      ...block,
      html: undefined,
      lines: linesFromText(normalizedText),
    }
  }

  if (block.html) {
    if (looksLikeTableContent(raw) || normalizedText.length > 220) {
      return {
        ...block,
        html: undefined,
        imagePath: undefined,
        lines: linesFromText(normalizedText),
      }
    }

    return {
      ...block,
      lines: linesFromText(normalizedText),
    }
  }

  return {
    ...block,
    html: undefined,
    imagePath: undefined,
    lines: linesFromText(normalizedText),
  }
}

export function buildTranslatedLayoutPages(
  sourcePages: MineruLayoutPage[] | null | undefined,
  translatedMarkdown: string | null | undefined
) {
  if (!sourcePages?.length || !translatedMarkdown?.trim()) return null

  const segments = splitMarkdownSegments(translatedMarkdown)
  const blocks = sourcePages.flatMap((page) => page.blocks.filter(isTranslatableBlock))

  if (!segments.length || !blocks.length) return null
  if (segments.length === 1 && blocks.length > 8) return null
  if (blocks.length > segments.length * 10 || segments.length > blocks.length * 8) return null

  const totalBlockWeight = blocks.reduce((sum, block) => sum + getBlockWeight(block), 0)
  const totalSegmentWeight = segments.reduce((sum, segment) => sum + segment.weight, 0)

  if (totalBlockWeight <= 0 || totalSegmentWeight <= 0) return null

  const assignments = new Map<string, string>()
  let segmentIndex = 0
  let consumedSegmentWeight = 0
  let consumedBlockWeight = 0

  for (const block of blocks) {
    const blockWeight = getBlockWeight(block)
    const targetSegmentWeight =
      (totalSegmentWeight * (consumedBlockWeight + blockWeight)) / totalBlockWeight
    const assigned: string[] = []

    while (
      segmentIndex < segments.length &&
      (consumedSegmentWeight < targetSegmentWeight || assigned.length === 0)
    ) {
      const segment = segments[segmentIndex]
      assigned.push(segment.raw)
      consumedSegmentWeight += segment.weight
      segmentIndex += 1
    }

    if (assigned.length > 0) {
      assignments.set(block.id, assigned.join("\n\n"))
    }

    consumedBlockWeight += blockWeight
  }

  if (segmentIndex < segments.length && blocks.length > 0) {
    const lastBlock = blocks[blocks.length - 1]
    const current = assignments.get(lastBlock.id)
    const remaining = segments.slice(segmentIndex).map((segment) => segment.raw).join("\n\n")
    assignments.set(lastBlock.id, current ? `${current}\n\n${remaining}` : remaining)
  }

  return sourcePages.map((page) => ({
    ...page,
    blocks: page.blocks.map((block) => {
      if (block.discarded || NON_TRANSLATABLE_BLOCK_TYPES.has(block.type)) {
        return clearTranslatedBlock(block)
      }

      const assigned = assignments.get(block.id)
      if (!assigned) {
        return clearTranslatedBlock(block)
      }

      return applyTranslatedSegment(block, assigned)
    }),
  }))
}
