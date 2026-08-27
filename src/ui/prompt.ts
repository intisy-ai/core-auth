import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/** Prompts on a single readline and returns the trimmed answer, or `null` if it was blank. */
export async function prompt(message: string): Promise<string | null> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(message + " ");
    const trimmed = (answer || "").trim();
    return trimmed || null;
  } finally {
    rl.close();
  }
}
