import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/gamebacklog/",
  server: {
    port: 5173,
    proxy: {
      "/gamebacklog/api": { target: "http://localhost:3010", changeOrigin: false },
      "/gamebacklog/mcp": { target: "http://localhost:3010", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
  },
});
