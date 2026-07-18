import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "harden-production-bundle",
      generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === "chunk") {
            chunk.code = chunk.code
              .replaceAll("https://react.dev/errors/", "React error ")
              // StateLens never uses React's raw-HTML escape hatch. Removing the
              // dispatch key keeps that capability absent from packaged code.
              .replaceAll("dangerouslySetInnerHTML", "statelensRawHtmlDisabled");
          }
        }
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        panel: resolve(import.meta.dirname, "panel.html"),
        devtools: resolve(import.meta.dirname, "devtools.html"),
        "service-worker": resolve(import.meta.dirname, "src/background/service-worker.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "service-worker" ? "service-worker.js" : "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
