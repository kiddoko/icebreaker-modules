// Builds breakerMED into one readable main.js (not minified: the STORE reviews it line by line).
//   npm run build  (or: node build.mjs)
import { build } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
await build({
  configFile: false,
  logLevel: "error",
  root: join(here, "src"),
  build: {
    lib: { entry: join(here, "src/main.ts"), formats: ["es"], fileName: () => "main.js" },
    outDir: here,
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    target: "es2021",
    copyPublicDir: false,
  },
});
console.log("built", join(here, "main.js"));
