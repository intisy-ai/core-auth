// @ts-nocheck
// Live quality ranking for the Auto "leaderboard" source. Pulls per-model quality
// scores from a public, KEYLESS source — OpenRouter's model list
// (https://openrouter.ai/api/v1/models), whose `benchmarks.artificial_analysis
// .intelligence_index` aggregates Artificial Analysis' intelligence index for the
// major providers (Anthropic/Google/OpenAI/…). No hardcoded quality table: the data
// updates as OpenRouter refreshes. Results are cached to disk (24h TTL) so we don't
// refetch on every model refresh. An optional ARTIFICIAL_ANALYSIS_API_KEY (or
// cfg.leaderboard.apiKey) is used first when present (direct AA, finest coverage).
// On a cold failure with no cache we return the catalog order unchanged — we never
// fabricate a ranking.

import { readConfig } from "./config.js";
import { getConfigDir } from "./env.js";
import { log } from "./log.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const AA_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cachePath(): string {
  return join(getConfigDir(), "config", "leaderboard.json");
}

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
    // strip effort/variant tokens regardless of separator so "Gemini Flash (High)",
    // "gemini-flash-high" and "gemini flash low" all collapse to the SAME base key —
    // variants of one model then share a score and group together (the old regex only
    // stripped hyphenated "-high", so parenthesized "(High)" variants scattered).
    .replace(/\b(minimal|extra[\s_-]?low|low|medium|high|thinking|agent|preview|customtools|reasoning)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

type Score = { norm: string; score: number };
type ScoreSet = { scores: Score[]; source: string };

// Human-readable provenance of the score data (both routes carry Artificial
// Analysis' intelligence index — the source says HOW we obtained it).
const SOURCE_AA = "Artificial Analysis";
const SOURCE_OPENROUTER = "Artificial Analysis via OpenRouter";

// ---- score sources ----------------------------------------------------------

// OpenRouter's public /models — keyless. Each model may carry
// benchmarks.artificial_analysis.intelligence_index; index by both name and id.
async function fetchOpenRouter(): Promise<Score[]> {
  const response = await fetch(OPENROUTER_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) { log("leaderboard: openrouter " + response.status); return []; }
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : (payload && payload.data) || [];
  const out: Score[] = [];
  for (const r of rows) {
    const score = r && r.benchmarks && r.benchmarks.artificial_analysis
      && r.benchmarks.artificial_analysis.intelligence_index;
    if (typeof score !== "number") continue;
    if (r.name) out.push({ norm: normalize(r.name), score });
    if (r.id) out.push({ norm: normalize(r.id), score });
  }
  return out;
}

// Direct Artificial Analysis — requires the user's own key; broader/fresher coverage.
async function fetchAA(key: string): Promise<Score[]> {
  const response = await fetch(AA_URL, { headers: { "x-api-key": key, Accept: "application/json" } });
  if (!response.ok) { log("leaderboard: AA " + response.status); return []; }
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload && (payload.data || payload.models || payload.results);
  if (!Array.isArray(rows)) return [];
  const out: Score[] = [];
  for (const r of rows) {
    if (!r) continue;
    const name = r.name || r.model_name || r.slug || r.id || r.model;
    const score =
      r.intelligenceIndex ?? r.intelligence_index ?? r.intelligence ??
      (r.evaluations && (r.evaluations.artificial_analysis_intelligence_index ?? r.evaluations.intelligence_index)) ??
      r.quality ?? r.elo ?? r.score;
    if (name && typeof score === "number") out.push({ norm: normalize(String(name)), score });
  }
  return out;
}

// ---- cache ------------------------------------------------------------------

function readCache(): { fetchedAt: number; scores: Score[]; source?: string } | null {
  try {
    const raw = JSON.parse(readFileSync(cachePath(), "utf8"));
    if (raw && Array.isArray(raw.scores) && typeof raw.fetchedAt === "number") return raw;
  } catch { /* none / unreadable */ }
  return null;
}

function writeCache(scores: Score[], source: string): void {
  try {
    const p = cachePath();
    if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ fetchedAt: Date.now(), source, scores }, null, 2), "utf8");
  } catch (e) { log("leaderboard cache write failed: " + e); }
}

// Fresh cache -> use it. Else fetch (AA key first if set, else OpenRouter), cache, return.
// On failure, fall back to any stale cache; finally to empty (caller keeps catalog order).
async function getScores(): Promise<ScoreSet> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return { scores: cached.scores, source: cached.source || "" };
  let scores: Score[] = [];
  let source = "";
  try {
    const key = apiKey();
    if (key) { scores = await fetchAA(key); source = SOURCE_AA; }
    if (!scores.length) { scores = await fetchOpenRouter(); source = SOURCE_OPENROUTER; }
  } catch (e) { log("leaderboard fetch failed: " + e); }
  if (scores.length) { writeCache(scores, source); return { scores, source }; }
  return cached ? { scores: cached.scores, source: cached.source || "" } : { scores: [], source: "" };
}

// Full name of the source backing the current scores ("" when no data yet).
export async function leaderboardSource(): Promise<string> {
  return (await getScores()).source;
}

// Compact tag for row hints ("score 50 · AA"); full name goes in a subtitle.
export function leaderboardSourceShort(source: string): string {
  return source ? "AA" : "";
}

// ---- public order -----------------------------------------------------------

// effort/variant weight (higher ranks higher), read from a model's DISPLAY NAME which
// reliably carries "(Thinking)"/"(High)"/… — the catalog id is an opaque API rawId.
function effortRank(text: string): number {
  const s = String(text).toLowerCase();
  if (/(^|[^a-z])thinking([^a-z]|$)/.test(s)) return 6;
  if (/extra[\s_-]?low/.test(s)) return 1;
  if (/(^|[^a-z])high([^a-z]|$)/.test(s)) return 5;
  if (/(^|[^a-z])medium([^a-z]|$)/.test(s)) return 4;
  if (/(^|[^a-z])low([^a-z]|$)/.test(s)) return 2;
  if (/(^|[^a-z])minimal([^a-z]|$)/.test(s)) return 1;
  return 3;   // normal / no effort marker
}

// base matching key from a display name: drop ALL parenthetical tags — the effort
// "(High)" and the provider label "(Antigravity)" — then normalize. Variants of one
// model collapse to the same key (so they group + share a score).
function baseKeyFromName(text: string): string {
  return normalize(String(text).replace(/\([^)]*\)/g, " "));
}

/**
 * Returns `candidateIds` sorted best-first by live quality score (OpenRouter's
 * intelligence_index, keyless; or AA when a key is set). `nameOf` maps a catalog id to
 * its display name; matching + effort are derived from the NAME (the id is an opaque
 * API rawId that doesn't carry the model name or effort). Variants of one model group
 * together at the base score, ordered by effort among themselves; effort never decides
 * order between different models. With no live data (offline, no cache) the catalog
 * order is preserved (variants still effort-ordered within a base) — never fabricated.
 */
// version-tolerant score lookup for a normalized base key: exact/substring base-key
// match wins; else a digit-stripped FAMILY match so "Claude Opus 4.6" still ranks by
// the live opus family even if OpenRouter only lists Opus 4.8. -1 = no live score.
function scoreForKey(key: string, scores: Score[]): number {
  if (!scores.length) return -1;
  const stripVer = (n: string): string => n.replace(/[0-9]+/g, "");
  let best = -1;
  for (const s of scores) {
    if (s.norm === key || s.norm.includes(key) || key.includes(s.norm)) best = Math.max(best, s.score);
  }
  if (best >= 0) return best;
  const fk = stripVer(key);
  if (fk.length < 4) return -1;
  for (const s of scores) {
    const fs = stripVer(s.norm);
    if (fs && (fs === fk || fs.includes(fk) || fk.includes(fs))) best = Math.max(best, s.score);
  }
  return best;
}

// Per-model live quality scores { id: number } for the given catalog ids (only ids
// with a live score are included). Used to DISPLAY the score next to models; the
// caller persists it in the model cache so both the provider browser and the loader's
// mapping picker can show it without re-fetching.
export async function computeLeaderboardScores(
  candidateIds: string[],
  nameOf: (id: string) => string = (id) => id,
): Promise<Record<string, number>> {
  const { scores } = await getScores();
  const out: Record<string, number> = {};
  for (const id of candidateIds) {
    const s = scoreForKey(baseKeyFromName(nameOf(id)), scores);
    if (s >= 0) out[id] = s;
  }
  return out;
}

export async function computeLeaderboardOrder(
  candidateIds: string[],
  nameOf: (id: string) => string = (id) => id,
): Promise<string[]> {
  const { scores } = await getScores();
  const scoreFor = (key: string): number => scoreForKey(key, scores);

  const scored = candidateIds.map((id, i) => {
    const name = nameOf(id);
    const base = baseKeyFromName(name);
    return { id, i, base, effort: effortRank(name), score: scoreFor(base) };
  });
  // Effort ONLY decides order between variants of the SAME base model — never between
  // different models (those keep score order, then catalog order).
  const tie = (a, b) => (a.base === b.base ? (b.effort - a.effort) : 0) || (a.i - b.i);
  return scored
    .sort((a, b) => {
      if (a.score >= 0 && b.score >= 0) return (b.score - a.score) || tie(a, b);
      if (a.score >= 0) return -1;       // scored before unscored
      if (b.score >= 0) return 1;
      return tie(a, b);                  // both unscored: same-base effort, else catalog
    })
    .map((s) => s.id);
}
