import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const devProxyTarget =
  process.env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8000";

export default defineConfig({
  envPrefix: ["VITE_", "REACT_APP_"],
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "RSS Reader",
        short_name: "RSS",
        theme_color: "#0f172a",
        background_color: "#f5f6f8",
        display: "standalone",
        start_url: "/",
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: devProxyTarget,
        changeOrigin: true,
      },
      "/plugins": {
        target: devProxyTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    coverage: {
      reporter: ["text", "json", "html"],
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
  },
});
