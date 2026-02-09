import {
  DEFAULT_TIME_FORMAT,
  THEME_MODE_KEY,
  TIME_FORMAT_TOKEN_PATTERN,
} from "./constants";
import type { ThemeMode } from "./types";

export function toPlainText(value?: string | null): string {
  if (!value) {
    return "";
  }
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function readThemeMode(): ThemeMode {
  try {
    const value = window.localStorage.getItem(THEME_MODE_KEY);
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
  } catch {
    return "system";
  }
  return "system";
}

export function detectSystemTheme(): "light" | "dark" {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function normalizeTimeFormat(value: string): string {
  const trimmed = value.trim();
  return trimmed || DEFAULT_TIME_FORMAT;
}

export function toSafeExternalHttpUrl(value?: string | null): string | null {
  const raw = (value || "").trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname
    ) {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function formatDateByPattern(date: Date, format: string): string {
  const normalizedFormat = normalizeTimeFormat(format);
  const tokenValues: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    DD: String(date.getDate()).padStart(2, "0"),
    HH: String(date.getHours()).padStart(2, "0"),
    mm: String(date.getMinutes()).padStart(2, "0"),
    ss: String(date.getSeconds()).padStart(2, "0"),
  };
  return normalizedFormat.replace(
    TIME_FORMAT_TOKEN_PATTERN,
    (token) => tokenValues[token] ?? token,
  );
}

export function formatSuccessRate(value: number): string {
  const clamped = Math.min(1, Math.max(0, value || 0));
  return `${(clamped * 100).toFixed(1)}%`;
}
