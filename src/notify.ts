// @ts-nocheck
// Cross-app user notifications for auth providers: a small message the USER sees
// that never enters the model's context.
//
//  - opencode: a real toast via the plugin client (client.tui.showToast). The
//    provider's app-front-door hooks hand us the client through setAppClient().
//  - Claude Code: the provider runs headless under the CC proxy and Claude has no
//    toast API, so we append to a queue file. A PostToolUse hook (registered by the
//    loader) drains it and re-emits each line as a hook `systemMessage`, which Claude
//    Code shows to the user WITHOUT adding it to the model's context.

import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { log } from "./log.js";
import { activeAppId, getConfigDir } from "./env.js";

let appClient = null;   // set by the provider's app-front-door hooks
let notifier = null;    // injected by a host that owns the core event bus

// Providers call this from their app-front-door hooks with the plugin `client` so
// opencode notifications become real toasts. No-op / harmless when never called.
export function setAppClient(client) { appClient = client || null; }

// A host that bundles core wires its event-bus publish here, so notifications flow
// onto the one shared bus instead of the local toast/queue. Unset (the default)
// keeps the standalone toast/queue delivery below.
export function setNotifier(fn) { notifier = typeof fn === "function" ? fn : null; }

function isClaude() { return activeAppId() === "claude"; }

// Shared queue the Claude drain hook reads. It's TRANSIENT runtime state (appended
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
    if (!isClaude() && appClient && appClient.tui && typeof appClient.tui.showToast === "function") {
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
