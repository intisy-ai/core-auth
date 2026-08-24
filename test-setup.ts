// Every test runs against a temp home and a temp app registry, pinned here so no test file has to
// remember. A module that reaches the registry without pinning first reads the developer's real
// ~/.config/cairn/apps.json and resolves their real app home.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const home = mkdtempSync(join(tmpdir(), "core-auth-suite-home-"));
writeFileSync(join(home, "apps.json"), "{}");
process.env.HUB_CONFIG_DIR = home;
process.env.HUB_APPS_FILE = join(home, "apps.json");

afterAll(() => {
  try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
});
