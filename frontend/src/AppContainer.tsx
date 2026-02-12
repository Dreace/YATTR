import { useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "./api";
import type {
  DebugEntry,
  Entry,
  Feed,
  FetchLog,
  Folder,
  GeneralSettings,
  HealthStatus,
  PluginProvidedSettings,
  PluginSettings,
} from "./api";
import { useAuth } from "./auth/AuthProvider";
import { defaultSettings } from "./app/constants";
import type {
  EditFeedDraft,
  FeedMenuState,
  FolderMenuState,
  SearchScope,
  ThemeMode,
  ZoneCountState,
  ZoneKey,
} from "./app/types";
import {
  detectSystemTheme,
  formatDateByPattern,
  formatSuccessRate,
  normalizeTimeFormat,
  readThemeMode,
  toPlainText,
  toSafeExternalHttpUrl,
} from "./app/utils";
import {
  formatPublishedAtByPattern,
  formatRelativeByNow,
  toApiAssetUrlByBase,
} from "./app/viewHelpers";
import { useI18n } from "./i18n";
import { buildAppDataQueries } from "./app/useAppDataQueries";
import { buildEntryAndSearchActions } from "./app/useEntryAndSearchActions";
import { buildManagementActions } from "./app/useManagementActions";
import { useAppEffects } from "./app/useAppEffects";
import type {
  FeedDeleteDialogState,
  FolderDeleteDialogState,
} from "./app/dialogTypes";
import { AppView } from "./components/app/AppView";
interface SidebarTreeData {
  byFolder: Map<number, Feed[]>;
  noFolder: Feed[];
}
export default function App() {
  const { signOut } = useAuth();
  const { t, mode: langMode, setMode: setLangMode } = useI18n();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<number[]>([]);
  const [unreadByFeed, setUnreadByFeed] = useState<Map<number, number>>(new Map());
  const [zoneCounts, setZoneCounts] = useState<ZoneCountState>({
    all: 0,
    unread: 0,
    starred: 0,
    later: 0,
  });
  const [selectedFolder, setSelectedFolder] = useState<number | null>(null);
  const [selectedFeed, setSelectedFeed] = useState<number | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<number>>(() => new Set());
  const [ungroupedCollapsed, setUngroupedCollapsed] = useState(false);
  const [activeZone, setActiveZone] = useState<ZoneKey>("unread");
  const [entrySort, setEntrySort] = useState<"updated" | "title">("updated");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [effectiveTheme, setEffectiveTheme] = useState<"light" | "dark">(() =>
    themeMode === "system" ? detectSystemTheme() : themeMode,
  );
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const [settingsDraft, setSettingsDraft] = useState<GeneralSettings>(defaultSettings);
  const [pluginSettings, setPluginSettings] = useState<PluginSettings>({
    available: [],
    enabled: [],
  });
  const [pluginSettingMap, setPluginSettingMap] = useState<Record<string, PluginProvidedSettings>>({});
  const [pluginActionLoading, setPluginActionLoading] = useState<Record<string, boolean>>({});
  const [savingPlugins, setSavingPlugins] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthLoadFailed, setHealthLoadFailed] = useState(false);
  const [debugFeedId, setDebugFeedId] = useState<number | null>(null);
  const [debugLogs, setDebugLogs] = useState<FetchLog[]>([]);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [debugMessage, setDebugMessage] = useState("");
  const [feedMenu, setFeedMenu] = useState<FeedMenuState | null>(null);
  const [folderMenu, setFolderMenu] = useState<FolderMenuState | null>(null);
  const [feedDeleteDialog, setFeedDeleteDialog] = useState<FeedDeleteDialogState | null>(null);
  const [folderDeleteDialog, setFolderDeleteDialog] = useState<FolderDeleteDialogState | null>(null);
  const [deleteDialogBusy, setDeleteDialogBusy] = useState(false);
  const [newFeedUrl, setNewFeedUrl] = useState("");
  const [newFeedFolderId, setNewFeedFolderId] = useState<number | null>(null);
  const [newFeedMessage, setNewFeedMessage] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderMessage, setNewFolderMessage] = useState("");
  const [editFeedDraft, setEditFeedDraft] = useState<EditFeedDraft | null>(null);
  const [savingFeedEdit, setSavingFeedEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRefreshRunningRef = useRef(false);
  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [folders],
  );
  const treeData = useMemo<SidebarTreeData>(() => {
    const byFolder = new Map<number, Feed[]>();
    const noFolder: Feed[] = [];
    for (const feed of feeds) {
      if (feed.folder_id == null) {
        noFolder.push(feed);
      } else {
        const list = byFolder.get(feed.folder_id) ?? [];
        list.push(feed);
        byFolder.set(feed.folder_id, list);
      }
    }
    for (const list of byFolder.values()) {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    noFolder.sort((a, b) => a.title.localeCompare(b.title));
    return { byFolder, noFolder };
  }, [feeds]);
  const selectedFeedObject = useMemo(
    () => feeds.find((feed) => feed.id === selectedFeed) ?? null,
    [feeds, selectedFeed],
  );
  const feedById = useMemo(() => {
    const map = new Map<number, Feed>();
    for (const feed of feeds) {
      map.set(feed.id, feed);
    }
    return map;
  }, [feeds]);
  const selectedEntryFeed = useMemo(() => {
    if (!selectedEntry) {
      return null;
    }
    return feedById.get(selectedEntry.feed_id) ?? null;
  }, [feedById, selectedEntry]);
  const selectedEntrySafeUrl = useMemo(
    () => toSafeExternalHttpUrl(selectedEntry?.url),
    [selectedEntry?.url],
  );
  const selectedFolderFeedIds = useMemo(() => {
    if (selectedFolder == null) {
      return new Set(feeds.map((feed) => feed.id));
    }
    return new Set(
      feeds
        .filter((feed) => feed.folder_id === selectedFolder)
        .map((feed) => feed.id),
    );
  }, [feeds, selectedFolder]);
  const folderUnreadCountByFolder = useMemo(() => {
    const byFolder = new Map<number, number>();
    for (const folder of sortedFolders) {
      const folderFeeds = treeData.byFolder.get(folder.id) ?? [];
      let totalUnread = 0;
      for (const feed of folderFeeds) {
        totalUnread += unreadByFeed.get(feed.id) ?? 0;
      }
      byFolder.set(folder.id, totalUnread);
    }
    return byFolder;
  }, [sortedFolders, treeData, unreadByFeed]);
  const ungroupedUnreadCount = useMemo(() => {
    let totalUnread = 0;
    for (const feed of treeData.noFolder) {
      totalUnread += unreadByFeed.get(feed.id) ?? 0;
    }
    return totalUnread;
  }, [treeData, unreadByFeed]);
  const activeTimeFormat = useMemo(
    () => normalizeTimeFormat(settingsDraft.time_format),
    [settingsDraft.time_format],
  );
  const timeFormatPreview = useMemo(
    () => formatDateByPattern(new Date(relativeNow), activeTimeFormat),
    [relativeNow, activeTimeFormat],
  );
  const articleHtml = useMemo(() => {
    const source = selectedEntry?.content_html || selectedEntry?.summary || t("common.none");
    return source.replace(/src=\"\/api\/cache\//g, );
  }, [selectedEntry, t]);
  const toApiAssetUrl = (path: string | null | undefined): string =>
    toApiAssetUrlByBase(API_BASE_URL, path);
  const formatPublishedAt = (timestamp?: number): string =>
    formatPublishedAtByPattern(timestamp, activeTimeFormat);
  const formatRelative = (timestamp?: number): string =>
    formatRelativeByNow(timestamp, relativeNow, t);
  const dataQueries = buildAppDataQueries({
    debugFeedId,
    selectedFeed,
    selectedFolder,
    selectedFolderFeedIds,
    activeZone,
    entrySort,
    searchKeyword,
    searchScope,
    setFolders,
    setFeeds,
    setUnreadByFeed,
    setSettingsDraft,
    setPluginSettings,
    setPluginSettingMap,
    setDebugFeedId,
    setZoneCounts,
    setEntries,
    setCurrentPage,
    setTotalPages,
    setTotalItems,
    setSelectedEntry,
    setSelectedEntryIds,
    setLoadingEntries,
  });
  const entryActions = buildEntryAndSearchActions({
    entries,
    selectedEntry,
    selectedEntryIds,
    selectedFeed,
    selectedFolder,
    selectedFolderFeedIds,
    activeZone,
    entrySort,
    searchScope,
    searchInput,
    searchKeyword,
    setEntries,
    setSelectedEntry,
    setSelectedEntryIds,
    setSearchInput,
    setSearchKeyword,
    setUnreadByFeed,
    refreshUnreadCounts: dataQueries.refreshUnreadCounts,
    refreshZoneCounts: dataQueries.refreshZoneCounts,
    refreshEntries: dataQueries.refreshEntries,
  });
  const managementActions = buildManagementActions({
    signOut,
    t,
    feeds,
    folders,
    sortedFolders,
    selectedFeed,
    selectedFolder,
    debugFeedId,
    settingsDraft,
    pluginSettings,
    editFeedDraft,
    feedDeleteDialog,
    folderDeleteDialog,
    collapsedFolderIds,
    newFeedUrl,
    newFeedFolderId,
    newFolderName,
    setSettingsDraft,
    setPluginSettings,
    setPluginSettingMap,
    setPluginActionLoading,
    setSavingPlugins,
    setHealthStatus,
    setHealthLoading,
    setHealthLoadFailed,
    setNewFeedUrl,
    setNewFeedMessage,
    setNewFolderName,
    setNewFolderMessage,
    setEditFeedDraft,
    setSavingFeedEdit,
    setError,
    setFeedMenu,
    setFolderMenu,
    setFeedDeleteDialog,
    setFolderDeleteDialog,
    setDeleteDialogBusy,
    setSelectedFeed,
    setSelectedFolder,
    setDebugFeedId,
    setDebugOpen,
    setDebugLogs,
    setDebugEntries,
    setDebugMessage,
    setActiveZone,
    setCollapsedFolderIds,
    refreshBase: dataQueries.refreshBase,
    refreshEntries: dataQueries.refreshEntries,
    refreshZoneCounts: dataQueries.refreshZoneCounts,
  });
  useAppEffects({
    t,
    themeMode,
    setEffectiveTheme,
    setRelativeNow,
    bootstrapped,
    setBootstrapped,
    setError,
    selectedFeed,
    selectedFolder,
    activeZone,
    entrySort,
    searchKeyword,
    searchScope,
    refreshBase: dataQueries.refreshBase,
    refreshZoneCounts: dataQueries.refreshZoneCounts,
    refreshEntries: dataQueries.refreshEntries,
    setFeedMenu,
    setFolderMenu,
    autoRefreshIntervalSec: settingsDraft.auto_refresh_interval_sec,
    autoRefreshRunningRef,
    currentPage,
    debugOpen,
    debugFeedId,
    refreshDebugData: managementActions.refreshDebugData,
    settingsOpen,
    loadHealthStatus: managementActions.loadHealthStatus,
    entries,
    selectedEntry,
    selectedEntrySafeUrl,
    setSelectedEntry,
    toggleRead: entryActions.toggleRead,
    toggleStar: entryActions.toggleStar,
    toggleLater: entryActions.toggleLater,
  });
  return (
    <AppView
      t={t}
      themeMode={themeMode}
      effectiveTheme={effectiveTheme}
      onThemeChange={setThemeMode}
      onOpenSettings={() => setSettingsOpen(true)}
      onOpenDebug={() => setDebugOpen(true)}
      onSignOut={() => void managementActions.handleSignOut()}
      error={error}
      activeZone={activeZone}
      selectedFeed={selectedFeed}
      selectedFolder={selectedFolder}
      zoneCounts={zoneCounts}
      newFeedUrl={newFeedUrl}
      newFeedFolderId={newFeedFolderId}
      newFeedMessage={newFeedMessage}
      newFolderName={newFolderName}
      newFolderMessage={newFolderMessage}
      sortedFolders={sortedFolders}
      treeData={treeData}
      unreadByFeed={unreadByFeed}
      folderUnreadCountByFolder={folderUnreadCountByFolder}
      ungroupedUnreadCount={ungroupedUnreadCount}
      ungroupedCollapsed={ungroupedCollapsed}
      isFolderCollapsed={managementActions.isFolderCollapsed}
      toApiAssetUrl={toApiAssetUrl}
      onSelectZone={managementActions.handleSelectZone}
      onNewFeedUrlChange={setNewFeedUrl}
      onNewFeedFolderChange={setNewFeedFolderId}
      onAddFeed={() => void managementActions.handleValidateAndAddFeed()}
      onNewFolderNameChange={setNewFolderName}
      onAddFolder={() => void managementActions.handleCreateFolder()}
      onToggleFolderCollapsed={managementActions.toggleFolderCollapsed}
      onSelectFolder={managementActions.handleSelectFolder}
      onSelectFeed={managementActions.handleSelectFeed}
      onFolderContextMenu={(event, folder) => {
        event.preventDefault();
        setFeedMenu(null);
        setFolderMenu({ x: event.clientX, y: event.clientY, folderId: folder.id });
      }}
      onToggleUngrouped={() => setUngroupedCollapsed((prev) => !prev)}
      onFeedContextMenu={(event, feed) => {
        event.preventDefault();
        setFolderMenu(null);
        setFeedMenu({ x: event.clientX, y: event.clientY, feedId: feed.id });
      }}
      entrySort={entrySort}
      searchScope={searchScope}
      searchInput={searchInput}
      searchKeyword={searchKeyword}
      currentPage={currentPage}
      totalPages={totalPages}
      totalItems={totalItems}
      loadingEntries={loadingEntries}
      entries={entries}
      selectedEntry={selectedEntry}
      selectedEntryIds={selectedEntryIds}
      feedById={feedById}
      formatPublishedAt={formatPublishedAt}
      formatRelative={formatRelative}
      toPlainText={toPlainText}
      onChangeActiveZone={setActiveZone}
      onChangeEntrySort={setEntrySort}
      onChangeSearchScope={setSearchScope}
      onSearchInputChange={setSearchInput}
      onRunSearch={() => void entryActions.handleRunSearch()}
      onClearSearch={() => void entryActions.handleClearSearch()}
      onMarkCurrentPageRead={() => void entryActions.markCurrentPageRead()}
      onMarkAllInScopeRead={() => void entryActions.markAllInScopeRead()}
      onMarkSelectedRead={() => void entryActions.markSelectedRead()}
      onRefreshPage={() => void dataQueries.refreshEntries(currentPage)}
      onPrevPage={() => void dataQueries.refreshEntries(currentPage - 1)}
      onNextPage={() => void dataQueries.refreshEntries(currentPage + 1)}
      onSelectEntry={setSelectedEntry}
      onToggleStar={(entry) => void entryActions.toggleStar(entry)}
      onToggleSelectedEntry={(entryId, checked) => {
        setSelectedEntryIds((prev) => {
          if (checked) {
            return prev.includes(entryId) ? prev : [...prev, entryId];
          }
          return prev.filter((id) => id !== entryId);
        });
      }}
      selectedEntryFeed={selectedEntryFeed}
      selectedEntrySafeUrl={selectedEntrySafeUrl}
      articleHtml={articleHtml}
      onToggleRead={() => void entryActions.toggleRead()}
      onToggleStarCurrent={() => void entryActions.toggleStar()}
      onToggleLater={() => void entryActions.toggleLater()}
      folderMenu={folderMenu}
      feedMenu={feedMenu}
      onDeleteFolder={managementActions.handleFolderDelete}
      onEditFeed={managementActions.openEditFeedDialog}
      onOpenDebugFeed={(feedId) => void managementActions.openDebugForFeed(feedId)}
      onDeleteFeed={managementActions.handleFeedDelete}
      feedDeleteDialog={feedDeleteDialog}
      folderDeleteDialog={folderDeleteDialog}
      deleteDialogBusy={deleteDialogBusy}
      onCloseFeedDeleteDialog={() => setFeedDeleteDialog(null)}
      onConfirmFeedDelete={() => void managementActions.confirmFeedDelete()}
      onCloseFolderDeleteDialog={() => setFolderDeleteDialog(null)}
      onMoveFolderDeleteStepToMode={() =>
        setFolderDeleteDialog((prev) => (prev ? { ...prev, step: "mode" } : prev))
      }
      onConfirmFolderDeleteKeepFeeds={() => void managementActions.confirmFolderDelete(false)}
      onConfirmFolderDeleteDeleteFeeds={() => void managementActions.confirmFolderDelete(true)}
      editFeedDraft={editFeedDraft}
      savingFeedEdit={savingFeedEdit}
      onCloseEditFeedDialog={() => setEditFeedDraft(null)}
      onSaveEditFeedDialog={() => void managementActions.handleEditFeedSave()}
      onChangeEditFeedDraft={setEditFeedDraft}
      settingsOpen={settingsOpen}
      settingsDraft={settingsDraft}
      langMode={langMode}
      timeFormatPreview={timeFormatPreview}
      healthLoading={healthLoading}
      healthLoadFailed={healthLoadFailed}
      healthStatus={healthStatus}
      pluginSettings={pluginSettings}
      pluginSettingMap={pluginSettingMap}
      pluginActionLoading={pluginActionLoading}
      savingPlugins={savingPlugins}
      onCloseSettings={() => setSettingsOpen(false)}
      onSettingsDraftChange={setSettingsDraft}
      onSaveGeneralSettings={() => void managementActions.handleSaveGeneralSettings()}
      onLangModeChange={setLangMode}
      onImportOpml={(file) => void managementActions.handleImportOpml(file)}
      onExportOpml={() => void managementActions.handleExportOpml()}
      formatSuccessRate={formatSuccessRate}
      onTogglePlugin={managementActions.handleTogglePlugin}
      onSavePlugins={() => void managementActions.handleSavePlugins()}
      onPluginAction={(pluginId, action) => void managementActions.handlePluginAction(pluginId, action)}
      debugOpen={debugOpen}
      debugFeedId={debugFeedId}
      feeds={feeds}
      debugMessage={debugMessage}
      debugLogs={debugLogs}
      debugEntries={debugEntries}
      toSafeExternalHttpUrl={toSafeExternalHttpUrl}
      onCloseDebug={() => setDebugOpen(false)}
      onChangeDebugFeedId={setDebugFeedId}
      onRefreshDebug={() => void managementActions.handleDebugRefresh()}
      onRefreshDebugLogs={() => {
        if (debugFeedId) {
          void managementActions.refreshDebugData(debugFeedId);
        }
      }}
      selectedFeedObject={selectedFeedObject}
    />
  );
}
