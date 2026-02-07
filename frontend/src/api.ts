import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

export function normalizeLoopbackApiBaseUrl(
  raw: string,
  currentHost?: string,
): string {
  if (!raw || !currentHost || !isLoopbackHost(currentHost)) {
    return raw;
  }
  try {
    const parsed = new URL(raw);
    if (!isLoopbackHost(parsed.hostname) || parsed.hostname === currentHost) {
      return raw;
    }
    parsed.hostname = currentHost;
    return parsed.toString();
  } catch {
    return raw;
  }
}

export function resolveApiBaseUrl(
  env: Record<string, string | undefined> = import.meta.env as Record<
    string,
    string | undefined
  >,
  currentHost: string | undefined = typeof window === "undefined"
    ? undefined
    : window.location.hostname,
): string {
  const raw = (
    env.VITE_API_BASE_URL ||
    env.REACT_APP_API_BASE_URL ||
    ""
  ).trim();
  if (!raw) {
    return "";
  }
  const normalized = normalizeLoopbackApiBaseUrl(raw, currentHost);
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export const API_BASE_URL = resolveApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL || undefined,
  withCredentials: true,
});

let accessToken: string | null = null;
let refreshHandler: (() => Promise<AuthSession | null>) | null = null;
let authFailureHandler: (() => void) | null = null;
let refreshInFlight: Promise<AuthSession | null> | null = null;

function shouldSkipRefresh(url?: string): boolean {
  if (!url) {
    return false;
  }
  return (
    url.includes("/api/auth/login") ||
    url.includes("/api/auth/refresh") ||
    url.includes("/api/auth/logout")
  );
}

async function runRefresh(): Promise<AuthSession | null> {
  if (!refreshHandler) {
    return null;
  }
  if (!refreshInFlight) {
    refreshInFlight = refreshHandler().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const config = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;
    if (
      !config ||
      status !== 401 ||
      config._retry ||
      shouldSkipRefresh(config.url)
    ) {
      return Promise.reject(error);
    }
    config._retry = true;
    const refreshed = await runRefresh();
    if (refreshed?.access_token) {
      accessToken = refreshed.access_token;
      config.headers = config.headers ?? {};
      config.headers.Authorization = `Bearer ${accessToken}`;
      return api.request(config);
    }
    accessToken = null;
    if (authFailureHandler) {
      authFailureHandler();
    }
    return Promise.reject(error);
  },
);

export interface AuthUser {
  id: number;
  email: string;
}

export interface AuthSession {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function clearAccessToken(): void {
  accessToken = null;
}

export function registerAuthHandlers(handlers: {
  refresh: () => Promise<AuthSession | null>;
  onAuthFailure: () => void;
}): () => void {
  refreshHandler = handlers.refresh;
  authFailureHandler = handlers.onAuthFailure;
  return () => {
    if (refreshHandler === handlers.refresh) {
      refreshHandler = null;
    }
    if (authFailureHandler === handlers.onAuthFailure) {
      authFailureHandler = null;
    }
  };
}

export interface Feed {
  id: number;
  title: string;
  url: string;
  site_url?: string | null;
  folder_id?: number | null;
  fetch_interval_min?: number;
  fulltext_enabled?: boolean;
  cleanup_retention_days?: number;
  cleanup_keep_content?: boolean;
  image_cache_enabled?: boolean;
  last_status?: number;
  error_count?: number;
  disabled?: boolean;
  icon_url?: string | null;
}

export interface Folder {
  id: number;
  name: string;
  sort_order: number;
}

export interface Entry {
  id: number;
  feed_id: number;
  title: string;
  url?: string;
  summary?: string;
  content_html?: string;
  content_text?: string;
  is_read?: boolean;
  is_starred?: boolean;
  is_later?: boolean;
  published_at?: number;
}

export interface EntryPage {
  items: Entry[];
  next_cursor?: number | null;
  has_more: boolean;
  current_page: number;
  total_pages: number;
  total_items: number;
}

export interface GeneralSettings {
  default_fetch_interval_min: number;
  fulltext_enabled: boolean;
  cleanup_retention_days: number;
  cleanup_keep_content: boolean;
  image_cache_enabled: boolean;
  auto_refresh_interval_sec: number;
  time_format: string;
}

export interface PluginSettings {
  available: string[];
  enabled: string[];
}

export interface PluginSettingItem {
  key: string;
  label: string;
  value: string;
  display?: "text" | "code";
}

export interface PluginSettingAction {
  id: string;
  label: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE" | "GET";
  path: string;
}

export interface PluginProvidedSettings {
  plugin_id: string;
  title: string;
  description?: string;
  items: PluginSettingItem[];
  actions: PluginSettingAction[];
}

export interface FetchLog {
  id: number;
  feed_id: number;
  status: number;
  fetched_at: number;
  error_message?: string | null;
}

export interface DebugRefreshResult {
  ok: boolean;
  feed_id: number;
  added: number;
  queued?: boolean;
  last_status: number;
  error_count: number;
  last_fetch_at: number;
}

export interface FeedFetchResult {
  ok: boolean;
  added: number;
  queued?: boolean;
}

export interface FeedValidateOut {
  valid: boolean;
  title: string;
  site_url?: string | null;
  message?: string | null;
}

export interface FeedCreatePayload {
  title: string;
  url: string;
  site_url?: string | null;
  folder_id?: number | null;
  fetch_interval_min?: number;
  fulltext_enabled?: boolean;
  cleanup_retention_days?: number;
  cleanup_keep_content?: boolean;
  image_cache_enabled?: boolean;
}

export interface FeedUnreadCount {
  feed_id: number;
  unread_count: number;
}

export interface DebugEntry {
  id: number;
  feed_id: number;
  title: string;
  url?: string | null;
  published_at: number;
  summary?: string | null;
  content_html?: string | null;
  content_text?: string | null;
}

export async function login(
  username: string,
  password: string,
): Promise<AuthSession> {
  const response = await api.post(
    "/api/auth/login",
    new URLSearchParams({ username, password }),
  );
  const session = response.data as AuthSession;
  setAccessToken(session.access_token);
  return session;
}

export async function refreshSession(): Promise<AuthSession> {
  const response = await api.post("/api/auth/refresh", null);
  const session = response.data as AuthSession;
  setAccessToken(session.access_token);
  return session;
}

export async function logout(): Promise<void> {
  try {
    await api.post("/api/auth/logout", null);
  } finally {
    clearAccessToken();
  }
}

export async function fetchMe(): Promise<AuthUser> {
  const response = await api.get("/api/me");
  return response.data;
}

export async function fetchFeeds(): Promise<Feed[]> {
  const response = await api.get("/api/feeds");
  return response.data;
}

export async function fetchUnreadCounts(): Promise<FeedUnreadCount[]> {
  const response = await api.get("/api/feeds/unread_counts");
  return response.data;
}

export async function validateFeedUrl(url: string): Promise<FeedValidateOut> {
  const response = await api.post("/api/feeds/validate", { url });
  return response.data;
}

export async function createFeed(payload: FeedCreatePayload): Promise<Feed> {
  const response = await api.post("/api/feeds", payload);
  return response.data;
}

export async function fetchFolders(): Promise<Folder[]> {
  const response = await api.get("/api/folders");
  return response.data;
}

export async function updateFeed(
  feedId: number,
  payload: Omit<Feed, "id"> & {
    fetch_interval_min?: number;
    folder_id?: number | null;
  },
): Promise<Feed> {
  const response = await api.put(`/api/feeds/${feedId}`, payload);
  return response.data;
}

export async function deleteFeed(feedId: number): Promise<void> {
  await api.delete(`/api/feeds/${feedId}`);
}

export async function fetchFeedNow(
  feedId: number,
  background = false,
): Promise<FeedFetchResult> {
  const response = await api.post(`/api/feeds/${feedId}/fetch`, null, {
    params: { background },
  });
  return response.data;
}

export async function fetchEntries(params?: {
  feedId?: number;
  folderId?: number;
  state?: "all" | "unread" | "starred" | "later";
  page?: number;
  pageSize?: number;
  sortBy?: "updated" | "title";
}): Promise<EntryPage> {
  const response = await api.get("/api/entries", {
    params: {
      feedId: params?.feedId,
      folderId: params?.folderId,
      state: params?.state ?? "all",
      page: params?.page ?? 1,
      page_size: params?.pageSize ?? 40,
      sort_by: params?.sortBy ?? "updated",
    },
  });
  return response.data;
}

export async function searchEntries(
  query: string,
  scope: "all" | "title" | "summary" | "content" = "all",
): Promise<Entry[]> {
  const response = await api.get("/api/search", {
    params: { q: query, scope },
  });
  return response.data;
}

export async function markEntryRead(
  entryId: number,
  isRead: boolean,
): Promise<void> {
  const endpoint = isRead ? "read" : "unread";
  await api.post(`/api/entries/${entryId}/${endpoint}`);
}

export async function markEntryStar(
  entryId: number,
  isStarred: boolean,
): Promise<void> {
  const endpoint = isStarred ? "star" : "unstar";
  await api.post(`/api/entries/${entryId}/${endpoint}`);
}

export async function markEntryLater(
  entryId: number,
  isLater: boolean,
): Promise<void> {
  const endpoint = isLater ? "later" : "unlater";
  await api.post(`/api/entries/${entryId}/${endpoint}`);
}

export async function batchUpdateEntries(
  entryIds: number[],
  payload: { is_read?: boolean; is_starred?: boolean; is_later?: boolean },
): Promise<void> {
  await api.post("/api/entries/batch", { entry_ids: entryIds, ...payload });
}

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const response = await api.get("/api/settings/general");
  return response.data;
}

export async function updateGeneralSettings(
  payload: GeneralSettings,
): Promise<GeneralSettings> {
  const response = await api.put("/api/settings/general", payload);
  return response.data;
}

export async function fetchPluginSettings(): Promise<PluginSettings> {
  const response = await api.get("/api/settings/plugins");
  return response.data;
}

export async function updatePluginSettings(
  enabled: string[],
): Promise<PluginSettings> {
  const response = await api.put("/api/settings/plugins", { enabled });
  return response.data;
}

export async function fetchPluginProvidedSettings(
  pluginId: string,
): Promise<PluginProvidedSettings> {
  const response = await api.get(`/plugins/${pluginId}/settings`);
  return response.data;
}

export async function invokePluginSettingAction(
  action: PluginSettingAction,
): Promise<PluginProvidedSettings> {
  const response = await api.request({
    url: action.path,
    method: action.method,
  });
  return response.data;
}

export async function importOpml(file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  await api.post("/api/opml/import", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
}

export async function exportOpml(): Promise<string> {
  const response = await api.get("/api/opml/export");
  return response.data.content;
}

export async function debugRefreshFeed(
  feedId: number,
  background = false,
): Promise<DebugRefreshResult> {
  const response = await api.post(`/api/debug/feeds/${feedId}/refresh`, null, {
    params: { background },
  });
  return response.data;
}

export async function fetchDebugFeedLogs(feedId: number): Promise<FetchLog[]> {
  const response = await api.get(`/api/debug/feeds/${feedId}/logs`);
  return response.data;
}

export async function fetchDebugFeedEntries(
  feedId: number,
): Promise<DebugEntry[]> {
  const response = await api.get(`/api/debug/feeds/${feedId}/entries`);
  return response.data;
}
