import { formatDateByPattern } from "./utils";
import type { TranslateFn } from "./types";

export function toApiAssetUrlByBase(
  apiBaseUrl: string,
  path: string | null | undefined,
): string {
  if (!path) {
    return "";
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  if (path.startsWith("/")) {
    return `${apiBaseUrl}${path}`;
  }
  return path;
}

export function formatPublishedAtByPattern(
  timestamp: number | undefined,
  pattern: string,
): string {
  if (!timestamp) {
    return "--";
  }
  return formatDateByPattern(new Date(timestamp * 1000), pattern);
}

export function formatRelativeByNow(
  timestamp: number | undefined,
  nowMs: number,
  t: TranslateFn,
): string {
  if (!timestamp) {
    return "--";
  }
  const diffSec = Math.max(0, Math.floor((nowMs - timestamp * 1000) / 1000));
  if (diffSec < 60) {
    return t("time.ago.seconds", { value: diffSec });
  }
  if (diffSec < 3600) {
    return t("time.ago.minutes", { value: Math.floor(diffSec / 60) });
  }
  if (diffSec < 86400) {
    return t("time.ago.hours", { value: Math.floor(diffSec / 3600) });
  }
  return t("time.ago.days", { value: Math.floor(diffSec / 86400) });
}
