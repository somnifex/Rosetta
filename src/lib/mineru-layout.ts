type BBox = [number, number, number, number]

const DEFAULT_PAGE_WIDTH = 760
const DEFAULT_PAGE_HEIGHT = 1000

export interface MineruLayoutTextFragment {
  type: string
  content: string
}

export interface MineruLayoutTextLine {
  fragments: MineruLayoutTextFragment[]
}

export interface MineruLayoutBlock {
  id: string
  type: string
  bbox: BBox
  lines: MineruLayoutTextLine[]
  html?: string
  imagePath?: string
  discarded?: boolean
}

export interface MineruLayoutPage {
  pageIndex: number
  width: number
  height: number
  blocks: MineruLayoutBlock[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function toStringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function toBBox(value: unknown): BBox | null {
  if (Array.isArray(value) && value.length >= 4) {
    const parts = value
      .slice(0, 4)
      .map((item) => toFiniteNumber(item))

    if (parts.some((item) => item == null)) return null

    return normalizeBBox([
      parts[0] as number,
      parts[1] as number,
      parts[2] as number,
      parts[3] as number,
    ])
  }

  if (typeof value === "string") {
    const parts = value
      .trim()
      .split(/[,\s]+/)
      .map((item) => Number(item))

    if (parts.length < 4 || parts.slice(0, 4).some((item) => !Number.isFinite(item))) {
      return null
    }

    return normalizeBBox([parts[0], parts[1], parts[2], parts[3]])
  }

  return null
}

function normalizeBBox([x0, y0, x1, y1]: BBox): BBox {
  const left = Math.min(x0, x1)
  const top = Math.min(y0, y1)
  const right = Math.max(x0, x1, left + 1)
  const bottom = Math.max(y0, y1, top + 1)
  return [left, top, right, bottom]
}

function scaleBBox([x0, y0, x1, y1]: BBox, scaleX: number, scaleY: number): BBox {
  return normalizeBBox([x0 * scaleX, y0 * scaleY, x1 * scaleX, y1 * scaleY])
}

function linesFromText(text: string | null | undefined, fragmentType = "text"): MineruLayoutTextLine[] {
  if (typeof text !== "string" || text.length === 0) return []

  return text.split(/\r?\n/).map((line) => ({
    fragments: [{ type: fragmentType, content: line }],
  }))
}

function linesFromStringArray(value: unknown, fragmentType = "text"): MineruLayoutTextLine[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => linesFromText(toStringValue(item), fragmentType))
}

function findFirstStringByKeys(value: unknown, keys: readonly string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstStringByKeys(item, keys)
      if (found) return found
    }
    return undefined
  }

  if (!isRecord(value)) return undefined

  for (const key of keys) {
    const direct = toStringValue(value[key])
    if (direct) return direct
  }

  for (const child of Object.values(value)) {
    const found = findFirstStringByKeys(child, keys)
    if (found) return found
  }

  return undefined
}

function extractLinesFromLayoutBlock(block: Record<string, unknown>) {
  const lines = Array.isArray(block.lines) ? block.lines : []
  const normalized: MineruLayoutTextLine[] = []

  for (const line of lines) {
    if (typeof line === "string") {
      normalized.push(...linesFromText(line))
      continue
    }

    if (!isRecord(line)) continue

    const spans = Array.isArray(line.spans) ? line.spans : []
    const fragments = spans.flatMap((span) => {
      if (!isRecord(span)) return []
      const content = toStringValue(span.content)
      if (!content) return []
      const type = toStringValue(span.type) ?? "text"
      return [{ type, content }]
    })

    if (fragments.length > 0) {
      normalized.push({ fragments })
      continue
    }

    const lineContent = toStringValue(line.content)
    if (lineContent) {
      normalized.push(...linesFromText(lineContent))
    }
  }

  if (normalized.length > 0) return normalized

  const blockContent = toStringValue(block.content)
  if (blockContent) return linesFromText(blockContent)

  const blockText = toStringValue(block.text)
  if (blockText) return linesFromText(blockText)

  return []
}

function normalizeLayoutLeaf(
  block: Record<string, unknown>,
  pageIndex: number,
  key: string,
  discarded = false
): MineruLayoutBlock | null {
  const bbox = toBBox(block.bbox)
  if (!bbox) return null

  const type = toStringValue(block.type) ?? "text"
  const lines = extractLinesFromLayoutBlock(block)
  const html = findFirstStringByKeys(block, ["html"])
  const imagePath = findFirstStringByKeys(block, ["image_path", "img_path"])

  return {
    id: `p${pageIndex}-${key}`,
    type,
    bbox,
    lines,
    html: html ?? undefined,
    imagePath: imagePath ?? undefined,
    discarded,
  }
}

function normalizeLayoutBlocks(
  blocks: unknown,
  pageIndex: number,
  discarded = false,
  prefix = "block"
): MineruLayoutBlock[] {
  if (!Array.isArray(blocks)) return []

  return blocks.flatMap((block, blockIndex) => {
    if (!isRecord(block)) return []

    const nestedBlocks = Array.isArray(block.blocks) ? block.blocks : []
    const key = `${prefix}-${blockIndex}`

    if (nestedBlocks.length > 0) {
      return normalizeLayoutBlocks(nestedBlocks, pageIndex, discarded, key)
    }

    const normalized = normalizeLayoutLeaf(block, pageIndex, key, discarded)
    return normalized ? [normalized] : []
  })
}

function parseLayoutJson(value: unknown): MineruLayoutPage[] | null {
  if (!isRecord(value) || !Array.isArray(value.pdf_info)) return null

  const pages = value.pdf_info.flatMap((page, pageOrder) => {
    if (!isRecord(page)) return []

    const size = Array.isArray(page.page_size) ? page.page_size : []
    const width = toFiniteNumber(size[0]) ?? DEFAULT_PAGE_WIDTH
    const height = toFiniteNumber(size[1]) ?? DEFAULT_PAGE_HEIGHT
    const pageIndex = toFiniteNumber(page.page_idx) ?? pageOrder
    const blocks = [
      ...normalizeLayoutBlocks(page.para_blocks, pageIndex, false, "content"),
      ...normalizeLayoutBlocks(page.discarded_blocks, pageIndex, true, "discarded"),
    ].sort(compareBlocks)

    return [{ pageIndex, width, height, blocks }]
  })

  return pages.length > 0 ? pages : null
}

function compareBlocks(left: MineruLayoutBlock, right: MineruLayoutBlock) {
  const deltaTop = left.bbox[1] - right.bbox[1]
  if (Math.abs(deltaTop) > 1) return deltaTop

  const deltaLeft = left.bbox[0] - right.bbox[0]
  if (Math.abs(deltaLeft) > 1) return deltaLeft

  return left.id.localeCompare(right.id)
}

function normalizeContentListItem(
  value: Record<string, unknown>,
  pageIndex: number,
  key: string
): MineruLayoutBlock | null {
  const rawBBox = toBBox(value.bbox)
  if (!rawBBox) return null

  const rawType = toStringValue(value.type) ?? "text"
  const textLevel = toFiniteNumber(value.text_level)
  const type = rawType === "text" && textLevel != null && textLevel > 0 ? "title" : rawType
  const bbox = scaleBBox(rawBBox, DEFAULT_PAGE_WIDTH / 1000, DEFAULT_PAGE_HEIGHT / 1000)

  let lines: MineruLayoutTextLine[] = []
  if (type === "list") {
    lines = linesFromStringArray(value.list_items)
  } else if (type === "image") {
    lines = [
      ...linesFromStringArray(value.image_caption),
      ...linesFromStringArray(value.image_footnote),
    ]
  } else if (type === "table") {
    lines = [
      ...linesFromStringArray(value.table_caption),
      ...linesFromStringArray(value.table_footnote),
    ]
  } else {
    lines = linesFromText(toStringValue(value.text))
  }

  return {
    id: `p${pageIndex}-${key}`,
    type,
    bbox,
    lines,
    html: toStringValue(value.table_body) ?? undefined,
    imagePath: toStringValue(value.img_path) ?? undefined,
    discarded: type === "header" || type === "footer",
  }
}

function parseContentList(value: unknown): MineruLayoutPage[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  if (!value.every((item) => isRecord(item) && toFiniteNumber(item.page_idx) != null && toBBox(item.bbox))) {
    return null
  }

  const pageMap = new Map<number, MineruLayoutBlock[]>()

  value.forEach((item, index) => {
    if (!isRecord(item)) return
    const pageIndex = toFiniteNumber(item.page_idx) ?? 0
    const normalized = normalizeContentListItem(item, pageIndex, `content-${index}`)
    if (!normalized) return

    const bucket = pageMap.get(pageIndex)
    if (bucket) {
      bucket.push(normalized)
      return
    }

    pageMap.set(pageIndex, [normalized])
  })

  if (pageMap.size === 0) return null

  return Array.from(pageMap.entries())
    .sort(([left], [right]) => left - right)
    .map(([pageIndex, blocks]) => ({
      pageIndex,
      width: DEFAULT_PAGE_WIDTH,
      height: DEFAULT_PAGE_HEIGHT,
      blocks: blocks.sort(compareBlocks),
    }))
}

export function parseMineruLayout(rawJson: string | null | undefined) {
  if (typeof rawJson !== "string" || !rawJson.trim()) return null

  try {
    const parsed = JSON.parse(rawJson) as unknown
    return parseLayoutJson(parsed) ?? parseContentList(parsed)
  } catch {
    return null
  }
}
