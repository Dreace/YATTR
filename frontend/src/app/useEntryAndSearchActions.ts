import type { Dispatch, SetStateAction } from "react";
import {
  batchUpdateEntries,
  fetchEntries,
  markEntryLater,
  markEntryRead,
  markEntryStar,
  searchEntries,
  type Entry,
} from "../api";
import type { EntrySort, SearchScope, ZoneKey } from "./types";

interface BuildEntryAndSearchActionsParams {
  entries: Entry[];
  selectedEntry: Entry | null;
  selectedEntryIds: number[];
  selectedFeed: number | null;
  selectedFolder: number | null;
  selectedFolderFeedIds: Set<number>;
  activeZone: ZoneKey;
  entrySort: EntrySort;
  searchScope: SearchScope;
  searchInput: string;
  searchKeyword: string;
  setEntries: Dispatch<SetStateAction<Entry[]>>;
  setSelectedEntry: Dispatch<SetStateAction<Entry | null>>;
  setSelectedEntryIds: Dispatch<SetStateAction<number[]>>;
  setSearchInput: Dispatch<SetStateAction<string>>;
  setSearchKeyword: Dispatch<SetStateAction<string>>;
  setUnreadByFeed: Dispatch<SetStateAction<Map<number, number>>>;
  refreshUnreadCounts: () => Promise<void>;
  refreshZoneCounts: () => Promise<void>;
  refreshEntries: (page: number) => Promise<void>;
}

export function buildEntryAndSearchActions(params: BuildEntryAndSearchActionsParams) {
  const updateEntryState = (entryId: number, patch: Partial<Entry>) => {
    params.setEntries((prev) =>
      prev.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)),
    );
    params.setSelectedEntry((prev) =>
      prev && prev.id === entryId ? { ...prev, ...patch } : prev,
    );
  };

  const adjustUnreadCount = (feedId: number, delta: number) => {
    if (!delta) {
      return;
    }
    params.setUnreadByFeed((prev) => {
      const next = new Map(prev);
      const current = next.get(feedId) ?? 0;
      next.set(feedId, Math.max(0, current + delta));
      return next;
    });
  };

  const toggleRead = async (target?: Entry) => {
    const entry = target ?? params.selectedEntry;
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
    await params.refreshZoneCounts();
  };

  const toggleStar = async (target?: Entry) => {
    const entry = target ?? params.selectedEntry;
    if (!entry) {
      return;
    }
    const next = !entry.is_starred;
    await markEntryStar(entry.id, next);
    updateEntryState(entry.id, { is_starred: next });
    await params.refreshZoneCounts();
  };

  const toggleLater = async (target?: Entry) => {
    const entry = target ?? params.selectedEntry;
    if (!entry) {
      return;
    }
    const next = !entry.is_later;
    await markEntryLater(entry.id, next);
    updateEntryState(entry.id, { is_later: next });
    await params.refreshZoneCounts();
  };

  const markCurrentPageRead = async () => {
    const ids = params.entries.map((entry) => entry.id);
    if (!ids.length) {
      return;
    }
    await batchUpdateEntries(ids, { is_read: true });
    params.setEntries((prev) => prev.map((entry) => ({ ...entry, is_read: true })));
    params.setSelectedEntry((prev) => (prev ? { ...prev, is_read: true } : prev));
    await Promise.all([params.refreshUnreadCounts(), params.refreshZoneCounts()]);
  };

  const markSelectedRead = async () => {
    if (!params.selectedEntryIds.length) {
      return;
    }
    await batchUpdateEntries(params.selectedEntryIds, { is_read: true });
    params.setEntries((prev) =>
      prev.map((entry) =>
        params.selectedEntryIds.includes(entry.id) ? { ...entry, is_read: true } : entry,
      ),
    );
    params.setSelectedEntry((prev) =>
      prev && params.selectedEntryIds.includes(prev.id)
        ? { ...prev, is_read: true }
        : prev,
    );
    params.setSelectedEntryIds([]);
    await Promise.all([params.refreshUnreadCounts(), params.refreshZoneCounts()]);
  };

  const markAllInScopeRead = async () => {
    const dedup = new Set<number>();

    if (params.searchKeyword) {
      const rows = await searchEntries(params.searchKeyword, params.searchScope);
      let filteredRows = rows;
      if (params.selectedFeed != null) {
        filteredRows = filteredRows.filter((entry) => entry.feed_id === params.selectedFeed);
      } else if (params.selectedFolder != null) {
        filteredRows = filteredRows.filter((entry) =>
          params.selectedFolderFeedIds.has(entry.feed_id),
        );
      }
      if (params.activeZone === "unread") {
        filteredRows = filteredRows.filter((entry) => !entry.is_read);
      }
      if (params.activeZone === "starred") {
        filteredRows = filteredRows.filter((entry) => Boolean(entry.is_starred));
      }
      if (params.activeZone === "later") {
        filteredRows = filteredRows.filter((entry) => Boolean(entry.is_later));
      }
      const sortedRows = [...filteredRows];
      if (params.entrySort === "title") {
        sortedRows.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      } else {
        sortedRows.sort((a, b) => (b.published_at || 0) - (a.published_at || 0));
      }
      for (const row of sortedRows) {
        if (!row.is_read) {
          dedup.add(row.id);
        }
      }
    } else {
      let nextPage = 1;
      let total = 1;
      while (nextPage <= total && nextPage <= 500) {
        const page = await fetchEntries({
          feedId: params.selectedFeed ?? undefined,
          folderId:
            params.selectedFeed == null ? (params.selectedFolder ?? undefined) : undefined,
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
      await batchUpdateEntries(ids.slice(index, index + 200), { is_read: true });
    }
    await Promise.all([
      params.refreshEntries(1),
      params.refreshUnreadCounts(),
      params.refreshZoneCounts(),
    ]);
  };

  const handleRunSearch = async () => {
    const keyword = params.searchInput.trim();
    params.setSearchKeyword(keyword);
    await params.refreshEntries(1);
  };

  const handleClearSearch = async () => {
    params.setSearchInput("");
    params.setSearchKeyword("");
    await params.refreshEntries(1);
  };

  return {
    toggleRead,
    toggleStar,
    toggleLater,
    markCurrentPageRead,
    markSelectedRead,
    markAllInScopeRead,
    handleRunSearch,
    handleClearSearch,
  };
}
