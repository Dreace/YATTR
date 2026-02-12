import type { MouseEvent } from "react";
import type {
  DebugEntry,
  Feed,
  FetchLog,
  Folder,
  GeneralSettings,
  HealthStatus,
  PluginProvidedSettings,
  PluginSettingAction,
  PluginSettings,
  Entry,
} from "../../api";
import type {
  EditFeedDraft,
  EntrySort,
  SearchScope,
  ThemeMode,
  TranslateFn,
  ZoneCountState,
  ZoneKey,
} from "../../app/types";
import type {
  FeedDeleteDialogState,
  FolderDeleteDialogState,
} from "../../app/dialogTypes";
import { DebugDrawer } from "./DebugDrawer";
import { EditFeedDialog } from "./EditFeedDialog";
import { EntryList } from "./EntryList";
import { FeedContextMenu } from "./FeedContextMenu";
import { FolderContextMenu } from "./FolderContextMenu";
import { ReaderPane } from "./ReaderPane";
import { SettingsDrawer } from "./SettingsDrawer";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { UIButton, UIDialog } from "../ui";

interface SidebarTreeData {
  byFolder: Map<number, Feed[]>;
  noFolder: Feed[];
}

interface AppViewProps {
  t: TranslateFn;
  themeMode: ThemeMode;
  effectiveTheme: "light" | "dark";
  onThemeChange: (mode: ThemeMode) => void;
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  onSignOut: () => void;
  error: string | null;

  activeZone: ZoneKey;
  selectedFeed: number | null;
  selectedFolder: number | null;
  zoneCounts: ZoneCountState;
  newFeedUrl: string;
  newFeedFolderId: number | null;
  newFeedMessage: string;
  newFolderName: string;
  newFolderMessage: string;
  sortedFolders: Folder[];
  treeData: SidebarTreeData;
  unreadByFeed: Map<number, number>;
  folderUnreadCountByFolder: Map<number, number>;
  ungroupedUnreadCount: number;
  ungroupedCollapsed: boolean;
  isFolderCollapsed: (folderId: number) => boolean;
  toApiAssetUrl: (path: string | null | undefined) => string;
  onSelectZone: (zone: ZoneKey) => void;
  onNewFeedUrlChange: (value: string) => void;
  onNewFeedFolderChange: (value: number | null) => void;
  onAddFeed: () => void;
  onNewFolderNameChange: (value: string) => void;
  onAddFolder: () => void;
  onToggleFolderCollapsed: (folderId: number) => void;
  onSelectFolder: (folderId: number) => void;
  onSelectFeed: (feed: Feed) => void;
  onFolderContextMenu: (event: MouseEvent<HTMLButtonElement>, folder: Folder) => void;
  onToggleUngrouped: () => void;
  onFeedContextMenu: (event: MouseEvent<HTMLButtonElement>, feed: Feed) => void;

  entrySort: EntrySort;
  searchScope: SearchScope;
  searchInput: string;
  searchKeyword: string;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  loadingEntries: boolean;
  entries: Entry[];
  selectedEntry: Entry | null;
  selectedEntryIds: number[];
  feedById: Map<number, Feed>;
  formatPublishedAt: (timestamp?: number) => string;
  formatRelative: (timestamp?: number) => string;
  toPlainText: (value?: string | null) => string;
  onChangeActiveZone: (zone: ZoneKey) => void;
  onChangeEntrySort: (sort: EntrySort) => void;
  onChangeSearchScope: (scope: SearchScope) => void;
  onSearchInputChange: (value: string) => void;
  onRunSearch: () => void;
  onClearSearch: () => void;
  onMarkCurrentPageRead: () => void;
  onMarkAllInScopeRead: () => void;
  onMarkSelectedRead: () => void;
  onRefreshPage: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onSelectEntry: (entry: Entry | null) => void;
  onToggleStar: (entry?: Entry) => void;
  onToggleSelectedEntry: (entryId: number, checked: boolean) => void;

  selectedEntryFeed: Feed | null;
  selectedEntrySafeUrl: string | null;
  articleHtml: string;
  onToggleRead: () => void;
  onToggleStarCurrent: () => void;
  onToggleLater: () => void;

  folderMenu: { x: number; y: number; folderId: number } | null;
  feedMenu: { x: number; y: number; feedId: number } | null;
  onDeleteFolder: (folderId: number) => void;
  onEditFeed: (feedId: number) => void;
  onOpenDebugFeed: (feedId: number) => void;
  onDeleteFeed: (feedId: number) => void;

  feedDeleteDialog: FeedDeleteDialogState | null;
  folderDeleteDialog: FolderDeleteDialogState | null;
  deleteDialogBusy: boolean;
  onCloseFeedDeleteDialog: () => void;
  onConfirmFeedDelete: () => void;
  onCloseFolderDeleteDialog: () => void;
  onMoveFolderDeleteStepToMode: () => void;
  onConfirmFolderDeleteKeepFeeds: () => void;
  onConfirmFolderDeleteDeleteFeeds: () => void;

  editFeedDraft: EditFeedDraft | null;
  savingFeedEdit: boolean;
  onCloseEditFeedDialog: () => void;
  onSaveEditFeedDialog: () => void;
  onChangeEditFeedDraft: (
    updater: (prev: EditFeedDraft | null) => EditFeedDraft | null,
  ) => void;

  settingsOpen: boolean;
  settingsDraft: GeneralSettings;
  langMode: "system" | "zh" | "en";
  timeFormatPreview: string;
  healthLoading: boolean;
  healthLoadFailed: boolean;
  healthStatus: HealthStatus | null;
  pluginSettings: PluginSettings;
  pluginSettingMap: Record<string, PluginProvidedSettings>;
  pluginActionLoading: Record<string, boolean>;
  savingPlugins: boolean;
  onCloseSettings: () => void;
  onSettingsDraftChange: (value: GeneralSettings) => void;
  onSaveGeneralSettings: () => void;
  onLangModeChange: (mode: "system" | "zh" | "en") => void;
  onImportOpml: (file: File) => void;
  onExportOpml: () => void;
  formatSuccessRate: (value: number) => string;
  onTogglePlugin: (pluginId: string, enabled: boolean) => void;
  onSavePlugins: () => void;
  onPluginAction: (pluginId: string, action: PluginSettingAction) => void;

  debugOpen: boolean;
  debugFeedId: number | null;
  feeds: Feed[];
  debugMessage: string;
  debugLogs: FetchLog[];
  debugEntries: DebugEntry[];
  toSafeExternalHttpUrl: (value?: string | null) => string | null;
  onCloseDebug: () => void;
  onChangeDebugFeedId: (feedId: number | null) => void;
  onRefreshDebug: () => void;
  onRefreshDebugLogs: () => void;

  selectedFeedObject: Feed | null;
}

export function AppView(props: AppViewProps) {
  const {
    t,
    themeMode,
    effectiveTheme,
    onThemeChange,
    onOpenSettings,
    onOpenDebug,
    onSignOut,
    error,
  } = props;

  return (
    <div className="app-shell">
      <Topbar
        t={t}
        themeMode={themeMode}
        effectiveTheme={effectiveTheme}
        onThemeChange={onThemeChange}
        onOpenSettings={onOpenSettings}
        onOpenDebug={onOpenDebug}
        onSignOut={onSignOut}
      />

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="app-main">
        <Sidebar
          t={props.t}
          activeZone={props.activeZone}
          selectedFeed={props.selectedFeed}
          selectedFolder={props.selectedFolder}
          zoneCounts={props.zoneCounts}
          newFeedUrl={props.newFeedUrl}
          newFeedFolderId={props.newFeedFolderId}
          newFeedMessage={props.newFeedMessage}
          newFolderName={props.newFolderName}
          newFolderMessage={props.newFolderMessage}
          sortedFolders={props.sortedFolders}
          treeData={props.treeData}
          unreadByFeed={props.unreadByFeed}
          folderUnreadCountByFolder={props.folderUnreadCountByFolder}
          ungroupedUnreadCount={props.ungroupedUnreadCount}
          ungroupedCollapsed={props.ungroupedCollapsed}
          isFolderCollapsed={props.isFolderCollapsed}
          toApiAssetUrl={props.toApiAssetUrl}
          onSelectZone={props.onSelectZone}
          onNewFeedUrlChange={props.onNewFeedUrlChange}
          onNewFeedFolderChange={props.onNewFeedFolderChange}
          onAddFeed={props.onAddFeed}
          onNewFolderNameChange={props.onNewFolderNameChange}
          onAddFolder={props.onAddFolder}
          onToggleFolderCollapsed={props.onToggleFolderCollapsed}
          onSelectFolder={props.onSelectFolder}
          onSelectFeed={props.onSelectFeed}
          onFolderContextMenu={props.onFolderContextMenu}
          onToggleUngrouped={props.onToggleUngrouped}
          onFeedContextMenu={props.onFeedContextMenu}
        />

        <EntryList
          t={props.t}
          activeZone={props.activeZone}
          entrySort={props.entrySort}
          searchScope={props.searchScope}
          searchInput={props.searchInput}
          searchKeyword={props.searchKeyword}
          currentPage={props.currentPage}
          totalPages={props.totalPages}
          totalItems={props.totalItems}
          loadingEntries={props.loadingEntries}
          entries={props.entries}
          selectedEntry={props.selectedEntry}
          selectedEntryIds={props.selectedEntryIds}
          feedById={props.feedById}
          formatPublishedAt={props.formatPublishedAt}
          formatRelative={props.formatRelative}
          toPlainText={props.toPlainText}
          toApiAssetUrl={props.toApiAssetUrl}
          onChangeActiveZone={props.onChangeActiveZone}
          onChangeEntrySort={props.onChangeEntrySort}
          onChangeSearchScope={props.onChangeSearchScope}
          onSearchInputChange={props.onSearchInputChange}
          onRunSearch={props.onRunSearch}
          onClearSearch={props.onClearSearch}
          onMarkCurrentPageRead={props.onMarkCurrentPageRead}
          onMarkAllInScopeRead={props.onMarkAllInScopeRead}
          onMarkSelectedRead={props.onMarkSelectedRead}
          onRefreshPage={props.onRefreshPage}
          onPrevPage={props.onPrevPage}
          onNextPage={props.onNextPage}
          onSelectEntry={props.onSelectEntry}
          onToggleStar={props.onToggleStar}
          onToggleSelectedEntry={props.onToggleSelectedEntry}
        />

        <ReaderPane
          t={props.t}
          selectedEntry={props.selectedEntry}
          selectedEntryFeed={props.selectedEntryFeed}
          selectedEntrySafeUrl={props.selectedEntrySafeUrl}
          articleHtml={props.articleHtml}
          formatPublishedAt={props.formatPublishedAt}
          toApiAssetUrl={props.toApiAssetUrl}
          onToggleRead={props.onToggleRead}
          onToggleStar={props.onToggleStarCurrent}
          onToggleLater={props.onToggleLater}
        />
      </div>

      {props.folderMenu ? (
        <FolderContextMenu
          t={props.t}
          x={props.folderMenu.x}
          y={props.folderMenu.y}
          onDelete={() => props.onDeleteFolder(props.folderMenu!.folderId)}
        />
      ) : null}

      {props.feedMenu ? (
        <FeedContextMenu
          t={props.t}
          x={props.feedMenu.x}
          y={props.feedMenu.y}
          onEdit={() => props.onEditFeed(props.feedMenu!.feedId)}
          onDebug={() => props.onOpenDebugFeed(props.feedMenu!.feedId)}
          onDelete={() => props.onDeleteFeed(props.feedMenu!.feedId)}
        />
      ) : null}

      <UIDialog
        open={Boolean(props.feedDeleteDialog)}
        title={props.t("context.delete")}
        closeLabel={props.t("common.close")}
        onClose={props.onCloseFeedDeleteDialog}
        footer={
          <>
            <UIButton
              variant="outline"
              onClick={props.onCloseFeedDeleteDialog}
              disabled={props.deleteDialogBusy}
            >
              {props.t("common.cancel")}
            </UIButton>
            <UIButton
              variant="danger"
              onClick={props.onConfirmFeedDelete}
              disabled={props.deleteDialogBusy}
            >
              {props.deleteDialogBusy
                ? props.t("common.processing")
                : props.t("context.delete")}
            </UIButton>
          </>
        }
      >
        {props.feedDeleteDialog ? (
          <p>{props.t("context.delete.confirm", { title: props.feedDeleteDialog.feedTitle })}</p>
        ) : null}
      </UIDialog>

      <UIDialog
        open={Boolean(props.folderDeleteDialog)}
        title={props.t("context.folder.delete")}
        closeLabel={props.t("common.close")}
        onClose={props.onCloseFolderDeleteDialog}
        footer={
          props.folderDeleteDialog?.step === "confirm" ? (
            <>
              <UIButton
                variant="outline"
                onClick={props.onCloseFolderDeleteDialog}
                disabled={props.deleteDialogBusy}
              >
                {props.t("common.cancel")}
              </UIButton>
              <UIButton
                variant="danger"
                onClick={props.onMoveFolderDeleteStepToMode}
                disabled={props.deleteDialogBusy}
              >
                {props.t("context.folder.delete")}
              </UIButton>
            </>
          ) : (
            <>
              <UIButton
                variant="outline"
                onClick={props.onCloseFolderDeleteDialog}
                disabled={props.deleteDialogBusy}
              >
                {props.t("common.cancel")}
              </UIButton>
              <UIButton
                variant="secondary"
                onClick={props.onConfirmFolderDeleteKeepFeeds}
                disabled={props.deleteDialogBusy}
              >
                {props.t("context.folder.delete.keep_feeds")}
              </UIButton>
              <UIButton
                variant="danger"
                onClick={props.onConfirmFolderDeleteDeleteFeeds}
                disabled={props.deleteDialogBusy}
              >
                {props.deleteDialogBusy
                  ? props.t("common.processing")
                  : props.t("context.folder.delete.delete_feeds")}
              </UIButton>
            </>
          )
        }
      >
        {props.folderDeleteDialog ? (
          <p>
            {props.folderDeleteDialog.step === "confirm"
              ? props.t("context.folder.delete.confirm", {
                  name: props.folderDeleteDialog.folderName,
                })
              : props.t("context.folder.delete.mode", {
                  name: props.folderDeleteDialog.folderName,
                })}
          </p>
        ) : null}
      </UIDialog>

      <EditFeedDialog
        t={props.t}
        editFeedDraft={props.editFeedDraft}
        savingFeedEdit={props.savingFeedEdit}
        sortedFolders={props.sortedFolders}
        onClose={props.onCloseEditFeedDialog}
        onSave={props.onSaveEditFeedDialog}
        onChangeDraft={props.onChangeEditFeedDraft}
      />

      <SettingsDrawer
        t={props.t}
        open={props.settingsOpen}
        settingsDraft={props.settingsDraft}
        langMode={props.langMode}
        timeFormatPreview={props.timeFormatPreview}
        healthLoading={props.healthLoading}
        healthLoadFailed={props.healthLoadFailed}
        healthStatus={props.healthStatus}
        pluginSettings={props.pluginSettings}
        pluginSettingMap={props.pluginSettingMap}
        pluginActionLoading={props.pluginActionLoading}
        savingPlugins={props.savingPlugins}
        onClose={props.onCloseSettings}
        onSettingsDraftChange={props.onSettingsDraftChange}
        onSaveGeneralSettings={props.onSaveGeneralSettings}
        onLangModeChange={props.onLangModeChange}
        onImportOpml={props.onImportOpml}
        onExportOpml={props.onExportOpml}
        formatSuccessRate={props.formatSuccessRate}
        onTogglePlugin={props.onTogglePlugin}
        onSavePlugins={props.onSavePlugins}
        onPluginAction={props.onPluginAction}
      />

      <DebugDrawer
        t={props.t}
        open={props.debugOpen}
        debugFeedId={props.debugFeedId}
        feeds={props.feeds}
        debugMessage={props.debugMessage}
        debugLogs={props.debugLogs}
        debugEntries={props.debugEntries}
        formatPublishedAt={props.formatPublishedAt}
        toSafeExternalHttpUrl={props.toSafeExternalHttpUrl}
        toPlainText={props.toPlainText}
        onClose={props.onCloseDebug}
        onChangeFeedId={props.onChangeDebugFeedId}
        onRefresh={props.onRefreshDebug}
        onRefreshLogs={props.onRefreshDebugLogs}
      />

      {props.selectedFeedObject ? (
        <footer className="app-footer">
          {props.t("footer.current_feed", {
            title: props.selectedFeedObject.title,
            interval:
              props.selectedFeedObject.fetch_interval_min ??
              props.settingsDraft.default_fetch_interval_min,
            status: (props.selectedFeedObject.fulltext_enabled ??
              props.settingsDraft.fulltext_enabled)
              ? props.t("common.enabled")
              : props.t("common.disabled"),
          })}
        </footer>
      ) : null}
    </div>
  );
}
