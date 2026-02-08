import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Language = "zh" | "en";
export type LanguageMode = "system" | Language;

export const LANG_MODE_KEY = "rss_lang_mode";

const messages = {
  zh: {
    "common.app_name": "YATTR",
    "common.loading": "加载中...",
    "common.search": "搜索",
    "common.clear": "清空",
    "common.refresh": "刷新",
    "common.save": "保存",
    "common.cancel": "取消",
    "common.close": "关闭",
    "common.ok": "我知道了",
    "common.none": "暂无",
    "common.enable": "启用",
    "common.processing": "处理中...",
    "common.enabled": "开",
    "common.disabled": "关",
    "common.source": "来源",
    "common.updated": "更新",
    "common.published": "发布时间",
    "common.error": "错误",
    "common.theme": "主题模式",
    "common.theme.light": "亮色",
    "common.theme.dark": "暗色",
    "common.theme.system": "跟随系统",
    "common.theme.status.light": "亮色中",
    "common.theme.status.dark": "暗色中",

    "topbar.settings": "设置",
    "topbar.debug": "调试",
    "topbar.signout": "退出登录",

    "zone.title": "特殊区域",
    "zone.all": "全部文章",
    "zone.unread": "最新更新",
    "zone.starred": "加星文章",
    "zone.later": "已归档文章",

    "sidebar.add_feed": "添加订阅",
    "sidebar.add_feed.placeholder": "输入 RSS/Atom URL",
    "sidebar.add_feed.button": "验证并添加",
    "sidebar.add_feed.success": "添加成功",
    "sidebar.add_feed.fail": "添加失败，请检查 URL 是否有效",
    "sidebar.feeds": "订阅源",
    "sidebar.feed.fetch_failed": "上次抓取失败",
    "sidebar.ungrouped": "未分组",

    "toolbar.filter.all": "全部",
    "toolbar.filter.unread": "未读",
    "toolbar.filter.starred": "收藏",
    "toolbar.filter.later": "稍后读",
    "toolbar.sort.updated": "按更新时间",
    "toolbar.sort.title": "按标题",
    "toolbar.scope.all": "全文",
    "toolbar.scope.title": "标题",
    "toolbar.scope.summary": "摘要",
    "toolbar.scope.content": "正文",
    "toolbar.search.placeholder": "搜索...",

    "toolbar.batch.page_read": "当前页标记已读",
    "toolbar.batch.all_read": "一键全部已读",
    "toolbar.batch.selected_read": "标记选中已读",
    "toolbar.pager.prev": "上一页",
    "toolbar.pager.next": "下一页",
    "toolbar.pager.info":
      "第 {currentPage}/{totalPages} 页 · 共 {totalItems} 条",

    "entry.title.empty": "(无标题)",
    "entry.snippet.empty": "暂无摘要",
    "entry.empty": "暂无文章",
    "entry.checkbox": "选择 {title}",
    "entry.state.unread": "未读",
    "entry.state.later": "稍后",
    "entry.state.starred": "已星标",

    "reader.empty": "请选择文章以开始阅读",
    "reader.action.read": "标记已读",
    "reader.action.unread": "标记未读",
    "reader.action.star": "收藏",
    "reader.action.unstar": "取消收藏",
    "reader.action.later": "稍后读",
    "reader.action.unlater": "取消稍后",
    "reader.action.open": "打开原文",

    "context.edit": "编辑订阅",
    "context.debug": "调试",
    "context.delete": "删除订阅",
    "context.delete.confirm": "确认删除订阅「{title}」?",

    "edit.title": "编辑订阅",
    "edit.field.title": "标题",
    "edit.field.url": "URL",
    "edit.field.site_url": "站点 URL",
    "edit.field.folder": "所属分组",
    "edit.field.interval": "抓取间隔（分钟）",
    "edit.field.fulltext": "启用全文抽取",
    "edit.field.retention": "保留天数",
    "edit.field.keep_content": "保留正文内容",
    "edit.field.image_cache": "启用图片缓存",
    "edit.error.required": "标题和 URL 不能为空",
    "edit.save.loading": "保存中...",

    "settings.title": "设置",
    "settings.section.general": "全局设置",
    "settings.default_interval": "默认抓取间隔（分钟）",
    "settings.retention_days": "保留天数",
    "settings.fulltext": "启用全文抽取（全局）",
    "settings.keep_content": "保留正文内容（全局）",
    "settings.image_cache": "启用图片缓存（默认关闭）",
    "settings.auto_refresh": "自动刷新间隔（秒，0=关闭）",
    "settings.language": "语言",
    "settings.language.system": "跟随系统",
    "settings.language.zh": "简体中文",
    "settings.language.en": "English",
    "settings.time_format": "时间格式",
    "settings.time_format.placeholder": "例如 YYYY-MM-DD HH:mm:ss",
    "settings.time_format.preview": "当前预览: {value}",
    "settings.save": "保存全局设置",

    "settings.help.default_interval":
      "系统定时抓取订阅源的默认间隔。未单独设置的订阅会持续继承该值。",
    "settings.help.retention_days":
      "清理任务会按这个天数删除较早文章。数值越小，占用空间越低。",
    "settings.help.fulltext":
      "启用后，未单独设置的订阅会自动继承全文抽取开关。",
    "settings.help.keep_content":
      "关闭后，清理文章时会只保留标题和摘要，适合控制数据库体积。",
    "settings.help.image_cache":
      "启用后会缓存正文图片到本地，提升加载稳定性；清理文章时会同步清理相关缓存。",
    "settings.help.auto_refresh":
      "前端会按该间隔自动拉取最新数据并刷新界面。设置为 0 表示关闭自动刷新。",
    "settings.help.language": "切换界面语言，或跟随系统语言。",
    "settings.help.time_format":
      "数据库统一使用 UTC 时间戳，界面按浏览器时区显示并按此模板格式化。",
    "settings.help.plugin_enabled":
      "启用后会加载该插件的设置与接口；变更在服务重启后完整生效。",

    "settings.section.opml": "OPML",
    "settings.opml.import": "导入 OPML",
    "settings.opml.export": "导出 OPML",
    "settings.section.health": "系统状态",
    "settings.health.status": "状态",
    "settings.health.feeds": "订阅源总数",
    "settings.health.entries": "文章总数",
    "settings.health.failed_feeds": "失败订阅源",
    "settings.health.success_rate": "近期成功率",
    "settings.health.load_failed": "系统状态加载失败",

    "settings.section.plugins": "插件管理",
    "settings.plugins.empty": "当前没有可用插件",
    "settings.plugins.no_items": "插件未返回可展示的设置项。",
    "settings.plugins.save": "保存插件配置",
    "settings.plugins.save.loading": "保存中...",
    "settings.plugins.note": "插件启用状态保存后会立即生效。",

    "help.title": "选项说明",
    "help.aria": "查看「{title}」说明",

    "debug.title": "调试抓取",
    "debug.section.control": "抓取控制",
    "debug.action.refresh": "强制获取最新内容",
    "debug.action.refresh_logs": "刷新日志",
    "debug.section.logs": "抓取日志与错误",
    "debug.section.preview": "获取内容预览",
    "debug.empty.logs": "暂无日志",
    "debug.empty.entries": "暂无抓取内容",
    "debug.log.ok": "OK",
    "debug.entry.updated": "更新时间: {time}",
    "debug.entry.empty": "暂无正文内容",
    "debug.message.queued": "已将 feed={feedId} 的强制抓取任务加入后台队列",
    "debug.message.done":
      "已强制抓取 feed={feedId}，新增 {added} 条，状态 {status}",

    "footer.current_feed":
      "当前订阅: {title} | 间隔 {interval} 分钟 | 全文抽取 {status}",

    "login.loading": "正在检查登录状态...",
    "login.title": "登录 YATTR",
    "login.email": "邮箱",
    "login.password": "密码",
    "login.email.placeholder": "请输入管理员邮箱",
    "login.password.placeholder": "请输入密码",
    "login.submit": "登录",
    "login.submitting": "登录中...",
    "login.error.required": "请输入邮箱和密码",
    "login.error.invalid": "登录失败，请检查账号或密码",

    "app.error.load": "无法加载数据，请稍后重试",
    "time.ago.seconds": "{value} 秒前",
    "time.ago.minutes": "{value} 分钟前",
    "time.ago.hours": "{value} 小时前",
    "time.ago.days": "{value} 天前",
  },
  en: {
    "common.app_name": "YATTR",
    "common.loading": "Loading...",
    "common.search": "Search",
    "common.clear": "Clear",
    "common.refresh": "Refresh",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.close": "Close",
    "common.ok": "Got it",
    "common.none": "None",
    "common.enable": "Enable",
    "common.processing": "Processing...",
    "common.enabled": "On",
    "common.disabled": "Off",
    "common.source": "Source",
    "common.updated": "Updated",
    "common.published": "Published",
    "common.error": "Error",
    "common.theme": "Theme",
    "common.theme.light": "Light",
    "common.theme.dark": "Dark",
    "common.theme.system": "System",
    "common.theme.status.light": "Light",
    "common.theme.status.dark": "Dark",

    "topbar.settings": "Settings",
    "topbar.debug": "Debug",
    "topbar.signout": "Sign out",

    "zone.title": "Zones",
    "zone.all": "All items",
    "zone.unread": "Unread",
    "zone.starred": "Starred",
    "zone.later": "Later",

    "sidebar.add_feed": "Add feed",
    "sidebar.add_feed.placeholder": "Enter RSS/Atom URL",
    "sidebar.add_feed.button": "Validate & add",
    "sidebar.add_feed.success": "Feed added",
    "sidebar.add_feed.fail": "Failed to add. Check the URL.",
    "sidebar.feeds": "Feeds",
    "sidebar.feed.fetch_failed": "Last fetch failed",
    "sidebar.ungrouped": "Ungrouped",

    "toolbar.filter.all": "All",
    "toolbar.filter.unread": "Unread",
    "toolbar.filter.starred": "Starred",
    "toolbar.filter.later": "Later",
    "toolbar.sort.updated": "Updated",
    "toolbar.sort.title": "Title",
    "toolbar.scope.all": "All",
    "toolbar.scope.title": "Title",
    "toolbar.scope.summary": "Summary",
    "toolbar.scope.content": "Content",
    "toolbar.search.placeholder": "Search...",

    "toolbar.batch.page_read": "Mark page read",
    "toolbar.batch.all_read": "Mark all read",
    "toolbar.batch.selected_read": "Mark selected read",
    "toolbar.pager.prev": "Prev",
    "toolbar.pager.next": "Next",
    "toolbar.pager.info":
      "Page {currentPage}/{totalPages} · {totalItems} items",

    "entry.title.empty": "(Untitled)",
    "entry.snippet.empty": "No summary",
    "entry.empty": "No entries",
    "entry.checkbox": "Select {title}",
    "entry.state.unread": "Unread",
    "entry.state.later": "Later",
    "entry.state.starred": "Starred",

    "reader.empty": "Select an entry to start reading",
    "reader.action.read": "Mark read",
    "reader.action.unread": "Mark unread",
    "reader.action.star": "Star",
    "reader.action.unstar": "Unstar",
    "reader.action.later": "Read later",
    "reader.action.unlater": "Unlater",
    "reader.action.open": "Open original",

    "context.edit": "Edit feed",
    "context.debug": "Debug",
    "context.delete": "Delete feed",
    "context.delete.confirm": "Delete feed “{title}”?",

    "edit.title": "Edit feed",
    "edit.field.title": "Title",
    "edit.field.url": "URL",
    "edit.field.site_url": "Site URL",
    "edit.field.folder": "Folder",
    "edit.field.interval": "Fetch interval (min)",
    "edit.field.fulltext": "Enable full text",
    "edit.field.retention": "Retention days",
    "edit.field.keep_content": "Keep content",
    "edit.field.image_cache": "Enable image cache",
    "edit.error.required": "Title and URL are required",
    "edit.save.loading": "Saving...",

    "settings.title": "Settings",
    "settings.section.general": "General",
    "settings.default_interval": "Default fetch interval (min)",
    "settings.retention_days": "Retention days",
    "settings.fulltext": "Enable full text (global)",
    "settings.keep_content": "Keep content (global)",
    "settings.image_cache": "Enable image cache (default off)",
    "settings.auto_refresh": "Auto refresh (sec, 0=off)",
    "settings.language": "Language",
    "settings.language.system": "System",
    "settings.language.zh": "简体中文",
    "settings.language.en": "English",
    "settings.time_format": "Time format",
    "settings.time_format.placeholder": "e.g. YYYY-MM-DD HH:mm:ss",
    "settings.time_format.preview": "Preview: {value}",
    "settings.save": "Save settings",

    "settings.help.default_interval":
      "Default fetch interval inherited by feeds that are not explicitly customized.",
    "settings.help.retention_days":
      "Older entries are cleaned after this many days.",
    "settings.help.fulltext":
      "Feeds without explicit overrides inherit this full-text extraction switch.",
    "settings.help.keep_content":
      "If disabled, cleanup keeps only title and summary to reduce storage.",
    "settings.help.image_cache":
      "Cache images locally for stability. Cleanup also removes cached images.",
    "settings.help.auto_refresh": "Auto refresh the UI. Set 0 to disable.",
    "settings.help.language":
      "Switch UI language or follow the system language.",
    "settings.help.time_format":
      "Database stores UTC timestamps; UI shows browser-local time using this format.",
    "settings.help.plugin_enabled":
      "Enable the plugin. Changes fully apply after service restart.",

    "settings.section.opml": "OPML",
    "settings.opml.import": "Import OPML",
    "settings.opml.export": "Export OPML",
    "settings.section.health": "Health",
    "settings.health.status": "Status",
    "settings.health.feeds": "Feeds",
    "settings.health.entries": "Entries",
    "settings.health.failed_feeds": "Failed feeds",
    "settings.health.success_rate": "Recent success rate",
    "settings.health.load_failed": "Failed to load health status",

    "settings.section.plugins": "Plugins",
    "settings.plugins.empty": "No available plugins",
    "settings.plugins.no_items": "This plugin provides no visible settings.",
    "settings.plugins.save": "Save plugins",
    "settings.plugins.save.loading": "Saving...",
    "settings.plugins.note": "Plugin enablement changes take effect immediately.",

    "help.title": "Help",
    "help.aria": "Show help for {title}",

    "debug.title": "Debug",
    "debug.section.control": "Fetch controls",
    "debug.action.refresh": "Force refresh",
    "debug.action.refresh_logs": "Refresh logs",
    "debug.section.logs": "Fetch logs",
    "debug.section.preview": "Content preview",
    "debug.empty.logs": "No logs",
    "debug.empty.entries": "No entries",
    "debug.log.ok": "OK",
    "debug.entry.updated": "Updated: {time}",
    "debug.entry.empty": "No content",
    "debug.message.queued": "Queued refresh for feed={feedId}",
    "debug.message.done":
      "Refreshed feed={feedId}, added {added}, status {status}",

    "footer.current_feed":
      "Current feed: {title} | Interval {interval} min | Full text {status}",

    "login.loading": "Checking login status...",
    "login.title": "Sign in to YATTR",
    "login.email": "Email",
    "login.password": "Password",
    "login.email.placeholder": "Enter admin email",
    "login.password.placeholder": "Enter password",
    "login.submit": "Sign in",
    "login.submitting": "Signing in...",
    "login.error.required": "Email and password are required",
    "login.error.invalid": "Login failed. Check your credentials.",

    "app.error.load": "Failed to load data. Please try again.",
    "time.ago.seconds": "{value}s ago",
    "time.ago.minutes": "{value}m ago",
    "time.ago.hours": "{value}h ago",
    "time.ago.days": "{value}d ago",
  },
} as const;

type MessageKey = keyof typeof messages.zh;

function detectSystemLanguage(): Language {
  if (typeof navigator === "undefined") {
    return "en";
  }
  const raw =
    navigator.language || (navigator.languages ? navigator.languages[0] : "");
  return raw.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function resolveLanguage(mode: LanguageMode): Language {
  return mode === "system" ? detectSystemLanguage() : mode;
}

function formatMessage(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

/* eslint-disable no-unused-vars */
interface I18nContextValue {
  mode: LanguageMode;
  language: Language;
  setMode: (...args: [LanguageMode]) => void;
  t: (...args: [MessageKey, Record<string, string | number>?]) => string;
}
/* eslint-enable no-unused-vars */

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function readStoredMode(): LanguageMode {
  try {
    const raw = window.localStorage.getItem(LANG_MODE_KEY);
    if (raw === "system" || raw === "zh" || raw === "en") {
      return raw;
    }
  } catch {
    return "system";
  }
  return "system";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<LanguageMode>(() => readStoredMode());
  const [language, setLanguage] = useState<Language>(() =>
    resolveLanguage(mode),
  );

  useEffect(() => {
    setLanguage(resolveLanguage(mode));
    try {
      window.localStorage.setItem(LANG_MODE_KEY, mode);
    } catch {
      // Ignore storage errors.
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "system") {
      return;
    }
    const handleChange = () => setLanguage(resolveLanguage("system"));
    window.addEventListener("languagechange", handleChange);
    return () => window.removeEventListener("languagechange", handleChange);
  }, [mode]);

  const value = useMemo<I18nContextValue>(
    () => ({
      mode,
      language,
      setMode: setModeState,
      t: (key, params) => formatMessage(messages[language][key], params),
    }),
    [language, mode],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}
