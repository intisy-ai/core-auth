#!/usr/bin/env node
// Generic gradle-TeaVM -> stable-ESM staging step, reusable by ANY module that TeaVM-compiles Java
// into JS. Lives in core-proxy (the generic routing/TeaVM engine) so an app-proxy that nests
// core-proxy as a submodule (claude-code-proxy, opencode-proxy) reaches it via core-proxy/teavm-build.mjs
// without needing the `core` submodule. Nothing here is app-specific; everything is passed by flag.
//
// CONTRACT:
//   1. Runs `./gradlew <module>:<task>` (default task: generateJavaScript) inside --java-dir.
//   2. Locates the single non-sourcemap .js file TeaVM emitted under
//      <java-dir>/<module-dir>/build/generated/teavm/js/ (module-dir defaults to <module> with
//      its leading ':' stripped; override with --module-dir for a differently-named project dir).
//   3. Copies that file to --out (creating parent directories as needed), so esbuild bundles a
//      STABLE path instead of reaching into a Gradle build/ directory directly.
//
// Usage (run from the consuming package's own directory, where core-proxy is a submodule at ./core-proxy):
//   node core-proxy/teavm-build.mjs \
//     --java-dir java --module :claude-code-proxy-teavm --out src/generated/anthropic-rate-limit.teavm.js
//
// Optional flags:
//   --task <gradleTask>     (default: generateJavaScript)
//   --module-dir <dirName>  (default: --module with its leading ':' stripped)
//   --skip-build            (skip the gradle invocation; just re-copy whatever was last generated
//                            -- useful for iterating on the copy step without re-running Gradle)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const javaDir = resolve(val("--java-dir", null) ?? fail("--java-dir is required"));
const gradleModule = val("--module", null) ?? fail("--module is required (e.g. :claude-code-proxy-teavm)");
const gradleTask = val("--task", "generateJavaScript");
const moduleDir = val("--module-dir", gradleModule.replace(/^:/, ""));
const outPath = resolve(val("--out", null) ?? fail("--out is required"));
const skipBuild = has("--skip-build");

function fail(msg) {
  console.error(`teavm-build: ${msg}`);
  process.exit(1);
}

if (!existsSync(javaDir)) fail(`--java-dir not found: ${javaDir}`);

if (!skipBuild) {
  const isWin = process.platform === "win32";
  const gradlewPath = join(javaDir, isWin ? "gradlew.bat" : "gradlew");
  if (!existsSync(gradlewPath)) fail(`gradle wrapper not found at ${gradlewPath}`);
  console.log(`teavm-build: running ${gradleModule}:${gradleTask} in ${javaDir}`);
  const gradleArgs = [`${gradleModule}:${gradleTask}`, "--console=plain"];
  // gradlew.bat isn't directly executable (CreateProcess needs an interpreter for .bat) --
  // spawn cmd.exe /c explicitly (array args, no `shell: true`) rather than relying on execFileSync's
  // shell option, which triggers a Node deprecation warning about unescaped argument concatenation
  // on Windows. cmd.exe itself is a real .exe, so Node's normal (safe) Windows arg-quoting applies.
  if (isWin) {
    execFileSync("cmd.exe", ["/d", "/s", "/c", gradlewPath, ...gradleArgs], { cwd: javaDir, stdio: "inherit" });
  } else {
    execFileSync(gradlewPath, gradleArgs, { cwd: javaDir, stdio: "inherit" });
  }
}

const generatedDir = join(javaDir, moduleDir, "build", "generated", "teavm", "js");
if (!existsSync(generatedDir)) {
  fail(`no TeaVM output dir at ${generatedDir} -- did the gradle task run and does --module-dir match the project's actual directory name?`);
}
const candidates = readdirSync(generatedDir).filter((f) => f.endsWith(".js") && !f.endsWith(".js.map"));
if (candidates.length !== 1) {
  fail(`expected exactly one .js file in ${generatedDir}, found: ${candidates.join(", ") || "(none)"}`);
}
const generatedFile = join(generatedDir, candidates[0]);

mkdirSync(dirname(outPath), { recursive: true });
copyFileSync(generatedFile, outPath);
// Sourcemap, if TeaVM emitted one alongside: copy it too so it doesn't silently point nowhere.
const mapFile = `${generatedFile}.map`;
if (existsSync(mapFile)) copyFileSync(mapFile, `${outPath}.map`);

console.log(`teavm-build: staged ${generatedFile} -> ${outPath}`);

// Sanity: never silently stage an empty/corrupt file.
const size = statSync(outPath).size;
if (size === 0) fail(`staged file ${outPath} is empty`);
