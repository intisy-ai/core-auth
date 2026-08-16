// @ts-nocheck
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

let appClient = null;   // set by the provider's app-front-door hooks
let notifier = null;    // injected by a host that owns the core event bus

// Providers call this from their app-front-door hooks with the plugin `client`: a registered
// client with a toast API is what turns a notification into a real toast rather than a queue
// entry. No-op / harmless when never called.
export function setAppClient(client) { appClient = client || null; }

// A host that bundles core wires its event-bus publish here, so notifications flow
// onto the one shared bus instead of the local toast/queue. Unset (the default)
// keeps the standalone toast/queue delivery below.
export function setNotifier(fn) { notifier = typeof fn === "function" ? fn : null; }

// Shared queue for an app whose front door registered no toast-capable client: that app's own
// drain hook reads it. It's TRANSIENT runtime state (appended
// then read-and-cleared), so it lives under cache/, not config/ (config is for
// config files only). Sibling of config/ and logs/ under the app dir.
export function notifyQueuePath(dir) { return join(dir || getConfigDir(), "cache", "auth-notifications.jsonl"); }

// notify(message, level?): level is "info" | "success" | "warning" | "error".
// Never throws: a failed notification must not break the request path.
export function notify(message, level) {
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
    if (appClient && appClient.tui && typeof appClient.tui.showToast === "function") {
      const variant = lvl === "success" || lvl === "warning" || lvl === "error" ? lvl : "info";
      // opencode's SDK expects the payload nested under `body`; a flat {message,variant} silently no-ops.
      Promise.resolve(appClient.tui.showToast({ body: { message, variant } })).catch(() => {});
      return;
    }
    const p = notifyQueuePath();
    try { mkdirSync(dirname(p), { recursive: true }); } catch {}
    appendFileSync(p, JSON.stringify({ message, level: lvl, at: Date.now() }) + "\n", "utf8");
  } catch { /* notifications are best-effort */ }
}
