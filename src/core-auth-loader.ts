// Eager-load accessor for the TeaVM-generated ESM staged into src/generated/ by `npm run
// build:teavm`. initCoreAuth() awaits the dynamic import exactly once at startup; getCoreAuth()
// then reads the already-resolved module synchronously, so account-rotation callers can stay
// sync instead of threading async through every caller.

let coreAuthModule: typeof import("./generated/core-auth.teavm.js") | null = null;
let coreAuthModulePromise: Promise<typeof import("./generated/core-auth.teavm.js")> | null = null;

export async function initCoreAuth(): Promise<void> {
  if (coreAuthModule) return;
  if (!coreAuthModulePromise) {
    coreAuthModulePromise = import("./generated/core-auth.teavm.js");
  }
  coreAuthModule = await coreAuthModulePromise;
}

export function getCoreAuth(): typeof import("./generated/core-auth.teavm.js") {
  if (!coreAuthModule) {
    throw new Error("core-auth TeaVM not initialized; call initCoreAuth() at startup");
  }
  return coreAuthModule;
}
