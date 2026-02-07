import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from "react";
import { forwardRef } from "react";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

interface UIButtonProps extends ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const UIButton = forwardRef<ElementRef<"button">, UIButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cx(
        "ui-button",
        `ui-button--${variant}`,
        `ui-button--${size}`,
        className,
      )}
      {...props}
    />
  ),
);

UIButton.displayName = "UIButton";

export const UIInput = forwardRef<
  ElementRef<"input">,
  ComponentPropsWithoutRef<"input">
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cx("ui-input", className)} {...props} />
));

UIInput.displayName = "UIInput";

export const UISelect = forwardRef<
  ElementRef<"select">,
  ComponentPropsWithoutRef<"select">
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cx("ui-select", className)} {...props} />
));

UISelect.displayName = "UISelect";

export function UIBadge({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <span className={cx("ui-badge", className)}>{children}</span>;
}

export const UICheckbox = forwardRef<
  ElementRef<"input">,
  Omit<ComponentPropsWithoutRef<"input">, "type">
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cx("ui-checkbox", className)}
    {...props}
  />
));

UICheckbox.displayName = "UICheckbox";

export function UIScrollArea({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cx("ui-scroll-area", className)}>{children}</div>;
}

export function UISeparator({ className }: { className?: string }) {
  return <div className={cx("ui-separator", className)} aria-hidden="true" />;
}

export function UITooltip({
  content,
  children,
  className,
}: {
  content: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("ui-tooltip", className)} title={content}>
      {children}
    </span>
  );
}

export function UIDialog({
  open,
  title,
  onClose,
  closeLabel = "Close",
  className,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  closeLabel?: string;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) {
    return null;
  }
  return (
    <div
      className="ui-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={cx("ui-dialog-card", className)}>
        <div className="ui-dialog-header">
          <h3>{title}</h3>
          <UIButton
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={closeLabel}
          >
            {closeLabel}
          </UIButton>
        </div>
        <div className="ui-dialog-body">{children}</div>
        {footer ? <div className="ui-dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function UISheet({
  open,
  title,
  onClose,
  closeLabel = "Close",
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  closeLabel?: string;
  children: ReactNode;
}) {
  if (!open) {
    return null;
  }
  return (
    <div
      className="ui-sheet-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="ui-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="ui-sheet-card"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ui-sheet-header">
          <h3>{title}</h3>
          <UIButton
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={closeLabel}
          >
            {closeLabel}
          </UIButton>
        </div>
        <div className="ui-sheet-body">{children}</div>
      </aside>
    </div>
  );
}
