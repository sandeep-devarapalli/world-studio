import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const scriptsRoot = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: fileURLToPath(new URL("./dist/reduced-collider-held-runner", import.meta.url)),
    rollupOptions: {
      output: { entryFileNames: "validate-reduced-collider-held.mjs" },
    },
    ssr: fileURLToPath(new URL("./validate-reduced-collider-held.mjs", import.meta.url)),
    target: "node22",
  },
  root: scriptsRoot,
  ssr: {
    noExternal: ["@world-studio/artifacts", "@world-studio/world-core"],
  },
});
