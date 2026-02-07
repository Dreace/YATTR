import { vi } from "vitest";

const renderMock = vi.fn();

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: () => ({ render: renderMock }),
  },
  createRoot: () => ({ render: renderMock }),
}));

const registerMock = vi.fn();
vi.mock("virtual:pwa-register", () => ({
  registerSW: registerMock,
}));

document.body.innerHTML = "<div id='root'></div>";

it("registers service worker and renders app", async () => {
  await import("../main");
  expect(registerMock).toHaveBeenCalled();
  expect(renderMock).toHaveBeenCalled();
});
