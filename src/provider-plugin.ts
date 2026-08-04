// The provider prologue every core-auth provider (antigravity-auth, claude-code-auth,
// custom-auth, stub-auth) runs before it can serve as an OpenCode plugin. Order matters:
// config + capabilities must be registered BEFORE the config-CLI guard, so `config schema`
// (the loader's Configure screen, the `/config` command) sees the full schema even on a
// `config`/`readme` CLI invocation that exits right after.
//
// core-auth has no "core" submodule of its own (only a provider repo nests both core/ and
// core-auth/ side by side), so defineConfig/defineCapabilities/defineReadme/maybeRunReadmeCli/
// deployCommands cannot be imported here directly. The caller passes its own "../core/dist/index.js"
// imports in via `core`, and its own config-CLI guard (`maybeRunConfigCli(name)` or a provider's
// richer `maybeRunCli(name)` that also handles other actions like `accounts`) via `configCliGuard`.

import { createProviderPlugin, type ProviderPlugin } from "./provider-plugin-runtime.js";
import type { ProviderDef } from "./types.js";

// core-auth carries no "core" submodule of its own (only a provider repo nests core/ and
// core-auth/ side by side), so these mirror core's CommandDef / CapabilitySchema / ReadmeSpec
// shapes structurally instead of importing them. A real value from "../core/dist/index.js"
// slots in with no casting: TypeScript matches these by shape, not by shared identity.
export interface CommandDef {
  name: string;
  description: string;
  argumentHint?: string;
  body?: string;
  shell?: string;
}

export type FieldType = "boolean" | "number" | "string" | "secret" | "select" | "multiline" | "list";

export interface FieldSpec {
  key: string;
  type: FieldType;
  label?: string;
  description?: string;
  group?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  itemType?: "string" | "number";
  placeholder?: string;
}

export interface ActionSpec {
  id: string;
  label: string;
  description?: string;
  confirm?: string;
  danger?: boolean;
}

export interface CapabilitySchema {
  fields?: FieldSpec[];
  actions?: ActionSpec[];
}

export interface ReadmeSpec {
  name?: string;
  tagline?: string;
  description?: string;
  architecture?: string;
  structure?: { src?: string[]; dist?: string[] };
  commands?: Array<{ name: string; description?: string; argumentHint?: string }>;
  dependencies?: string[];
  extraSections?: Array<{ id: string; title: string; body: string; after?: string }>;
}

export interface ProviderPluginCore {
  defineConfig(name: string, defaults: Record<string, unknown>): Record<string, unknown>;
  defineCapabilities(name: string, schema: CapabilitySchema): void;
  defineReadme(spec: ReadmeSpec): ReadmeSpec;
  maybeRunReadmeCli(name: string): boolean;
  deployCommands(packageName: string, commands: CommandDef[]): string[];
}

export interface ProviderPluginOpts {
  name: string;                                     // defineConfig/defineCapabilities/readme registration name
  driver: ProviderDef;
  core: ProviderPluginCore;                          // the caller's own core imports
  configCliGuard: () => boolean | Promise<boolean>;  // maybeRunConfigCli(name) or a provider's own maybeRunCli(name)
  packageName?: string;                              // deployCommands bundle-path name; defaults to `name`
  defaults?: Record<string, unknown>;
  capabilities?: CapabilitySchema;
  readme?: ReadmeSpec;
  commands?: CommandDef[];
  exit?: (code: number) => void;                     // defaults to process.exit; overridable for tests
}

// Slash-command / config invocations shell back in as `node <bundle> <action>`; both guards
// below must exit before the provider registers, so a CLI invocation never boots the provider.
export async function defineProviderPlugin(opts: ProviderPluginOpts): Promise<ProviderPlugin | undefined> {
  const exit = opts.exit ?? ((code: number) => process.exit(code));

  opts.core.defineConfig(opts.name, opts.defaults ?? {});
  if (opts.capabilities) opts.core.defineCapabilities(opts.name, opts.capabilities);
  if (opts.readme) opts.core.defineReadme(opts.readme);

  if (opts.readme && opts.core.maybeRunReadmeCli(opts.name)) {
    exit(0);
    return undefined;
  }

  if (await opts.configCliGuard()) {
    exit(0);
    return undefined;
  }

  if (opts.commands && opts.commands.length) {
    try { opts.core.deployCommands(opts.packageName ?? opts.name, opts.commands); }
    catch { /* best-effort, matches every provider's current guard */ }
  }

  return createProviderPlugin(opts.driver);
}
