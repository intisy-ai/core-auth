// Locks the rule that made this rewrite necessary: core-auth (a generic core lib) must not import
// or bundle any app-wire translator, and must not default the OpenCode namespace to a specific
// vendor. App-home detection (claude vs opencode config dir) is a separate, sanctioned concern and
// is intentionally NOT covered here. If this fails, a translator import or a hardcoded wire-vendor
// default crept back in.
import { expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const FORBIDDEN: RegExp[] = [
  /from\s+["'][^"']*-translator/,                        // importing any *-translator submodule
  /\banthropic-translator\b/,                             // the removed submodule, by name
  /\btranslators\s*\.\s*(anthropic|gemini|openai)\b/,     // core-ir per-vendor translator access
  /\|\|\s*["'](anthropic|gemini|openai)["']/,             // hardcoded wire-vendor namespace default
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "generated") continue;
      out.push(...sourceFiles(p));
      continue;
    }
    if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

it("core-auth imports no wire translator and hardcodes no wire-vendor default", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    readFileSync(file, "utf-8").split("\n").forEach((line, i) => {
      for (const re of FORBIDDEN) if (re.test(line)) offenders.push(file + ":" + (i + 1) + "  " + line.trim());
    });
  }
  expect(offenders, "translator import / wire-vendor default in core-auth:\n" + offenders.join("\n")).toEqual([]);
});
