// select()-based renderer for the menu model (menu-model.ts). Drives any menu and
// its pushed submenus via a builder stack, rebuilding each loop so state changes
// show. STANDALONE renderer (oc auth login); the loader has its own renderer for
// the same model. An item's run() may also return { input: {...} } to collect a
// line of text (paste a login code, a proxy URL), handled here via prompt().

import { createInterface } from "node:readline/promises";
import { select, type SelectItemColor, type SelectItemKind } from "./select.js";
import { prompt } from "./prompt.js";
import { isTTY } from "./ansi.js";

/**
 * Navigation an item's `run()` (or an input's `complete()`) returns, interpreted by this
 * renderer's own apply loop.
 *
 * @remarks
 * `refresh` and `flash` are read by the loader's own (native-tab) renderer for this same model,
 * not by this standalone one, which always redraws and never shows a flash.
 */
export interface MenuNavAction {
  push?: MenuBuilder;
  pop?: true | number;
  close?: boolean;
  refresh?: boolean;
  flash?: string;
  input?: MenuInput;
}

/** A line of text this renderer collects before continuing, e.g. a pasted login code or a proxy URL. */
export interface MenuInput {
  title?: string;
  message?: string;
  pendingLabel?: string;
  /** Primary path: resolves when a loopback listener auto-captures the input (e.g. an OAuth redirect); the pasted-text path is the fallback. */
  background?: Promise<MenuNavAction | null>;
  onClose?: () => void;
  complete: (value: string) => MenuNavAction | void | Promise<MenuNavAction | void>;
}

/** One row of a menu screen, as this renderer draws it. */
export interface MenuItem {
  label: string;
  hint?: string;
  color?: SelectItemColor;
  kind?: SelectItemKind;
  separator?: boolean;
  fraction?: number;
  reset?: string;
  run?: () => MenuNavAction | void | Promise<MenuNavAction | void>;
}

/** One screen this renderer draws. */
export interface MenuModel {
  title: string;
  subtitle?: string;
  items: MenuItem[];
  onOpen?: () => Promise<void>;
}

/** Lazily builds a `MenuModel`; called fresh on every redraw so state changes show. */
export type MenuBuilder = () => MenuModel;

interface MenuInputResult {
  paste?: string | null;
  bg?: MenuNavAction | null;
}

/**
 * Drives a menu and its pushed submenus via a builder stack, redrawing on every loop so state
 * changes show. The `select()`-based standalone renderer; the loader has its own renderer for
 * the same model.
 *
 * @remarks A no-op when stdout is not a TTY, since this renderer needs an interactive terminal.
 */
export async function runMenu(rootBuilder: MenuBuilder): Promise<void> {
  if (!isTTY()) return;
  const stack: MenuBuilder[] = [rootBuilder];
  const apply = (a: MenuNavAction | void): void => {
    if (!a) return;                          // stay -> rebuild
    if (a.push) stack.push(a.push);          // push provides a builder fn
    else if (a.pop) { const n = a.pop === true ? 1 : Math.max(1, a.pop | 0); for (let i = 0; i < n && stack.length; i++) stack.pop(); }
    else if (a.close) stack.length = 0;
  };
  let opened = false;
  while (stack.length) {
    const menu = stack[stack.length - 1]();
    // once per session: let the menu fetch live data (e.g. quota) before first draw
    if (!opened) { opened = true; if (typeof menu.onOpen === "function") { try { await menu.onOpen(); } catch {} } }
    const items = menu.items.map((it, i) => ({
      label: it.label, hint: it.hint, color: it.color, kind: it.kind, separator: it.separator,
      fraction: it.fraction, reset: it.reset, value: i,
    }));
    const choice = await select(items, { message: menu.title, subtitle: menu.subtitle, clearScreen: true });
    if (choice === null || choice === undefined) { stack.pop(); continue; }   // Esc = back / exit
    const item = menu.items[choice];
    if (!item || typeof item.run !== "function") continue;                    // heading/separator
    let action: MenuNavAction | void;
    try { action = await item.run(); } catch (e) { process.stderr.write(String(e) + "\n"); continue; }
    if (action && action.input) {
      const inp = action.input;
      if (inp.message) process.stdout.write("\n" + inp.message + "\n");
      let result: MenuInputResult;
      if (inp.background) {
        // race a manual paste against the loopback auto-capture; close the readline
        // as soon as either settles so a loopback win doesn't leave it dangling
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const pasteP: Promise<MenuInputResult> = rl.question((inp.title || "Input") + ": ").then((t) => ({ paste: (t || "").trim() })).catch(() => ({ paste: null }));
        const bgP: Promise<MenuInputResult> = inp.background.then((account) => ({ bg: account }));
        result = await Promise.race([pasteP, bgP]);
        try { rl.close(); } catch {}
      } else {
        result = { paste: await prompt((inp.title || "Input") + ":") };
      }
      if (inp.onClose) { try { inp.onClose(); } catch {} }
      try {
        if (result.bg) apply(result.bg);
        else if (result.paste != null && String(result.paste).trim() !== "") {
          if (inp.pendingLabel) process.stdout.write("\n" + inp.pendingLabel + "\n");
          apply(await inp.complete(String(result.paste).trim()));
        }
      } catch (e) { process.stderr.write(String(e) + "\n"); }
      continue;
    }
    apply(action);
  }
}
