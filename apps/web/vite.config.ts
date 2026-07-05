import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    forwardConsole: mode === "test" ? { logLevels: ["error"], unhandledErrors: true } : true
  }
}));
