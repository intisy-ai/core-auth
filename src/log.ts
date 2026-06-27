// @ts-nocheck
// File logger, toggleable via auth.json `logging`. Console mirroring is GLOBAL,
// off by default, toggled for every plugin via the shared config/core.json `logConsole`
// (or CORE_LOG_CONSOLE). Console lines go to stderr, prefixed [core-auth] + colored —
// matching core's scheme (core-auth doesn't bundle core, so the logic is mirrored here).

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join } from "path";
import { getConfigDir } from "./env.js";
import { readConfig } from "./config.js";

const START_TIME = new Date().toISOString().replace(/:/g, "-").split(".")[0];
const NAME = "core-auth";

// the shared ecosystem config (config/settings.json, root settings.json fallback)
function globalCore(): Record<string, any> {
  for (const p of [join(getConfigDir(), "config", "settings.json"), join(getConfigDir(), "settings.json")]) {
    try { if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")); } catch { /* ignore */ }
  }
  return {};
}
function envTruthy(v?: string): boolean { return !!v && v !== "0" && v.toLowerCase() !== "false"; }
function consoleEnabled(): boolean {
  if (process.env.CORE_LOG_CONSOLE !== undefined) return envTruthy(process.env.CORE_LOG_CONSOLE);
  return globalCore().logConsole === true;
}
function colorEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  return globalCore().logColor !== false;
}

// same palette + hash as core, so [core-auth] is always the same color ecosystem-wide
const RESET = "\x1b[0m";
const PALETTE = [36, 32, 33, 35, 34, 96, 92, 93, 95, 94];
function prefixColor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function log(message: string): void {
  try {
    if (consoleEnabled()) {
      if (colorEnabled()) console.error(`\x1b[${prefixColor(NAME)}m[${NAME}]${RESET} ${message}`);
      else console.error(`[${NAME}] ${message}`);
    }
    if (readConfig().logging === false) return;
    const dateStr = new Date().toISOString().split("T")[0];
    const dir = join(getConfigDir(), "logs", dateStr);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "core-auth-" + START_TIME + ".log"),
      "[" + new Date().toISOString() + "] " + message + "\n");
  } catch { /* never crash on log failure */ }
}
