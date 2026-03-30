import type { ReaderBaseMode } from "@/hooks/useReaderState"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Columns2, FileText, Languages, MessageSquareMore } from "lucide-react"

interface ReaderModeSwitcherProps {
  mode: ReaderBaseMode
  askOpen: boolean
  onModeChange: (mode: ReaderBaseMode) => void
  onAskToggle: () => void
  disabled?: Partial<Record<ReaderBaseMode | "ask", boolean>>
}

const MODE_ITEMS: Array<{
  key: ReaderBaseMode
  label: string
  icon: typeof FileText
  shortcut: string
}> = [
  { key: "original", label: "原文", icon: FileText, shortcut: "1" },
  { key: "translated", label: "翻译", icon: Languages, shortcut: "2" },
  { key: "compare", label: "对照", icon: Columns2, shortcut: "3" },
]

export function ReaderModeSwitcher({
  mode,
  askOpen,
  onModeChange,
  onAskToggle,
  disabled,
}: ReaderModeSwitcherProps) {
  return (
    <div className="desktop-panel flex flex-wrap items-center gap-1 rounded-2xl border border-border/70 p-1.5">
      {MODE_ITEMS.map((item) => {
        const Icon = item.icon
        const active = mode === item.key
        return (
          <Button
            key={item.key}
            variant="ghost"
            size="sm"
            className={cn(
              "rounded-xl px-3 text-xs sm:text-sm",
              active && "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
            )}
            onClick={() => onModeChange(item.key)}
            disabled={disabled?.[item.key]}
          >
            <Icon className="mr-1.5 h-4 w-4" />
            {item.label}
            <span className={cn(
              "ml-2 rounded-md border px-1.5 py-0.5 text-[10px] leading-none",
              active
                ? "border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/90"
                : "border-border bg-background/80 text-muted-foreground"
            )}>
              {item.shortcut}
            </span>
          </Button>
        )
      })}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "rounded-xl px-3 text-xs sm:text-sm",
          askOpen && "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
        )}
        onClick={onAskToggle}
        disabled={disabled?.ask}
      >
        <MessageSquareMore className="mr-1.5 h-4 w-4" />
        提问
        <span className={cn(
          "ml-2 rounded-md border px-1.5 py-0.5 text-[10px] leading-none",
          askOpen
            ? "border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/90"
            : "border-border bg-background/80 text-muted-foreground"
        )}>
          4
        </span>
      </Button>
    </div>
  )
}
