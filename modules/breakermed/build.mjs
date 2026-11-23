// Builds BreakerMED into one readable main.js (not minified: the STORE reviews it line by line),
// and writes the `med` command's usage into README.md (between its two "usage" markers).
//   npm run build  (or: node build.mjs)
import { build, createServer } from "vite";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** README's command block, from USAGE (src/commands.ts): the help and the README can't differ */
export function readmeWithUsage(readme, usage) {
  const start = "<!-- usage: start -->", end = "<!-- usage: end -->";
  const a = readme.indexOf(start), b = readme.indexOf(end);
  if (a < 0 || b < a) throw new Error("README.md: the usage markers are missing");
  return `${readme.slice(0, a + start.length)}\n\`\`\`\n${usage.join("\n")}\n\`\`\`\n${readme.slice(b)}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await createServer({ configFile: false, logLevel: "error", root: join(here, "src"), server: { middlewareMode: true }, appType: "custom" });
  const { USAGE } = await server.ssrLoadModule("/commands.ts");
  await server.close();
  const path = join(here, "README.md");
  writeFileSync(path, readmeWithUsage(readFileSync(path, "utf8"), USAGE));
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
  console.log("built", join(here, "main.js"), "· README's usage");
}
