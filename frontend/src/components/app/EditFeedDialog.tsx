import { UICheckbox, UIDialog, UIInput, UISelect, UIButton } from "../ui";
import type { Folder } from "../../api";
import type { EditFeedDraft, TranslateFn } from "../../app/types";

interface EditFeedDialogProps {
  t: TranslateFn;
  editFeedDraft: EditFeedDraft | null;
  savingFeedEdit: boolean;
  sortedFolders: Folder[];
  onClose: () => void;
  onSave: () => void;
  onChangeDraft: (updater: (prev: EditFeedDraft | null) => EditFeedDraft | null) => void;
}

export function EditFeedDialog({
  t,
  editFeedDraft,
  savingFeedEdit,
  sortedFolders,
  onClose,
  onSave,
  onChangeDraft,
}: EditFeedDialogProps) {
  return (
    <UIDialog
      open={Boolean(editFeedDraft)}
      title={t("edit.title")}
      closeLabel={t("common.close")}
      onClose={onClose}
      footer={
        <>
          <UIButton variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </UIButton>
          <UIButton onClick={onSave} disabled={savingFeedEdit}>
            {savingFeedEdit ? t("edit.save.loading") : t("common.save")}
          </UIButton>
        </>
      }
    >
      {editFeedDraft ? (
        <form className="edit-feed-form" onSubmit={(event) => event.preventDefault()}>
          <label>
            <span>{t("edit.field.title")}</span>
            <UIInput
              value={editFeedDraft.title}
              onChange={(event) =>
                onChangeDraft((prev) =>
                  prev ? { ...prev, title: event.target.value } : prev,
                )
              }
            />
          </label>
          <label>
            <span>{t("edit.field.url")}</span>
            <UIInput
              value={editFeedDraft.url}
              onChange={(event) =>
                onChangeDraft((prev) =>
                  prev ? { ...prev, url: event.target.value } : prev,
                )
              }
            />
          </label>
          <label>
            <span>{t("edit.field.site_url")}</span>
            <UIInput
              value={editFeedDraft.site_url}
              onChange={(event) =>
                onChangeDraft((prev) =>
                  prev ? { ...prev, site_url: event.target.value } : prev,
                )
              }
            />
          </label>
          <label>
            <span>{t("edit.field.folder")}</span>
            <UISelect
              value={editFeedDraft.folder_id ?? ""}
              onChange={(event) =>
                onChangeDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        folder_id: event.target.value
                          ? Number(event.target.value)
                          : null,
                      }
                    : prev,
                )
              }
            >
              <option value="">{t("sidebar.ungrouped")}</option>
              {sortedFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </UISelect>
          </label>
          <label>
            <span>{t("edit.field.interval")}</span>
            <UIInput
              type="number"
              min={1}
              max={1440}
              value={editFeedDraft.fetch_interval_min}
              onChange={(event) =>
                onChangeDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        fetch_interval_min: Number(event.target.value) || 1,
                      }
                    : prev,
                )
              }
            />
          </label>
          <label className="checkbox-label">
            <UICheckbox
              checked={editFeedDraft.fulltext_enabled}
              onChange={(event) =>
                onChangeDraft((prev) =>
                  prev
                    ? { ...prev, fulltext_enabled: event.target.checked }
                    : prev,
                )
              }
            />
            <span>{t("edit.field.fulltext")}</span>
          </label>
          <label>
            <span>{t("edit.field.retention")}</span>
            <UIInput
              type="number"
              min={1}
              max={3650}
              value={editFeedDraft.cleanup_retention_days}
              onChange={(event) =>
                onChangeDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        cleanup_retention_days: Number(event.target.value) || 1,
                      }
                    : prev,
                )
              }
            />
          </label>
          <label className="checkbox-label">
            <UICheckbox
              checked={editFeedDraft.cleanup_keep_content}
              onChange={(event) =>
                onChangeDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        cleanup_keep_content: event.target.checked,
                      }
                    : prev,
                )
              }
            />
            <span>{t("edit.field.keep_content")}</span>
          </label>
          <label className="checkbox-label">
            <UICheckbox
              checked={editFeedDraft.image_cache_enabled}
              onChange={(event) =>
                onChangeDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        image_cache_enabled: event.target.checked,
                      }
                    : prev,
                )
              }
            />
            <span>{t("edit.field.image_cache")}</span>
          </label>
          <label className="checkbox-label">
            <UICheckbox
              checked={editFeedDraft.disabled}
              onChange={(event) =>
                onChangeDraft((prev) =>
                  prev ? { ...prev, disabled: event.target.checked } : prev,
                )
              }
            />
            <span>{t("edit.field.disabled")}</span>
          </label>
        </form>
      ) : null}
    </UIDialog>
  );
}
