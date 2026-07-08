// @ts-nocheck
// Open a URL in the user's default browser. Silent no-op when none is available
// (headless / container): the async "error" event from a missing opener is
// swallowed so callers can rely on the in-tab paste fallback instead.

import { spawn } from "node:child_process";

export function openBrowser(url) {
  if (!url) return;
  try {
    const platform = process.platform;
    let command, args;
    if (platform === "win32") {
      // NOT `cmd /c start` — cmd treats & as a command separator and %xx as env-var
      // expansion, so an OAuth URL (full of & and %) gets truncated and the browser
      // opens a DIFFERENT url. Pass the whole `Start-Process '<url>'` command to
      // PowerShell as a base64 -EncodedCommand (UTF-16LE): this bypasses ALL argv/shell
      // quoting, so the exact url — & and %xx intact — reaches the default browser.
      const psCmd = "Start-Process '" + String(url).replace(/'/g, "''") + "'";
      command = "powershell";
      args = ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(psCmd, "utf16le").toString("base64")];
    } else {
      command = platform === "darwin" ? "open" : "xdg-open";
      args = [url];
    }
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {}
}
