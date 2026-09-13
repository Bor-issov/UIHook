import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(import.meta.dirname, "src/sidepanel"),
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ["@uihook/source"] },
  build: {
    emptyOutDir: false,
    rollupOptions: { input: { sidepanel: path.resolve(import.meta.dirname, "src/sidepanel/sidepanel.html") } },
  },
});
