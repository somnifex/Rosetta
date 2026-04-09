import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, Ref, UIEventHandler } from "react"
import {
  resolveMarkdownAssetPath,
  resolveMarkdownAssetUrl,
} from "@/lib/markdown-assets"
import { clamp } from "@/lib/utils"
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

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

function getMediaAssetCandidates(rawPath: string | undefined) {
  if (!rawPath) return []

  const normalized = rawPath.trim().replace(/\\/g, "/")
  if (!normalized) return []

  const stripped = normalized.replace(/^\.?\//, "")
  const withoutImagesPrefix = stripped.replace(/^images\//, "")
  const basename = stripped.split("/").pop() ?? stripped

  return uniqueStrings([
    normalized,
    stripped,
    stripped.startsWith("images/") ? withoutImagesPrefix : `images/${stripped}`,
    basename ? `images/${basename}` : null,
    basename,
  ])
}

function resolveMineruAssetUrls(rawPath: string | undefined, assetBaseDir?: string | null) {
  return uniqueStrings(
    getMediaAssetCandidates(rawPath).flatMap((candidate) => {
      const url = resolveMarkdownAssetUrl(candidate, assetBaseDir)
      const absolutePath = resolveMarkdownAssetPath(candidate, assetBaseDir)
      return [url, absolutePath ? resolveMarkdownAssetUrl(absolutePath, assetBaseDir) : null]
    })
  )
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

function getBaseTextStyle(block: MineruLayoutBlock): CSSProperties {
  if (block.type === "title") {
    return { fontSize: "17px", lineHeight: 1.16, fontWeight: 600, letterSpacing: "-0.03em" }
  }

  if (block.type === "header" || block.type === "footer") {
    return { fontSize: "8.7px", lineHeight: 1.18 }
  }

  if (block.type.endsWith("_caption") || block.type === "ref_text") {
    return { fontSize: "9.8px", lineHeight: 1.24 }
  }

  return { fontSize: "11.1px", lineHeight: 1.22 }
}

function getBlockZIndex(block: MineruLayoutBlock) {
  if (block.type === "header" || block.type === "footer") return 1
  if (block.type.endsWith("_body")) return 2
  if (block.type.endsWith("_caption")) return 5
  if (block.type === "image" || block.type === "table") return 3
  return 4
}

function MineruImage({
  imagePath,
  assetBaseDir,
}: {
  imagePath?: string
  assetBaseDir?: string | null
}) {
  const urls = useMemo(() => resolveMineruAssetUrls(imagePath, assetBaseDir), [imagePath, assetBaseDir])
  const urlsKey = urls.join("\n")
  const [currentIndex, setCurrentIndex] = useState(0)
  const [hasFailed, setHasFailed] = useState(false)

  useEffect(() => {
    setCurrentIndex(0)
    setHasFailed(false)
  }, [urlsKey])

  const currentUrl = urls[currentIndex]

  if (!currentUrl || hasFailed) {
    return (
      <div className="mineru-layout-media-placeholder">
        <span className="mineru-layout-media-badge">Image unavailable</span>
        {imagePath ? <span className="mineru-layout-media-path">{imagePath}</span> : null}
      </div>
    )
  }

  return (
    <img
      src={currentUrl}
      alt=""
      loading="lazy"
      decoding="async"
      className="mineru-layout-media"
      onError={() => {
        if (currentIndex < urls.length - 1) {
          setCurrentIndex((value) => value + 1)
          return
        }
        setHasFailed(true)
      }}
    />
  )
}

function FittedTextBlock({
  block,
  width,
  height,
  style,
}: {
  block: MineruLayoutBlock
  width: number
  height: number
  style: CSSProperties
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const element = innerRef.current
    if (!element) return

    const nextFrame = window.requestAnimationFrame(() => {
      const naturalWidth = element.scrollWidth
      const naturalHeight = element.scrollHeight

      if (!naturalWidth || !naturalHeight) {
        if (scale !== 1) setScale(1)
        return
      }

      const widthRatio = width / naturalWidth
      const heightRatio = height / naturalHeight
      const nextScale = Math.min(1, widthRatio, heightRatio)
      const clamped = Number.isFinite(nextScale) ? clamp(nextScale, 0.48, 1) : 1

      if (Math.abs(clamped - scale) > 0.01) {
        setScale(clamped)
      }
    })

    return () => window.cancelAnimationFrame(nextFrame)
  }, [block.id, block.lines, width, height, scale])

  return (
    <div
      className={cn(
        "mineru-layout-block mineru-layout-text-block absolute overflow-hidden",
        block.type === "title" ? "mineru-layout-title" : undefined,
        block.type === "header" || block.type === "footer" ? "mineru-layout-chrome" : undefined,
        block.type.endsWith("_caption") || block.type === "ref_text"
          ? "mineru-layout-caption"
          : undefined,
        block.discarded ? "mineru-layout-discarded" : undefined
      )}
      style={style}
    >
      <div
        ref={innerRef}
        className="mineru-layout-text-inner"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          ...getBaseTextStyle(block),
        }}
      >
        {renderLines(block.lines)}
      </div>
    </div>
  )
}

function renderBlock(block: MineruLayoutBlock, assetBaseDir?: string | null) {
  const [x0, y0, x1, y1] = block.bbox
  const width = Math.max(1, x1 - x0)
  const height = Math.max(1, y1 - y0)
  const hasMedia = Boolean(block.imagePath || block.html)
  const isMediaBlock = hasMedia && (block.type.includes("image") || block.type.includes("table"))

  const style: CSSProperties = {
    left: `${x0}px`,
    top: `${y0}px`,
    width: `${width}px`,
    height: `${height}px`,
    zIndex: getBlockZIndex(block),
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
        {block.html ? (
          <div className="mineru-layout-html" dangerouslySetInnerHTML={{ __html: block.html }} />
        ) : (
          <div className="mineru-layout-media-shell">
            <MineruImage imagePath={block.imagePath} assetBaseDir={assetBaseDir} />
          </div>
        )}

        {block.lines.length > 0 ? (
          <div className="mineru-layout-caption-copy">{renderLines(block.lines)}</div>
        ) : null}
      </div>
    )
  }

  return (
    <FittedTextBlock
      key={block.id}
      block={block}
      width={width}
      height={height}
      style={style}
    />
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
