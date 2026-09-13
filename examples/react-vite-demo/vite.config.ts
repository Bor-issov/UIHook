import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { uihook } from "@uihook/instrument/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // uihook() must run before the React transform so it sees original JSX positions.
  plugins: [uihook(), react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
