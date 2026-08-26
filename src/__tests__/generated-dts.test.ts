import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repo = fileURLToPath(new URL("../..", import.meta.url));

function emit(module: string, extra: string[] = []): string {
  const scratch = mkdtempSync(join(tmpdir(), "core-auth-dts-"));
  execFileSync(process.execPath, [
    join(repo, "node_modules", "@intisy-ai", "api", "scripts", "emit-dts.mjs"),
    "--java-dir", repo,
    "--module", module,
    ...extra,
    "--out", scratch,
  ], { cwd: repo, stdio: "inherit" });
  return scratch;
}

function expectMatchesCommitted(scratch: string, names: string[]): void {
  expect(readdirSync(scratch).sort()).toEqual(names);
  for (const name of names) {
    expect(readFileSync(join(scratch, name), "utf8")).toBe(readFileSync(join(repo, "src", "generated", name), "utf8"));
  }
}

it("keeps the committed contract declarations identical to what the java emits", () => {
  expectMatchesCommitted(emit(":auth-contracts", ["--module-dir", "auth-contracts", "--ext", ".ts"]), ["auth-contracts.keys.ts", "auth-contracts.ts"]);
});

it("keeps the committed teavm declarations identical to what the java emits", () => {
  expectMatchesCommitted(emit(":auth-teavm"), ["core-auth.teavm.d.ts"]);
});
