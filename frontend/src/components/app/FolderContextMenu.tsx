import { UIButton } from "../ui";
import type { TranslateFn } from "../../app/types";

interface FolderContextMenuProps {
  t: TranslateFn;
  x: number;
  y: number;
  onDelete: () => void;
}

export function FolderContextMenu({
  t,
  x,
  y,
  onDelete,
}: FolderContextMenuProps) {
  return (
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      <UIButton variant="danger" onClick={onDelete}>
        {t("context.folder.delete")}
      </UIButton>
    </div>
  );
}
