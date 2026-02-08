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
import {
  UIBadge,
  UIButton,
  UICheckbox,
  UIDialog,
  UIInput,
  UISelect,
  UISeparator,
  UIScrollArea,
  UISheet,
  UITooltip,
} from "./components/ui";
import { useAuth } from "./auth/AuthProvider";
import { useI18n } from "./i18n";

const PAGE_SIZE = 40;
const THEME_MODE_KEY = "rss_theme_mode";
const DEFAULT_TIME_FORMAT = "YYYY-MM-DD HH:mm:ss";
const TIME_FORMAT_TOKEN_PATTERN = /YYYY|MM|DD|HH|mm|ss/g;

type EntryStateFilter = "all" | "unread" | "starred" | "later";
type ZoneKey = EntryStateFilter;
type SearchScope = "all" | "title" | "summary" | "content";
type EntrySort = "updated" | "title";
type ThemeMode = "light" | "dark" | "system";

interface EditFeedDraft {
  id: number;
  title: string;
  url: string;
  site_url: string;
  folder_id: number | null;
  fetch_interval_min: number;
  fulltext_enabled: boolean;
  cleanup_retention_days: number;
  cleanup_keep_content: boolean;
  image_cache_enabled: boolean;
}

interface FeedMenuState {
  x: number;
  y: number;
  feedId: number;
}

interface ZoneCountState {
  all: number;
  unread: number;
  starred: number;
  later: number;
}

const defaultSettings: GeneralSettings = {
  default_fetch_interval_min: 30,
  fulltext_enabled: false,
  cleanup_retention_days: 30,
  cleanup_keep_content: true,
  image_cache_enabled: false,
  auto_refresh_interval_sec: 0,
  time_format: DEFAULT_TIME_FORMAT,
};

function toPlainText(value?: string | null): string {
  if (!value) {
    return "";
  }
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function readThemeMode(): ThemeMode {
  try {
    const value = window.localStorage.getItem(THEME_MODE_KEY);
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
  } catch {
    return "system";
  }
  return "system";
}

function detectSystemTheme(): "light" | "dark" {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function normalizeTimeFormat(value: string): string {
  const trimmed = value.trim();
  return trimmed || DEFAULT_TIME_FORMAT;
}

export function toSafeExternalHttpUrl(value?: string | null): string | null {
  const raw = (value || "").trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname
    ) {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function formatDateByPattern(date: Date, format: string): string {
  const normalizedFormat = normalizeTimeFormat(format);
  const tokenValues: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    DD: String(date.getDate()).padStart(2, "0"),
    HH: String(date.getHours()).padStart(2, "0"),
    mm: String(date.getMinutes()).padStart(2, "0"),
    ss: String(date.getSeconds()).padStart(2, "0"),
  };
  return normalizedFormat.replace(
    TIME_FORMAT_TOKEN_PATTERN,
    (token) => tokenValues[token] ?? token,
  );
}

function formatSuccessRate(value: number): string {
  const clamped = Math.min(1, Math.max(0, value || 0));
  return `${(clamped * 100).toFixed(1)}%`;
}

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

  const articleHtml = useMemo(() => {
    const source =
      selectedEntry?.content_html || selectedEntry?.summary || t("common.none");
    return source.replace(
      /src="\/api\/cache\//g,
      `src="${API_BASE_URL}/api/cache/`,
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

  const handleSignOut = async () => {
    await signOut();
  };

  const renderSettingLabel = (title: string, description: string) => (
    <span className="setting-label">
      <span>{title}</span>
      <UITooltip content={description}>
        <span
          className="setting-help-trigger"
          role="img"
          aria-label={t("help.aria", { title })}
        >
          i
        </span>
      </UITooltip>
    </span>
  );

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
      <header className="app-topbar">
        <div className="brand">{t("common.app_name")}</div>
        <div className="topbar-actions">
          <UISelect
            value={themeMode}
            onChange={(event) => setThemeMode(event.target.value as ThemeMode)}
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
          <UIButton variant="outline" onClick={() => setSettingsOpen(true)}>
            {t("topbar.settings")}
          </UIButton>
          <UIButton variant="outline" onClick={() => setDebugOpen(true)}>
            {t("topbar.debug")}
          </UIButton>
          <UIButton variant="outline" onClick={() => void handleSignOut()}>
            {t("topbar.signout")}
          </UIButton>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="app-main">
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
                onClick={() => handleSelectZone("all")}
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
                onClick={() => handleSelectZone("unread")}
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
                onClick={() => handleSelectZone("starred")}
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
                onClick={() => handleSelectZone("later")}
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
                onChange={(event) => setNewFeedUrl(event.target.value)}
                placeholder={t("sidebar.add_feed.placeholder")}
              />
              <UISelect
                value={newFeedFolderId ?? ""}
                onChange={(event) =>
                  setNewFeedFolderId(
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
              <UIButton onClick={() => void handleValidateAndAddFeed()}>
                {t("sidebar.add_feed.button")}
              </UIButton>
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
                    <button
                      type="button"
                      className={
                        selectedFolder === folder.id && selectedFeed == null
                          ? "tree-row folder-row active"
                          : "tree-row folder-row"
                      }
                      onClick={() => handleSelectFolder(folder.id)}
                    >
                      <span>{folder.name}</span>
                    </button>
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
                          onClick={() => handleSelectFeed(feed)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setFeedMenu({
                              x: event.clientX,
                              y: event.clientY,
                              feedId: feed.id,
                            });
                          }}
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
                  </div>
                ))}

                {treeData.noFolder.length > 0 ? (
                  <div className="tree-folder">
                    <div className="tree-row folder-row">
                      {t("sidebar.ungrouped")}
                    </div>
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
                          onClick={() => handleSelectFeed(feed)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setFeedMenu({
                              x: event.clientX,
                              y: event.clientY,
                              feedId: feed.id,
                            });
                          }}
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
                  </div>
                ) : null}
              </div>
            </UIScrollArea>
          </section>
        </aside>

        <main className="column list-column">
          <div className="list-toolbar primary-toolbar">
            <UISelect
              value={activeZone}
              onChange={(event) =>
                setActiveZone(event.target.value as EntryStateFilter)
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
                setEntrySort(event.target.value as EntrySort)
              }
            >
              <option value="updated">{t("toolbar.sort.updated")}</option>
              <option value="title">{t("toolbar.sort.title")}</option>
            </UISelect>
            <UISelect
              value={searchScope}
              onChange={(event) =>
                setSearchScope(event.target.value as SearchScope)
              }
            >
              <option value="all">{t("toolbar.scope.all")}</option>
              <option value="title">{t("toolbar.scope.title")}</option>
              <option value="summary">{t("toolbar.scope.summary")}</option>
              <option value="content">{t("toolbar.scope.content")}</option>
            </UISelect>
            <UIInput
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleRunSearch();
                }
              }}
              placeholder={t("toolbar.search.placeholder")}
            />
            <UIButton onClick={() => void handleRunSearch()}>
              {t("common.search")}
            </UIButton>
            <UIButton
              variant="ghost"
              onClick={() => void handleClearSearch()}
              disabled={!searchInput && !searchKeyword}
            >
              {t("common.clear")}
            </UIButton>
          </div>

          <div className="list-toolbar secondary-toolbar">
            <UIButton onClick={() => void markCurrentPageRead()}>
              {t("toolbar.batch.page_read")}
            </UIButton>
            <UIButton onClick={() => void markAllInScopeRead()}>
              {t("toolbar.batch.all_read")}
            </UIButton>
            <UIButton
              variant="secondary"
              onClick={() => void markSelectedRead()}
              disabled={!selectedEntryIds.length}
            >
              {t("toolbar.batch.selected_read")}
            </UIButton>
            <UIButton
              variant="outline"
              onClick={() => void refreshEntries(currentPage)}
            >
              {t("common.refresh")}
            </UIButton>
            <UIButton
              variant="outline"
              onClick={() => void refreshEntries(currentPage - 1)}
              disabled={currentPage <= 1 || loadingEntries}
            >
              {t("toolbar.pager.prev")}
            </UIButton>
            <UIButton
              variant="outline"
              onClick={() => void refreshEntries(currentPage + 1)}
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
                    onClick={() => setSelectedEntry(entry)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        setSelectedEntry(entry);
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
                        onChange={(event) => {
                          setSelectedEntryIds((prev) => {
                            if (event.target.checked) {
                              return prev.includes(entry.id)
                                ? prev
                                : [...prev, entry.id];
                            }
                            return prev.filter((id) => id !== entry.id);
                          });
                        }}
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
                          void toggleStar(entry);
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
                        {t("common.source")}:{" "}
                        {feed?.title ?? `#${entry.feed_id}`}
                      </div>
                      <div className="entry-updated">
                        {t("common.updated")}:{" "}
                        {formatPublishedAt(entry.published_at)}
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
                    {t("common.source")}:{" "}
                    {selectedEntryFeed?.title ?? `#${selectedEntry.feed_id}`}
                  </span>
                  <span>
                    {t("common.published")}:{" "}
                    {formatPublishedAt(selectedEntry.published_at)}
                  </span>
                </div>
                <div className="reader-actions">
                  <UIButton onClick={() => void toggleRead()}>
                    {selectedEntry.is_read
                      ? t("reader.action.unread")
                      : t("reader.action.read")}
                  </UIButton>
                  <UIButton onClick={() => void toggleStar()}>
                    {selectedEntry.is_starred
                      ? t("reader.action.unstar")
                      : t("reader.action.star")}
                  </UIButton>
                  <UIButton onClick={() => void toggleLater()}>
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
      </div>

      {feedMenu ? (
        <div
          className="context-menu"
          style={{ left: feedMenu.x, top: feedMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <UIButton
            variant="outline"
            onClick={() => openEditFeedDialog(feedMenu.feedId)}
          >
            {t("context.edit")}
          </UIButton>
          <UIButton
            variant="outline"
            onClick={() => void openDebugForFeed(feedMenu.feedId)}
          >
            {t("context.debug")}
          </UIButton>
          <UIButton
            variant="danger"
            onClick={() => void handleFeedDelete(feedMenu.feedId)}
          >
            {t("context.delete")}
          </UIButton>
        </div>
      ) : null}

      <UIDialog
        open={Boolean(editFeedDraft)}
        title={t("edit.title")}
        closeLabel={t("common.close")}
        onClose={() => setEditFeedDraft(null)}
        footer={
          <>
            <UIButton variant="outline" onClick={() => setEditFeedDraft(null)}>
              {t("common.cancel")}
            </UIButton>
            <UIButton
              onClick={() => void handleEditFeedSave()}
              disabled={savingFeedEdit}
            >
              {savingFeedEdit ? t("edit.save.loading") : t("common.save")}
            </UIButton>
          </>
        }
      >
        {editFeedDraft ? (
          <form
            className="edit-feed-form"
            onSubmit={(event) => event.preventDefault()}
          >
            <label>
              <span>{t("edit.field.title")}</span>
              <UIInput
                value={editFeedDraft.title}
                onChange={(event) =>
                  setEditFeedDraft((prev) =>
                    prev ? { ...prev, title: event.target.value } : prev,
                  )
                }
              />
            </label>
            <label>
              <span>{t("edit.field.url")}</span>
              <UIInput
                value={editFeedDraft.url}
                onChange={(event) =>
                  setEditFeedDraft((prev) =>
                    prev ? { ...prev, url: event.target.value } : prev,
                  )
                }
              />
            </label>
            <label>
              <span>{t("edit.field.site_url")}</span>
              <UIInput
                value={editFeedDraft.site_url}
                onChange={(event) =>
                  setEditFeedDraft((prev) =>
                    prev ? { ...prev, site_url: event.target.value } : prev,
                  )
                }
              />
            </label>
            <label>
              <span>{t("edit.field.folder")}</span>
              <UISelect
                value={editFeedDraft.folder_id ?? ""}
                onChange={(event) =>
                  setEditFeedDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          folder_id: event.target.value
                            ? Number(event.target.value)
                            : null,
                        }
                      : prev,
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
            </label>
            <label>
              <span>{t("edit.field.interval")}</span>
              <UIInput
                type="number"
                min={1}
                max={1440}
                value={editFeedDraft.fetch_interval_min}
                onChange={(event) =>
                  setEditFeedDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          fetch_interval_min: Number(event.target.value) || 1,
                        }
                      : prev,
                  )
                }
              />
            </label>
            <label className="checkbox-label">
              <UICheckbox
                checked={editFeedDraft.fulltext_enabled}
                onChange={(event) =>
                  setEditFeedDraft((prev) =>
                    prev
                      ? { ...prev, fulltext_enabled: event.target.checked }
                      : prev,
                  )
                }
              />
              <span>{t("edit.field.fulltext")}</span>
            </label>
            <label>
              <span>{t("edit.field.retention")}</span>
              <UIInput
                type="number"
                min={1}
                max={3650}
                value={editFeedDraft.cleanup_retention_days}
                onChange={(event) =>
                  setEditFeedDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          cleanup_retention_days:
                            Number(event.target.value) || 1,
                        }
                      : prev,
                  )
                }
              />
            </label>
            <label className="checkbox-label">
              <UICheckbox
                checked={editFeedDraft.cleanup_keep_content}
                onChange={(event) =>
                  setEditFeedDraft((prev) =>
                    prev
                      ? { ...prev, cleanup_keep_content: event.target.checked }
                      : prev,
                  )
                }
              />
              <span>{t("edit.field.keep_content")}</span>
            </label>
            <label className="checkbox-label">
              <UICheckbox
                checked={editFeedDraft.image_cache_enabled}
                onChange={(event) =>
                  setEditFeedDraft((prev) =>
                    prev
                      ? { ...prev, image_cache_enabled: event.target.checked }
                      : prev,
                  )
                }
              />
              <span>{t("edit.field.image_cache")}</span>
            </label>
          </form>
        ) : null}
      </UIDialog>

      <UISheet
        open={settingsOpen}
        title={t("settings.title")}
        closeLabel={t("common.close")}
        onClose={() => setSettingsOpen(false)}
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
                  setSettingsDraft((prev) => ({
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
                  setSettingsDraft((prev) => ({
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
                  setSettingsDraft((prev) => ({
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
                  setSettingsDraft((prev) => ({
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
                  setSettingsDraft((prev) => ({
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
                  setSettingsDraft((prev) => ({
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
                  setLangMode(event.target.value as "system" | "zh" | "en")
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
                    setSettingsDraft((prev) => ({
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
            <UIButton onClick={() => void handleSaveGeneralSettings()}>
              {t("settings.save")}
            </UIButton>
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
                  void handleImportOpml(file);
                  event.target.value = "";
                }}
              />
            </label>
            <UIButton onClick={() => void handleExportOpml()}>
              {t("settings.opml.export")}
            </UIButton>
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
                    onChange={(event) =>
                      handleTogglePlugin(name, event.target.checked)
                    }
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
                (!pluginSettingMap[name] ||
                  !pluginSettingMap[name].items?.length) ? (
                  <div className="muted-text">
                    {t("settings.plugins.no_items")}
                  </div>
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
                          onClick={() => void handlePluginAction(name, action)}
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
            <UIButton
              onClick={() => void handleSavePlugins()}
              disabled={savingPlugins}
            >
              {savingPlugins
                ? t("settings.plugins.save.loading")
                : t("settings.plugins.save")}
            </UIButton>
          </div>
          <div className="muted-text">{t("settings.plugins.note")}</div>
        </section>
      </UISheet>

      <UISheet
        open={debugOpen}
        title={t("debug.title")}
        closeLabel={t("common.close")}
        onClose={() => setDebugOpen(false)}
      >
        <section className="drawer-section">
          <h4>{t("debug.section.control")}</h4>
          <div className="drawer-actions">
            <UISelect
              value={debugFeedId ?? ""}
              onChange={(event) => setDebugFeedId(Number(event.target.value))}
            >
              {feeds.map((feed) => (
                <option key={feed.id} value={feed.id}>
                  {feed.title}
                </option>
              ))}
            </UISelect>
            <UIButton
              onClick={() => void handleDebugRefresh()}
              disabled={!debugFeedId}
            >
              {t("debug.action.refresh")}
            </UIButton>
            <UIButton
              variant="outline"
              onClick={() => {
                if (debugFeedId) {
                  void refreshDebugData(debugFeedId);
                }
              }}
              disabled={!debugFeedId}
            >
              {t("debug.action.refresh_logs")}
            </UIButton>
          </div>
          {debugMessage ? (
            <div className="inline-message">{debugMessage}</div>
          ) : null}
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
                <span
                  className={log.error_message ? "error-text" : "muted-text"}
                >
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
