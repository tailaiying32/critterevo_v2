import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works at any URL path (for example a GitHub Pages project site).
  base: "./",
  worker: { format: "es" },
});
