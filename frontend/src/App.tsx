import { useEffect, useMemo, useRef, useState } from "react";
import {
  API_BASE_URL,
  batchUpdateEntries,
  createFeed,
  debugRefreshFeed,
  deleteFeed,
  exportOpml,
  fetchDebugFeedEntries,
  fetchDebugFeedLogs,
  fetchEntries,
  fetchFeeds,
  fetchFolders,
  fetchHealthStatus,
  fetchPluginProvidedSettings,
  fetchPluginSettings,
  fetchUnreadCounts,
  getGeneralSettings,
  importOpml,
  markEntryLater,
  markEntryRead,
  markEntryStar,
  searchEntries,
  updateFeed,
  updateGeneralSettings,
  invokePluginSettingAction,
  updatePluginSettings,
  validateFeedUrl,
  type DebugEntry,
  type Entry,
  type Feed,
  type FetchLog,
  type Folder,
  type GeneralSettings,
  type HealthStatus,
  type PluginProvidedSettings,
  type PluginSettingAction,
  type PluginSettings,
} from "./api";
import { useAuth } from "./auth/AuthProvider";
import { useI18n } from "./i18n";
import { defaultSettings, PAGE_SIZE, THEME_MODE_KEY } from "./app/constants";
import type {
  EditFeedDraft,
  EntrySort,
  FeedMenuState,
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
import { DebugDrawer } from "./components/app/DebugDrawer";
import { EditFeedDialog } from "./components/app/EditFeedDialog";
import { EntryList } from "./components/app/EntryList";
import { FeedContextMenu } from "./components/app/FeedContextMenu";
import { ReaderPane } from "./components/app/ReaderPane";
import { SettingsDrawer } from "./components/app/SettingsDrawer";
import { Sidebar } from "./components/app/Sidebar";
import { Topbar } from "./components/app/Topbar";

export { toSafeExternalHttpUrl } from "./app/utils";

export default function App() {
  const { signOut } = useAuth();
  const { t, mode: langMode, setMode: setLangMode } = useI18n();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<number[]>([]);
  const [unreadByFeed, setUnreadByFeed] = useState<Map<number, number>>(
    new Map(),
  );
  const [zoneCounts, setZoneCounts] = useState<ZoneCountState>({
    all: 0,
    unread: 0,
    starred: 0,
    later: 0,
  });
  const [selectedFolder, setSelectedFolder] = useState<number | null>(null);
  const [selectedFeed, setSelectedFeed] = useState<number | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [ungroupedCollapsed, setUngroupedCollapsed] = useState(false);
  const [activeZone, setActiveZone] = useState<ZoneKey>("unread");
  const [entrySort, setEntrySort] = useState<EntrySort>("updated");
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
  const [settingsDraft, setSettingsDraft] =
    useState<GeneralSettings>(defaultSettings);
  const [pluginSettings, setPluginSettings] = useState<PluginSettings>({
    available: [],
    enabled: [],
  });
  const [pluginSettingMap, setPluginSettingMap] = useState<
    Record<string, PluginProvidedSettings>
  >({});
  const [pluginActionLoading, setPluginActionLoading] = useState<
    Record<string, boolean>
  >({});
  const [savingPlugins, setSavingPlugins] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthLoadFailed, setHealthLoadFailed] = useState(false);

  const [debugFeedId, setDebugFeedId] = useState<number | null>(null);
  const [debugLogs, setDebugLogs] = useState<FetchLog[]>([]);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [debugMessage, setDebugMessage] = useState("");

  const [feedMenu, setFeedMenu] = useState<FeedMenuState | null>(null);
  const [newFeedUrl, setNewFeedUrl] = useState("");
  const [newFeedFolderId, setNewFeedFolderId] = useState<number | null>(null);
  const [newFeedMessage, setNewFeedMessage] = useState("");
  const [editFeedDraft, setEditFeedDraft] = useState<EditFeedDraft | null>(
    null,
  );
  const [savingFeedEdit, setSavingFeedEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRefreshRunningRef = useRef(false);

  const sortedFolders = useMemo(
    () =>
      [...folders].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [folders],
  );

  const treeData = useMemo(() => {
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

  const articleHtml = useMemo(() => {
    const source =
      selectedEntry?.content_html || selectedEntry?.summary || t("common.none");
    return source.replace(
      /src=\"\/api\/cache\//g,
      `src=\"${API_BASE_URL}/api/cache/`,
    );
  }, [selectedEntry, t]);

  const activeTimeFormat = useMemo(
    () => normalizeTimeFormat(settingsDraft.time_format),
    [settingsDraft.time_format],
  );
  const timeFormatPreview = useMemo(
    () => formatDateByPattern(new Date(relativeNow), activeTimeFormat),
    [relativeNow, activeTimeFormat],
  );

  const toApiAssetUrl = (path: string | null | undefined): string => {
    if (!path) {
      return "";
    }
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    if (path.startsWith("/")) {
      return `${API_BASE_URL}${path}`;
    }
    return path;
  };

  const formatPublishedAt = (timestamp?: number): string => {
    if (!timestamp) {
      return "--";
    }
    return formatDateByPattern(new Date(timestamp * 1000), activeTimeFormat);
  };

  const formatRelative = (timestamp?: number): string => {
    if (!timestamp) {
      return "--";
    }
    const diffSec = Math.max(
      0,
      Math.floor((relativeNow - timestamp * 1000) / 1000),
    );
    if (diffSec < 60) {
      return t("time.ago.seconds", { value: diffSec });
    }
    if (diffSec < 3600) {
      return t("time.ago.minutes", { value: Math.floor(diffSec / 60) });
    }
    if (diffSec < 86400) {
      return t("time.ago.hours", { value: Math.floor(diffSec / 3600) });
    }
    return t("time.ago.days", { value: Math.floor(diffSec / 86400) });
  };

  const toUnreadMap = (
    rows: Array<{ feed_id: number; unread_count: number }>,
  ) => {
    const next = new Map<number, number>();
    for (const row of rows) {
      next.set(row.feed_id, row.unread_count);
    }
    return next;
  };

  const refreshUnreadCounts = async () => {
    const rows = await fetchUnreadCounts();
    setUnreadByFeed(toUnreadMap(rows));
  };

  const refreshZoneCounts = async () => {
    const [allPage, unreadPage, starredPage, laterPage] = await Promise.all([
      fetchEntries({ state: "all", page: 1, pageSize: 1, sortBy: "updated" }),
      fetchEntries({
        state: "unread",
        page: 1,
        pageSize: 1,
        sortBy: "updated",
      }),
      fetchEntries({
        state: "starred",
        page: 1,
        pageSize: 1,
        sortBy: "updated",
      }),
      fetchEntries({ state: "later", page: 1, pageSize: 1, sortBy: "updated" }),
    ]);
    setZoneCounts({
      all: allPage.total_items || 0,
      unread: unreadPage.total_items || 0,
      starred: starredPage.total_items || 0,
      later: laterPage.total_items || 0,
    });
  };

  const refreshBase = async () => {
    const [folderRows, feedRows, unreadRows, settings, plugins] =
      await Promise.all([
        fetchFolders(),
        fetchFeeds(),
        fetchUnreadCounts(),
        getGeneralSettings(),
        fetchPluginSettings(),
      ]);
    setFolders(folderRows);
    setFeeds(feedRows);
    setUnreadByFeed(toUnreadMap(unreadRows));
    setSettingsDraft(settings);
    setPluginSettings(plugins);
    const pluginDetails = await Promise.all(
      plugins.enabled.map(async (pluginId) => {
        try {
          const detail = await fetchPluginProvidedSettings(pluginId);
          return [pluginId, detail] as const;
        } catch {
          return null;
        }
      }),
    );
    const nextPluginMap: Record<string, PluginProvidedSettings> = {};
    for (const row of pluginDetails) {
      if (!row) {
        continue;
      }
      nextPluginMap[row[0]] = row[1];
    }
    setPluginSettingMap(nextPluginMap);

    if (!debugFeedId && feedRows.length > 0) {
      setDebugFeedId(feedRows[0].id);
    }
  };

  const applyClientFilters = (rows: Entry[]): Entry[] => {
    let filtered = rows;

    if (selectedFeed != null) {
      filtered = filtered.filter((entry) => entry.feed_id === selectedFeed);
    } else if (selectedFolder != null) {
      filtered = filtered.filter((entry) =>
        selectedFolderFeedIds.has(entry.feed_id),
      );
    }

    if (activeZone === "unread") {
      filtered = filtered.filter((entry) => !entry.is_read);
    }
    if (activeZone === "starred") {
      filtered = filtered.filter((entry) => Boolean(entry.is_starred));
    }
    if (activeZone === "later") {
      filtered = filtered.filter((entry) => Boolean(entry.is_later));
    }

    const sorted = [...filtered];
    if (entrySort === "title") {
      sorted.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    } else {
      sorted.sort((a, b) => (b.published_at || 0) - (a.published_at || 0));
    }

    return sorted;
  };

  const paginateRows = (rows: Entry[], page: number) => {
    const safePage = Math.max(1, page);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const current = Math.min(safePage, pages);
    const start = (current - 1) * PAGE_SIZE;
    return {
      current,
      pages,
      total: rows.length,
      items: rows.slice(start, start + PAGE_SIZE),
    };
  };

  const replaceEntries = (
    nextEntries: Entry[],
    page: number,
    pages: number,
    total: number,
  ) => {
    setEntries(nextEntries);
    setCurrentPage(page);
    setTotalPages(Math.max(1, pages));
    setTotalItems(Math.max(0, total));
    setSelectedEntry(
      (prev) =>
        nextEntries.find((item) => item.id === prev?.id) ??
        nextEntries[0] ??
        null,
    );
    setSelectedEntryIds((prev) =>
      prev.filter((id) => nextEntries.some((entry) => entry.id === id)),
    );
  };

  const refreshEntries = async (nextPage: number) => {
    setLoadingEntries(true);
    try {
      if (searchKeyword) {
        const rows = await searchEntries(searchKeyword, searchScope);
        const filteredRows = applyClientFilters(rows);
        const paged = paginateRows(filteredRows, nextPage);
        replaceEntries(paged.items, paged.current, paged.pages, paged.total);
        return;
      }

      const page = await fetchEntries({
        feedId: selectedFeed ?? undefined,
        folderId:
          selectedFeed == null ? (selectedFolder ?? undefined) : undefined,
        state: activeZone,
        page: nextPage,
        pageSize: PAGE_SIZE,
        sortBy: entrySort,
      });
      replaceEntries(
        page.items,
        page.current_page || 1,
        page.total_pages || 1,
        page.total_items || 0,
      );
    } finally {
      setLoadingEntries(false);
    }
  };

  const updateEntryState = (entryId: number, patch: Partial<Entry>) => {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === entryId ? { ...entry, ...patch } : entry,
      ),
    );
    setSelectedEntry((prev) =>
      prev && prev.id === entryId ? { ...prev, ...patch } : prev,
    );
  };

  const adjustUnreadCount = (feedId: number, delta: number) => {
    if (!delta) {
      return;
    }
    setUnreadByFeed((prev) => {
      const next = new Map(prev);
      const current = next.get(feedId) ?? 0;
      next.set(feedId, Math.max(0, current + delta));
      return next;
    });
  };

  const toggleRead = async (target?: Entry) => {
    const entry = target ?? selectedEntry;
    if (!entry) {
      return;
    }
    const oldValue = Boolean(entry.is_read);
    const next = !entry.is_read;
    await markEntryRead(entry.id, next);
    updateEntryState(entry.id, { is_read: next });
    if (!oldValue && next) {
      adjustUnreadCount(entry.feed_id, -1);
    } else if (oldValue && !next) {
      adjustUnreadCount(entry.feed_id, 1);
    }
    await refreshZoneCounts();
  };

  const toggleStar = async (target?: Entry) => {
    const entry = target ?? selectedEntry;
    if (!entry) {
      return;
    }
    const next = !entry.is_starred;
    await markEntryStar(entry.id, next);
    updateEntryState(entry.id, { is_starred: next });
    await refreshZoneCounts();
  };

  const toggleLater = async (target?: Entry) => {
    const entry = target ?? selectedEntry;
    if (!entry) {
      return;
    }
    const next = !entry.is_later;
    await markEntryLater(entry.id, next);
    updateEntryState(entry.id, { is_later: next });
    await refreshZoneCounts();
  };

  const markCurrentPageRead = async () => {
    const ids = entries.map((entry) => entry.id);
    if (!ids.length) {
      return;
    }
    await batchUpdateEntries(ids, { is_read: true });
    setEntries((prev) => prev.map((entry) => ({ ...entry, is_read: true })));
    setSelectedEntry((prev) => (prev ? { ...prev, is_read: true } : prev));
    await Promise.all([refreshUnreadCounts(), refreshZoneCounts()]);
  };

  const markSelectedRead = async () => {
    if (!selectedEntryIds.length) {
      return;
    }
    await batchUpdateEntries(selectedEntryIds, { is_read: true });
    setEntries((prev) =>
      prev.map((entry) =>
        selectedEntryIds.includes(entry.id)
          ? { ...entry, is_read: true }
          : entry,
      ),
    );
    setSelectedEntry((prev) =>
      prev && selectedEntryIds.includes(prev.id)
        ? { ...prev, is_read: true }
        : prev,
    );
    setSelectedEntryIds([]);
    await Promise.all([refreshUnreadCounts(), refreshZoneCounts()]);
  };

  const markAllInScopeRead = async () => {
    const dedup = new Set<number>();

    if (searchKeyword) {
      const rows = await searchEntries(searchKeyword, searchScope);
      const filteredRows = applyClientFilters(rows);
      for (const row of filteredRows) {
        if (!row.is_read) {
          dedup.add(row.id);
        }
      }
    } else {
      let nextPage = 1;
      let total = 1;
      while (nextPage <= total && nextPage <= 500) {
        const page = await fetchEntries({
          feedId: selectedFeed ?? undefined,
          folderId:
            selectedFeed == null ? (selectedFolder ?? undefined) : undefined,
          state: "unread",
          page: nextPage,
          pageSize: 200,
          sortBy: "updated",
        });
        for (const row of page.items) {
          dedup.add(row.id);
        }
        total = page.total_pages || 1;
        nextPage += 1;
      }
    }

    const ids = [...dedup];
    if (!ids.length) {
      return;
    }
    for (let index = 0; index < ids.length; index += 200) {
      await batchUpdateEntries(ids.slice(index, index + 200), {
        is_read: true,
      });
    }
    await Promise.all([
      refreshEntries(1),
      refreshUnreadCounts(),
      refreshZoneCounts(),
    ]);
  };

  const handleRunSearch = async () => {
    const keyword = searchInput.trim();
    setSearchKeyword(keyword);
    await refreshEntries(1);
  };

  const handleClearSearch = async () => {
    setSearchInput("");
    setSearchKeyword("");
    await refreshEntries(1);
  };

  const handleSaveGeneralSettings = async () => {
    const saved = await updateGeneralSettings({
      ...settingsDraft,
      default_fetch_interval_min: Math.max(
        1,
        Math.min(1440, settingsDraft.default_fetch_interval_min),
      ),
      cleanup_retention_days: Math.max(
        1,
        Math.min(3650, settingsDraft.cleanup_retention_days),
      ),
      auto_refresh_interval_sec: Math.max(
        0,
        Math.min(86400, settingsDraft.auto_refresh_interval_sec),
      ),
      time_format: normalizeTimeFormat(settingsDraft.time_format),
    });
    setSettingsDraft(saved);
  };

  const handleTogglePlugin = (name: string, enabled: boolean) => {
    setPluginSettings((prev) => {
      const set = new Set(prev.enabled);
      if (enabled) {
        set.add(name);
      } else {
        set.delete(name);
      }
      return { ...prev, enabled: [...set] };
    });
  };

  const handleSavePlugins = async () => {
    setSavingPlugins(true);
    try {
      const saved = await updatePluginSettings(pluginSettings.enabled);
      setPluginSettings(saved);
      const pluginDetails = await Promise.all(
        saved.enabled.map(async (pluginId) => {
          try {
            const detail = await fetchPluginProvidedSettings(pluginId);
            return [pluginId, detail] as const;
          } catch {
            return null;
          }
        }),
      );
      const nextPluginMap: Record<string, PluginProvidedSettings> = {};
      for (const row of pluginDetails) {
        if (!row) {
          continue;
        }
        nextPluginMap[row[0]] = row[1];
      }
      setPluginSettingMap(nextPluginMap);
    } finally {
      setSavingPlugins(false);
    }
  };

  const handlePluginAction = async (
    pluginId: string,
    action: PluginSettingAction,
  ) => {
    const key = `${pluginId}:${action.id}`;
    setPluginActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const updated = await invokePluginSettingAction(action);
      setPluginSettingMap((prev) => ({ ...prev, [pluginId]: updated }));
    } finally {
      setPluginActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleImportOpml = async (file: File) => {
    await importOpml(file);
    await Promise.all([refreshBase(), refreshEntries(1)]);
  };

  const handleExportOpml = async () => {
    const content = await exportOpml();
    const blob = new Blob([content], { type: "text/xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "subscriptions.opml";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const loadHealthStatus = async () => {
    setHealthLoading(true);
    setHealthLoadFailed(false);
    try {
      const status = await fetchHealthStatus();
      setHealthStatus(status);
    } catch {
      setHealthLoadFailed(true);
    } finally {
      setHealthLoading(false);
    }
  };

  const handleValidateAndAddFeed = async () => {
    const url = newFeedUrl.trim();
    if (!url) {
      return;
    }
    try {
      const validated = await validateFeedUrl(url);
      if (!validated.valid) {
        setNewFeedMessage(validated.message || t("sidebar.add_feed.fail"));
        return;
      }
      await createFeed({
        title: validated.title,
        url,
        site_url: validated.site_url ?? null,
        folder_id: newFeedFolderId,
      });
      setNewFeedUrl("");
      setNewFeedMessage(t("sidebar.add_feed.success"));
      await Promise.all([
        refreshBase(),
        refreshEntries(1),
        refreshZoneCounts(),
      ]);
    } catch {
      setNewFeedMessage(t("sidebar.add_feed.fail"));
    }
  };

  const openEditFeedDialog = (feedId: number) => {
    const feed = feeds.find((item) => item.id === feedId);
    if (!feed) {
      return;
    }
    setEditFeedDraft({
      id: feed.id,
      title: feed.title,
      url: feed.url,
      site_url: feed.site_url ?? "",
      folder_id: feed.folder_id ?? null,
      disabled: feed.disabled ?? false,
      fetch_interval_min: feed.fetch_interval_min ?? 30,
      fulltext_enabled: feed.fulltext_enabled ?? false,
      cleanup_retention_days:
        feed.cleanup_retention_days ?? settingsDraft.cleanup_retention_days,
      cleanup_keep_content:
        feed.cleanup_keep_content ?? settingsDraft.cleanup_keep_content,
      image_cache_enabled:
        feed.image_cache_enabled ?? settingsDraft.image_cache_enabled,
    });
    setFeedMenu(null);
  };

  const handleEditFeedSave = async () => {
    if (!editFeedDraft) {
      return;
    }
    const title = editFeedDraft.title.trim();
    const url = editFeedDraft.url.trim();
    if (!title || !url) {
      setError(t("edit.error.required"));
      return;
    }
    setSavingFeedEdit(true);
    try {
      await updateFeed(editFeedDraft.id, {
        title,
        url,
        site_url: editFeedDraft.site_url.trim() || null,
        folder_id: editFeedDraft.folder_id,
        disabled: editFeedDraft.disabled,
        fetch_interval_min: Math.max(1, editFeedDraft.fetch_interval_min),
        fulltext_enabled: editFeedDraft.fulltext_enabled,
        cleanup_retention_days: Math.max(
          1,
          Math.min(3650, editFeedDraft.cleanup_retention_days),
        ),
        cleanup_keep_content: editFeedDraft.cleanup_keep_content,
        image_cache_enabled: editFeedDraft.image_cache_enabled,
      });
      setEditFeedDraft(null);
      setError(null);
      await Promise.all([refreshBase(), refreshEntries(1)]);
    } finally {
      setSavingFeedEdit(false);
    }
  };

  const handleFeedDelete = async (feedId: number) => {
    const feed = feeds.find((item) => item.id === feedId);
    if (!feed) {
      return;
    }
    const ok = window.confirm(
      t("context.delete.confirm", { title: feed.title }),
    );
    if (!ok) {
      return;
    }
    await deleteFeed(feedId);
    if (selectedFeed === feedId) {
      setSelectedFeed(null);
    }
    setFeedMenu(null);
    await Promise.all([refreshBase(), refreshEntries(1), refreshZoneCounts()]);
  };

  const openDebugForFeed = async (feedId: number) => {
    setDebugFeedId(feedId);
    setDebugOpen(true);
    setFeedMenu(null);
    await refreshDebugData(feedId);
  };

  const refreshDebugData = async (feedId: number) => {
    const [logs, items] = await Promise.all([
      fetchDebugFeedLogs(feedId),
      fetchDebugFeedEntries(feedId),
    ]);
    setDebugLogs(logs);
    setDebugEntries(items);
  };

  const handleDebugRefresh = async () => {
    if (!debugFeedId) {
      return;
    }
    const result = await debugRefreshFeed(debugFeedId, true);
    setDebugMessage(
      result.queued
        ? t("debug.message.queued", { feedId: result.feed_id })
        : t("debug.message.done", {
            feedId: result.feed_id,
            added: result.added,
            status: result.last_status,
          }),
    );
    await Promise.all([
      refreshBase(),
      refreshDebugData(debugFeedId),
      refreshZoneCounts(),
    ]);
  };

  const handleSelectZone = (zone: ZoneKey) => {
    setActiveZone(zone);
    setSelectedFeed(null);
    setSelectedFolder(null);
  };

  const handleSelectFolder = (folderId: number) => {
    setSelectedFolder(folderId);
    setSelectedFeed(null);
  };

  const handleSelectFeed = (feed: Feed) => {
    setSelectedFeed(feed.id);
    setSelectedFolder(feed.folder_id ?? null);
  };

  const isFolderCollapsed = (folderId: number): boolean =>
    collapsedFolderIds.has(folderId);

  const toggleFolderCollapsed = (folderId: number) => {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleSignOut = async () => {
    await signOut();
  };

  useEffect(() => {
    void (async () => {
      try {
        await refreshBase();
        await refreshZoneCounts();
        await refreshEntries(1);
        setBootstrapped(true);
      } catch {
        setError(t("app.error.load"));
      }
    })();
  }, [t]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRelativeNow(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_MODE_KEY, themeMode);
    } catch {
      // Ignore storage errors.
    }
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    const applyTheme = () => {
      const system = media
        ? media.matches
          ? "dark"
          : "light"
        : detectSystemTheme();
      const next = themeMode === "system" ? system : themeMode;
      setEffectiveTheme(next);
      document.documentElement.setAttribute("data-theme", next);
    };
    applyTheme();
    if (themeMode !== "system" || !media) {
      return;
    }
    const listener = () => applyTheme();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    }
    media.addListener(listener);
    return () => media.removeListener(listener);
  }, [themeMode]);

  useEffect(() => {
    if (!bootstrapped) {
      return;
    }
    void refreshEntries(1);
  }, [
    selectedFeed,
    selectedFolder,
    activeZone,
    entrySort,
    searchKeyword,
    searchScope,
    bootstrapped,
  ]);

  useEffect(() => {
    const closeMenu = () => setFeedMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  useEffect(() => {
    if (!bootstrapped) {
      return;
    }
    const intervalSec = Math.max(
      0,
      settingsDraft.auto_refresh_interval_sec || 0,
    );
    if (intervalSec <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      if (autoRefreshRunningRef.current) {
        return;
      }
      autoRefreshRunningRef.current = true;
      void (async () => {
        try {
          await Promise.all([
            refreshBase(),
            refreshEntries(currentPage),
            refreshZoneCounts(),
          ]);
          if (debugOpen && debugFeedId) {
            await refreshDebugData(debugFeedId);
          }
        } finally {
          autoRefreshRunningRef.current = false;
        }
      })();
    }, intervalSec * 1000);
    return () => window.clearInterval(timer);
  }, [
    bootstrapped,
    settingsDraft.auto_refresh_interval_sec,
    currentPage,
    debugOpen,
    debugFeedId,
    activeZone,
    entrySort,
    searchKeyword,
    searchScope,
    selectedFeed,
    selectedFolder,
  ]);

  useEffect(() => {
    if (!debugOpen || !debugFeedId) {
      return;
    }
    void refreshDebugData(debugFeedId);
  }, [debugOpen, debugFeedId]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    void loadHealthStatus();
  }, [settingsOpen]);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }
      if (!entries.length) {
        return;
      }
      const index = entries.findIndex(
        (entry) => entry.id === selectedEntry?.id,
      );
      if (event.key === "j") {
        const next = entries[Math.min(index + 1, entries.length - 1)];
        if (next) {
          setSelectedEntry(next);
        }
      }
      if (event.key === "k") {
        const prev = entries[Math.max(index - 1, 0)];
        if (prev) {
          setSelectedEntry(prev);
        }
      }
      if (event.key === "m") {
        void toggleRead();
      }
      if (event.key === "s") {
        void toggleStar();
      }
      if (event.key === "t") {
        void toggleLater();
      }
      if (event.key === "o" && selectedEntrySafeUrl) {
        window.open(selectedEntrySafeUrl, "_blank", "noopener");
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [entries, selectedEntry, selectedEntrySafeUrl]);

  return (
    <div className="app-shell">
      <Topbar
        t={t}
        themeMode={themeMode}
        effectiveTheme={effectiveTheme}
        onThemeChange={setThemeMode}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenDebug={() => setDebugOpen(true)}
        onSignOut={() => void handleSignOut()}
      />

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="app-main">
        <Sidebar
          t={t}
          activeZone={activeZone}
          selectedFeed={selectedFeed}
          selectedFolder={selectedFolder}
          zoneCounts={zoneCounts}
          newFeedUrl={newFeedUrl}
          newFeedFolderId={newFeedFolderId}
          newFeedMessage={newFeedMessage}
          sortedFolders={sortedFolders}
          treeData={treeData}
          unreadByFeed={unreadByFeed}
          folderUnreadCountByFolder={folderUnreadCountByFolder}
          ungroupedUnreadCount={ungroupedUnreadCount}
          ungroupedCollapsed={ungroupedCollapsed}
          isFolderCollapsed={isFolderCollapsed}
          toApiAssetUrl={toApiAssetUrl}
          onSelectZone={handleSelectZone}
          onNewFeedUrlChange={setNewFeedUrl}
          onNewFeedFolderChange={setNewFeedFolderId}
          onAddFeed={() => void handleValidateAndAddFeed()}
          onToggleFolderCollapsed={toggleFolderCollapsed}
          onSelectFolder={handleSelectFolder}
          onSelectFeed={handleSelectFeed}
          onToggleUngrouped={() => setUngroupedCollapsed((prev) => !prev)}
          onFeedContextMenu={(event, feed) => {
            event.preventDefault();
            setFeedMenu({
              x: event.clientX,
              y: event.clientY,
              feedId: feed.id,
            });
          }}
        />

        <EntryList
          t={t}
          activeZone={activeZone}
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
          toApiAssetUrl={toApiAssetUrl}
          onChangeActiveZone={setActiveZone}
          onChangeEntrySort={setEntrySort}
          onChangeSearchScope={setSearchScope}
          onSearchInputChange={setSearchInput}
          onRunSearch={() => void handleRunSearch()}
          onClearSearch={() => void handleClearSearch()}
          onMarkCurrentPageRead={() => void markCurrentPageRead()}
          onMarkAllInScopeRead={() => void markAllInScopeRead()}
          onMarkSelectedRead={() => void markSelectedRead()}
          onRefreshPage={() => void refreshEntries(currentPage)}
          onPrevPage={() => void refreshEntries(currentPage - 1)}
          onNextPage={() => void refreshEntries(currentPage + 1)}
          onSelectEntry={setSelectedEntry}
          onToggleStar={(entry) => void toggleStar(entry)}
          onToggleSelectedEntry={(entryId, checked) => {
            setSelectedEntryIds((prev) => {
              if (checked) {
                return prev.includes(entryId) ? prev : [...prev, entryId];
              }
              return prev.filter((id) => id !== entryId);
            });
          }}
        />

        <ReaderPane
          t={t}
          selectedEntry={selectedEntry}
          selectedEntryFeed={selectedEntryFeed}
          selectedEntrySafeUrl={selectedEntrySafeUrl}
          articleHtml={articleHtml}
          formatPublishedAt={formatPublishedAt}
          toApiAssetUrl={toApiAssetUrl}
          onToggleRead={() => void toggleRead()}
          onToggleStar={() => void toggleStar()}
          onToggleLater={() => void toggleLater()}
        />
      </div>

      {feedMenu ? (
        <FeedContextMenu
          t={t}
          x={feedMenu.x}
          y={feedMenu.y}
          onEdit={() => openEditFeedDialog(feedMenu.feedId)}
          onDebug={() => void openDebugForFeed(feedMenu.feedId)}
          onDelete={() => void handleFeedDelete(feedMenu.feedId)}
        />
      ) : null}

      <EditFeedDialog
        t={t}
        editFeedDraft={editFeedDraft}
        savingFeedEdit={savingFeedEdit}
        sortedFolders={sortedFolders}
        onClose={() => setEditFeedDraft(null)}
        onSave={() => void handleEditFeedSave()}
        onChangeDraft={setEditFeedDraft}
      />

      <SettingsDrawer
        t={t}
        open={settingsOpen}
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
        onClose={() => setSettingsOpen(false)}
        onSettingsDraftChange={setSettingsDraft}
        onSaveGeneralSettings={() => void handleSaveGeneralSettings()}
        onLangModeChange={setLangMode}
        onImportOpml={(file) => void handleImportOpml(file)}
        onExportOpml={() => void handleExportOpml()}
        formatSuccessRate={formatSuccessRate}
        onTogglePlugin={handleTogglePlugin}
        onSavePlugins={() => void handleSavePlugins()}
        onPluginAction={(pluginId, action) =>
          void handlePluginAction(pluginId, action)
        }
      />

      <DebugDrawer
        t={t}
        open={debugOpen}
        debugFeedId={debugFeedId}
        feeds={feeds}
        debugMessage={debugMessage}
        debugLogs={debugLogs}
        debugEntries={debugEntries}
        formatPublishedAt={formatPublishedAt}
        toSafeExternalHttpUrl={toSafeExternalHttpUrl}
        toPlainText={toPlainText}
        onClose={() => setDebugOpen(false)}
        onChangeFeedId={setDebugFeedId}
        onRefresh={() => void handleDebugRefresh()}
        onRefreshLogs={() => {
          if (debugFeedId) {
            void refreshDebugData(debugFeedId);
          }
        }}
      />

      {selectedFeedObject ? (
        <footer className="app-footer">
          {t("footer.current_feed", {
            title: selectedFeedObject.title,
            interval:
              selectedFeedObject.fetch_interval_min ??
              settingsDraft.default_fetch_interval_min,
            status: (selectedFeedObject.fulltext_enabled ??
              settingsDraft.fulltext_enabled)
              ? t("common.enabled")
              : t("common.disabled"),
          })}
        </footer>
      ) : null}
    </div>
  );
}
