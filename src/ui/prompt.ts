// @ts-nocheck
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export async function prompt(message) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(message + " ");
    const trimmed = (answer || "").trim();
    return trimmed || null;
  } finally {
    rl.close();
  }
}
