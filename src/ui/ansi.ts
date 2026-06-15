// @ts-nocheck
export const ANSI = {
  hide: "\x1b[?25l",
  show: "\x1b[?25h",
  up: (n = 1) => `\x1b[${n}A`,
  clearLine: "\x1b[2K",
  clearScreen: "\x1b[2J",
  moveTo: (row, col) => `\x1b[${row};${col}H`,
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

export function parseKey(data) {
  const s = data.toString();
  if (s === "\x1b[A" || s === "\x1bOA") return "up";
  if (s === "\x1b[B" || s === "\x1bOB") return "down";
  if (s === "\r" || s === "\n") return "enter";
  if (s === "\x03" || s === "\x1b") return "escape";
  return null;
}

export function isTTY() {
  return Boolean(process.stdin.isTTY);
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function truncateAnsi(s, max) {
  if (stripAnsi(s).length <= max) return s;
  let out = "", visible = 0, i = 0;
  while (i < s.length && visible < max) {
    if (s[i] === "\x1b") {
      const end = s.indexOf("m", i);
      if (end !== -1) { out += s.slice(i, end + 1); i = end + 1; continue; }
    }
    out += s[i]; visible++; i++;
  }
  return out + ANSI.reset;
}
