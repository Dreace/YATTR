import type { GeneralSettings } from "../api";

export const PAGE_SIZE = 40;
export const THEME_MODE_KEY = "rss_theme_mode";
export const DEFAULT_TIME_FORMAT = "YYYY-MM-DD HH:mm:ss";
export const TIME_FORMAT_TOKEN_PATTERN = /YYYY|MM|DD|HH|mm|ss/g;

export const defaultSettings: GeneralSettings = {
  default_fetch_interval_min: 30,
  fulltext_enabled: false,
  cleanup_retention_days: 30,
  cleanup_keep_content: true,
  image_cache_enabled: false,
  auto_refresh_interval_sec: 0,
  time_format: DEFAULT_TIME_FORMAT,
};
