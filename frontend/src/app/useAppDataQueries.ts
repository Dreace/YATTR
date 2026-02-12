import type { Dispatch, SetStateAction } from "react";
import {
  fetchEntries,
  fetchFeeds,
  fetchFolders,
  fetchPluginProvidedSettings,
  fetchPluginSettings,
  fetchUnreadCounts,
  getGeneralSettings,
  searchEntries,
  type Entry,
  type Feed,
  type Folder,
  type GeneralSettings,
  type PluginProvidedSettings,
  type PluginSettings,
} from "../api";
import { PAGE_SIZE } from "./constants";
import type { EntrySort, SearchScope, ZoneCountState, ZoneKey } from "./types";

interface BuildAppDataQueriesParams {
  debugFeedId: number | null;
  selectedFeed: number | null;
  selectedFolder: number | null;
  selectedFolderFeedIds: Set<number>;
  activeZone: ZoneKey;
  entrySort: EntrySort;
  searchKeyword: string;
  searchScope: SearchScope;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  setFeeds: Dispatch<SetStateAction<Feed[]>>;
  setUnreadByFeed: Dispatch<SetStateAction<Map<number, number>>>;
  setSettingsDraft: Dispatch<SetStateAction<GeneralSettings>>;
  setPluginSettings: Dispatch<SetStateAction<PluginSettings>>;
  setPluginSettingMap: Dispatch<SetStateAction<Record<string, PluginProvidedSettings>>>;
  setDebugFeedId: Dispatch<SetStateAction<number | null>>;
  setZoneCounts: Dispatch<SetStateAction<ZoneCountState>>;
  setEntries: Dispatch<SetStateAction<Entry[]>>;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  setTotalPages: Dispatch<SetStateAction<number>>;
  setTotalItems: Dispatch<SetStateAction<number>>;
  setSelectedEntry: Dispatch<SetStateAction<Entry | null>>;
  setSelectedEntryIds: Dispatch<SetStateAction<number[]>>;
  setLoadingEntries: Dispatch<SetStateAction<boolean>>;
}

function toUnreadMap(rows: Array<{ feed_id: number; unread_count: number }>) {
  const next = new Map<number, number>();
  for (const row of rows) {
    next.set(row.feed_id, row.unread_count);
  }
  return next;
}

export function buildAppDataQueries(params: BuildAppDataQueriesParams) {
  const applyClientFilters = (rows: Entry[]): Entry[] => {
    let filtered = rows;

    if (params.selectedFeed != null) {
      filtered = filtered.filter((entry) => entry.feed_id === params.selectedFeed);
    } else if (params.selectedFolder != null) {
      filtered = filtered.filter((entry) =>
        params.selectedFolderFeedIds.has(entry.feed_id),
      );
    }

    if (params.activeZone === "unread") {
      filtered = filtered.filter((entry) => !entry.is_read);
    }
    if (params.activeZone === "starred") {
      filtered = filtered.filter((entry) => Boolean(entry.is_starred));
    }
    if (params.activeZone === "later") {
      filtered = filtered.filter((entry) => Boolean(entry.is_later));
    }

    const sorted = [...filtered];
    if (params.entrySort === "title") {
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
    params.setEntries(nextEntries);
    params.setCurrentPage(page);
    params.setTotalPages(Math.max(1, pages));
    params.setTotalItems(Math.max(0, total));
    params.setSelectedEntry(
      (prev) =>
        nextEntries.find((item) => item.id === prev?.id) ?? nextEntries[0] ?? null,
    );
    params.setSelectedEntryIds((prev) =>
      prev.filter((id) => nextEntries.some((entry) => entry.id === id)),
    );
  };

  const refreshUnreadCounts = async () => {
    const rows = await fetchUnreadCounts();
    params.setUnreadByFeed(toUnreadMap(rows));
  };

  const refreshZoneCounts = async () => {
    const [allPage, unreadPage, starredPage, laterPage] = await Promise.all([
      fetchEntries({ state: "all", page: 1, pageSize: 1, sortBy: "updated" }),
      fetchEntries({ state: "unread", page: 1, pageSize: 1, sortBy: "updated" }),
      fetchEntries({ state: "starred", page: 1, pageSize: 1, sortBy: "updated" }),
      fetchEntries({ state: "later", page: 1, pageSize: 1, sortBy: "updated" }),
    ]);
    params.setZoneCounts({
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
    params.setFolders(folderRows);
    params.setFeeds(feedRows);
    params.setUnreadByFeed(toUnreadMap(unreadRows));
    params.setSettingsDraft(settings);
    params.setPluginSettings(plugins);

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
      if (row) {
        nextPluginMap[row[0]] = row[1];
      }
    }
    params.setPluginSettingMap(nextPluginMap);

    if (!params.debugFeedId && feedRows.length > 0) {
      params.setDebugFeedId(feedRows[0].id);
    }
  };

  const refreshEntries = async (nextPage: number) => {
    params.setLoadingEntries(true);
    try {
      if (params.searchKeyword) {
        const rows = await searchEntries(params.searchKeyword, params.searchScope);
        const filteredRows = applyClientFilters(rows);
        const paged = paginateRows(filteredRows, nextPage);
        replaceEntries(paged.items, paged.current, paged.pages, paged.total);
        return;
      }

      const page = await fetchEntries({
        feedId: params.selectedFeed ?? undefined,
        folderId:
          params.selectedFeed == null ? (params.selectedFolder ?? undefined) : undefined,
        state: params.activeZone,
        page: nextPage,
        pageSize: PAGE_SIZE,
        sortBy: params.entrySort,
      });
      replaceEntries(
        page.items,
        page.current_page || 1,
        page.total_pages || 1,
        page.total_items || 0,
      );
    } finally {
      params.setLoadingEntries(false);
    }
  };

  return {
    refreshUnreadCounts,
    refreshZoneCounts,
    refreshBase,
    refreshEntries,
  };
}
