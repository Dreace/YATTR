export type EntryStateFilter = "all" | "unread" | "starred" | "later";
export type ZoneKey = EntryStateFilter;
export type SearchScope = "all" | "title" | "summary" | "content";
export type EntrySort = "updated" | "title";
export type ThemeMode = "light" | "dark" | "system";
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export interface EditFeedDraft {
  id: number;
  title: string;
  url: string;
  site_url: string;
  folder_id: number | null;
  disabled: boolean;
  fetch_interval_min: number;
  fulltext_enabled: boolean;
  cleanup_retention_days: number;
  cleanup_keep_content: boolean;
  image_cache_enabled: boolean;
}

export interface FeedMenuState {
  x: number;
  y: number;
  feedId: number;
}

export interface ZoneCountState {
  all: number;
  unread: number;
  starred: number;
  later: number;
}
