// Single-source replacements for the memoized dynamic-import boilerplate
// (loadOrchestrator/getLoadedOrchestrator) and scattered try/JSON.parse/catch
// sites duplicated across provider plugins.

/** A memoized dynamic import, built by {@link lazyModule}. */
export interface LazyModule<T> {
  /** Runs the import on first call; subsequent calls return the same in-flight or resolved promise. */
  load(): Promise<T>;
  /** Synchronous escape hatch for callback contracts that cannot await; `null` until the first `load()` resolves. */
  getLoaded(): T | null;
}

/**
 * Memoizes a dynamic import so the importer runs exactly once no matter how
 * many times load() is called. getLoaded() is a synchronous escape hatch for
 * callback contracts that can't await; it returns null until the first load()
 * resolves.
 */
export function lazyModule<T>(importer: () => Promise<T>): LazyModule<T> {
  let promise: Promise<T> | null = null;
  let loaded: T | null = null;
  return {
    load(): Promise<T> {
      if (!promise) {
        promise = importer().then((m) => (loaded = m));
      }
      return promise;
    },
    getLoaded(): T | null {
      return loaded;
    },
  };
}

/** JSON.parse that returns fallback instead of throwing on any parse error. */
export function safeJsonParse<T>(text: string, fallback: T): T {
  if (typeof text !== "string" || !text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
