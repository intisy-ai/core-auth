// Cross-app user notifications for auth providers: a small message the USER sees that never
// enters the model's context.
//
// Delivery follows the CLIENT, not the app: an app whose front door registered a client with a
// toast API gets a real toast, and everything else appends to a queue file that the app's own
// drain hook re-emits in whatever form that app shows a user. An app with no toast API registers
// no client, so it takes the queue path without this module knowing which app it is.

import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { log } from "./log.js";
import { getConfigDir } from "./env.js";

/** Severity of a {@link notify} message, which selects the toast variant when a client is registered. */
export type NotifyLevel = "info" | "success" | "warning" | "error";
type NotifierFn = (message: string, level: NotifyLevel) => void;
type ToastFn = (payload: { body: { message: string; variant: NotifyLevel } }) => unknown;

let appClient: unknown = null;   // set by the provider's app-front-door hooks
let notifier: NotifierFn | null = null;    // injected by a host that owns the core event bus

function toastFn(client: unknown): ToastFn | null {
  const candidate = client as { tui?: { showToast?: unknown } } | null | undefined;
  const fn = candidate?.tui?.showToast;
  return typeof fn === "function" ? (fn as ToastFn) : null;
}

/**
 * Registers the app's plugin `client`, called by a provider from its app-front-door hooks.
 *
 * @remarks A registered client with a toast API is what turns a notification into a real toast rather than a queue entry. Harmless when never called.
 */
export function setAppClient(client: unknown): void { appClient = client || null; }

/**
 * Registers a host's event-bus publish function, so notifications flow onto the one shared bus
 * instead of the local toast/queue.
 *
 * @remarks Unset (the default) keeps the standalone toast/queue delivery.
 */
export function setNotifier(fn: unknown): void { notifier = typeof fn === "function" ? (fn as NotifierFn) : null; }

/**
 * Path to the notification queue an app with no toast-capable client drains, its own drain hook
 * reading and clearing it.
 *
 * @remarks Transient runtime state (appended then read-and-cleared), so it lives under `cache/`, not `config/`; a sibling of `config/` and `logs/` under the app dir.
 */
export function notifyQueuePath(dir?: string): string { return join(dir || getConfigDir(), "cache", "auth-notifications.jsonl"); }

/**
 * Shows the user a small message that never enters the model's context: a real toast when the
 * app registered a toast-capable client, a queued entry the app's drain hook re-emits otherwise.
 *
 * @remarks Never throws: a failed notification must not break the request path.
 */
export function notify(message: string, level?: NotifyLevel): void {
  const lvl = level || "info";
  // Persistent record in the normal log (both apps). The toast/queue below is
  // transient delivery only; the queue is read-and-cleared by the drain hook, so
  // without this a notification would leave no trace after being shown once.
  log("notify[" + lvl + "] " + message);
  if (notifier) {
    try { notifier(message, lvl); } catch {}
    return;
  }
  try {
    const showToast = toastFn(appClient);
    if (showToast) {
      const variant = lvl === "success" || lvl === "warning" || lvl === "error" ? lvl : "info";
      // opencode's SDK expects the payload nested under `body`; a flat {message,variant} silently no-ops.
      Promise.resolve(showToast({ body: { message, variant } })).catch(() => {});
      return;
    }
    const p = notifyQueuePath();
    try { mkdirSync(dirname(p), { recursive: true }); } catch {}
    appendFileSync(p, JSON.stringify({ message, level: lvl, at: Date.now() }) + "\n", "utf8");
  } catch { /* notifications are best-effort */ }
}
