// The provider prologue every core-auth provider (antigravity-auth, claude-code-auth,
// custom-auth, stub-auth) runs before it can serve as an OpenCode plugin. A provider's settings,
// their values and its slash commands are all manifest declarations a host applies, so nothing is
// registered here: what remains is the README generator and the guard that lets an action
// invocation (`node <bundle> accounts`) exit before the provider boots.
//
// core-auth has no "core" submodule of its own (only a provider repo nests both core/ and
// core-auth/ side by side), so defineReadme/maybeRunReadmeCli cannot be imported here directly. The
// caller passes its own "../core/dist/index.js" imports in via `core`, and its own action guard via
// `cliGuard`.

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
  defineReadme(spec: ReadmeSpec): ReadmeSpec;
  maybeRunReadmeCli(name: string): boolean;
}

export interface ProviderPluginOpts {
  name: string;                                     // the readme registration name
  driver: ProviderDef;
  core: ProviderPluginCore;                          // the caller's own core imports
  cliGuard: () => boolean | Promise<boolean>;        // the provider's own maybeRunCli(name), for actions like `accounts`
  readme?: ReadmeSpec;
  exit?: (code: number) => void;                     // defaults to process.exit; overridable for tests
}

// Slash-command / config invocations shell back in as `node <bundle> <action>`; both guards
// below must exit before the provider registers, so a CLI invocation never boots the provider.
export async function defineProviderPlugin(opts: ProviderPluginOpts): Promise<ProviderPlugin | undefined> {
  const exit = opts.exit ?? ((code: number) => process.exit(code));

  if (opts.readme) opts.core.defineReadme(opts.readme);

  if (opts.readme && opts.core.maybeRunReadmeCli(opts.name)) {
    exit(0);
    return undefined;
  }

  if (await opts.cliGuard()) {
    exit(0);
    return undefined;
  }

  return createProviderPlugin(opts.driver);
}
