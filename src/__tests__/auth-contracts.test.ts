import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repo = fileURLToPath(new URL("../..", import.meta.url));

function contractFiles(dir: string): string[] {
  // src/generated also holds the TeaVM bundle, which this emission does not produce.
  return readdirSync(dir).filter((name) => name.startsWith("auth-contracts")).sort();
}

it("keeps the committed provider vocabulary identical to what the java emits", () => {
  const scratch = mkdtempSync(join(tmpdir(), "auth-contracts-"));
  execFileSync(process.execPath, [
    join(repo, "node_modules", "@intisy-ai", "api", "scripts", "emit-dts.mjs"),
    "--java-dir", repo,
    "--module", ":auth-contracts",
    "--module-dir", "auth-contracts",
    "--out", scratch,
  ], { cwd: repo, stdio: "inherit" });

  const emitted = contractFiles(scratch);
  const committed = contractFiles(join(repo, "src", "generated"));
  expect(emitted).toEqual(committed);
  for (const name of emitted) {
    expect(readFileSync(join(scratch, name), "utf8")).toBe(
      readFileSync(join(repo, "src", "generated", name), "utf8"),
    );
  }
});
