import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

interface ChatMarkdownProps {
  content: string
  className?: string
}

const markdownComponents: Components = {
  h1: ({ className, ...props }) => (
    <h1 className={cn("text-lg font-semibold tracking-tight", className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn("text-base font-semibold tracking-tight", className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn("text-sm font-semibold tracking-tight", className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cn("whitespace-pre-wrap break-words", className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn("list-disc space-y-2 pl-5", className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn("list-decimal space-y-2 pl-5", className)} {...props} />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("whitespace-pre-wrap", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "rounded-lg border-l-4 border-border bg-muted px-4 py-3 text-muted-foreground",
        className
      )}
      {...props}
    />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn(
        "underline decoration-border underline-offset-4 transition-colors hover:text-foreground",
        className
      )}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "overflow-x-auto rounded-lg border border-border bg-muted px-4 py-3 text-[13px] leading-6",
        className
      )}
      {...props}
    />
  ),
  code: ({ className, children, ...props }) => {
    const raw = String(children)
    const isBlock = !!className || raw.includes("\n")

    return (
      <code
        className={cn(
          "font-mono text-[13px]",
          isBlock ? "bg-transparent p-0" : "rounded bg-muted px-1.5 py-0.5",
          className
        )}
        {...props}
      >
        {children}
      </code>
    )
  },
  hr: (props) => <hr className="border-border" {...props} />,
  table: ({ className, ...props }) => (
    <div className="overflow-x-auto">
      <table className={cn("min-w-full border-collapse text-sm", className)} {...props} />
    </div>
  ),
  thead: ({ className, ...props }) => <thead className={cn("bg-muted/70", className)} {...props} />,
  th: ({ className, ...props }) => (
    <th className={cn("border border-border px-3 py-2 text-left font-medium", className)} {...props} />
  ),
  td: ({ className, ...props }) => (
    <td className={cn("border border-border px-3 py-2 align-top", className)} {...props} />
  ),
}

export function ChatMarkdown({ content, className }: ChatMarkdownProps) {
  return (
    <div className={cn("space-y-4 text-sm leading-7 text-foreground", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
