import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { UIButton, UIInput } from "../components/ui";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n";

export default function LoginPage() {
  const { isAuthenticated, isInitializing, signIn } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isInitializing) {
    return <div className="auth-loading">{t("login.loading")}</div>;
  }
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const from =
    typeof location.state === "object" &&
    location.state &&
    "from" in location.state
      ? String((location.state as { from?: string }).from || "/")
      : "/";

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError(t("login.error.required"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
      navigate(from, { replace: true });
    } catch {
      setError(t("login.error.invalid"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>{t("login.title")}</h1>
        <label className="login-field">
          <span>{t("login.email")}</span>
          <UIInput
            type="email"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={t("login.email.placeholder")}
          />
        </label>
        <label className="login-field">
          <span>{t("login.password")}</span>
          <UIInput
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("login.password.placeholder")}
          />
        </label>
        {error ? <p className="login-error">{error}</p> : null}
        <UIButton type="submit" disabled={submitting}>
          {submitting ? t("login.submitting") : t("login.submit")}
        </UIButton>
      </form>
    </div>
  );
}
