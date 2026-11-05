// Builds the web client into web/dist: one JavaScript bundle, one stylesheet, index.html.
// Run with: npm run build --workspace web   (or npm run build at the root)
import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";

const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: ["src/main.tsx", "src/style.css"], // -> dist/main.js, dist/style.css
  bundle: true, // Preact and our code in one file
  minify: true,
  sourcemap: true, // readable stack traces in the browser's dev tools
  format: "esm",
  target: "es2022", // browsers from the last few years, iPhones included
  jsx: "automatic",
  jsxImportSource: "preact",
  loader: { ".woff2": "file", ".woff": "file" }, // fonts are copied next to the bundle
  assetNames: "fonts/[name]-[hash]",
  outdir,
  logLevel: "info", // prints the bundle sizes
});

await copyFile("index.html", `${outdir}/index.html`);
