// Generic local HTTP listener for an OAuth redirect; the driver passes its own redirect URI (port + callback path).

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";

/** Options to {@link startOAuthListener}. */
export interface StartOAuthListenerOptions {
  /** How long to wait for the callback before rejecting; 5 minutes by default. */
  timeoutMs?: number;
}

/** A running local OAuth-redirect listener. */
export interface OAuthListener {
  /** Resolves with the redirect's full URL once the callback lands. */
  waitForCallback: () => Promise<URL>;
  /** Stops the listener; rejects the pending {@link waitForCallback} promise if it never landed. */
  close: () => Promise<void>;
}

// OrbStack host networking only forwards 127.0.0.1-bound ports to the host
function isOrbStackDockerHost() {
  if (!existsSync("/.dockerenv")) return false;
  try {
    if (existsSync("/proc/version") && readFileSync("/proc/version", "utf8").toLowerCase().includes("orbstack")) return true;
    const hostname = process.env.HOSTNAME || "";
    if (hostname.startsWith("orbstack-") || hostname.endsWith(".orb") || hostname === "orbstack") return true;
    if (existsSync("/etc/resolv.conf")) {
      const resolv = readFileSync("/etc/resolv.conf", "utf8");
      if (resolv.includes("orb.local") || resolv.includes("orbstack")) return true;
    }
    if (process.platform === "linux" && existsSync("/run/host-services")) return true;
  } catch {}
  return false;
}

function isWSL() {
  if (process.platform !== "linux") return false;
  try {
    const release = readFileSync("/proc/version", "utf8").toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch { return false; }
}

function isRemoteEnvironment() {
  return !!(process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION ||
    process.env.REMOTE_CONTAINERS || process.env.CODESPACES);
}

function getBindAddress() {
  if (process.env.HUB_OAUTH_BIND) return process.env.HUB_OAUTH_BIND;
  if (isOrbStackDockerHost()) return "127.0.0.1";
  if (isWSL() || isRemoteEnvironment()) return "0.0.0.0";
  return "127.0.0.1";
}

function successPage() {
  return "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"/>" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Authentication Successful</title>" +
    "<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#0b0f17;color:#f9fafb}" +
    ".card{background:#1f2937;border:1px solid #374151;border-radius:16px;padding:3rem 2rem;max-width:400px;text-align:center}" +
    ".dot{width:64px;height:64px;background:rgba(52,211,153,.12);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1.5rem;color:#34d399;font-size:32px}" +
    "h1{font-size:1.5rem;margin:0 0 .5rem}p{color:#9ca3af;margin:0}</style></head>" +
    "<body><div class=\"card\"><div class=\"dot\">&#10003;</div><h1>All set!</h1>" +
    "<p>Authentication succeeded. You can close this tab and return to your terminal.</p></div></body></html>";
}

/**
 * Starts a local HTTP listener for an OAuth redirect callback, on the port and path the driver's
 * own redirect URI names.
 *
 * @throws if the port is already in use, or the callback does not arrive within `timeoutMs`
 */
export async function startOAuthListener(redirectUriString: string, opts?: StartOAuthListenerOptions): Promise<OAuthListener> {
  const options = opts || {};
  const timeoutMs = options.timeoutMs || 5 * 60 * 1000;
  const redirectUri = new URL(redirectUriString);
  const callbackPath = redirectUri.pathname || "/";
  const port = redirectUri.port ? parseInt(redirectUri.port, 10) : (redirectUri.protocol === "https:" ? 443 : 80);
  const origin = redirectUri.protocol + "//" + redirectUri.host;

  let settled = false;
  let resolveCallback: (url: URL) => void = () => {};
  let rejectCallback: (error: Error) => void = () => {};
  const callbackPromise = new Promise<URL>((resolve, reject) => {
    resolveCallback = (url) => { if (settled) return; settled = true; if (timeoutHandle) clearTimeout(timeoutHandle); resolve(url); };
    rejectCallback = (error) => { if (settled) return; settled = true; if (timeoutHandle) clearTimeout(timeoutHandle); reject(error); };
  });

  const timeoutHandle = setTimeout(() => rejectCallback(new Error("Timed out waiting for OAuth callback")), timeoutMs);
  if (timeoutHandle.unref) timeoutHandle.unref();

  const server = createServer((request, response) => {
    if (!request.url) { response.writeHead(400, { "Content-Type": "text/plain" }); response.end("Invalid request"); return; }
    const url = new URL(request.url, origin);
    if (url.pathname !== callbackPath) { response.writeHead(404, { "Content-Type": "text/plain" }); response.end("Not found"); return; }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(successPage());
    resolveCallback(url);
    setImmediate(() => server.close());
  });

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: NodeJS.ErrnoException) => {
      server.off("error", handleError);
      if (error && error.code === "EADDRINUSE") { reject(new Error("Port " + port + " is already in use.")); return; }
      reject(error);
    };
    server.once("error", handleError);
    server.listen(port, getBindAddress(), () => { server.off("error", handleError); resolve(); });
  });

  server.on("error", (error) => rejectCallback(error instanceof Error ? error : new Error(String(error))));

  return {
    waitForCallback: () => callbackPromise,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error?: NodeJS.ErrnoException) => {
        if (error && error.code !== "ERR_SERVER_NOT_RUNNING") { reject(error); return; }
        if (!settled) rejectCallback(new Error("OAuth listener closed before callback"));
        resolve();
      });
    }),
  };
}
