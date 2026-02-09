import { UICheckbox, UIInput, UISelect, UISeparator, UISheet, UITooltip, UIButton } from "../ui";
import type {
  GeneralSettings,
  HealthStatus,
  PluginProvidedSettings,
  PluginSettingAction,
  PluginSettings,
} from "../../api";
import type { TranslateFn } from "../../app/types";
import type { LanguageMode } from "../../i18n";

interface SettingsDrawerProps {
  t: TranslateFn;
  open: boolean;
  settingsDraft: GeneralSettings;
  langMode: LanguageMode;
  timeFormatPreview: string;
  healthLoading: boolean;
  healthLoadFailed: boolean;
  healthStatus: HealthStatus | null;
  pluginSettings: PluginSettings;
  pluginSettingMap: Record<string, PluginProvidedSettings>;
  pluginActionLoading: Record<string, boolean>;
  savingPlugins: boolean;
  onClose: () => void;
  onSettingsDraftChange: (updater: (prev: GeneralSettings) => GeneralSettings) => void;
  onSaveGeneralSettings: () => void;
  onLangModeChange: (mode: LanguageMode) => void;
  onImportOpml: (file: File) => void;
  onExportOpml: () => void;
  formatSuccessRate: (value: number) => string;
  onTogglePlugin: (name: string, enabled: boolean) => void;
  onSavePlugins: () => void;
  onPluginAction: (pluginId: string, action: PluginSettingAction) => void;
}

export function SettingsDrawer({
  t,
  open,
  settingsDraft,
  langMode,
  timeFormatPreview,
  healthLoading,
  healthLoadFailed,
  healthStatus,
  pluginSettings,
  pluginSettingMap,
  pluginActionLoading,
  savingPlugins,
  onClose,
  onSettingsDraftChange,
  onSaveGeneralSettings,
  onLangModeChange,
  onImportOpml,
  onExportOpml,
  formatSuccessRate,
  onTogglePlugin,
  onSavePlugins,
  onPluginAction,
}: SettingsDrawerProps) {
  const renderSettingLabel = (title: string, description: string) => (
    <span className="setting-label">
      <span>{title}</span>
      <UITooltip content={description}>
        <span className="setting-help-trigger" role="img" aria-label={t("help.aria", { title })}>
          i
        </span>
      </UITooltip>
    </span>
  );

  return (
    <UISheet
      open={open}
      title={t("settings.title")}
      closeLabel={t("common.close")}
      onClose={onClose}
    >
      <section className="drawer-section">
        <h4>{t("settings.section.general")}</h4>
        <div className="settings-grid">
          <label className="setting-row">
            {renderSettingLabel(
              t("settings.default_interval"),
              t("settings.help.default_interval"),
            )}
            <UIInput
              type="number"
              min={1}
              max={1440}
              value={settingsDraft.default_fetch_interval_min}
              onChange={(event) =>
                onSettingsDraftChange((prev) => ({
                  ...prev,
                  default_fetch_interval_min: Number(event.target.value) || 1,
                }))
              }
            />
          </label>
          <label className="setting-row">
            {renderSettingLabel(
              t("settings.retention_days"),
              t("settings.help.retention_days"),
            )}
            <UIInput
              type="number"
              min={1}
              max={3650}
              value={settingsDraft.cleanup_retention_days}
              onChange={(event) =>
                onSettingsDraftChange((prev) => ({
                  ...prev,
                  cleanup_retention_days: Number(event.target.value) || 1,
                }))
              }
            />
          </label>
          <label className="setting-row checkbox-row">
            {renderSettingLabel(
              t("settings.fulltext"),
              t("settings.help.fulltext"),
            )}
            <UICheckbox
              checked={settingsDraft.fulltext_enabled}
              onChange={(event) =>
                onSettingsDraftChange((prev) => ({
                  ...prev,
                  fulltext_enabled: event.target.checked,
                }))
              }
            />
          </label>
          <label className="setting-row checkbox-row">
            {renderSettingLabel(
              t("settings.keep_content"),
              t("settings.help.keep_content"),
            )}
            <UICheckbox
              checked={settingsDraft.cleanup_keep_content}
              onChange={(event) =>
                onSettingsDraftChange((prev) => ({
                  ...prev,
                  cleanup_keep_content: event.target.checked,
                }))
              }
            />
          </label>
          <label className="setting-row checkbox-row">
            {renderSettingLabel(
              t("settings.image_cache"),
              t("settings.help.image_cache"),
            )}
            <UICheckbox
              checked={settingsDraft.image_cache_enabled}
              onChange={(event) =>
                onSettingsDraftChange((prev) => ({
                  ...prev,
                  image_cache_enabled: event.target.checked,
                }))
              }
            />
          </label>
          <label className="setting-row">
            {renderSettingLabel(
              t("settings.auto_refresh"),
              t("settings.help.auto_refresh"),
            )}
            <UIInput
              type="number"
              min={0}
              max={86400}
              value={settingsDraft.auto_refresh_interval_sec}
              onChange={(event) =>
                onSettingsDraftChange((prev) => ({
                  ...prev,
                  auto_refresh_interval_sec: Number(event.target.value) || 0,
                }))
              }
            />
          </label>
          <label className="setting-row">
            {renderSettingLabel(
              t("settings.language"),
              t("settings.help.language"),
            )}
            <UISelect
              value={langMode}
              onChange={(event) =>
                onLangModeChange(event.target.value as "system" | "zh" | "en")
              }
            >
              <option value="system">{t("settings.language.system")}</option>
              <option value="zh">{t("settings.language.zh")}</option>
              <option value="en">{t("settings.language.en")}</option>
            </UISelect>
          </label>
          <label className="setting-row">
            {renderSettingLabel(
              t("settings.time_format"),
              t("settings.help.time_format"),
            )}
            <div className="time-format-field">
              <UIInput
                className="time-format-input"
                value={settingsDraft.time_format}
                onChange={(event) =>
                  onSettingsDraftChange((prev) => ({
                    ...prev,
                    time_format: event.target.value,
                  }))
                }
                placeholder={t("settings.time_format.placeholder")}
              />
              <span className="muted-text time-format-preview">
                {t("settings.time_format.preview", { value: timeFormatPreview })}
              </span>
            </div>
          </label>
        </div>
        <div className="drawer-actions">
          <UIButton onClick={onSaveGeneralSettings}>{t("settings.save")}</UIButton>
        </div>
      </section>

      <UISeparator />

      <section className="drawer-section">
        <h4>{t("settings.section.opml")}</h4>
        <div className="drawer-actions">
          <label className="file-trigger">
            {t("settings.opml.import")}
            <input
              type="file"
              accept=".opml,text/xml"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  return;
                }
                onImportOpml(file);
                event.target.value = "";
              }}
            />
          </label>
          <UIButton onClick={onExportOpml}>{t("settings.opml.export")}</UIButton>
        </div>
      </section>

      <UISeparator />

      <section className="drawer-section">
        <h4>{t("settings.section.health")}</h4>
        {healthLoading ? (
          <div className="muted-text">{t("common.loading")}</div>
        ) : null}
        {!healthLoading && healthLoadFailed ? (
          <div className="error-text">{t("settings.health.load_failed")}</div>
        ) : null}
        {!healthLoading && !healthLoadFailed && healthStatus ? (
          <div className="feed-setting-list">
            <div className="feed-setting-item">
              <div className="key-line">
                <span>{t("settings.health.status")}:</span>
                <span>{healthStatus.status}</span>
              </div>
              <div className="key-line">
                <span>{t("settings.health.feeds")}:</span>
                <span>{healthStatus.feeds}</span>
              </div>
              <div className="key-line">
                <span>{t("settings.health.entries")}:</span>
                <span>{healthStatus.entries}</span>
              </div>
              <div className="key-line">
                <span>{t("settings.health.failed_feeds")}:</span>
                <span>{healthStatus.failed_feeds}</span>
              </div>
              <div className="key-line">
                <span>{t("settings.health.success_rate")}:</span>
                <span>{formatSuccessRate(healthStatus.success_rate)}</span>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <UISeparator />

      <section className="drawer-section">
        <h4>{t("settings.section.plugins")}</h4>
        <div className="feed-setting-list">
          {pluginSettings.available.map((name) => (
            <div key={name} className="feed-setting-item plugin-setting-item">
              <div className="feed-setting-name">
                {pluginSettingMap[name]?.title ?? name}
              </div>
              <label className="setting-row checkbox-row">
                {renderSettingLabel(
                  t("common.enable"),
                  t("settings.help.plugin_enabled"),
                )}
                <UICheckbox
                  checked={pluginSettings.enabled.includes(name)}
                  onChange={(event) => onTogglePlugin(name, event.target.checked)}
                />
              </label>
              {pluginSettingMap[name]?.description ? (
                <div className="muted-text">
                  {pluginSettingMap[name].description}
                </div>
              ) : null}
              {pluginSettingMap[name]?.items?.map((item) => (
                <div className="plugin-extra" key={`${name}:${item.key}`}>
                  <div className="key-line">
                    <span>{item.label}:</span>
                    {item.display === "code" ? (
                      <code>{item.value}</code>
                    ) : (
                      <span>{item.value}</span>
                    )}
                  </div>
                </div>
              ))}
              {pluginSettings.enabled.includes(name) &&
              (!pluginSettingMap[name] || !pluginSettingMap[name].items?.length) ? (
                <div className="muted-text">{t("settings.plugins.no_items")}</div>
              ) : null}
              {pluginSettingMap[name]?.actions?.length ? (
                <div className="drawer-actions">
                  {pluginSettingMap[name].actions.map((action) => {
                    const key = `${name}:${action.id}`;
                    return (
                      <UIButton
                        key={key}
                        variant="outline"
                        disabled={pluginActionLoading[key]}
                        onClick={() => onPluginAction(name, action)}
                      >
                        {pluginActionLoading[key]
                          ? t("common.processing")
                          : action.label}
                      </UIButton>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
          {pluginSettings.available.length === 0 ? (
            <div className="empty-state">{t("settings.plugins.empty")}</div>
          ) : null}
        </div>
        <div className="drawer-actions">
          <UIButton onClick={onSavePlugins} disabled={savingPlugins}>
            {savingPlugins
              ? t("settings.plugins.save.loading")
              : t("settings.plugins.save")}
          </UIButton>
        </div>
        <div className="muted-text">{t("settings.plugins.note")}</div>
      </section>
    </UISheet>
  );
}
