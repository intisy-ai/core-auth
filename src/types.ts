// The provider contract: a plugin supplies one of these and core-auth does all the app/loader integration.

import type { HandlerCtx, IrEventStream, IrRequest, IrResponse } from "@intisy-ai/core-ir";
import type { SettingsMenuGroup } from "./settings-schema.js";

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
  appProviderId?: string;             // app-side provider id to attach models to (defaults to the provider id)
  appNpm?: string;                    // SDK package for a custom (non-built-in) app-side provider
  models: Record<string, ProviderModel>;
  /**
   * The app-wire entry point, for a host that supplies no translator. A provider that speaks
   * canonical IR implements {@link handleIr} alone and leaves this unset.
   */
  handle?: (request: Request, ctx: ProviderCtx) => Promise<Response>;
  // when present, core exposes an opencode oauth "code" method; complete(input?)
  // persists the CoreAccount. input is opencode's pasted code / redirect URL;
  // when omitted (CLI path) the driver falls back to its own listener / readline.
  loginFlow?: (ctx: ProviderCtx) => Promise<{
    url: string;
    instructions?: string;
    complete: (input?: string) => Promise<CoreAccount | null>;
    /** Resolves when the browser hits the localhost redirect; omitted if the provider has no loopback. */
    loopback?: Promise<CoreAccount | null>;
    /** Releases the listener when the input is dismissed or superseded. */
    cancel?: () => void;
  }>;
  accounts?: AccountController;
  proxies?: boolean;   // opt into the shared proxy subsystem (Manage-proxies menu + per-account selection)
  /** Live model-catalog fetch, used only once the provider has at least one account. */
  fetchModels?: (ctx: ProviderCtx & { hasAccounts: boolean }) => Promise<{
    models: Record<string, ProviderModel>;
    ranking?: string[];
    defaultModelId?: string;
  }>;
  /**
   * Non-manual Auto-sort sources the provider opts into (manual, the user's hand-ordered list, is
   * always available and needs no declaration). `"leaderboard"` (or `{id:"leaderboard"}`) is the
   * built-in quality sort; anything else supplies its own `compute`.
   */
  sorts?: Array<"leaderboard" | { id: string; label?: string; compute: (ids: string[]) => Promise<string[]> | string[] }>;
  /** Schema-driven settings the provider menu's "Settings" screen renders and edits. */
  settings?: {
    groups: SettingsMenuGroup[];
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  /** Footnote shown under the provider's Quota screen (e.g. a pool the API doesn't report). */
  quotaNote?: string;
  /** Hides the Quota screen entirely for a provider with no quota API. */
  quotaDisabled?: boolean;
  /**
   * The canonical-IR entry point, which is the one every ecosystem provider implements.
   *
   * @remarks
   * Typed against core-ir's own contract rather than `unknown`: the capability this becomes is
   * declared there, so a driver whose return type does not match it is a compile error here instead
   * of a runtime surprise at the front-door.
   */
  handleIr?: (request: IrRequest, ctx: HandlerCtx) => Promise<IrResponse | IrEventStream>;
  // A provider may contribute extra app-shaped plugin hooks (e.g. an `event` handler);
  // the injected app front-door merges these in. Generic passthrough; core-auth doesn't know what they do.
  appHooks?: (input: unknown) => unknown | Promise<unknown>;
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
  disabledReason?: string | null;     // why the SYSTEM disabled the account, when enabled was set false by the system rather than by the user
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
  /**
   * Epoch ms this account becomes usable again, or `Infinity` when disabled. Optional: a
   * hand-built AccountView from a provider not going through the shared account-controller helper
   * may not compute it.
   */
  availableAt?: number;
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
  /** @param force skip any cache/TTL and refetch now (e.g. the menu's own "Refresh quotas" action). */
  refreshQuota?(force?: boolean): Promise<void>;
  /** Per-account quota refresh; renders as a core account-detail action. */
  refreshQuotaOne?(id: string): Promise<void>;
  actions?(): MenuAction[];                       // extra top-level menu items
  accountActions?(view: AccountView): MenuAction[];   // extra per-account menu items
}
