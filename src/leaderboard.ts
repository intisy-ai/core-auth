// @ts-nocheck
// Optional external quality ranking for the Auto "leaderboard" source.
// Uses Artificial Analysis (https://artificialanalysis.ai) — requires the user's
// OWN api key (cfg.leaderboard.apiKey or ARTIFICIAL_ANALYSIS_API_KEY). NEVER
// hardcode a key: this library ships publicly. With no key / on any failure it
// falls back to a built-in quality heuristic (heuristicOrder, below).

import { readConfig } from "./config.js";
import { log } from "./log.js";

function apiKey(): string {
  const fromEnv = (process.env.ARTIFICIAL_ANALYSIS_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  const cfg = readConfig().leaderboard || {};
  return String(cfg.apiKey || "").trim();
}

export function hasLeaderboardKey(): boolean {
  return !!apiKey();
}

// normalize a model id/name for fuzzy matching: lowercase, drop tier/variant
// suffixes and any non-alphanumerics so "claude-opus-4-6-thinking" ~ "Claude 4.6 Opus".
function normalize(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/-(minimal|low|medium|high|thinking|agent|extra-low|preview|customtools)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// pull [{name, score}] from the AA response, tolerating a few field-name shapes.
function extractScores(payload: any): Array<{ name: string; score: number }> {
  const rows = Array.isArray(payload) ? payload : payload && (payload.data || payload.models || payload.results);
  if (!Array.isArray(rows)) return [];
  const out: Array<{ name: string; score: number }> = [];
  for (const r of rows) {
    if (!r) continue;
    const name = r.name || r.model_name || r.slug || r.id || r.model;
    const score =
      r.intelligenceIndex ?? r.intelligence_index ?? r.intelligence ??
      (r.evaluations && (r.evaluations.artificial_analysis_intelligence_index ?? r.evaluations.intelligence_index)) ??
      r.quality ?? r.elo ?? r.score;
    if (name && typeof score === "number") out.push({ name: String(name), score });
  }
  return out;
}

// Built-in quality heuristic used when no API key is set (or the fetch fails) so
// "Leaderboard" still yields a sensible quality order out of the box. Higher =
// better; matched by substring on the raw model id.
const QUALITY_HINTS: Array<[RegExp, number]> = [
  [/opus/i, 100],
  [/gemini-3\.1-pro|gemini-3-pro|pro-agent/i, 92],
  [/sonnet/i, 85],
  [/gpt|oss/i, 75],
  [/gemini-3\.5-flash|gemini-3-flash/i, 58],
  [/flash-lite|flash-extra-low/i, 45],
  [/flash/i, 55],
];
function heuristicScore(id: string): number {
  for (const [re, score] of QUALITY_HINTS) if (re.test(id)) return score;
  return 50;
}
function heuristicOrder(candidateIds: string[]): string[] {
  return candidateIds
    .map((id, i) => ({ id, i, score: heuristicScore(id) }))
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .map((s) => s.id);
}

/**
 * Returns `candidateIds` sorted best-first by quality: live Artificial Analysis
 * scores when a key is set, otherwise the built-in heuristic. Never null so
 * "Leaderboard" always produces a visible quality ordering.
 */
export async function computeLeaderboardOrder(candidateIds: string[]): Promise<string[]> {
  const key = apiKey();
  if (!key) return heuristicOrder(candidateIds);
  let scores: Array<{ name: string; score: number }> = [];
  try {
    const response = await fetch("https://artificialanalysis.ai/api/v2/data/llms/models", {
      headers: { "x-api-key": key, Accept: "application/json" },
    });
    if (!response.ok) { log("leaderboard fetch " + response.status); return heuristicOrder(candidateIds); }
    scores = extractScores(await response.json());
  } catch (error) {
    log("leaderboard fetch failed: " + error);
    return heuristicOrder(candidateIds);
  }
  if (!scores.length) return heuristicOrder(candidateIds);

  const normScores = scores.map((s) => ({ norm: normalize(s.name), score: s.score }));
  const scoreFor = (id: string): number => {
    const n = normalize(id);
    let best = -1;
    for (const s of normScores) {
      if (s.norm === n || s.norm.includes(n) || n.includes(s.norm)) best = Math.max(best, s.score);
    }
    return best;
  };

  // blend: use the AA score where matched, else the heuristic, so every model is ranked
  const scored = candidateIds.map((id, i) => {
    const aa = scoreFor(id);
    return { id, i, score: aa >= 0 ? aa : heuristicScore(id) };
  });
  return scored.sort((a, b) => (b.score - a.score) || (a.i - b.i)).map((s) => s.id);
}
