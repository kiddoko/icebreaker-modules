/** a file's text, imported with ?raw (vite) */
declare module "*?raw" {
  const text: string;
  export default text;
}

/** vite: files by a pattern (tests/docs.test.ts reads the sources with ?raw) */
interface ImportMeta {
  glob(pattern: string, o: { query: "?raw"; import: "default"; eager: true }): Record<string, string>;
}
