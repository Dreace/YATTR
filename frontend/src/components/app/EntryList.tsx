import type { KeyboardEvent } from "react";
import {
  UIBadge,
  UIButton,
  UICheckbox,
  UIInput,
  UISelect,
  UIScrollArea,
} from "../ui";
import type { Entry, Feed } from "../../api";
import type { EntrySort, EntryStateFilter, SearchScope, TranslateFn } from "../../app/types";

interface EntryListProps {
  t: TranslateFn;
  activeZone: EntryStateFilter;
  entrySort: EntrySort;
  searchScope: SearchScope;
  searchInput: string;
  searchKeyword: string;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  loadingEntries: boolean;
  entries: Entry[];
  selectedEntry: Entry | null;
  selectedEntryIds: number[];
  feedById: Map<number, Feed>;
  formatPublishedAt: (timestamp?: number) => string;
  formatRelative: (timestamp?: number) => string;
  toPlainText: (value?: string | null) => string;
  toApiAssetUrl: (path: string | null | undefined) => string;
  onChangeActiveZone: (value: EntryStateFilter) => void;
  onChangeEntrySort: (value: EntrySort) => void;
  onChangeSearchScope: (value: SearchScope) => void;
  onSearchInputChange: (value: string) => void;
  onRunSearch: () => void;
  onClearSearch: () => void;
  onMarkCurrentPageRead: () => void;
  onMarkAllInScopeRead: () => void;
  onMarkSelectedRead: () => void;
  onRefreshPage: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onSelectEntry: (entry: Entry) => void;
  onToggleStar: (entry: Entry) => void;
  onToggleSelectedEntry: (entryId: number, checked: boolean) => void;
}

export function EntryList({
  t,
  activeZone,
  entrySort,
  searchScope,
  searchInput,
  searchKeyword,
  currentPage,
  totalPages,
  totalItems,
  loadingEntries,
  entries,
  selectedEntry,
  selectedEntryIds,
  feedById,
  formatPublishedAt,
  formatRelative,
  toPlainText,
  toApiAssetUrl,
  onChangeActiveZone,
  onChangeEntrySort,
  onChangeSearchScope,
  onSearchInputChange,
  onRunSearch,
  onClearSearch,
  onMarkCurrentPageRead,
  onMarkAllInScopeRead,
  onMarkSelectedRead,
  onRefreshPage,
  onPrevPage,
  onNextPage,
  onSelectEntry,
  onToggleStar,
  onToggleSelectedEntry,
}: EntryListProps) {
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      onRunSearch();
    }
  };

  return (
    <main className="column list-column">
      <div className="list-toolbar primary-toolbar">
        <UISelect
          value={activeZone}
          onChange={(event) =>
            onChangeActiveZone(event.target.value as EntryStateFilter)
          }
        >
          <option value="all">{t("toolbar.filter.all")}</option>
          <option value="unread">{t("toolbar.filter.unread")}</option>
          <option value="starred">{t("toolbar.filter.starred")}</option>
          <option value="later">{t("toolbar.filter.later")}</option>
        </UISelect>
        <UISelect
          value={entrySort}
          onChange={(event) =>
            onChangeEntrySort(event.target.value as EntrySort)
          }
        >
          <option value="updated">{t("toolbar.sort.updated")}</option>
          <option value="title">{t("toolbar.sort.title")}</option>
        </UISelect>
        <UISelect
          value={searchScope}
          onChange={(event) =>
            onChangeSearchScope(event.target.value as SearchScope)
          }
        >
          <option value="all">{t("toolbar.scope.all")}</option>
          <option value="title">{t("toolbar.scope.title")}</option>
          <option value="summary">{t("toolbar.scope.summary")}</option>
          <option value="content">{t("toolbar.scope.content")}</option>
        </UISelect>
        <UIInput
          value={searchInput}
          onChange={(event) => onSearchInputChange(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t("toolbar.search.placeholder")}
        />
        <UIButton onClick={onRunSearch}>{t("common.search")}</UIButton>
        <UIButton
          variant="ghost"
          onClick={onClearSearch}
          disabled={!searchInput && !searchKeyword}
        >
          {t("common.clear")}
        </UIButton>
      </div>

      <div className="list-toolbar secondary-toolbar">
        <UIButton onClick={onMarkCurrentPageRead}>
          {t("toolbar.batch.page_read")}
        </UIButton>
        <UIButton onClick={onMarkAllInScopeRead}>
          {t("toolbar.batch.all_read")}
        </UIButton>
        <UIButton
          variant="secondary"
          onClick={onMarkSelectedRead}
          disabled={!selectedEntryIds.length}
        >
          {t("toolbar.batch.selected_read")}
        </UIButton>
        <UIButton variant="outline" onClick={onRefreshPage}>
          {t("common.refresh")}
        </UIButton>
        <UIButton
          variant="outline"
          onClick={onPrevPage}
          disabled={currentPage <= 1 || loadingEntries}
        >
          {t("toolbar.pager.prev")}
        </UIButton>
        <UIButton
          variant="outline"
          onClick={onNextPage}
          disabled={currentPage >= totalPages || loadingEntries}
        >
          {t("toolbar.pager.next")}
        </UIButton>
        <span className="pager-info">
          {t("toolbar.pager.info", { currentPage, totalPages, totalItems })}
        </span>
        {loadingEntries ? (
          <span className="loading-text">{t("common.loading")}</span>
        ) : null}
      </div>

      <UIScrollArea className="entry-scroll">
        <div className="entry-list">
          {entries.map((entry) => {
            const feed = feedById.get(entry.feed_id);
            const isActive = selectedEntry?.id === entry.id;
            const isChecked = selectedEntryIds.includes(entry.id);
            return (
              <div
                key={entry.id}
                className={isActive ? "entry-row active" : "entry-row"}
                onClick={() => onSelectEntry(entry)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onSelectEntry(entry);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={entry.title}
              >
                <div className="entry-left">
                  <UICheckbox
                    checked={isChecked}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      onToggleSelectedEntry(entry.id, event.target.checked)
                    }
                    aria-label={t("entry.checkbox", { title: entry.title })}
                  />
                  <button
                    type="button"
                    className={
                      entry.is_starred
                        ? "star-toggle active"
                        : "star-toggle"
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleStar(entry);
                    }}
                    aria-label={
                      entry.is_starred
                        ? t("reader.action.unstar")
                        : t("reader.action.star")
                    }
                  >
                    ★
                  </button>
                  {feed?.icon_url ? (
                    <img
                      className="feed-icon"
                      src={toApiAssetUrl(feed.icon_url)}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span className="feed-icon placeholder" />
                  )}
                </div>
                <div className="entry-main">
                  <div className="entry-title">
                    {entry.title || t("entry.title.empty")}
                  </div>
                  <div className="entry-snippet">
                    {toPlainText(
                      entry.summary ||
                        entry.content_text ||
                        entry.content_html,
                    ) || t("entry.snippet.empty")}
                  </div>
                </div>
                <div className="entry-right">
                  <div className="entry-source">
                    {t("common.source")}: {feed?.title ?? `#${entry.feed_id}`}
                  </div>
                  <div className="entry-updated">
                    {t("common.updated")}: {formatPublishedAt(entry.published_at)}
                  </div>
                  <div className="entry-relative">
                    {formatRelative(entry.published_at)}
                  </div>
                  <div className="entry-status">
                    {!entry.is_read ? (
                      <UIBadge className="state-badge unread">
                        {t("entry.state.unread")}
                      </UIBadge>
                    ) : null}
                    {entry.is_later ? (
                      <UIBadge className="state-badge later">
                        {t("entry.state.later")}
                      </UIBadge>
                    ) : null}
                    {entry.is_starred ? (
                      <UIBadge className="state-badge starred">
                        {t("entry.state.starred")}
                      </UIBadge>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
          {entries.length === 0 ? (
            <div className="empty-state">{t("entry.empty")}</div>
          ) : null}
        </div>
      </UIScrollArea>
    </main>
  );
}
