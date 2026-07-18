import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        content: resolve(__dirname, "src/content.ts"),
        popup: resolve(__dirname, "src/popup.ts"),
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
  plugins: [
    {
      name: "copy-extension-static",
      closeBundle() {
        mkdirSync(resolve(__dirname, "dist"), { recursive: true });
        copyFileSync(resolve(__dirname, "manifest.json"), resolve(__dirname, "dist/manifest.json"));
        copyFileSync(resolve(__dirname, "src/popup.html"), resolve(__dirname, "dist/popup.html"));
        copyFileSync(resolve(__dirname, "src/styles.css"), resolve(__dirname, "dist/styles.css"));
      },
    },
  ],
});
