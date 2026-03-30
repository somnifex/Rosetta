import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"

export default function GeneralTab() {
  const { t } = useTranslation("settings")

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("general.title")}</CardTitle>
        <CardDescription>{t("general.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t("general.language")}</Label>
          <p className="text-xs text-muted-foreground">{t("general.language_desc")}</p>
          <LanguageSwitcher />
        </div>
        <div className="space-y-2">
          <Label>{t("general.default_target_language")}</Label>
          <Input placeholder="English" />
        </div>
        <div className="space-y-2">
          <Label>{t("general.theme")}</Label>
          <select className="w-full h-10 px-3 rounded-md border border-input bg-background">
            <option>{t("general.theme_options.light")}</option>
            <option>{t("general.theme_options.dark")}</option>
            <option>{t("general.theme_options.system")}</option>
          </select>
        </div>
      </CardContent>
    </Card>
  )
}
