// @ts-nocheck
// The provider contract: a plugin supplies one of these and core-auth does all the app/loader integration.

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
  opencodeNpm?: string;               // SDK package for a custom (non-built-in) opencode provider
  models: Record<string, ProviderModel>;
  handle: (request: Request, ctx: ProviderCtx) => Promise<Response>;
  // when present, core exposes an opencode oauth "code" method; complete(input?)
  // persists the CoreAccount. input is opencode's pasted code / redirect URL;
  // when omitted (CLI path) the driver falls back to its own listener / readline.
  loginFlow?: (ctx: ProviderCtx) => Promise<{ url: string; instructions?: string; complete: (input?: string) => Promise<CoreAccount | null> }>;
  accounts?: AccountController;
  proxies?: boolean;   // opt into the shared proxy subsystem (Manage-proxies menu + per-account selection)
}

export interface CoreAccount {
  id: string;                         // stable identity (usually the account email)
  email?: string;
  refresh: string;                    // OAuth refresh token (the durable credential)
  access?: string;
  expires?: number;                   // epoch ms
  addedAt?: number;
  lastUsed?: number;
  enabled?: boolean;                  // user-disabled accounts are skipped by selection
  rateLimitResetTimes?: Record<string, number>;  // lane -> epoch ms the lane is rate-limited until
  coolingDownUntil?: number;          // epoch ms; transient backoff across all lanes
  cooldownReason?: string | null;     // transient (raw error text), never shown in UI rows
  disabledReason?: string | null;     // why the SYSTEM disabled the account (actionable, shown in UI)
  meta?: Record<string, unknown>;     // provider extras, opaque to the harness
}

export interface AccountPool {
  accounts: CoreAccount[];
  activeIndex: number;                // sticky selection when no lane is given
  activeIndexByLane?: Record<string, number>;
}

export type AccountStatus = "active" | "rate-limited" | "cooling-down" | "verification-required" | "disabled";

export interface AccountQuota {
  label?: string;                     // lane / model / family this quota is for
  usedFraction?: number;              // 0..1
  remainingFraction?: number;         // 0..1
  resetTime?: string | number;
}

// Presentation-only view rendered by the shared core TUI.
export interface AccountView {
  id: string;
  email?: string;
  status: AccountStatus;
  enabled: boolean;
  lastUsed?: number;
  detail?: string;                    // human-readable status note ("rate-limited 12m")
  quota?: AccountQuota[];
}

// Implemented by the provider; consumed by the shared core TUI.
export interface MenuAction {
  label: string;
  color?: string;
  run: () => void | Promise<void>;
}

export interface AccountController {
  list(): AccountView[];
  enable(id: string, on: boolean): void;
  remove(id: string): void;
  login(): Promise<AccountView | null>;
  refreshQuota?(): Promise<void>;
  actions?(): MenuAction[];                       // extra top-level menu items
  accountActions?(view: AccountView): MenuAction[];   // extra per-account menu items
}
