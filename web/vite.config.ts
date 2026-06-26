import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// M-BOX 面板默认通过本机 daemon 提供服务；开发期把 /api 反代到 daemon。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8088",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:8088",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1200,
  },
});
