import { UIBadge, UIButton, UISelect } from "../ui";
import type { ThemeMode, TranslateFn } from "../../app/types";

interface TopbarProps {
  t: TranslateFn;
  themeMode: ThemeMode;
  effectiveTheme: "light" | "dark";
  onThemeChange: (mode: ThemeMode) => void;
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  onSignOut: () => void;
}

export function Topbar({
  t,
  themeMode,
  effectiveTheme,
  onThemeChange,
  onOpenSettings,
  onOpenDebug,
  onSignOut,
}: TopbarProps) {
  return (
    <header className="app-topbar">
      <div className="brand">{t("common.app_name")}</div>
      <div className="topbar-actions">
        <UISelect
          value={themeMode}
          onChange={(event) => onThemeChange(event.target.value as ThemeMode)}
          aria-label={t("common.theme")}
        >
          <option value="light">{t("common.theme.light")}</option>
          <option value="dark">{t("common.theme.dark")}</option>
          <option value="system">{t("common.theme.system")}</option>
        </UISelect>
        <UIBadge>
          {effectiveTheme === "dark"
            ? t("common.theme.status.dark")
            : t("common.theme.status.light")}
        </UIBadge>
        <UIButton variant="outline" onClick={onOpenSettings}>
          {t("topbar.settings")}
        </UIButton>
        <UIButton variant="outline" onClick={onOpenDebug}>
          {t("topbar.debug")}
        </UIButton>
        <UIButton variant="outline" onClick={onSignOut}>
          {t("topbar.signout")}
        </UIButton>
      </div>
    </header>
  );
}
