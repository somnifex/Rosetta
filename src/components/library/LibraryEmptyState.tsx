import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"

interface LibraryEmptyStateProps {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  icon: ReactNode
}

export function LibraryEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon,
}: LibraryEmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background px-6 py-20 text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      {actionLabel && onAction && (
        <Button className="mt-6 rounded-lg shadow-none" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
