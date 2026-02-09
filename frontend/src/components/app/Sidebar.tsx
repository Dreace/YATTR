import type { MouseEvent } from "react";
import {
  UIBadge,
  UIButton,
  UIInput,
  UISelect,
  UISeparator,
  UIScrollArea,
  UITooltip,
} from "../ui";
import type { Feed, Folder } from "../../api";
import type {
  EntryStateFilter,
  TranslateFn,
  ZoneCountState,
} from "../../app/types";

interface SidebarTreeData {
  byFolder: Map<number, Feed[]>;
  noFolder: Feed[];
}

interface SidebarProps {
  t: TranslateFn;
  activeZone: EntryStateFilter;
  selectedFeed: number | null;
  selectedFolder: number | null;
  zoneCounts: ZoneCountState;
  newFeedUrl: string;
  newFeedFolderId: number | null;
  newFeedMessage: string;
  sortedFolders: Folder[];
  treeData: SidebarTreeData;
  unreadByFeed: Map<number, number>;
  folderArticleCountByFolder: Map<number, number>;
  ungroupedArticleCount: number;
  ungroupedCollapsed: boolean;
  isFolderCollapsed: (folderId: number) => boolean;
  toApiAssetUrl: (path: string | null | undefined) => string;
  onSelectZone: (zone: EntryStateFilter) => void;
  onNewFeedUrlChange: (value: string) => void;
  onNewFeedFolderChange: (value: number | null) => void;
  onAddFeed: () => void;
  onToggleFolderCollapsed: (folderId: number) => void;
  onSelectFolder: (folderId: number) => void;
  onSelectFeed: (feed: Feed) => void;
  onToggleUngrouped: () => void;
  onFeedContextMenu: (event: MouseEvent<HTMLButtonElement>, feed: Feed) => void;
}

export function Sidebar({
  t,
  activeZone,
  selectedFeed,
  selectedFolder,
  zoneCounts,
  newFeedUrl,
  newFeedFolderId,
  newFeedMessage,
  sortedFolders,
  treeData,
  unreadByFeed,
  folderArticleCountByFolder,
  ungroupedArticleCount,
  ungroupedCollapsed,
  isFolderCollapsed,
  toApiAssetUrl,
  onSelectZone,
  onNewFeedUrlChange,
  onNewFeedFolderChange,
  onAddFeed,
  onToggleFolderCollapsed,
  onSelectFolder,
  onSelectFeed,
  onToggleUngrouped,
  onFeedContextMenu,
}: SidebarProps) {
  return (
    <aside className="column sidebar-column">
      <section className="sidebar-section">
        <div className="section-title">{t("zone.title")}</div>
        <div className="zone-list">
          <button
            type="button"
            className={
              activeZone === "all" &&
              selectedFeed == null &&
              selectedFolder == null
                ? "tree-row active"
                : "tree-row"
            }
            onClick={() => onSelectZone("all")}
          >
            <span>{t("zone.all")}</span>
            <UIBadge>{zoneCounts.all}</UIBadge>
          </button>
          <button
            type="button"
            className={
              activeZone === "unread" &&
              selectedFeed == null &&
              selectedFolder == null
                ? "tree-row active"
                : "tree-row"
            }
            onClick={() => onSelectZone("unread")}
          >
            <span>{t("zone.unread")}</span>
            <UIBadge>{zoneCounts.unread}</UIBadge>
          </button>
          <button
            type="button"
            className={
              activeZone === "starred" &&
              selectedFeed == null &&
              selectedFolder == null
                ? "tree-row active"
                : "tree-row"
            }
            onClick={() => onSelectZone("starred")}
          >
            <span>{t("zone.starred")}</span>
            <UIBadge>{zoneCounts.starred}</UIBadge>
          </button>
          <button
            type="button"
            className={
              activeZone === "later" &&
              selectedFeed == null &&
              selectedFolder == null
                ? "tree-row active"
                : "tree-row"
            }
            onClick={() => onSelectZone("later")}
          >
            <span>{t("zone.later")}</span>
            <UIBadge>{zoneCounts.later}</UIBadge>
          </button>
        </div>
      </section>

      <UISeparator />

      <section className="sidebar-section">
        <div className="section-title">{t("sidebar.add_feed")}</div>
        <div className="add-feed-form">
          <UIInput
            value={newFeedUrl}
            onChange={(event) => onNewFeedUrlChange(event.target.value)}
            placeholder={t("sidebar.add_feed.placeholder")}
          />
          <UISelect
            value={newFeedFolderId ?? ""}
            onChange={(event) =>
              onNewFeedFolderChange(
                event.target.value ? Number(event.target.value) : null,
              )
            }
          >
            <option value="">{t("sidebar.ungrouped")}</option>
            {sortedFolders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </UISelect>
          <UIButton onClick={onAddFeed}>{t("sidebar.add_feed.button")}</UIButton>
        </div>
        {newFeedMessage ? (
          <div className="inline-message">{newFeedMessage}</div>
        ) : null}
      </section>

      <UISeparator />

      <section className="sidebar-section sidebar-tree-wrap">
        <div className="section-title">{t("sidebar.feeds")}</div>
        <UIScrollArea className="sidebar-tree-scroll">
          <div className="tree-group">
            {sortedFolders.map((folder) => (
              <div key={folder.id} className="tree-folder">
                <div className="folder-row-wrap">
                  <button
                    type="button"
                    className="folder-collapse-toggle"
                    onClick={() => onToggleFolderCollapsed(folder.id)}
                    aria-label={t(
                      isFolderCollapsed(folder.id)
                        ? "sidebar.folder.expand"
                        : "sidebar.folder.collapse",
                      { name: folder.name },
                    )}
                  >
                    {isFolderCollapsed(folder.id) ? "📁" : "📂"}
                  </button>
                  <button
                    type="button"
                    className={
                      selectedFolder === folder.id && selectedFeed == null
                        ? "tree-row folder-row active"
                        : "tree-row folder-row"
                    }
                    onClick={() => onSelectFolder(folder.id)}
                  >
                    <span>
                      {folder.name} ({folderArticleCountByFolder.get(folder.id) ?? 0})
                    </span>
                  </button>
                </div>
                {!isFolderCollapsed(folder.id) ? (
                  <div className="tree-children">
                    {(treeData.byFolder.get(folder.id) ?? []).map((feed) => (
                      <button
                        type="button"
                        key={feed.id}
                        className={
                          selectedFeed === feed.id
                            ? "tree-row feed-row active"
                            : "tree-row feed-row"
                        }
                        onClick={() => onSelectFeed(feed)}
                        onContextMenu={(event) => onFeedContextMenu(event, feed)}
                      >
                        <span className="feed-node-title">
                          {feed.icon_url ? (
                            <img
                              className="feed-icon"
                              src={toApiAssetUrl(feed.icon_url)}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="feed-icon placeholder" />
                          )}
                          {(feed.error_count ?? 0) > 0 ? (
                            <UITooltip content={t("sidebar.feed.fetch_failed")}>
                              <span
                                className="feed-error-indicator"
                                role="img"
                                aria-label={t("sidebar.feed.fetch_failed")}
                                title={t("sidebar.feed.fetch_failed")}
                              >
                                !
                              </span>
                            </UITooltip>
                          ) : null}
                          <span className="feed-text">{feed.title}</span>
                        </span>
                        <UIBadge>{unreadByFeed.get(feed.id) ?? 0}</UIBadge>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            {treeData.noFolder.length > 0 ? (
              <div className="tree-folder">
                <div className="folder-row-wrap">
                  <button
                    type="button"
                    className="folder-collapse-toggle"
                    onClick={onToggleUngrouped}
                    aria-label={t(
                      ungroupedCollapsed
                        ? "sidebar.folder.expand"
                        : "sidebar.folder.collapse",
                      { name: t("sidebar.ungrouped") },
                    )}
                  >
                    {ungroupedCollapsed ? "📁" : "📂"}
                  </button>
                  <div className="tree-row folder-row">
                    {t("sidebar.ungrouped")} ({ungroupedArticleCount})
                  </div>
                </div>
                {!ungroupedCollapsed ? (
                  <div className="tree-children">
                    {treeData.noFolder.map((feed) => (
                      <button
                        type="button"
                        key={feed.id}
                        className={
                          selectedFeed === feed.id
                            ? "tree-row feed-row active"
                            : "tree-row feed-row"
                        }
                        onClick={() => onSelectFeed(feed)}
                        onContextMenu={(event) => onFeedContextMenu(event, feed)}
                      >
                        <span className="feed-node-title">
                          {feed.icon_url ? (
                            <img
                              className="feed-icon"
                              src={toApiAssetUrl(feed.icon_url)}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="feed-icon placeholder" />
                          )}
                          {(feed.error_count ?? 0) > 0 ? (
                            <UITooltip content={t("sidebar.feed.fetch_failed")}>
                              <span
                                className="feed-error-indicator"
                                role="img"
                                aria-label={t("sidebar.feed.fetch_failed")}
                                title={t("sidebar.feed.fetch_failed")}
                              >
                                !
                              </span>
                            </UITooltip>
                          ) : null}
                          <span className="feed-text">{feed.title}</span>
                        </span>
                        <UIBadge>{unreadByFeed.get(feed.id) ?? 0}</UIBadge>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </UIScrollArea>
      </section>
    </aside>
  );
}
