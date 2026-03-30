import { cn } from "@/lib/utils"
import { MarkdownRenderer } from "@/components/shared/MarkdownRenderer"

interface ChatMarkdownProps {
  content: string
  className?: string
  onCodeBlockOpen?: (payload: { code: string; language: string }) => void
  openCodeLabel?: string
}

export function ChatMarkdown({
  content,
  className,
  onCodeBlockOpen,
  openCodeLabel,
}: ChatMarkdownProps) {
  return (
    <MarkdownRenderer
      content={content}
      className={cn("text-sm text-foreground", className)}
      onCodeBlockOpen={onCodeBlockOpen}
      openCodeLabel={openCodeLabel}
    />
  )
}
