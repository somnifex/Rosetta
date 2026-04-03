import ReactMarkdown from "react-markdown"
import rehypeKatex from "rehype-katex"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { cn } from "@/lib/utils"
import {
  resolveMarkdownAssetPath,
  resolveMarkdownAssetUrl,
} from "@/lib/markdown-assets"

interface MarkdownRendererProps {
  content: string
  className?: string
  assetBaseDir?: string | null
  onCodeBlockOpen?: (payload: { code: string; language: string }) => void
  openCodeLabel?: string
}

export function MarkdownRenderer({
  content,
  className,
  assetBaseDir,
  onCodeBlockOpen,
  openCodeLabel,
}: MarkdownRendererProps) {
  const directUrlPattern = /^[A-Za-z][A-Za-z\d+.-]*:/

  const openLinkTarget = async (target: string) => {
    const isTauri = Boolean(
      (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    )

    if (isTauri) {
      const shell = await import("@tauri-apps/plugin-shell")
      await shell.open(target)
      return
    }

    window.open(target, "_blank", "noopener,noreferrer")
  }

  return (
    <div className={cn("reader-prose prose prose-slate max-w-none dark:prose-invert", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={{
          a({ href, children, ...props }: any) {
            const resolvedHref = resolveMarkdownAssetUrl(href, assetBaseDir) ?? href
            const resolvedPath = resolveMarkdownAssetPath(href, assetBaseDir)
            const openTarget =
              resolvedPath ??
              (typeof resolvedHref === "string" && directUrlPattern.test(resolvedHref)
                ? resolvedHref
                : null)

            if (!openTarget) {
              return (
                <a
                  href={resolvedHref}
                  {...props}
                  onClick={(event) => {
                    event.preventDefault()
                  }}
                >
                  {children}
                </a>
              )
            }

            if (String(openTarget).startsWith("#")) {
              return (
                <a href={resolvedHref} {...props}>
                  {children}
                </a>
              )
            }

            return (
              <a
                href={resolvedHref}
                {...props}
                onClick={(event) => {
                  event.preventDefault()
                  void openLinkTarget(String(openTarget))
                }}
              >
                {children}
              </a>
            )
          },
          img({ src, alt, ...props }: any) {
            const resolvedSrc = resolveMarkdownAssetUrl(src, assetBaseDir) ?? src
            return (
              <span className="reader-figure">
                <img src={resolvedSrc} alt={alt ?? ""} loading="lazy" {...props} />
              </span>
            )
          },
          blockquote({ className, children, ...props }: any) {
            return (
              <blockquote className={cn("reader-callout", className)} {...props}>
                {children}
              </blockquote>
            )
          },
          hr({ className, ...props }: any) {
            return <hr className={cn("reader-rule", className)} {...props} />
          },
          table({ className, children, ...props }: any) {
            return (
              <div className="reader-table-wrap">
                <table className={className} {...props}>
                  {children}
                </table>
              </div>
            )
          },
          code({ inline, className, children, ...props }: any) {
            if (inline) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              )
            }

            if (!onCodeBlockOpen) {
              return (
                <pre className="m-0 max-h-[320px] overflow-auto rounded-2xl border border-border/75 bg-background p-3">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              )
            }

            const match = /language-([\w+-]+)/.exec(className ?? "")
            const language = (match?.[1] ?? "text").toLowerCase()
            const code = String(children ?? "").replace(/\n$/, "")

            return (
              <div className="my-4 overflow-hidden rounded-2xl border border-border/75 bg-background">
                <div className="flex items-center justify-between border-b border-border/70 bg-muted/45 px-3 py-2">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {language}
                  </span>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-background hover:text-foreground"
                    onClick={() => onCodeBlockOpen({ code, language })}
                  >
                    {openCodeLabel ?? "Open in side panel"}
                  </button>
                </div>
                <pre className="m-0 max-h-[320px] overflow-auto p-3">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
