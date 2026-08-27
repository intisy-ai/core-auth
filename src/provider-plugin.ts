// The provider prologue every core-auth provider (antigravity-auth, claude-code-auth,
// custom-auth, stub-auth) runs before it can serve as an OpenCode plugin. A provider's settings,
// their values and its slash commands are all manifest declarations a host applies, so nothing is
// registered here: what remains is the README generator and the guard that lets an action
// invocation (`node <bundle> accounts`) exit before the provider boots.
//
// The action guard stays a parameter (`cliGuard`), because which actions a provider answers is the
// provider's own business.

import { defineReadme, maybeRunReadmeCli } from "@intisy-ai/core";
import { createProviderPlugin, type ProviderPlugin } from "./provider-plugin-runtime.js";
import type { ProviderDef } from "./types.js";
import type { ReadmeSpec } from "@intisy-ai/core";

// core mints the settings vocabulary a provider declares itself in, and the readme shape it
// registers, so both are re-exported rather than restated: a provider takes them from here and the
// contract cannot narrow behind its back. The copies these replace had already drifted, missing an
// action's `args` and a schema's `sections` and `data`.
export type { CommandDef, FieldType, FieldSpec, ActionSpec, CapabilitySchema, ReadmeSpec } from "@intisy-ai/core";
/** Options to {@link defineProviderPlugin}. */
export interface ProviderPluginOpts {
  /** The readme registration name. */
  name: string;
  /** The provider's definition. */
  driver: ProviderDef;
  /** The provider's own `maybeRunCli()`, for actions like `accounts`. */
  cliGuard?: () => boolean | Promise<boolean>;
  /** The provider's readme spec, registered before the plugin activates. */
  readme?: ReadmeSpec;
  /** Defaults to `process.exit`; overridable for tests. */
  exit?: (code: number) => void;
}

/**
 * Runs the provider prologue every core-auth provider needs before it can serve as an app plugin.
 *
 * @remarks Slash-command / config invocations shell back in as `node <bundle> <action>`; both the readme and cliGuard checks must exit before the provider registers, so a CLI invocation never boots the provider.
 * @returns `undefined` when a CLI guard exited instead of the plugin
 */
export async function defineProviderPlugin(opts: ProviderPluginOpts): Promise<ProviderPlugin | undefined> {
  const exit = opts.exit ?? ((code: number) => process.exit(code));

  if (opts.readme) {
    defineReadme(opts.readme);
    if (maybeRunReadmeCli(opts.name)) {
      exit(0);
      return undefined;
    }
  }

  if (opts.cliGuard && await opts.cliGuard()) {
    exit(0);
    return undefined;
  }

  return createProviderPlugin(opts.driver);
}
