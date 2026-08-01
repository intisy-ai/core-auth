#!/usr/bin/env node
// Post-tsc step: tsc does not copy plain .js files, but the runtime `import("./generated/...")`
// in core-proxy-loader.js must resolve to the TeaVM-transpiled JS that build:teavm staged under
// src/generated/. Copy it (and its sourcemap, if present) into dist/generated/ verbatim.
//
// Reusable the same way teavm-build.mjs is: an app-proxy nesting core-proxy as a submodule and
// building it via `npx tsc --project core-proxy/tsconfig.json` calls this afterward via
// `node core-proxy/copy-generated.mjs` (relying on the default --root of "core-proxy").
import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const root = val("--root", ".");

const srcDir = join(root, "src", "generated");
const outDir = join(root, "dist", "generated");

mkdirSync(outDir, { recursive: true });

if (existsSync(srcDir)) {
  for (const file of readdirSync(srcDir)) {
    if (file.endsWith(".js") || file.endsWith(".js.map")) {
      copyFileSync(join(srcDir, file), join(outDir, file));
      console.log(`copy-generated: copied ${join(srcDir, file)} -> ${join(outDir, file)}`);
    }
  }
}
