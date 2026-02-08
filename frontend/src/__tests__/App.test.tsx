import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import App, { toSafeExternalHttpUrl } from "../App";
import * as api from "../api";
import { I18nProvider } from "../i18n";

const { entryA, entryB } = vi.hoisted(() => ({
  entryA: {
    id: 10,
    feed_id: 1,
    title: "标题A",
    summary: "<p>摘要<b>A</b></p>",
    content_html: "<p>摘要A</p>",
    is_read: false,
    is_starred: false,
    is_later: false,
    url: "https://example.com/a",
    published_at: 1710000000,
  },
  entryB: {
    id: 11,
    feed_id: 1,
    title: "标题B",
    summary: "<p>摘要<i>B</i></p>",
    content_html: "<p>摘要B</p>",
    is_read: false,
    is_starred: false,
    is_later: false,
    url: "https://example.com/b",
    published_at: 1710001000,
  },
}));

vi.mock("../api", () => ({
  API_BASE_URL: "http://127.0.0.1:8000",
  fetchFolders: vi
    .fn()
    .mockResolvedValue([{ id: 1, name: "默认", sort_order: 0 }]),
  fetchFolderArticleCounts: vi
    .fn()
    .mockResolvedValue([{ folder_id: 1, article_count: 225 }]),
  fetchFeeds: vi.fn().mockResolvedValue([
    {
      id: 1,
      title: "示例订阅",
      url: "https://example.com/rss",
      site_url: "https://example.com",
      folder_id: 1,
      fetch_interval_min: 30,
      fulltext_enabled: false,
      disabled: false,
      icon_url: "/api/cache/favicons/1.png",
    },
  ]),
  fetchUnreadCounts: vi
    .fn()
    .mockResolvedValue([{ feed_id: 1, unread_count: 5 }]),
  fetchEntries: vi
    .fn()
    .mockImplementation((params?: { state?: string; page?: number }) => {
      const state = params?.state ?? "all";
      if (state === "all") {
        return Promise.resolve({
          items: params?.page === 2 ? [entryB] : [entryA],
          next_cursor: 10,
          has_more: true,
          current_page: params?.page ?? 1,
          total_pages: 2,
          total_items: 225,
        });
      }
      if (state === "unread") {
        return Promise.resolve({
          items: [entryA],
          next_cursor: 10,
          has_more: true,
          current_page: params?.page ?? 1,
          total_pages: 2,
          total_items: 130,
        });
      }
      if (state === "starred") {
        return Promise.resolve({
          items: [],
          next_cursor: null,
          has_more: false,
          current_page: 1,
          total_pages: 1,
          total_items: 29,
        });
      }
      return Promise.resolve({
        items: [],
        next_cursor: null,
        has_more: false,
        current_page: 1,
        total_pages: 1,
        total_items: 12,
      });
    }),
  searchEntries: vi.fn().mockResolvedValue([entryB]),
  validateFeedUrl: vi.fn().mockResolvedValue({
    valid: true,
    title: "新订阅",
    site_url: "https://new.example.com",
    message: "ok",
  }),
  createFeed: vi.fn().mockResolvedValue({
    id: 2,
    title: "新订阅",
    url: "https://new.example.com/rss",
    site_url: "https://new.example.com",
    folder_id: 1,
  }),
  deleteFeed: vi.fn().mockResolvedValue(undefined),
  fetchFeedNow: vi.fn().mockResolvedValue({ ok: true, added: 1 }),
  markEntryRead: vi.fn().mockResolvedValue(undefined),
  markEntryStar: vi.fn().mockResolvedValue(undefined),
  markEntryLater: vi.fn().mockResolvedValue(undefined),
  batchUpdateEntries: vi.fn().mockResolvedValue(undefined),
  updateFeed: vi.fn().mockResolvedValue({
    id: 1,
    title: "已编辑订阅",
    url: "https://edited.example.com/rss",
    site_url: "https://edited.example.com",
    folder_id: 1,
    fetch_interval_min: 60,
    fulltext_enabled: true,
  }),
  fetchPluginProvidedSettings: vi.fn().mockResolvedValue({
    plugin_id: "fever",
    title: "Fever API",
    description: "供 Reeder / Fiery Feeds / ReadKit 等客户端接入",
    items: [
      { key: "api_key", label: "API Key", value: "abc", display: "code" },
      {
        key: "endpoint_path",
        label: "API 路径",
        value: "/plugins/fever/?api",
        display: "code",
      },
      {
        key: "endpoint_url",
        label: "API 地址",
        value: "http://127.0.0.1:8000/plugins/fever/?api",
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
  }),
  getGeneralSettings: vi.fn().mockResolvedValue({
    default_fetch_interval_min: 30,
    fulltext_enabled: false,
    cleanup_retention_days: 30,
    cleanup_keep_content: true,
    image_cache_enabled: false,
    auto_refresh_interval_sec: 0,
    time_format: "YYYY-MM-DD HH:mm:ss",
  }),
  fetchHealthStatus: vi.fn().mockResolvedValue({
    feeds: 1,
    entries: 2,
    failed_feeds: 0,
    success_rate: 1,
    status: "ok",
  }),
  updateGeneralSettings: vi.fn().mockResolvedValue({
    default_fetch_interval_min: 35,
    fulltext_enabled: false,
    cleanup_retention_days: 30,
    cleanup_keep_content: true,
    image_cache_enabled: false,
    auto_refresh_interval_sec: 0,
    time_format: "YYYY-MM-DD HH:mm:ss",
  }),
  fetchPluginSettings: vi.fn().mockResolvedValue({
    available: ["fever"],
    enabled: ["fever"],
  }),
  updatePluginSettings: vi.fn().mockResolvedValue({
    available: ["fever"],
    enabled: ["fever"],
  }),
  invokePluginSettingAction: vi.fn().mockResolvedValue({
    plugin_id: "fever",
    title: "Fever API",
    items: [
      { key: "api_key", label: "API Key", value: "def", display: "code" },
    ],
    actions: [],
  }),
  importOpml: vi.fn().mockResolvedValue(undefined),
  exportOpml: vi.fn().mockResolvedValue("<opml />"),
  debugRefreshFeed: vi.fn().mockResolvedValue({
    ok: true,
    feed_id: 1,
    added: 3,
    last_status: 200,
    error_count: 0,
    last_fetch_at: 1,
  }),
  fetchDebugFeedLogs: vi
    .fn()
    .mockResolvedValue([
      { id: 1, feed_id: 1, status: 200, fetched_at: 1, error_message: null },
    ]),
  fetchDebugFeedEntries: vi.fn().mockResolvedValue([
    {
      id: 101,
      feed_id: 1,
      title: "调试内容",
      url: "https://example.com/debug",
      published_at: 1710000000,
      summary: "debug summary",
      content_html: "<p>debug html content</p>",
      content_text: "debug text",
    },
  ]),
}));

const signOutMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    signOut: signOutMock,
    isAuthenticated: true,
    isInitializing: false,
    user: { id: 1, email: "admin@example.com" },
    signIn: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  localStorage.setItem("rss_lang_mode", "zh");
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

function renderApp() {
  return render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

it("allows only http/https external urls", () => {
  expect(toSafeExternalHttpUrl("https://example.com/a")).toBe(
    "https://example.com/a",
  );
  expect(toSafeExternalHttpUrl("http://example.com/a")).toBe(
    "http://example.com/a",
  );
  expect(toSafeExternalHttpUrl("javascript:alert(1)")).toBeNull();
  expect(toSafeExternalHttpUrl("data:text/html,hello")).toBeNull();
  expect(toSafeExternalHttpUrl("/relative/path")).toBeNull();
});

it("renders single tt-rss shell layout", async () => {
  renderApp();
  expect(await screen.findByText("YATTR")).toBeInTheDocument();
  expect(screen.getByText("特殊区域")).toBeInTheDocument();
  expect(screen.getByText("订阅源")).toBeInTheDocument();
  expect(screen.queryByText("阅读")).not.toBeInTheDocument();
});

it("supports theme mode switch", async () => {
  renderApp();
  const selector = await screen.findByLabelText("主题模式");
  await userEvent.selectOptions(selector, "light");
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  await userEvent.selectOptions(selector, "dark");
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

it("starts relative-time refresh timer", async () => {
  const timerSpy = vi.spyOn(window, "setInterval");
  renderApp();
  await screen.findByText("YATTR");
  expect(timerSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
  timerSpy.mockRestore();
});

it("shows special zone counters and unread count", async () => {
  renderApp();
  expect(await screen.findByText("225")).toBeInTheDocument();
  expect(screen.getByText("130")).toBeInTheDocument();
  expect(screen.getByText("29")).toBeInTheDocument();
  expect(screen.getByText("5")).toBeInTheDocument();
});

it("renders entry row with card meta and source/update", async () => {
  renderApp();
  const row = await screen.findByRole("button", { name: "标题A" });
  expect(row.className).toContain("entry-row");
  expect(screen.getAllByText(/来源:/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/更新:/).length).toBeGreaterThan(0);
  const snippet = row.querySelector(".entry-snippet");
  expect(snippet?.textContent).toContain("摘要 A");
  expect(snippet?.textContent).not.toContain("<b>");
});

it("supports search, sorting and pagination", async () => {
  renderApp();
  await userEvent.type(await screen.findByPlaceholderText("搜索..."), "hello");
  await userEvent.click(screen.getByText("搜索"));
  expect(api.searchEntries).toHaveBeenCalledWith("hello", "all");
  await userEvent.click(screen.getByText("清空"));
  await userEvent.selectOptions(
    screen.getByDisplayValue("按更新时间"),
    "title",
  );
  expect(api.fetchEntries).toHaveBeenCalledWith(
    expect.objectContaining({
      sortBy: "title",
    }),
  );

  await userEvent.click(screen.getByText("下一页"));
  expect(api.fetchEntries).toHaveBeenCalledWith(
    expect.objectContaining({
      page: 2,
    }),
  );
});

it("syncs reader pane and keyboard navigation", async () => {
  renderApp();
  expect((await screen.findAllByText("标题A")).length).toBeGreaterThan(0);
  expect(screen.getByText("打开原文")).toBeInTheDocument();

  fireEvent.keyDown(window, { key: "j" });
  fireEvent.keyDown(window, { key: "k" });
  expect(screen.getAllByText("标题A").length).toBeGreaterThan(0);
});

it("opens edit-feed modal and saves with site_url", async () => {
  renderApp();
  const feedButton = await screen.findByText("示例订阅");
  fireEvent.contextMenu(feedButton);
  await userEvent.click(screen.getByText("编辑订阅"));

  expect(screen.getByRole("dialog", { name: "编辑订阅" })).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText("标题"));
  await userEvent.type(screen.getByLabelText("标题"), "已编辑订阅");
  await userEvent.clear(screen.getByLabelText("URL"));
  await userEvent.type(
    screen.getByLabelText("URL"),
    "https://edited.example.com/rss",
  );
  await userEvent.clear(screen.getByLabelText("站点 URL"));
  await userEvent.type(
    screen.getByLabelText("站点 URL"),
    "https://edited.example.com",
  );
  expect(screen.getByLabelText("保留天数")).toBeInTheDocument();
  expect(screen.getByLabelText("保留正文内容")).toBeInTheDocument();
  expect(screen.getByLabelText("启用图片缓存")).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("禁用订阅源"));
  await userEvent.click(screen.getByRole("button", { name: "保存" }));

  expect(api.updateFeed).toHaveBeenCalledWith(
    1,
    expect.objectContaining({
      title: "已编辑订阅",
      url: "https://edited.example.com/rss",
      site_url: "https://edited.example.com",
      disabled: true,
      cleanup_retention_days: 30,
      cleanup_keep_content: true,
      image_cache_enabled: false,
    }),
  );
});

it("supports collapsing and expanding folder tree", async () => {
  renderApp();
  await screen.findByRole("button", { name: /示例订阅/ });

  const collapseButton = screen.getByRole("button", { name: "折叠目录 默认" });
  await userEvent.click(collapseButton);
  expect(
    screen.queryByRole("button", { name: /示例订阅/ }),
  ).not.toBeInTheDocument();

  const expandButton = screen.getByRole("button", { name: "展开目录 默认" });
  await userEvent.click(expandButton);
  expect(screen.getByRole("button", { name: /示例订阅/ })).toBeInTheDocument();
});

it("shows folder article totals", async () => {
  renderApp();
  expect(await screen.findByText("默认 (225)")).toBeInTheDocument();
});

it("supports one-click mark all read", async () => {
  renderApp();
  await userEvent.click(await screen.findByText("一键全部已读"));
  expect(api.batchUpdateEntries).toHaveBeenCalledWith([10], { is_read: true });
});

it("opens settings drawer and saves global/plugin settings", async () => {
  renderApp();
  await userEvent.click(await screen.findByText("设置"));
  const dialog = await screen.findByRole("dialog", { name: "设置" });
  expect(dialog).toBeInTheDocument();
  const intervalInput = within(dialog).getAllByDisplayValue("30")[0];
  await userEvent.click(intervalInput);
  expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument();

  const section = screen.getByText("全局设置").closest("section");
  expect(section).toBeInTheDocument();
  const settingRows = section?.querySelectorAll(".setting-row");
  expect(settingRows && settingRows.length > 0).toBe(true);

  const timeFormatHelp = await screen.findByRole("img", {
    name: "查看「时间格式」说明",
  });
  const timeFormatRow = timeFormatHelp.closest(".setting-row");
  const timeFormatInput = timeFormatRow?.querySelector("input");
  if (!timeFormatInput) {
    throw new Error("time format input not found");
  }
  await userEvent.clear(timeFormatInput);
  await userEvent.type(timeFormatInput, "YYYY/MM/DD HH:mm");

  await userEvent.click(screen.getByText("保存全局设置"));
  expect(api.updateGeneralSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      time_format: "YYYY/MM/DD HH:mm",
    }),
  );

  await userEvent.click(screen.getByText("保存插件配置"));
  expect(api.updatePluginSettings).toHaveBeenCalled();
  expect(screen.getByText("API 路径:")).toBeInTheDocument();
  expect(screen.getByText("API 地址:")).toBeInTheDocument();
  expect(screen.getByText("系统状态")).toBeInTheDocument();
  expect(screen.getByText("近期成功率:")).toBeInTheDocument();
});

it("supports language switch and system-follow mode", async () => {
  renderApp();
  await userEvent.click(await screen.findByText("设置"));

  const languageHelp = await screen.findByRole("img", {
    name: "查看「语言」说明",
  });
  const languageRow = languageHelp.closest(".setting-row");
  const languageSelect = languageRow?.querySelector("select");
  if (!languageSelect) {
    throw new Error("language select not found");
  }

  await userEvent.selectOptions(languageSelect, "en");
  expect(
    await screen.findByRole("button", { name: "Settings" }),
  ).toBeInTheDocument();
  expect(localStorage.getItem("rss_lang_mode")).toBe("en");

  await userEvent.selectOptions(languageSelect, "system");
  expect(localStorage.getItem("rss_lang_mode")).toBe("system");
});

it("shows setting help as hover tooltip instead of dialog", async () => {
  renderApp();
  await userEvent.click(await screen.findByText("设置"));

  const helpIcon = await screen.findByRole("img", {
    name: "查看「启用全文抽取（全局）」说明",
  });
  const tooltipRoot = helpIcon.closest(".ui-tooltip");
  expect(tooltipRoot).toHaveAttribute(
    "title",
    "启用后，未单独设置的订阅会自动继承全文抽取开关。",
  );
  expect(
    screen.queryByRole("dialog", { name: "启用全文抽取（全局）" }),
  ).not.toBeInTheDocument();
});

it("opens debug drawer and shows logs + content preview", async () => {
  renderApp();
  await userEvent.click(await screen.findByText("调试"));
  await screen.findByRole("dialog", { name: "调试抓取" });

  await userEvent.click(screen.getByText("强制获取最新内容"));
  expect(api.debugRefreshFeed).toHaveBeenCalled();
  expect(api.fetchDebugFeedLogs).toHaveBeenCalled();
  expect(api.fetchDebugFeedEntries).toHaveBeenCalled();
  expect(screen.getByText("调试内容")).toBeInTheDocument();
});

it("calls sign out from topbar", async () => {
  renderApp();
  await userEvent.click(await screen.findByText("退出登录"));
  expect(signOutMock).toHaveBeenCalled();
});

it("imports and exports opml from settings drawer", async () => {
  renderApp();
  await userEvent.click(await screen.findByText("设置"));
  const importButton = await screen.findByText("导入 OPML");
  const label = importButton.closest("label");
  const fileInput = label?.querySelector(
    "input[type='file']",
  ) as HTMLInputElement;
  const file = new File(["<opml />"], "subs.opml", { type: "text/xml" });
  await userEvent.upload(fileInput, file);
  expect(api.importOpml).toHaveBeenCalled();

  if (!URL.createObjectURL) {
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:url"),
      writable: true,
    });
  }
  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      writable: true,
    });
  }
  const createUrl = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:url");
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  await userEvent.click(screen.getByText("导出 OPML"));
  expect(api.exportOpml).toHaveBeenCalled();
  createUrl.mockRestore();
  revokeUrl.mockRestore();
  clickSpy.mockRestore();
});

it("handles feed context menu actions", async () => {
  renderApp();
  const feedButton = await screen.findByText("示例订阅");
  fireEvent.contextMenu(feedButton);
  const menuRoot = document.querySelector<HTMLElement>(".context-menu");
  const menuScope = within(menuRoot ?? document.body);
  await userEvent.click(menuScope.getByText("调试"));
  expect(
    await screen.findByRole("dialog", { name: "调试抓取" }),
  ).toBeInTheDocument();
  expect(api.fetchDebugFeedLogs).toHaveBeenCalled();
  expect(api.fetchDebugFeedEntries).toHaveBeenCalled();
});

it("shows error when login fails", async () => {
  vi.mocked(api.fetchFolders).mockRejectedValueOnce(new Error("fail"));
  renderApp();
  expect(
    await screen.findByText("无法加载数据，请稍后重试"),
  ).toBeInTheDocument();
});
