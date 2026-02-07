import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";
import { AuthProvider } from "../auth/AuthProvider";
import { ProtectedRoute } from "../auth/ProtectedRoute";
import { useAuth } from "../auth/AuthProvider";
import { I18nProvider } from "../i18n";
import LoginPage from "../pages/LoginPage";
import { login, logout, refreshSession, type AuthSession } from "../api";

vi.mock("../api", () => ({
  login: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  refreshSession: vi.fn(),
  registerAuthHandlers: vi.fn(() => vi.fn()),
  setAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

function buildSession(email = "admin@example.com"): AuthSession {
  return {
    access_token: "token",
    token_type: "bearer",
    expires_in: 900,
    user: { id: 1, email },
  };
}

function renderAuthRoutes(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <I18nProvider>
        <AuthProvider>
          <Routes>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <div>APP_HOME</div>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.setItem("rss_lang_mode", "zh");
});

it("redirects unauthenticated user to login", async () => {
  vi.mocked(refreshSession).mockRejectedValueOnce(new Error("no-session"));
  renderAuthRoutes("/");
  expect(
    await screen.findByRole("button", { name: "登录" }),
  ).toBeInTheDocument();
});

it("allows login and navigates to app", async () => {
  vi.mocked(refreshSession).mockRejectedValueOnce(new Error("no-session"));
  vi.mocked(login).mockResolvedValueOnce(buildSession());
  renderAuthRoutes("/login");

  await userEvent.type(
    await screen.findByLabelText("邮箱"),
    "admin@example.com",
  );
  await userEvent.type(await screen.findByLabelText("密码"), "admin123");
  await userEvent.click(screen.getByRole("button", { name: "登录" }));
  expect(await screen.findByText("APP_HOME")).toBeInTheDocument();
});

it("redirects authenticated user away from login", async () => {
  vi.mocked(refreshSession).mockResolvedValueOnce(buildSession());
  renderAuthRoutes("/login");
  expect(await screen.findByText("APP_HOME")).toBeInTheDocument();
});

it("signs out via auth context action", async () => {
  vi.mocked(refreshSession).mockResolvedValueOnce(buildSession());
  render(
    <MemoryRouter initialEntries={["/"]}>
      <I18nProvider>
        <AuthProvider>
          <LogoutProbe />
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "执行退出" }),
  );
  expect(logout).toHaveBeenCalled();
});

function LogoutProbe() {
  const { signOut } = useAuth();
  return (
    <button type="button" onClick={() => void signOut()}>
      执行退出
    </button>
  );
}
