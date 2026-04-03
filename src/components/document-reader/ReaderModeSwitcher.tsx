import type { ReaderBaseMode } from "@/hooks/useReaderState"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Columns2, FileText, Languages, MessageSquareMore } from "lucide-react"

interface ReaderModeSwitcherProps {
  mode: ReaderBaseMode
  askOpen: boolean
  onModeChange: (mode: ReaderBaseMode) => void
  onAskToggle: () => void
  disabled?: Partial<Record<ReaderBaseMode | "ask", boolean>>
  className?: string
}

export function ReaderModeSwitcher({
  mode,
  askOpen,
  onModeChange,
  onAskToggle,
  disabled,
  className,
}: ReaderModeSwitcherProps) {
  const { t } = useTranslation("document")
  const MODE_ITEMS: Array<{
    key: ReaderBaseMode
    label: string
    icon: typeof FileText
    shortcut: string
  }> = [
    { key: "original", label: t("reader.modes.original"), icon: FileText, shortcut: "1" },
    { key: "translated", label: t("reader.modes.translated"), icon: Languages, shortcut: "2" },
    { key: "compare", label: t("reader.modes.compare"), icon: Columns2, shortcut: "3" },
  ]

  return (
    <div className={cn("desktop-panel grid grid-cols-4 items-center gap-1 rounded-2xl border border-border/70 p-1.5", className)}>
      {MODE_ITEMS.map((item) => {
        const Icon = item.icon
        const active = mode === item.key
        return (
          <Button
            key={item.key}
            variant="ghost"
            size="sm"
            className={cn(
              "min-w-0 w-full justify-center rounded-xl px-3 text-xs sm:text-sm",
              active && "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
            )}
            onClick={() => onModeChange(item.key)}
            disabled={disabled?.[item.key]}
          >
            <span className="flex min-w-0 items-center justify-center">
              <Icon className="mr-1.5 h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </span>
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
          "min-w-0 w-full justify-center rounded-xl px-3 text-xs sm:text-sm",
          askOpen && "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
        )}
        onClick={onAskToggle}
        disabled={disabled?.ask}
      >
        <span className="flex min-w-0 items-center justify-center">
          <MessageSquareMore className="mr-1.5 h-4 w-4 shrink-0" />
          <span className="truncate">{t("reader.modes.ask")}</span>
        </span>
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
