// Activity emit seam: a host that owns the event bus injects core's emitEvent here, mirroring
// setNotifier. Unset (default) makes emitActivity a harmless no-op.

type ActivityEmitterFn = (spec: unknown, source: string) => void;

let emitter: ActivityEmitterFn | null = null;

/** Registers the host's event-bus publish function; `emitActivity` is a no-op until this is called. */
export function setActivityEmitter(fn: unknown): void {
  emitter = typeof fn === "function" ? (fn as ActivityEmitterFn) : null;
}

/** Emits an activity event through the injected emitter; a harmless no-op when none is registered. */
export function emitActivity(spec: unknown, source = "core-auth"): void {
  if (!emitter) return;
  try { emitter(spec, source); } catch {}
}
