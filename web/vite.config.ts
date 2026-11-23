import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Backend address — single source is web/.env (VITE_JARVIS_HOST/PORT, see
// .env.example); JARVIS_API still overrides everything when set in the shell.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const host = env.VITE_JARVIS_HOST || "127.0.0.1";
  const port = env.VITE_JARVIS_PORT || "7341";
  const apiTarget = process.env.JARVIS_API ?? `http://${host}:${port}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
        "/ws":  { target: apiTarget, ws: true, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      target: "es2020",
    },
  };
});
