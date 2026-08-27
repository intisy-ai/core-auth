// Live quality ranking for the Auto "leaderboard" source. Pulls per-model quality
// scores from a public, keyless source: OpenRouter's model list
// (https://openrouter.ai/api/v1/models), whose `benchmarks.artificial_analysis
// .intelligence_index` aggregates Artificial Analysis' intelligence index for the
// major providers (Anthropic/Google/OpenAI/…). No hardcoded quality table: the data
// updates as OpenRouter refreshes. Results are cached to disk (24h TTL) so we don't
// refetch on every model refresh. An optional ARTIFICIAL_ANALYSIS_API_KEY (or
// cfg.leaderboard.apiKey) is used first when present (direct AA, finest coverage).
// On a cold failure with no cache we return the catalog order unchanged; we never
// fabricate a ranking. The ranking itself is single-sourced in Java (Leaderboard,
// accounts/rank); what stays here is fetching the scores, caching them and choosing
// between the two sources.

import { readConfig } from "./config.js";
import { getConfigDir } from "./env.js";
import { log } from "./log.js";
import { getCoreAuth } from "./core-auth-loader.js";
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

type Score = { norm: string; score: number };
type ScoreSet = { scores: Score[]; source: string };

// Human-readable provenance of the score data (both routes carry Artificial
// Analysis' intelligence index; the source says HOW we obtained it).
const SOURCE_AA = "Artificial Analysis";
const SOURCE_OPENROUTER = "Artificial Analysis via OpenRouter";

// ---- score sources ----------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

// OpenRouter's public /models endpoint, keyless. Each model may carry
// benchmarks.artificial_analysis.intelligence_index; index by both name and id.
async function fetchOpenRouter(): Promise<Score[]> {
  const response = await fetch(OPENROUTER_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) { log("leaderboard: openrouter " + response.status); return []; }
  const payload: unknown = await response.json();
  const body = asRecord(payload);
  const dataField = body ? body.data : undefined;
  const rows: unknown[] = Array.isArray(payload) ? payload : (Array.isArray(dataField) ? dataField : []);
  const out: Score[] = [];
  for (const item of rows) {
    const row = asRecord(item);
    const benchmarks = row ? asRecord(row.benchmarks) : null;
    const aa = benchmarks ? asRecord(benchmarks.artificial_analysis) : null;
    const score = aa ? aa.intelligence_index : undefined;
    if (typeof score !== "number") continue;
    const name = row?.name;
    const id = row?.id;
    if (typeof name === "string" && name) out.push({ norm: getCoreAuth().leaderboardNormalize(name), score });
    if (typeof id === "string" && id) out.push({ norm: getCoreAuth().leaderboardNormalize(id), score });
  }
  return out;
}

// Direct Artificial Analysis: requires the user's own key; broader/fresher coverage.
async function fetchAA(key: string): Promise<Score[]> {
  const response = await fetch(AA_URL, { headers: { "x-api-key": key, Accept: "application/json" } });
  if (!response.ok) { log("leaderboard: AA " + response.status); return []; }
  const payload: unknown = await response.json();
  const body = asRecord(payload);
  const rowsField = body ? (body.data || body.models || body.results) : undefined;
  const rows = Array.isArray(payload) ? payload : rowsField;
  if (!Array.isArray(rows)) return [];
  const out: Score[] = [];
  for (const item of rows) {
    const r = asRecord(item);
    if (!r) continue;
    const name = r.name || r.model_name || r.slug || r.id || r.model;
    const evaluations = asRecord(r.evaluations);
    const scoreRaw =
      r.intelligenceIndex ?? r.intelligence_index ?? r.intelligence ??
      (evaluations ? (evaluations.artificial_analysis_intelligence_index ?? evaluations.intelligence_index) : undefined) ??
      r.quality ?? r.elo ?? r.score;
    const score = typeof scoreRaw === "number" ? scoreRaw : undefined;
    if (name && typeof score === "number") out.push({ norm: getCoreAuth().leaderboardNormalize(String(name)), score });
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

/** Full name of the source backing the current scores; `""` when no data has been fetched yet. */
export async function leaderboardSource(): Promise<string> {
  return (await getScores()).source;
}

/** Compact tag for row hints (e.g. `"score 50 - AA"`); the full name goes in a subtitle. */
export function leaderboardSourceShort(source: string): string {
  return getCoreAuth().leaderboardSourceShort(source);
}

// ---- public order -----------------------------------------------------------

/**
 * Per-model live quality scores (`{ id: number }`) for the given catalog ids; only ids with a
 * live score are included.
 *
 * @remarks
 * Used to DISPLAY the score next to models; the caller persists it in the model cache so both
 * the provider browser and the loader's mapping picker can show it without re-fetching.
 */
export async function computeLeaderboardScores(
  candidateIds: string[],
  nameOf: (id: string) => string = (id) => id,
): Promise<Record<string, number>> {
  return JSON.parse(getCoreAuth().leaderboardScores(await rankingArgs(candidateIds, nameOf)));
}

/**
 * Returns `candidateIds` sorted best-first by live quality score. `nameOf` maps a catalog id to its
 * display name; matching and effort are derived from the NAME, since the id is an opaque vendor
 * rawId carrying neither. Variants of one model group together at the base score and are ordered by
 * effort among themselves; effort never decides order between different models. With no live data
 * the catalog order is preserved, and a ranking is never fabricated.
 */
export async function computeLeaderboardOrder(
  candidateIds: string[],
  nameOf: (id: string) => string = (id) => id,
): Promise<string[]> {
  return JSON.parse(getCoreAuth().leaderboardOrder(await rankingArgs(candidateIds, nameOf)));
}

// The names are resolved here rather than behind the ranking engine because nameOf is a caller
// callback: handing the engine a resolved array keeps the crossing to one call per ranking.
async function rankingArgs(candidateIds: string[], nameOf: (id: string) => string): Promise<string> {
  const { scores } = await getScores();
  return JSON.stringify({ ids: candidateIds, names: candidateIds.map(nameOf), scores });
}
