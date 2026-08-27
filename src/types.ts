// The provider contract: a plugin supplies one of these and core-auth does all the app/loader integration.

import type { HandlerCtx, IrEventStream, IrRequest, IrResponse } from "@intisy-ai/core-ir";
import type { SettingsMenuGroup } from "./settings-schema.js";

/** The per-call context a driver's hooks run under. */
export interface ProviderCtx {
  /** The active app's home directory. */
  configDir: string;
  /** Writes to the host's log, tagged for this provider. */
  log: (message: string) => void;
}

/** One model entry in a provider's catalog; app-specific fields ride along under the index signature. */
export interface ProviderModel {
  /** Display name. */
  name?: string;
  [key: string]: unknown;
}

/** The provider contract: a plugin supplies one of these and core-auth does all the app/loader integration. */
export interface ProviderDef {
  /** The loader/proxy provider name, used for handler discovery and the Providers tab. */
  id: string;
  /** Display name. */
  label: string;
  /** App-side provider id to attach models to; defaults to {@link id} when omitted. */
  appProviderId?: string;
  /** SDK package name for a custom (non-built-in) app-side provider. */
  appNpm?: string;
  /** The provider's static model catalog, shown before any account is logged in. */
  models: Record<string, ProviderModel>;
  /**
   * The app-wire entry point, for a host that supplies no translator. A provider that speaks
   * canonical IR implements {@link handleIr} alone and leaves this unset.
   */
  handle?: (request: Request, ctx: ProviderCtx) => Promise<Response>;
  /**
   * The split begin/complete OAuth flow. When present, core exposes an opencode oauth `"code"`
   * method; `complete(input?)` persists the resulting {@link CoreAccount}. `input` is opencode's
   * pasted code or redirect URL; when omitted (the CLI path) the driver falls back to its own
   * listener or readline.
   */
  loginFlow?: (ctx: ProviderCtx) => Promise<{
    /** Where to send the user to sign in. */
    url: string;
    /** Extra guidance shown alongside the URL. */
    instructions?: string;
    /** Completes the flow with a pasted code or redirect URL, returning the saved account. */
    complete: (input?: string) => Promise<CoreAccount | null>;
    /** Resolves when the browser hits the localhost redirect; omitted if the provider has no loopback. */
    loopback?: Promise<CoreAccount | null>;
    /** Releases the listener when the input is dismissed or superseded. */
    cancel?: () => void;
  }>;
  /** The provider's account operations for the shared core TUI; omitted for a provider with no account concept. */
  accounts?: AccountController;
  /** Opts into the shared proxy subsystem: the Manage-proxies menu and per-account proxy selection. */
  proxies?: boolean;
  /** Live model-catalog fetch, used only once the provider has at least one account. */
  fetchModels?: (ctx: ProviderCtx & { hasAccounts: boolean }) => Promise<{
    /** The fetched catalog, replacing {@link models} for display. */
    models: Record<string, ProviderModel>;
    /** Preferred order, top preference first; defaults to catalog order when omitted. */
    ranking?: string[];
    /** The model to select by default, when the provider has one. */
    defaultModelId?: string;
  }>;
  /**
   * Non-manual Auto-sort sources the provider opts into (manual, the user's hand-ordered list, is
   * always available and needs no declaration). `"leaderboard"` (or `{id:"leaderboard"}`) is the
   * built-in quality sort; anything else supplies its own `compute`.
   */
  sorts?: Array<"leaderboard" | {
    /** The sort's id, used as its `source` key in the Auto config. */
    id: string;
    /** Display label; defaults to `id` when omitted. */
    label?: string;
    /** Computes the sort's order for the given catalog ids. */
    compute: (ids: string[]) => Promise<string[]> | string[];
  }>;
  /** Schema-driven settings the provider menu's "Settings" screen renders and edits. */
  settings?: {
    /** The provider's settings, grouped for display. */
    groups: SettingsMenuGroup[];
    /** Reads a field's effective value by key. */
    get(key: string): unknown;
    /** Persists a field's value by key. */
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
  /**
   * Extra app-shaped plugin hooks the provider contributes, such as an `event` handler; the
   * injected app front-door merges these in. Generic passthrough: core-auth does not know what
   * they do.
   */
  appHooks?: (input: unknown) => unknown | Promise<unknown>;
}

/** A stored provider account: its identity, OAuth credentials, and rate-limit/disable state. */
export interface CoreAccount {
  /** Stable identity, usually the account email. */
  id: string;
  /** The account's email, when the provider has one; falls back to a slice of the refresh token when absent. */
  email?: string;
  /** The OAuth refresh token; the durable credential a session is rebuilt from. */
  refresh: string;
  /** The current access token, refreshed as it expires. */
  access?: string;
  /** Access-token expiry, epoch ms. */
  expires?: number;
  /** Epoch ms this account was added. */
  addedAt?: number;
  /** Epoch ms this account was last selected. */
  lastUsed?: number;
  /** `false` means the user disabled this account; selection skips it. */
  enabled?: boolean;
  /** Per-lane rate-limit expiry: lane name to epoch ms the lane is rate-limited until. */
  rateLimitResetTimes?: Record<string, number>;
  /** Epoch ms a transient backoff clears across all lanes. */
  coolingDownUntil?: number;
  /** Raw transient-error text; never shown in the UI, kept only for diagnosis. */
  cooldownReason?: string | null;
  /** Why the SYSTEM disabled the account, set only when {@link enabled} was cleared by the system rather than by the user. */
  disabledReason?: string | null;
  /** Provider-specific extras, opaque to the harness. */
  meta?: Record<string, unknown>;
}

/** A provider's stored accounts, plus which one selection uses when no lane is given. */
export interface AccountPool {
  /** Every stored account for this provider. */
  accounts: CoreAccount[];
  /** Sticky selection index used when no lane is given. */
  activeIndex: number;
  /** Sticky selection index per lane. */
  activeIndexByLane?: Record<string, number>;
}

/** An account's selection eligibility, as surfaced to the shared TUI. */
export type AccountStatus = "active" | "rate-limited" | "cooling-down" | "verification-required" | "disabled";

/** One quota reading for an account; a fraction absent from the response is left `undefined`, not `0`. */
export interface AccountQuota {
  /** The lane, model, or family this quota is for. */
  label?: string;
  /** Fraction of the quota used, `0` to `1`. */
  usedFraction?: number;
  /** Fraction of the quota remaining, `0` to `1`. */
  remainingFraction?: number;
  /** When this pool resets: epoch ms or an ISO string; absent for a rolling window that restarts on next use. */
  resetTime?: string | number;
}

/** Presentation-only account view rendered by the shared core TUI. */
export interface AccountView {
  /** Stable identity, matching {@link CoreAccount.id}. */
  id: string;
  /** The account's email, when the provider has one. */
  email?: string;
  /** Selection eligibility, as shown in the row. */
  status: AccountStatus;
  /** Whether the user has this account enabled. */
  enabled: boolean;
  /** Epoch ms this account was last selected. */
  lastUsed?: number;
  /** Human-readable status note, e.g. `"rate-limited 12m"`. */
  detail?: string;
  /** Per-pool quota readings; absent or empty when the provider reports none. */
  quota?: AccountQuota[];
  /**
   * Epoch ms this account becomes usable again, or `Infinity` when disabled. Optional: a
   * hand-built AccountView from a provider not going through the shared account-controller helper
   * may not compute it.
   */
  availableAt?: number;
}

/** A menu entry a provider or account contributes; implemented by the provider, consumed by the shared core TUI. */
export interface MenuAction {
  /** Row text. */
  label: string;
  /** Foreground color. */
  color?: string;
  /** Runs when chosen. */
  run: () => void | Promise<void>;
}

/** The account operations a provider exposes to the shared core TUI. */
export interface AccountController {
  /** Every account as a presentation view. */
  list(): AccountView[];
  /** Enables or disables an account. */
  enable(id: string, on: boolean): void;
  /** Removes an account by id. */
  remove(id: string): void;
  /** Runs the provider's login flow; `null` if it did not complete. */
  login(): Promise<AccountView | null>;
  /**
   * Refreshes quota for every account.
   *
   * @param force skip any cache/TTL and refetch now (e.g. the menu's own "Refresh quotas" action).
   */
  refreshQuota?(force?: boolean): Promise<void>;
  /** Per-account quota refresh; renders as a core account-detail action. */
  refreshQuotaOne?(id: string): Promise<void>;
  /** Extra top-level menu items. */
  actions?(): MenuAction[];
  /** Extra per-account menu items. */
  accountActions?(view: AccountView): MenuAction[];
}
