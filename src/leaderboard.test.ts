import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { computeLeaderboardOrder, computeLeaderboardScores, leaderboardSourceShort } from "./leaderboard.js";

// A cache written inside the 24h TTL is what keeps these tests off the network: getScores() returns
// it without ever reaching for OpenRouter or Artificial Analysis.
function primeCache(home: string, scores: { norm: string; score: number }[]): void {
  mkdirSync(join(home, "config"), { recursive: true });
  writeFileSync(
    join(home, "config", "leaderboard.json"),
    JSON.stringify({ fetchedAt: Date.now(), source: "Artificial Analysis", scores }),
    "utf8",
  );
}

describe("leaderboard ranking", () => {
  let home = "";
  let previousHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "leaderboard-"));
    previousHome = process.env.HUB_CONFIG_DIR;
    process.env.HUB_CONFIG_DIR = home;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HUB_CONFIG_DIR;
    else process.env.HUB_CONFIG_DIR = previousHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("orders a catalog best-first by live score", async () => {
    primeCache(home, [
      { norm: "claudeopus", score: 60 },
      { norm: "geminiflash", score: 80 },
      { norm: "gptturbo", score: 40 },
    ]);
    const names: Record<string, string> = { a: "Claude Opus", b: "Gemini Flash", c: "GPT Turbo" };

    expect(await computeLeaderboardOrder(["a", "b", "c"], (id) => names[id])).toEqual(["b", "a", "c"]);
  });

  it("puts every scored model ahead of every unscored one", async () => {
    primeCache(home, [{ norm: "geminiflash", score: 10 }]);
    const names: Record<string, string> = { known: "Gemini Flash", other: "Totally Unknown Model" };

    expect(await computeLeaderboardOrder(["other", "known"], (id) => names[id])).toEqual(["known", "other"]);
  });

  // Variants of one model separated in the catalog by a different model still come out grouped,
  // which the effort-versus-catalog-order tie-break cannot express on its own.
  it("groups variants of one model even when the catalog interleaves another", async () => {
    primeCache(home, []);
    const names: Record<string, string> = {
      "x-low": "Gemini Flash (Low)",
      y: "GPT Turbo",
      "x-thinking": "Gemini Flash (Thinking)",
    };

    expect(await computeLeaderboardOrder(["x-low", "y", "x-thinking"], (id) => names[id]))
      .toEqual(["x-thinking", "x-low", "y"]);
  });

  it("ranks variants of one model by effort", async () => {
    primeCache(home, [{ norm: "geminiflash", score: 50 }]);
    const names: Record<string, string> = {
      low: "Gemini Flash (Low)",
      thinking: "Gemini Flash (Thinking)",
      high: "Gemini Flash (High)",
    };

    expect(await computeLeaderboardOrder(["low", "thinking", "high"], (id) => names[id]))
      .toEqual(["thinking", "high", "low"]);
  });

  it("preserves the catalog order when there is no live data", async () => {
    primeCache(home, []);
    expect(await computeLeaderboardOrder(["first", "second", "third"], (id) => id))
      .toEqual(["first", "second", "third"]);
  });

  it("reports a score only for the ids that matched one", async () => {
    primeCache(home, [{ norm: "geminiflash", score: 50 }]);
    const names: Record<string, string> = { known: "Gemini Flash", other: "Totally Unknown Model" };

    expect(await computeLeaderboardScores(["known", "other"], (id) => names[id])).toEqual({ known: 50 });
  });

  // The score source lists a different version of the same family, which the digit-stripped
  // fallback still matches.
  it("ranks a catalog entry by its family when only another version is published", async () => {
    primeCache(home, [{ norm: "claude48opus", score: 70 }]);

    expect(await computeLeaderboardScores(["a"], () => "Claude 4.6 Opus")).toEqual({ a: 70 });
  });

  it("tags live data and nothing else", () => {
    expect(leaderboardSourceShort("Artificial Analysis via OpenRouter")).toBe("AA");
    expect(leaderboardSourceShort("")).toBe("");
  });
});
