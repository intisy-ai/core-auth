// @ts-nocheck
// Cross-app user notifications for auth providers — a small message the USER sees
// that never enters the model's context.
//
//  - opencode: a real toast via the plugin client (client.tui.showToast). The
//    provider's opencodeHooks hand us the client through setOpencodeClient().
//  - Claude Code: the provider runs headless under the CC proxy and Claude has no
//    toast API, so we append to a queue file. A PostToolUse hook (registered by the
//    loader) drains it and re-emits each line as a hook `systemMessage`, which Claude
//    Code shows to the user WITHOUT adding it to the model's context.

import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { log } from "./log.js";

let ocClient = null;   // set by a provider's opencodeHooks

// Providers call this from opencodeHooks with the plugin `client` so opencode
// notifications become real toasts. No-op / harmless when never called.
export function setOpencodeClient(client) { ocClient = client || null; }

function isClaude() { return process.argv.join(" ").includes("claude"); }

function configDir() {
  if (process.env.HUB_CONFIG_DIR) return process.env.HUB_CONFIG_DIR;
  return isClaude() ? join(homedir(), ".claude") : join(homedir(), ".config", "opencode");
}

// Shared queue the Claude drain hook reads (kept next to the other config).
export function notifyQueuePath(dir) { return join(dir || configDir(), "config", "auth-notifications.jsonl"); }

// notify(message, level?) — level: "info" | "success" | "warning" | "error".
// Never throws: a failed notification must not break the request path.
export function notify(message, level) {
  const lvl = level || "info";
  // Persistent record in the normal log (both apps). The toast/queue below is
  // transient delivery only — the queue is read-and-cleared by the drain hook, so
  // without this a notification would leave no trace after being shown once.
  log("notify[" + lvl + "] " + message);
  try {
    if (!isClaude() && ocClient && ocClient.tui && typeof ocClient.tui.showToast === "function") {
      const variant = lvl === "success" || lvl === "warning" || lvl === "error" ? lvl : "info";
      // opencode's SDK expects the payload nested under `body` — a flat {message,variant} silently no-ops.
      Promise.resolve(ocClient.tui.showToast({ body: { message, variant } })).catch(() => {});
      return;
    }
    const p = notifyQueuePath();
    try { mkdirSync(dirname(p), { recursive: true }); } catch {}
    appendFileSync(p, JSON.stringify({ message, level: lvl, at: Date.now() }) + "\n", "utf8");
  } catch { /* notifications are best-effort */ }
}
