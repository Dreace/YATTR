import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { useI18n } from "../i18n";

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const { isAuthenticated, isInitializing } = useAuth();
  const { t } = useI18n();
  if (isInitializing) {
    return <div className="auth-loading">{t("login.loading")}</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
