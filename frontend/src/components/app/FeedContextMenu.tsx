import { UIButton } from "../ui";
import type { TranslateFn } from "../../app/types";

interface FeedContextMenuProps {
  t: TranslateFn;
  x: number;
  y: number;
  onEdit: () => void;
  onDebug: () => void;
  onDelete: () => void;
}

export function FeedContextMenu({
  t,
  x,
  y,
  onEdit,
  onDebug,
  onDelete,
}: FeedContextMenuProps) {
  return (
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      <UIButton variant="outline" onClick={onEdit}>
        {t("context.edit")}
      </UIButton>
      <UIButton variant="outline" onClick={onDebug}>
        {t("context.debug")}
      </UIButton>
      <UIButton variant="danger" onClick={onDelete}>
        {t("context.delete")}
      </UIButton>
    </div>
  );
}
