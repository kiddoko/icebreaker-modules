// Checks index.json: valid JSON, required fields, unique ids. Run: node scripts/check-index.mjs
import { readFileSync } from "node:fs";
const list = JSON.parse(readFileSync(new URL("../index.json", import.meta.url), "utf8"));
if (!Array.isArray(list)) throw new Error("index.json must be an array");
const seen = new Set();
const errors = [];
list.forEach((e, i) => {
  const at = `entry ${i} (${e?.id ?? "?"})`;
  for (const k of ["id", "kind", "name", "description", "author", "repo"]) if (typeof e?.[k] !== "string" || !e[k].trim()) errors.push(`${at}: missing "${k}"`);
  if (e?.kind && !["plugin", "theme"].includes(e.kind)) errors.push(`${at}: kind must be "plugin" or "theme"`);
  if (e?.id && !/^[a-z0-9][a-z0-9-]*$/.test(e.id)) errors.push(`${at}: id must be lowercase letters, digits, dashes`);
  if (e?.id && seen.has(`${e.kind}:${e.id}`)) errors.push(`${at}: duplicate id`);
  seen.add(`${e?.kind}:${e?.id}`);
});
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`index.json OK — ${list.length} entries`);
