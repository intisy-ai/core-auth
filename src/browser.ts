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
    const spawnOpts = { detached: true, stdio: "ignore" };
    if (platform === "win32") {
      // `cmd /c start "" "<url>"`: an unquoted url lets cmd treat & as a command separator
      // (and %xx as env expansion), truncating the OAuth url. Passing the whole command
      // verbatim with the url DOUBLE-QUOTED avoids that: inside quotes cmd leaves & and
      // %xx untouched, so the exact url reaches the default browser. (title arg is the
      // empty "" before the url.)
      command = "cmd";
      args = ["/c", 'start "" "' + String(url).replace(/"/g, "") + '"'];
      spawnOpts.windowsVerbatimArguments = true;
    } else {
      command = platform === "darwin" ? "open" : "xdg-open";
      args = [url];
    }
    const child = spawn(command, args, spawnOpts);
    child.on("error", () => {});
    child.unref();
  } catch {}
}
