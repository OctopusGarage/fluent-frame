import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { defineConfig } from "vite";

function copyDirectory(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, basename(entry));
    if (statSync(sourcePath).isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else {
      copyFileSync(sourcePath, targetPath);
    }
  }
}

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
        copyDirectory(resolve(__dirname, "icons"), resolve(__dirname, "dist/icons"));
      },
    },
  ],
});
