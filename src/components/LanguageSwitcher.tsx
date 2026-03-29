import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES } from '@/i18n'
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Globe } from 'lucide-react'

interface LanguageSwitcherProps {
  compact?: boolean
}

export function LanguageSwitcher({ compact }: LanguageSwitcherProps) {
  const { i18n } = useTranslation()

  const currentLocale = SUPPORTED_LOCALES.find(l => l.code === i18n.language)
    ?? SUPPORTED_LOCALES[0]

  if (compact) {
    return (
      <Select value={currentLocale.code} onValueChange={(v) => i18n.changeLanguage(v)}>
        <SelectTrigger className="h-9 w-9 p-0 justify-center border-none bg-transparent hover:bg-accent [&>svg:last-child]:hidden">
          <Globe className="h-4 w-4" />
        </SelectTrigger>
        <SelectContent align="end">
          {SUPPORTED_LOCALES.map((locale) => (
            <SelectItem key={locale.code} value={locale.code}>
              {locale.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <Select value={currentLocale.code} onValueChange={(v) => i18n.changeLanguage(v)}>
      <SelectTrigger className="w-full h-9 text-sm">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 shrink-0" />
          <span>{currentLocale.label}</span>
        </div>
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LOCALES.map((locale) => (
          <SelectItem key={locale.code} value={locale.code}>
            {locale.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
