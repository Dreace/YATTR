import { UISelect, UISeparator, UISheet, UIButton } from "../ui";
import type { DebugEntry, Feed, FetchLog } from "../../api";
import type { TranslateFn } from "../../app/types";

interface DebugDrawerProps {
  t: TranslateFn;
  open: boolean;
  debugFeedId: number | null;
  feeds: Feed[];
  debugMessage: string;
  debugLogs: FetchLog[];
  debugEntries: DebugEntry[];
  formatPublishedAt: (timestamp?: number) => string;
  toSafeExternalHttpUrl: (value?: string | null) => string | null;
  toPlainText: (value?: string | null) => string;
  onClose: () => void;
  onChangeFeedId: (feedId: number) => void;
  onRefresh: () => void;
  onRefreshLogs: () => void;
}

export function DebugDrawer({
  t,
  open,
  debugFeedId,
  feeds,
  debugMessage,
  debugLogs,
  debugEntries,
  formatPublishedAt,
  toSafeExternalHttpUrl,
  toPlainText,
  onClose,
  onChangeFeedId,
  onRefresh,
  onRefreshLogs,
}: DebugDrawerProps) {
  return (
    <UISheet
      open={open}
      title={t("debug.title")}
      closeLabel={t("common.close")}
      onClose={onClose}
    >
      <section className="drawer-section">
        <h4>{t("debug.section.control")}</h4>
        <div className="drawer-actions">
          <UISelect
            value={debugFeedId ?? ""}
            onChange={(event) => onChangeFeedId(Number(event.target.value))}
          >
            {feeds.map((feed) => (
              <option key={feed.id} value={feed.id}>
                {feed.title}
              </option>
            ))}
          </UISelect>
          <UIButton onClick={onRefresh} disabled={!debugFeedId}>
            {t("debug.action.refresh")}
          </UIButton>
          <UIButton variant="outline" onClick={onRefreshLogs} disabled={!debugFeedId}>
            {t("debug.action.refresh_logs")}
          </UIButton>
        </div>
        {debugMessage ? <div className="inline-message">{debugMessage}</div> : null}
      </section>

      <UISeparator />

      <section className="drawer-section">
        <h4>{t("debug.section.logs")}</h4>
        <div className="debug-log-list">
          {debugLogs.map((log) => (
            <div key={log.id} className="debug-log-row">
              <span>#{log.id}</span>
              <span>status={log.status}</span>
              <span>{formatPublishedAt(log.fetched_at)}</span>
              <span className={log.error_message ? "error-text" : "muted-text"}>
                {log.error_message || t("debug.log.ok")}
              </span>
            </div>
          ))}
          {debugLogs.length === 0 ? (
            <div className="empty-state">{t("debug.empty.logs")}</div>
          ) : null}
        </div>
      </section>

      <UISeparator />

      <section className="drawer-section">
        <h4>{t("debug.section.preview")}</h4>
        <div className="debug-entry-list">
          {debugEntries.map((entry) => {
            const safeEntryUrl = toSafeExternalHttpUrl(entry.url);
            return (
              <article key={entry.id} className="debug-entry-card">
                <div className="debug-entry-title">{entry.title}</div>
                <div className="muted-text">
                  {t("debug.entry.updated", {
                    time: formatPublishedAt(entry.published_at),
                  })}
                </div>
                {safeEntryUrl ? (
                  <a
                    className="entry-link"
                    href={safeEntryUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {entry.url}
                  </a>
                ) : null}
                <div className="debug-entry-content">
                  {toPlainText(
                    entry.summary || entry.content_text || entry.content_html,
                  ) || t("debug.entry.empty")}
                </div>
              </article>
            );
          })}
          {debugEntries.length === 0 ? (
            <div className="empty-state">{t("debug.empty.entries")}</div>
          ) : null}
        </div>
      </section>
    </UISheet>
  );
}
