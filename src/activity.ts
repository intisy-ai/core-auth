// Activity emit seam. core-auth builds standalone (it does not import core), so a
// host that owns the event bus injects core's emitEvent here, mirroring setNotifier.
// Unset (default) makes emitActivity a harmless no-op.

type ActivityEmitterFn = (spec: unknown, source: string) => void;

let emitter: ActivityEmitterFn | null = null;
export function setActivityEmitter(fn: unknown): void {
  emitter = typeof fn === "function" ? (fn as ActivityEmitterFn) : null;
}
export function emitActivity(spec: unknown, source = "core-auth"): void {
  if (!emitter) return;
  try { emitter(spec, source); } catch {}
}
