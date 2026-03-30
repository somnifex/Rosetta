import { cn } from "@/lib/utils"
import { MarkdownRenderer } from "@/components/shared/MarkdownRenderer"

interface ChatMarkdownProps {
  content: string
  className?: string
}

export function ChatMarkdown({ content, className }: ChatMarkdownProps) {
  return (
    <MarkdownRenderer
      content={content}
      className={cn("text-sm text-foreground", className)}
    />
  )
}
