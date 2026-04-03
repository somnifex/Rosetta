import { useCallback } from "react"
import type { CSSProperties, Ref, UIEventHandler } from "react"
import { resolveMarkdownAssetUrl } from "@/lib/markdown-assets"
import type {
  MineruLayoutBlock,
  MineruLayoutPage,
  MineruLayoutTextFragment,
  MineruLayoutTextLine,
} from "@/lib/mineru-layout"
import { cn } from "@/lib/utils"

const BASE_PAGE_SCALE = 1.42

interface MineruLayoutViewerProps {
  pages: MineruLayoutPage[]
  onTextSelect?: (text: string) => void
  textScale?: number
  assetBaseDir?: string | null
  containerRef?: Ref<HTMLDivElement>
  onScroll?: UIEventHandler<HTMLDivElement>
  className?: string
}

function resolveMineruAssetUrl(rawPath: string | undefined, assetBaseDir?: string | null) {
  if (!rawPath) return null

  const normalized = rawPath.trim()
  if (!normalized) return null

  const candidates =
    normalized.includes("/") || normalized.includes("\\")
      ? [normalized]
      : [`images/${normalized}`, normalized]

  for (const candidate of candidates) {
    const resolved = resolveMarkdownAssetUrl(candidate, assetBaseDir)
    if (resolved) return resolved
  }

  return null
}

function normalizeMineruText(text: string) {
  return text
    .replace(/\$/g, "")
    .replace(/\\\(/g, "")
    .replace(/\\\)/g, "")
    .replace(/\\%/g, "%")
    .replace(/\\cdot/g, "*")
    .replace(/\\times/g, "x")
    .replace(/\\pm/g, "+/-")
    .replace(/\\leq/g, "<=")
    .replace(/\\geq/g, ">=")
    .replace(/\\rightarrow/g, "->")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\&/g, "&")
}

function renderFragment(fragment: MineruLayoutTextFragment, key: string) {
  const normalized = normalizeMineruText(fragment.content)
  const trimmed = normalized.trim()

  const superscript = trimmed.match(/^\^\{(.+)\}$/)
  if (superscript) {
    return (
      <sup key={key} className="mineru-layout-inline-equation">
        {normalizeMineruText(superscript[1])}
      </sup>
    )
  }

  const subscript = trimmed.match(/^_\{(.+)\}$/)
  if (subscript) {
    return (
      <sub key={key} className="mineru-layout-inline-equation">
        {normalizeMineruText(subscript[1])}
      </sub>
    )
  }

  return (
    <span
      key={key}
      className={fragment.type.includes("equation") ? "mineru-layout-inline-equation" : undefined}
    >
      {normalized}
    </span>
  )
}

function renderLines(lines: MineruLayoutTextLine[]) {
  return lines.map((line, lineIndex) => (
    <p key={lineIndex} className="mineru-layout-line">
      {line.fragments.map((fragment, fragmentIndex) =>
        renderFragment(fragment, `${lineIndex}-${fragmentIndex}`)
      )}
    </p>
  ))
}

function getBlockFontStyle(block: MineruLayoutBlock): CSSProperties {
  if (block.type === "title") {
    return { fontSize: "17px", lineHeight: 1.18, fontWeight: 600 }
  }

  if (block.type === "header" || block.type === "footer") {
    return { fontSize: "8.7px", lineHeight: 1.2 }
  }

  if (block.type.endsWith("_caption") || block.type === "ref_text") {
    return { fontSize: "9.7px", lineHeight: 1.28 }
  }

  return { fontSize: "11.1px", lineHeight: 1.3 }
}

function getBlockZIndex(block: MineruLayoutBlock) {
  if (block.type === "header" || block.type === "footer") return 1
  if (block.type.endsWith("_body")) return 2
  if (block.type.endsWith("_caption")) return 5
  if (block.type === "image" || block.type === "table") return 3
  return 4
}

function renderBlock(block: MineruLayoutBlock, assetBaseDir?: string | null) {
  const [x0, y0, x1, y1] = block.bbox
  const width = Math.max(1, x1 - x0)
  const height = Math.max(1, y1 - y0)
  const imageUrl = resolveMineruAssetUrl(block.imagePath, assetBaseDir)
  const hasMedia = Boolean(imageUrl || block.html)
  const isMediaBlock = hasMedia && (block.type.includes("image") || block.type.includes("table"))

  const style: CSSProperties = {
    left: `${x0}px`,
    top: `${y0}px`,
    width: `${width}px`,
    height: `${height}px`,
    zIndex: getBlockZIndex(block),
    ...getBlockFontStyle(block),
  }

  if (isMediaBlock) {
    return (
      <div
        key={block.id}
        className={cn(
          "mineru-layout-block mineru-layout-media-block absolute",
          block.type === "header" || block.type === "footer" ? "mineru-layout-chrome" : undefined
        )}
        style={style}
      >
        {imageUrl ? (
          <div className="mineru-layout-media-shell">
            <img src={imageUrl} alt="" loading="lazy" className="mineru-layout-media" />
          </div>
        ) : block.html ? (
          <div className="mineru-layout-html" dangerouslySetInnerHTML={{ __html: block.html }} />
        ) : null}

        {block.lines.length > 0 ? (
          <div className="mineru-layout-caption-copy">{renderLines(block.lines)}</div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      key={block.id}
      className={cn(
        "mineru-layout-block absolute overflow-hidden",
        block.type === "title" ? "mineru-layout-title" : undefined,
        block.type === "header" || block.type === "footer" ? "mineru-layout-chrome" : undefined,
        block.type.endsWith("_caption") || block.type === "ref_text"
          ? "mineru-layout-caption"
          : undefined,
        block.discarded ? "mineru-layout-discarded" : undefined
      )}
      style={style}
    >
      {renderLines(block.lines)}
    </div>
  )
}

export function MineruLayoutViewer({
  pages,
  onTextSelect,
  textScale = 1,
  assetBaseDir,
  containerRef,
  onScroll,
  className,
}: MineruLayoutViewerProps) {
  const handleMouseUp = useCallback(() => {
    if (!onTextSelect) return
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (text) onTextSelect(text)
  }, [onTextSelect])

  const zoom = Math.max(0.6, BASE_PAGE_SCALE * textScale)

  return (
    <div
      ref={containerRef}
      className={cn(
        "reader-doc-surface mineru-layout-surface flex-1 overflow-auto px-4 py-6 sm:px-6 lg:px-10",
        className
      )}
      onMouseUp={handleMouseUp}
      onScroll={onScroll}
    >
      <div className="mineru-layout-stack mx-auto flex min-w-full w-max flex-col items-center gap-6">
        {pages.map((page) => {
          const width = Math.round(page.width * zoom)
          const height = Math.round(page.height * zoom)

          return (
            <section
              key={page.pageIndex}
              className="mineru-layout-page-group flex flex-col gap-2"
              style={{ width: `${width}px` }}
            >
              <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
                <span className="rounded-full border border-border/70 bg-background/75 px-2.5 py-1 shadow-sm backdrop-blur">
                  Page {page.pageIndex + 1}
                </span>
              </div>

              <div
                className="reader-paper mineru-layout-page relative overflow-hidden rounded-[28px] border border-border/70"
                style={{ width: `${width}px`, height: `${height}px` }}
              >
                <div
                  className="mineru-layout-page-canvas absolute left-0 top-0"
                  style={{
                    width: `${page.width}px`,
                    height: `${page.height}px`,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                >
                  {page.blocks.map((block) => renderBlock(block, assetBaseDir))}
                </div>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
