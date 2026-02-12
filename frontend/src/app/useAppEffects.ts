import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { THEME_MODE_KEY } from "./constants";
import { detectSystemTheme } from "./utils";
import type { Entry, ThemeMode, TranslateFn } from "./types";

interface UseAppEffectsParams {
  t: TranslateFn;
  themeMode: ThemeMode;
  setEffectiveTheme: Dispatch<SetStateAction<"light" | "dark">>;
  setRelativeNow: Dispatch<SetStateAction<number>>;
  bootstrapped: boolean;
  setBootstrapped: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  selectedFeed: number | null;
  selectedFolder: number | null;
  activeZone: "all" | "unread" | "starred" | "later";
  entrySort: "updated" | "title";
  searchKeyword: string;
  searchScope: "all" | "title" | "summary" | "content";
  refreshBase: () => Promise<void>;
  refreshZoneCounts: () => Promise<void>;
  refreshEntries: (page: number) => Promise<void>;
  setFeedMenu: Dispatch<SetStateAction<{ x: number; y: number; feedId: number } | null>>;
  setFolderMenu: Dispatch<SetStateAction<{ x: number; y: number; folderId: number } | null>>;
  autoRefreshIntervalSec: number;
  autoRefreshRunningRef: MutableRefObject<boolean>;
  currentPage: number;
  debugOpen: boolean;
  debugFeedId: number | null;
  refreshDebugData: (feedId: number) => Promise<void>;
  settingsOpen: boolean;
  loadHealthStatus: () => Promise<void>;
  entries: Entry[];
  selectedEntry: Entry | null;
  selectedEntrySafeUrl: string | null;
  setSelectedEntry: Dispatch<SetStateAction<Entry | null>>;
  toggleRead: (target?: Entry) => Promise<void>;
  toggleStar: (target?: Entry) => Promise<void>;
  toggleLater: (target?: Entry) => Promise<void>;
}

export function useAppEffects(params: UseAppEffectsParams) {
  useEffect(() => {
    void (async () => {
      try {
        await params.refreshBase();
        await params.refreshZoneCounts();
        await params.refreshEntries(1);
        params.setBootstrapped(true);
      } catch {
        params.setError(params.t("app.error.load"));
      }
    })();
  }, [params.t]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      params.setRelativeNow(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_MODE_KEY, params.themeMode);
    } catch {
      // Ignore storage errors.
    }
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    const applyTheme = () => {
      const system = media ? (media.matches ? "dark" : "light") : detectSystemTheme();
      const next = params.themeMode === "system" ? system : params.themeMode;
      params.setEffectiveTheme(next);
      document.documentElement.setAttribute("data-theme", next);
    };
    applyTheme();
    if (params.themeMode !== "system" || !media) {
      return;
    }
    const listener = () => applyTheme();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    }
    media.addListener(listener);
    return () => media.removeListener(listener);
  }, [params.themeMode]);

  useEffect(() => {
    if (!params.bootstrapped) {
      return;
    }
    void params.refreshEntries(1);
  }, [
    params.selectedFeed,
    params.selectedFolder,
    params.activeZone,
    params.entrySort,
    params.searchKeyword,
    params.searchScope,
    params.bootstrapped,
  ]);

  useEffect(() => {
    const closeMenu = () => {
      params.setFeedMenu(null);
      params.setFolderMenu(null);
    };
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  useEffect(() => {
    if (!params.bootstrapped) {
      return;
    }
    const intervalSec = Math.max(0, params.autoRefreshIntervalSec || 0);
    if (intervalSec <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      if (params.autoRefreshRunningRef.current) {
        return;
      }
      params.autoRefreshRunningRef.current = true;
      void (async () => {
        try {
          await Promise.all([
            params.refreshBase(),
            params.refreshEntries(params.currentPage),
            params.refreshZoneCounts(),
          ]);
          if (params.debugOpen && params.debugFeedId) {
            await params.refreshDebugData(params.debugFeedId);
          }
        } finally {
          params.autoRefreshRunningRef.current = false;
        }
      })();
    }, intervalSec * 1000);
    return () => window.clearInterval(timer);
  }, [
    params.bootstrapped,
    params.autoRefreshIntervalSec,
    params.currentPage,
    params.debugOpen,
    params.debugFeedId,
    params.activeZone,
    params.entrySort,
    params.searchKeyword,
    params.searchScope,
    params.selectedFeed,
    params.selectedFolder,
  ]);

  useEffect(() => {
    if (!params.debugOpen || !params.debugFeedId) {
      return;
    }
    void params.refreshDebugData(params.debugFeedId);
  }, [params.debugOpen, params.debugFeedId]);

  useEffect(() => {
    if (!params.settingsOpen) {
      return;
    }
    void params.loadHealthStatus();
  }, [params.settingsOpen]);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }
      if (!params.entries.length) {
        return;
      }
      const index = params.entries.findIndex(
        (entry) => entry.id === params.selectedEntry?.id,
      );
      if (event.key === "j") {
        const next = params.entries[Math.min(index + 1, params.entries.length - 1)];
        if (next) {
          params.setSelectedEntry(next);
        }
      }
      if (event.key === "k") {
        const prev = params.entries[Math.max(index - 1, 0)];
        if (prev) {
          params.setSelectedEntry(prev);
        }
      }
      if (event.key === "m") {
        void params.toggleRead();
      }
      if (event.key === "s") {
        void params.toggleStar();
      }
      if (event.key === "t") {
        void params.toggleLater();
      }
      if (event.key === "o" && params.selectedEntrySafeUrl) {
        window.open(params.selectedEntrySafeUrl, "_blank", "noopener");
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [params.entries, params.selectedEntry, params.selectedEntrySafeUrl]);
}
