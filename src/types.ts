// @ts-nocheck
// The provider contract. A provider plugin supplies one of these and lets
// core-auth do all the OpenCode / Claude Code / loader integration.

export interface ProviderCtx {
  configDir: string;
  log: (message: string) => void;
}

export interface ProviderModel {
  name?: string;
  [key: string]: unknown;
}

export interface ProviderDef {
  id: string;                         // loader/proxy provider name (handler discovery + Providers tab)
  label: string;
  opencodeProvider?: string;          // opencode provider id to attach models to (default "anthropic")
  models: Record<string, ProviderModel>;
  handle: (request: Request, ctx: ProviderCtx) => Promise<Response>;
}
