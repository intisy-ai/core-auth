// @ts-nocheck
// Raw-stdin arrow-key menu (no external deps). Items support headings,
// separators, hints, colors. Returns the chosen value, or null on Esc/Ctrl-C.
import { ANSI, parseKey, isTTY, truncateAnsi } from "./ansi.js";

function colorCode(color) {
  if (color === "red") return ANSI.red;
  if (color === "green") return ANSI.green;
  if (color === "yellow") return ANSI.yellow;
  if (color === "cyan") return ANSI.cyan;
  return "";
}

export async function select(items, options) {
  if (!isTTY()) throw new Error("Interactive select requires a TTY terminal");

  const isSelectable = (i) => i && !i.disabled && !i.separator && i.kind !== "heading";
  const enabled = items.filter(isSelectable);
  if (enabled.length === 0) throw new Error("All items disabled");
  if (enabled.length === 1) return enabled[0].value;

  const { stdin, stdout } = process;
  let cursor = items.findIndex(isSelectable);
  if (cursor === -1) cursor = 0;
  let renderedLines = 0;

  const render = () => {
    const columns = stdout.columns ?? 80;
    const rows = stdout.rows ?? 24;
    const shouldClear = options.clearScreen === true;
    if (shouldClear) stdout.write(ANSI.clearScreen + ANSI.moveTo(1, 1));
    else if (renderedLines > 0) stdout.write(ANSI.up(renderedLines));

    let written = 0;
    const writeLine = (line) => { stdout.write(`${ANSI.clearLine}${line}\n`); written += 1; };

    const subtitleLines = options.subtitle ? 3 : 0;
    const fixed = 1 + subtitleLines + 2;
    const maxVisible = Math.max(1, Math.min(items.length, rows - fixed - 1));
    let start = 0, end = items.length;
    if (items.length > maxVisible) {
      start = Math.max(0, Math.min(cursor - Math.floor(maxVisible / 2), items.length - maxVisible));
      end = start + maxVisible;
    }

    writeLine(`${ANSI.dim}┌  ${ANSI.reset}${truncateAnsi(options.message, Math.max(1, columns - 4))}`);
    if (options.subtitle) {
      writeLine(`${ANSI.dim}│${ANSI.reset}`);
      writeLine(`${ANSI.cyan}◆${ANSI.reset}  ${truncateAnsi(options.subtitle, Math.max(1, columns - 4))}`);
      writeLine("");
    }

    for (let i = start; i < end; i++) {
      const item = items[i];
      if (!item) continue;
      if (item.separator) { writeLine(`${ANSI.dim}│${ANSI.reset}`); continue; }
      if (item.kind === "heading") {
        writeLine(`${ANSI.cyan}│${ANSI.reset}  ${truncateAnsi(`${ANSI.bold}${item.label}${ANSI.reset}`, Math.max(1, columns - 6))}`);
        continue;
      }
      const selected = i === cursor;
      const cc = colorCode(item.color);
      let text = selected
        ? (cc ? `${cc}${item.label}${ANSI.reset}` : item.label)
        : `${ANSI.dim}${cc}${item.label}${ANSI.reset}`;
      if (item.hint) text += ` ${ANSI.dim}${item.hint}${ANSI.reset}`;
      text = truncateAnsi(text, Math.max(1, columns - 8));
      const marker = selected ? `${ANSI.green}●${ANSI.reset}` : `${ANSI.dim}○${ANSI.reset}`;
      writeLine(`${ANSI.cyan}│${ANSI.reset}  ${marker} ${text}`);
    }

    const windowHint = items.length > (end - start) ? ` (${start + 1}-${end}/${items.length})` : "";
    writeLine(`${ANSI.cyan}│${ANSI.reset}  ${ANSI.dim}${options.help ?? `↑↓ select | Enter confirm | Esc back${windowHint}`}${ANSI.reset}`);
    writeLine(`${ANSI.cyan}└${ANSI.reset}`);
    renderedLines = written;
  };

  return new Promise((resolve) => {
    const wasRaw = stdin.isRaw ?? false;
    const cleanup = () => {
      try {
        stdin.removeListener("data", onKey);
        stdin.setRawMode(wasRaw);
        stdin.pause();
        stdout.write(ANSI.show);
      } catch {}
      process.removeListener("SIGINT", onSignal);
    };
    const onSignal = () => { cleanup(); resolve(null); };
    const nextSelectable = (from, dir) => {
      let next = from;
      do { next = (next + dir + items.length) % items.length; }
      while (!isSelectable(items[next]) && next !== from);
      return next;
    };
    const onKey = (data) => {
      const action = parseKey(data);
      if (action === "up") { cursor = nextSelectable(cursor, -1); render(); }
      else if (action === "down") { cursor = nextSelectable(cursor, 1); render(); }
      else if (action === "enter") { cleanup(); resolve(items[cursor]?.value ?? null); }
      else if (action === "escape") { cleanup(); resolve(null); }
    };
    process.once("SIGINT", onSignal);
    try { stdin.setRawMode(true); } catch { resolve(null); return; }
    stdin.resume();
    stdout.write(ANSI.hide);
    render();
    stdin.on("data", onKey);
  });
}
