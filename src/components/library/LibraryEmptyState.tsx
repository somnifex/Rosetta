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
    <div className="rounded-3xl border border-dashed bg-card/80 px-6 py-16 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        {icon}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {actionLabel && onAction && (
        <Button className="mt-5" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
