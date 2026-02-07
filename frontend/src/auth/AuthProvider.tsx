import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearAccessToken,
  login,
  logout,
  refreshSession,
  registerAuthHandlers,
  setAccessToken,
  type AuthUser,
  type AuthSession,
} from "../api";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  signIn: typeof login;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  const applySession = useCallback((session: AuthSession) => {
    setAccessToken(session.access_token);
    setUser(session.user);
  }, []);

  const clearSession = useCallback(() => {
    clearAccessToken();
    setUser(null);
  }, []);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const session = await login(username, password);
      applySession(session);
      return session;
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const refresh = useCallback(async () => {
    try {
      const session = await refreshSession();
      applySession(session);
      return session;
    } catch {
      clearSession();
      return null;
    }
  }, [applySession, clearSession]);

  useEffect(() => {
    const unregister = registerAuthHandlers({
      refresh,
      onAuthFailure: () => clearSession(),
    });
    return unregister;
  }, [clearSession, refresh]);

  useEffect(() => {
    void (async () => {
      await refresh();
      setIsInitializing(false);
    })();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isInitializing,
      signIn,
      signOut,
    }),
    [user, isInitializing, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
