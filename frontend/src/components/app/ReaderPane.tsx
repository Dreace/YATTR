import { UIButton, UIScrollArea } from "../ui";
import type { Entry, Feed } from "../../api";
import type { TranslateFn } from "../../app/types";

interface ReaderPaneProps {
  t: TranslateFn;
  selectedEntry: Entry | null;
  selectedEntryFeed: Feed | null;
  selectedEntrySafeUrl: string | null;
  articleHtml: string;
  formatPublishedAt: (timestamp?: number) => string;
  toApiAssetUrl: (path: string | null | undefined) => string;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onToggleLater: () => void;
}

export function ReaderPane({
  t,
  selectedEntry,
  selectedEntryFeed,
  selectedEntrySafeUrl,
  articleHtml,
  formatPublishedAt,
  toApiAssetUrl,
  onToggleRead,
  onToggleStar,
  onToggleLater,
}: ReaderPaneProps) {
  return (
    <section className="column reader-column">
      {selectedEntry ? (
        <>
          <header className="reader-header">
            <h2>
              {selectedEntryFeed?.icon_url ? (
                <img
                  className="feed-icon"
                  src={toApiAssetUrl(selectedEntryFeed.icon_url)}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <span className="feed-icon placeholder" />
              )}
              <span>{selectedEntry.title}</span>
            </h2>
            <div className="reader-meta">
              <span>
                {t("common.source")}: {selectedEntryFeed?.title ?? `#${selectedEntry.feed_id}`}
              </span>
              <span>
                {t("common.published")}: {formatPublishedAt(selectedEntry.published_at)}
              </span>
            </div>
            <div className="reader-actions">
              <UIButton onClick={onToggleRead}>
                {selectedEntry.is_read
                  ? t("reader.action.unread")
                  : t("reader.action.read")}
              </UIButton>
              <UIButton onClick={onToggleStar}>
                {selectedEntry.is_starred
                  ? t("reader.action.unstar")
                  : t("reader.action.star")}
              </UIButton>
              <UIButton onClick={onToggleLater}>
                {selectedEntry.is_later
                  ? t("reader.action.unlater")
                  : t("reader.action.later")}
              </UIButton>
              {selectedEntrySafeUrl ? (
                <a
                  className="entry-link"
                  href={selectedEntrySafeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("reader.action.open")}
                </a>
              ) : null}
            </div>
          </header>
          <UIScrollArea className="reader-scroll">
            <article
              className="reader-content"
              dangerouslySetInnerHTML={{
                __html: articleHtml,
              }}
            />
          </UIScrollArea>
        </>
      ) : (
        <div className="reader-empty">{t("reader.empty")}</div>
      )}
    </section>
  );
}
