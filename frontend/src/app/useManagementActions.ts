import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  createFeed,
  createFolder,
  debugRefreshFeed,
  deleteFeed,
  deleteFolder,
  exportOpml,
  fetchDebugFeedEntries,
  fetchDebugFeedLogs,
  fetchHealthStatus,
  fetchPluginProvidedSettings,
  importOpml,
  invokePluginSettingAction,
  updateFeed,
  updateGeneralSettings,
  updatePluginSettings,
  validateFeedUrl,
  type DebugEntry,
  type Feed,
  type FetchLog,
  type GeneralSettings,
  type HealthStatus,
  type PluginProvidedSettings,
  type PluginSettingAction,
  type PluginSettings,
} from "../api";
import type { FeedDeleteDialogState, FolderDeleteDialogState } from "./dialogTypes";
import { normalizeTimeFormat } from "./utils";
import type {
  EditFeedDraft,
  FeedMenuState,
  FolderMenuState,
  TranslateFn,
  ZoneKey,
} from "./types";

interface BuildManagementActionsParams {
  signOut: () => Promise<void>;
  t: TranslateFn;
  feeds: Feed[];
  folders: Array<{ id: number; name: string; sort_order: number }>;
  sortedFolders: Array<{ id: number; name: string; sort_order: number }>;
  selectedFeed: number | null;
  selectedFolder: number | null;
  debugFeedId: number | null;
  settingsDraft: GeneralSettings;
  pluginSettings: PluginSettings;
  editFeedDraft: EditFeedDraft | null;
  feedDeleteDialog: FeedDeleteDialogState | null;
  folderDeleteDialog: FolderDeleteDialogState | null;
  collapsedFolderIds: Set<number>;
  newFeedUrl: string;
  newFeedFolderId: number | null;
  newFolderName: string;
  setSettingsDraft: Dispatch<SetStateAction<GeneralSettings>>;
  setPluginSettings: Dispatch<SetStateAction<PluginSettings>>;
  setPluginSettingMap: Dispatch<SetStateAction<Record<string, PluginProvidedSettings>>>;
  setPluginActionLoading: Dispatch<SetStateAction<Record<string, boolean>>>;
  setSavingPlugins: Dispatch<SetStateAction<boolean>>;
  setHealthStatus: Dispatch<SetStateAction<HealthStatus | null>>;
  setHealthLoading: Dispatch<SetStateAction<boolean>>;
  setHealthLoadFailed: Dispatch<SetStateAction<boolean>>;
  setNewFeedUrl: Dispatch<SetStateAction<string>>;
  setNewFeedMessage: Dispatch<SetStateAction<string>>;
  setNewFolderName: Dispatch<SetStateAction<string>>;
  setNewFolderMessage: Dispatch<SetStateAction<string>>;
  setEditFeedDraft: Dispatch<SetStateAction<EditFeedDraft | null>>;
  setSavingFeedEdit: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setFeedMenu: Dispatch<SetStateAction<FeedMenuState | null>>;
  setFolderMenu: Dispatch<SetStateAction<FolderMenuState | null>>;
  setFeedDeleteDialog: Dispatch<SetStateAction<FeedDeleteDialogState | null>>;
  setFolderDeleteDialog: Dispatch<SetStateAction<FolderDeleteDialogState | null>>;
  setDeleteDialogBusy: Dispatch<SetStateAction<boolean>>;
  setSelectedFeed: Dispatch<SetStateAction<number | null>>;
  setSelectedFolder: Dispatch<SetStateAction<number | null>>;
  setDebugFeedId: Dispatch<SetStateAction<number | null>>;
  setDebugOpen: Dispatch<SetStateAction<boolean>>;
  setDebugLogs: Dispatch<SetStateAction<FetchLog[]>>;
  setDebugEntries: Dispatch<SetStateAction<DebugEntry[]>>;
  setDebugMessage: Dispatch<SetStateAction<string>>;
  setActiveZone: Dispatch<SetStateAction<ZoneKey>>;
  setCollapsedFolderIds: Dispatch<SetStateAction<Set<number>>>;
  refreshBase: () => Promise<void>;
  refreshEntries: (page: number) => Promise<void>;
  refreshZoneCounts: () => Promise<void>;
}

export function buildManagementActions(params: BuildManagementActionsParams) {
  const handleSaveGeneralSettings = async () => {
    const saved = await updateGeneralSettings({
      ...params.settingsDraft,
      default_fetch_interval_min: Math.max(
        1,
        Math.min(1440, params.settingsDraft.default_fetch_interval_min),
      ),
      cleanup_retention_days: Math.max(
        1,
        Math.min(3650, params.settingsDraft.cleanup_retention_days),
      ),
      auto_refresh_interval_sec: Math.max(
        0,
        Math.min(86400, params.settingsDraft.auto_refresh_interval_sec),
      ),
      time_format: normalizeTimeFormat(params.settingsDraft.time_format),
    });
    params.setSettingsDraft(saved);
  };

  const handleTogglePlugin = (name: string, enabled: boolean) => {
    params.setPluginSettings((prev) => {
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
    params.setSavingPlugins(true);
    try {
      const saved = await updatePluginSettings(params.pluginSettings.enabled);
      params.setPluginSettings(saved);
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
        if (row) {
          nextPluginMap[row[0]] = row[1];
        }
      }
      params.setPluginSettingMap(nextPluginMap);
    } finally {
      params.setSavingPlugins(false);
    }
  };

  const handlePluginAction = async (
    pluginId: string,
    action: PluginSettingAction,
  ) => {
    const key = `${pluginId}:${action.id}`;
    params.setPluginActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const updated = await invokePluginSettingAction(action);
      params.setPluginSettingMap((prev) => ({ ...prev, [pluginId]: updated }));
    } finally {
      params.setPluginActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleImportOpml = async (file: File) => {
    await importOpml(file);
    await Promise.all([params.refreshBase(), params.refreshEntries(1)]);
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
    params.setHealthLoading(true);
    params.setHealthLoadFailed(false);
    try {
      const status = await fetchHealthStatus();
      params.setHealthStatus(status);
    } catch {
      params.setHealthLoadFailed(true);
    } finally {
      params.setHealthLoading(false);
    }
  };

  const handleValidateAndAddFeed = async () => {
    const url = params.newFeedUrl.trim();
    if (!url) {
      return;
    }
    try {
      const validated = await validateFeedUrl(url);
      if (!validated.valid) {
        params.setNewFeedMessage(validated.message || params.t("sidebar.add_feed.fail"));
        return;
      }
      await createFeed({
        title: validated.title,
        url,
        site_url: validated.site_url ?? null,
        folder_id: params.newFeedFolderId,
      });
      params.setNewFeedUrl("");
      params.setNewFeedMessage(params.t("sidebar.add_feed.success"));
      await Promise.all([
        params.refreshBase(),
        params.refreshEntries(1),
        params.refreshZoneCounts(),
      ]);
    } catch {
      params.setNewFeedMessage(params.t("sidebar.add_feed.fail"));
    }
  };

  const handleCreateFolder = async () => {
    const name = params.newFolderName.trim();
    if (!name) {
      params.setNewFolderMessage(params.t("sidebar.add_folder.required"));
      return;
    }
    try {
      await createFolder({
        name,
        sort_order: params.sortedFolders.length,
      });
      params.setNewFolderName("");
      params.setNewFolderMessage(params.t("sidebar.add_folder.success"));
      await params.refreshBase();
    } catch {
      params.setNewFolderMessage(params.t("sidebar.add_folder.fail"));
    }
  };

  const openEditFeedDialog = (feedId: number) => {
    const feed = params.feeds.find((item) => item.id === feedId);
    if (!feed) {
      return;
    }
    params.setEditFeedDraft({
      id: feed.id,
      title: feed.title,
      url: feed.url,
      site_url: feed.site_url ?? "",
      folder_id: feed.folder_id ?? null,
      disabled: feed.disabled ?? false,
      fetch_interval_min: feed.fetch_interval_min ?? 30,
      fulltext_enabled: feed.fulltext_enabled ?? false,
      cleanup_retention_days:
        feed.cleanup_retention_days ?? params.settingsDraft.cleanup_retention_days,
      cleanup_keep_content:
        feed.cleanup_keep_content ?? params.settingsDraft.cleanup_keep_content,
      image_cache_enabled:
        feed.image_cache_enabled ?? params.settingsDraft.image_cache_enabled,
    });
    params.setFeedMenu(null);
    params.setFolderMenu(null);
  };

  const handleEditFeedSave = async () => {
    if (!params.editFeedDraft) {
      return;
    }
    const title = params.editFeedDraft.title.trim();
    const url = params.editFeedDraft.url.trim();
    if (!title || !url) {
      params.setError(params.t("edit.error.required"));
      return;
    }
    params.setSavingFeedEdit(true);
    try {
      await updateFeed(params.editFeedDraft.id, {
        title,
        url,
        site_url: params.editFeedDraft.site_url.trim() || null,
        folder_id: params.editFeedDraft.folder_id,
        disabled: params.editFeedDraft.disabled,
        fetch_interval_min: Math.max(1, params.editFeedDraft.fetch_interval_min),
        fulltext_enabled: params.editFeedDraft.fulltext_enabled,
        cleanup_retention_days: Math.max(
          1,
          Math.min(3650, params.editFeedDraft.cleanup_retention_days),
        ),
        cleanup_keep_content: params.editFeedDraft.cleanup_keep_content,
        image_cache_enabled: params.editFeedDraft.image_cache_enabled,
      });
      params.setEditFeedDraft(null);
      params.setError(null);
      await Promise.all([params.refreshBase(), params.refreshEntries(1)]);
    } finally {
      params.setSavingFeedEdit(false);
    }
  };

  const handleFeedDelete = (feedId: number) => {
    const feed = params.feeds.find((item) => item.id === feedId);
    if (!feed) {
      return;
    }
    params.setFeedMenu(null);
    params.setFolderMenu(null);
    params.setFeedDeleteDialog({
      feedId: feed.id,
      feedTitle: feed.title,
    });
  };

  const confirmFeedDelete = async () => {
    if (!params.feedDeleteDialog) {
      return;
    }
    const feedId = params.feedDeleteDialog.feedId;
    params.setDeleteDialogBusy(true);
    try {
      await deleteFeed(feedId);
      if (params.selectedFeed === feedId) {
        params.setSelectedFeed(null);
      }
      params.setFeedDeleteDialog(null);
      await Promise.all([
        params.refreshBase(),
        params.refreshEntries(1),
        params.refreshZoneCounts(),
      ]);
    } finally {
      params.setDeleteDialogBusy(false);
    }
  };

  const handleFolderDelete = (folderId: number) => {
    const folder = params.folders.find((item) => item.id === folderId);
    if (!folder) {
      return;
    }
    const feedsInFolder = params.feeds
      .filter((feed) => feed.folder_id === folderId)
      .map((feed) => feed.id);
    params.setFolderMenu(null);
    params.setFeedMenu(null);
    params.setFolderDeleteDialog({
      folderId: folder.id,
      folderName: folder.name,
      feedsInFolder,
      step: "confirm",
    });
  };

  const confirmFolderDelete = async (deleteFeeds: boolean) => {
    if (!params.folderDeleteDialog) {
      return;
    }
    const { folderId, feedsInFolder } = params.folderDeleteDialog;
    params.setDeleteDialogBusy(true);
    try {
      await deleteFolder(folderId, deleteFeeds);
      if (params.selectedFolder === folderId) {
        params.setSelectedFolder(null);
      }
      if (params.selectedFeed && feedsInFolder.includes(params.selectedFeed)) {
        params.setSelectedFeed(null);
      }
      if (params.debugFeedId && feedsInFolder.includes(params.debugFeedId)) {
        params.setDebugFeedId(null);
      }
      params.setFolderDeleteDialog(null);
      await Promise.all([
        params.refreshBase(),
        params.refreshEntries(1),
        params.refreshZoneCounts(),
      ]);
    } finally {
      params.setDeleteDialogBusy(false);
    }
  };

  const refreshDebugData = async (feedId: number) => {
    const [logs, items] = await Promise.all([
      fetchDebugFeedLogs(feedId),
      fetchDebugFeedEntries(feedId),
    ]);
    params.setDebugLogs(logs);
    params.setDebugEntries(items);
  };

  const openDebugForFeed = async (feedId: number) => {
    params.setDebugFeedId(feedId);
    params.setDebugOpen(true);
    params.setFeedMenu(null);
    params.setFolderMenu(null);
    await refreshDebugData(feedId);
  };

  const handleDebugRefresh = async () => {
    if (!params.debugFeedId) {
      return;
    }
    const result = await debugRefreshFeed(params.debugFeedId, true);
    params.setDebugMessage(
      result.queued
        ? params.t("debug.message.queued", { feedId: result.feed_id })
        : params.t("debug.message.done", {
            feedId: result.feed_id,
            added: result.added,
            status: result.last_status,
          }),
    );
    await Promise.all([
      params.refreshBase(),
      refreshDebugData(params.debugFeedId),
      params.refreshZoneCounts(),
    ]);
  };

  const handleSelectZone = (zone: ZoneKey) => {
    params.setActiveZone(zone);
    params.setSelectedFeed(null);
    params.setSelectedFolder(null);
    params.setFolderMenu(null);
  };

  const handleSelectFolder = (folderId: number) => {
    params.setSelectedFolder(folderId);
    params.setSelectedFeed(null);
    params.setFolderMenu(null);
  };

  const handleSelectFeed = (feed: Feed) => {
    params.setSelectedFeed(feed.id);
    params.setSelectedFolder(feed.folder_id ?? null);
    params.setFolderMenu(null);
  };

  const isFolderCollapsed = (folderId: number): boolean =>
    params.collapsedFolderIds.has(folderId);

  const toggleFolderCollapsed = (folderId: number) => {
    params.setCollapsedFolderIds((prev) => {
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
    await params.signOut();
  };

  return {
    handleSaveGeneralSettings,
    handleTogglePlugin,
    handleSavePlugins,
    handlePluginAction,
    handleImportOpml,
    handleExportOpml,
    loadHealthStatus,
    handleValidateAndAddFeed,
    handleCreateFolder,
    openEditFeedDialog,
    handleEditFeedSave,
    handleFeedDelete,
    confirmFeedDelete,
    handleFolderDelete,
    confirmFolderDelete,
    openDebugForFeed,
    refreshDebugData,
    handleDebugRefresh,
    handleSelectZone,
    handleSelectFolder,
    handleSelectFeed,
    isFolderCollapsed,
    toggleFolderCollapsed,
    handleSignOut,
  };
}
