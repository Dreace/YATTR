import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";

const { createMock, getMock, postMock, putMock, deleteMock, requestMock } =
  vi.hoisted(() => {
    const get = vi
      .fn()
      .mockResolvedValue({ data: [{ id: 1, title: "t", url: "u" }] });
    const post = vi.fn().mockResolvedValue({
      data: {
        access_token: "token",
        token_type: "bearer",
        expires_in: 900,
        user: { id: 1, email: "admin@example.com" },
      },
    });
    const put = vi
      .fn()
      .mockResolvedValue({ data: { id: 1, title: "t", url: "u" } });
    const del = vi.fn().mockResolvedValue({ data: { ok: true } });
    const request = vi.fn().mockResolvedValue({ data: { ok: true } });
    const create = vi.fn(() => ({
      get,
      post,
      put,
      delete: del,
      request,
      interceptors: {
        request: {
          use: vi.fn((fn) => fn({ headers: {} })),
        },
        response: {
          use: vi.fn(),
        },
      },
    }));
    return {
      createMock: create,
      getMock: get,
      postMock: post,
      putMock: put,
      deleteMock: del,
      requestMock: request,
    };
  });

vi.mock("axios", () => ({
  default: {
    create: createMock,
  },
}));

import {
  createFeed,
  batchUpdateEntries,
  clearAccessToken,
  deleteFeed,
  debugRefreshFeed,
  exportOpml,
  fetchFeedNow,
  fetchDebugFeedEntries,
  fetchDebugFeedLogs,
  fetchEntries,
  fetchFeeds,
  fetchFolders,
  fetchMe,
  getAccessToken,
  fetchPluginProvidedSettings,
  fetchPluginSettings,
  fetchUnreadCounts,
  getGeneralSettings,
  importOpml,
  invokePluginSettingAction,
  login,
  logout,
  markEntryLater,
  markEntryRead,
  markEntryStar,
  refreshSession,
  registerAuthHandlers,
  searchEntries,
  setAccessToken,
  updateFeed,
  updatePluginSettings,
  updateGeneralSettings,
  validateFeedUrl,
  normalizeLoopbackApiBaseUrl,
  resolveApiBaseUrl,
} from "../api";

afterEach(() => {
  localStorage.clear();
  clearAccessToken();
  vi.clearAllMocks();
});

it("uses relative api base url by default", () => {
  expect(createMock).toHaveBeenCalledWith({
    baseURL: undefined,
    withCredentials: true,
  });
});

it("resolves api base url from vite/react env", () => {
  expect(
    resolveApiBaseUrl({ VITE_API_BASE_URL: "https://api.example.com/" }),
  ).toBe("https://api.example.com");
  expect(
    resolveApiBaseUrl({ REACT_APP_API_BASE_URL: "http://127.0.0.1:8000/" }, ""),
  ).toBe("http://127.0.0.1:8000");
  expect(resolveApiBaseUrl({})).toBe("");
});

it("normalizes loopback host to current origin host", () => {
  expect(
    normalizeLoopbackApiBaseUrl("http://127.0.0.1:8000", "localhost"),
  ).toBe("http://localhost:8000/");
  expect(
    normalizeLoopbackApiBaseUrl("http://localhost:8000", "127.0.0.1"),
  ).toBe("http://127.0.0.1:8000/");
  expect(
    normalizeLoopbackApiBaseUrl("https://api.example.com", "localhost"),
  ).toBe("https://api.example.com");
});

it("logs in and keeps access token in memory", async () => {
  const session = await login("admin", "pass");
  expect(session.user.email).toBe("admin@example.com");
  expect(getAccessToken()).toBe("token");
  expect(postMock).toHaveBeenCalled();
});

it("refreshes session and clears token on logout", async () => {
  await refreshSession();
  expect(postMock).toHaveBeenCalledWith("/api/auth/refresh", null);
  expect(getAccessToken()).toBe("token");

  await fetchMe();
  expect(getMock).toHaveBeenCalledWith("/api/me");

  await logout();
  expect(postMock).toHaveBeenCalledWith("/api/auth/logout", null);
  expect(getAccessToken()).toBeNull();
});

it("registers auth handlers and exposes token helpers", async () => {
  setAccessToken("abc");
  expect(getAccessToken()).toBe("abc");
  const unregister = registerAuthHandlers({
    refresh: vi.fn().mockResolvedValue(null),
    onAuthFailure: vi.fn(),
  });
  unregister();
  clearAccessToken();
  expect(getAccessToken()).toBeNull();
});

it("fetches feeds and folders", async () => {
  await fetchFeeds();
  expect(getMock).toHaveBeenCalledWith("/api/feeds");
  await fetchFolders();
  expect(getMock).toHaveBeenCalledWith("/api/folders");
  await fetchUnreadCounts();
  expect(getMock).toHaveBeenCalledWith("/api/feeds/unread_counts");
});

it("validates and creates feed", async () => {
  postMock.mockResolvedValueOnce({
    data: {
      valid: true,
      title: "Feed",
      site_url: "https://example.com",
      message: "ok",
    },
  });
  const validated = await validateFeedUrl("https://example.com/rss");
  expect(validated.valid).toBe(true);
  expect(postMock).toHaveBeenCalledWith("/api/feeds/validate", {
    url: "https://example.com/rss",
  });

  await createFeed({
    title: "Feed",
    url: "https://example.com/rss",
    folder_id: 1,
    fetch_interval_min: 30,
    fulltext_enabled: false,
  });
  expect(postMock).toHaveBeenCalledWith("/api/feeds", {
    title: "Feed",
    url: "https://example.com/rss",
    folder_id: 1,
    fetch_interval_min: 30,
    fulltext_enabled: false,
  });
});

it("fetches paginated entries", async () => {
  getMock.mockResolvedValueOnce({
    data: {
      items: [],
      next_cursor: null,
      has_more: false,
      current_page: 1,
      total_pages: 1,
      total_items: 0,
    },
  });
  const page = await fetchEntries({
    feedId: 1,
    folderId: 2,
    state: "unread",
    page: 3,
    pageSize: 20,
    sortBy: "title",
  });
  expect(page.has_more).toBe(false);
  expect(getMock).toHaveBeenCalledWith("/api/entries", {
    params: {
      feedId: 1,
      folderId: 2,
      state: "unread",
      page: 3,
      page_size: 20,
      sort_by: "title",
    },
  });
});

it("searches entries", async () => {
  await searchEntries("hello", "title");
  expect(getMock).toHaveBeenCalledWith("/api/search", {
    params: { q: "hello", scope: "title" },
  });
});

it("updates entry states", async () => {
  await markEntryRead(1, true);
  expect(postMock).toHaveBeenCalledWith("/api/entries/1/read");
  await markEntryStar(1, false);
  expect(postMock).toHaveBeenCalledWith("/api/entries/1/unstar");
  await markEntryLater(1, true);
  expect(postMock).toHaveBeenCalledWith("/api/entries/1/later");
});

it("batch updates entries", async () => {
  await batchUpdateEntries([1, 2], { is_read: true });
  expect(postMock).toHaveBeenCalledWith("/api/entries/batch", {
    entry_ids: [1, 2],
    is_read: true,
  });
});

it("updates feed and general settings", async () => {
  await updateFeed(1, {
    title: "t",
    url: "u",
    fetch_interval_min: 60,
    fulltext_enabled: true,
  });
  expect(putMock).toHaveBeenCalledWith("/api/feeds/1", {
    title: "t",
    url: "u",
    fetch_interval_min: 60,
    fulltext_enabled: true,
  });

  await getGeneralSettings();
  expect(getMock).toHaveBeenCalledWith("/api/settings/general");

  await updateGeneralSettings({
    default_fetch_interval_min: 30,
    fulltext_enabled: false,
    cleanup_retention_days: 30,
    cleanup_keep_content: true,
    image_cache_enabled: false,
    auto_refresh_interval_sec: 0,
    time_format: "YYYY-MM-DD HH:mm:ss",
  });
  expect(putMock).toHaveBeenCalledWith("/api/settings/general", {
    default_fetch_interval_min: 30,
    fulltext_enabled: false,
    cleanup_retention_days: 30,
    cleanup_keep_content: true,
    image_cache_enabled: false,
    auto_refresh_interval_sec: 0,
    time_format: "YYYY-MM-DD HH:mm:ss",
  });
});

it("fetches and updates plugin settings", async () => {
  getMock.mockResolvedValueOnce({
    data: { available: ["fever"], enabled: ["fever"] },
  });
  const pluginSettings = await fetchPluginSettings();
  expect(pluginSettings.available).toContain("fever");
  expect(getMock).toHaveBeenCalledWith("/api/settings/plugins");

  putMock.mockResolvedValueOnce({
    data: { available: ["fever"], enabled: [] },
  });
  const updated = await updatePluginSettings([]);
  expect(updated.enabled).toEqual([]);
  expect(putMock).toHaveBeenCalledWith("/api/settings/plugins", {
    enabled: [],
  });
});

it("reads plugin-provided settings and invokes plugin action", async () => {
  getMock.mockResolvedValueOnce({
    data: {
      plugin_id: "fever",
      title: "Fever API",
      items: [
        { key: "api_key", label: "API Key", value: "abc", display: "code" },
        {
          key: "endpoint_path",
          label: "API 路径",
          value: "/plugins/fever/?api",
          display: "code",
        },
      ],
      actions: [
        {
          id: "reset_api_key",
          label: "重置 API Key",
          method: "POST",
          path: "/plugins/fever/settings/credentials/reset",
        },
      ],
    },
  });
  const settings = await fetchPluginProvidedSettings("fever");
  expect(settings.plugin_id).toBe("fever");
  expect(getMock).toHaveBeenCalledWith("/plugins/fever/settings");

  requestMock.mockResolvedValueOnce({
    data: {
      plugin_id: "fever",
      title: "Fever API",
      items: [
        { key: "api_key", label: "API Key", value: "def", display: "code" },
      ],
      actions: [],
    },
  });
  const next = await invokePluginSettingAction({
    id: "reset_api_key",
    label: "重置 API Key",
    method: "POST",
    path: "/plugins/fever/settings/credentials/reset",
  });
  expect(next.items[0].value).toBe("def");
  expect(requestMock).toHaveBeenCalledWith({
    url: "/plugins/fever/settings/credentials/reset",
    method: "POST",
  });
});

it("imports and exports opml", async () => {
  const opmlPath = resolve(
    process.cwd(),
    "..",
    "tt-rss_dreace_2026-02-05.opml",
  );
  const content = readFileSync(opmlPath);
  const file = new File([content], "tt-rss_dreace_2026-02-05.opml", {
    type: "text/xml",
  });
  await importOpml(file);
  expect(postMock).toHaveBeenCalledWith(
    "/api/opml/import",
    expect.any(FormData),
    expect.any(Object),
  );

  getMock.mockResolvedValueOnce({ data: { content: "<opml />" } });
  const text = await exportOpml();
  expect(text).toBe("<opml />");
});

it("calls debug endpoints", async () => {
  await fetchFeedNow(1);
  expect(postMock).toHaveBeenCalledWith("/api/feeds/1/fetch", null, {
    params: { background: false },
  });
  await debugRefreshFeed(1);
  expect(postMock).toHaveBeenCalledWith("/api/debug/feeds/1/refresh", null, {
    params: { background: false },
  });
  await fetchDebugFeedLogs(1);
  expect(getMock).toHaveBeenCalledWith("/api/debug/feeds/1/logs");
  await fetchDebugFeedEntries(1);
  expect(getMock).toHaveBeenCalledWith("/api/debug/feeds/1/entries");
  await deleteFeed(1);
  expect(deleteMock).toHaveBeenCalledWith("/api/feeds/1");
});
