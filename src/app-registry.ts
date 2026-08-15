import { existsSync, statSync } from "fs";
import { isAbsolute, join } from "path";
import { homedir } from "os";
import { readFileSync } from "fs";

/**
 * One app, as the registry declares it.
 *
 * @remarks
 * Structurally mirrored from core's `AppDescriptor` rather than imported: core-auth carries no
 * `core` submodule, which is the same reason `CONFIG_SUBDIR` and `cacheDir` are mirrored. Only the
 * fields this library reads are declared, because an unknown field is data it has no business
 * interpreting.
 */
export interface AppDescriptor {
  id: string;
  label?: string;
  home: { envOverride?: string; nativeEnv?: string; xdgSubdir?: string; candidates: string[] };
  detect?: { binary?: string; pkg?: string };
  modelCatalog?: { files: string[]; envOverride?: string; schemaUrl?: string; providerKey: string };
}

function trimmed(value?: string): string {
  return value && value.trim() ? value.trim() : "";
}

function registryFile(): string {
  const override = trimmed(process.env.HUB_APPS_FILE);
  return override || join(homedir(), ".config", "cairn", "apps.json");
}

let CACHE: AppDescriptor[] | null = null;
let CACHE_KEY = "";

/** Every app the registry declares, or an empty list when it declares none. */
export function appDescriptors(): AppDescriptor[] {
  const file = registryFile();
  let mtime = 0;
  try { mtime = existsSync(file) ? statSync(file).mtimeMs : 0; } catch { mtime = 0; }
  const key = file + "::" + mtime;
  if (CACHE && CACHE_KEY === key) return CACHE;
  let parsed: Record<string, Partial<AppDescriptor>> = {};
  try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { parsed = {}; }
  const out: AppDescriptor[] = [];
  for (const [id, entry] of Object.entries(parsed || {})) {
    const desc = { ...entry, id: entry?.id ?? id } as AppDescriptor;
    if (typeof desc.id !== "string" || !desc.id) continue;
    if (!desc.home || !Array.isArray(desc.home.candidates)) continue;
    out.push(desc);
  }
  CACHE = out;
  CACHE_KEY = key;
  return out;
}

/** One app by id, or null when the registry does not declare it. */
export function descriptorFor(id: string): AppDescriptor | null {
  if (!id) return null;
  return appDescriptors().find((desc) => desc.id === id) || null;
}

function expandTilde(value: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(home, value.slice(2));
  return value;
}

/** One declared path, resolved: `~` is the user home, a bare name is inside the app home. */
export function expandPath(value: string, appHome: string): string {
  const raw = trimmed(value);
  if (!raw) return "";
  if (raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\")) return expandTilde(raw, homedir());
  return isAbsolute(raw) ? raw : join(appHome, raw);
}

/** The home directory an app declares, by its own override, native var, XDG subdir or candidates. */
export function resolveHome(desc: AppDescriptor): string {
  const over = desc.home.envOverride ? trimmed(process.env[desc.home.envOverride]) : "";
  if (over) return over;
  const native = desc.home.nativeEnv ? trimmed(process.env[desc.home.nativeEnv]) : "";
  if (native) return native;
  if (desc.home.xdgSubdir) {
    const xdg = trimmed(process.env.XDG_CONFIG_HOME);
    if (xdg) return join(xdg, desc.home.xdgSubdir);
  }
  const candidates = desc.home.candidates.map((candidate) => expandTilde(candidate, homedir()));
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return candidates[candidates.length - 1] ?? "";
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Which app this process is running under, from data alone.
 *
 * @remarks
 * The injected id wins, because the app layer that launched this process is the only thing that
 * KNOWS. Everything below it is detection against what each app declares about itself, never a
 * name this library holds: an argv token matching a declared binary, a declared native env var
 * that is set, or a forced config dir matching a declared home.
 */
export function activeAppIdFromData(): string {
  const override = trimmed(process.env.CORE_APP);
  if (override) return override;
  const injected = trimmed(process.env.HUB_APP_ID);
  if (injected) return injected;

  const apps = appDescriptors();
  const argv = process.argv.join(" ").toLowerCase().split(/[^a-z0-9]+/);
  const byArgv = apps.find((desc) => desc.detect?.binary && argv.includes(desc.detect.binary.toLowerCase()));
  if (byArgv) return byArgv.id;

  const byEnv = apps.find((desc) => desc.home.nativeEnv && trimmed(process.env[desc.home.nativeEnv]));
  if (byEnv) return byEnv.id;

  const forced = trimmed(process.env.HUB_CONFIG_DIR);
  if (forced) {
    const target = normalize(forced);
    const byDir = apps.find((desc) => desc.home.candidates
      .map((candidate) => normalize(expandTilde(candidate, homedir())))
      .some((candidate) => candidate && (target === candidate || target.startsWith(candidate + "/"))));
    if (byDir) return byDir.id;
  }
  return "";
}

/** The descriptor of the app this process runs under, or null when it is unknown. */
export function activeDescriptor(): AppDescriptor | null {
  return descriptorFor(activeAppIdFromData());
}
