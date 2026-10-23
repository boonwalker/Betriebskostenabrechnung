import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      output: {
        // Der PDF-Worker (pdf.js) als .js ausliefern – nicht jeder Server kennt den Typ von .mjs
        assetFileNames: (info) => (info.names?.[0] ?? info.name ?? "").endsWith(".mjs") ? "assets/[name]-[hash].js" : "assets/[name]-[hash][extname]",
      },
    },
  },
});
