// @ts-nocheck
// Activity emit seam. core-auth builds standalone (it does not import core), so a
// host that owns the event bus injects core's emitEvent here, mirroring setNotifier.
// Unset (default) makes emitActivity a harmless no-op.

let emitter = null;
export function setActivityEmitter(fn) { emitter = typeof fn === "function" ? fn : null; }
export function emitActivity(spec, source = "core-auth") {
  if (!emitter) return;
  try { emitter(spec, source); } catch {}
}
