import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/gamebacklog/",
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3010", changeOrigin: false },
      "/mcp":  { target: "http://localhost:3010", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
  },
});
