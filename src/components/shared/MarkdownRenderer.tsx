import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

interface MarkdownRendererProps {
  content: string
  className?: string
  onCodeBlockOpen?: (payload: { code: string; language: string }) => void
  openCodeLabel?: string
}

export function MarkdownRenderer({
  content,
  className,
  onCodeBlockOpen,
  openCodeLabel,
}: MarkdownRendererProps) {
  return (
    <div className={cn("reader-prose prose prose-slate max-w-none dark:prose-invert", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={
          onCodeBlockOpen
            ? {
                code({ inline, className, children, ...props }: any) {
                  if (inline) {
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
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
              }
            : undefined
        }
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}