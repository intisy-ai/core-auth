// Generic "Auto" sort framework. Every provider gets "manual" for free (the user's
// hand-ordered list, handled in config.ts; always on) and may OPT INTO more via
// def.sorts (none required):
//   - "leaderboard" : built-in, core computes a quality order (leaderboard.ts)
//   - { id, label, compute(ids) } : a custom sort the provider defines
// computeSorts returns the available non-manual sources + their precomputed orders,
// which get cached so editors (loader tab, oc auth menu) stay generic.

import { computeLeaderboardOrder, computeLeaderboardScores, leaderboardSource } from "./leaderboard.js";
import { log } from "./log.js";
import type { ProviderDef } from "./types.js";

const BUILTIN_LABEL = { leaderboard: "Leaderboard (quality)" };

/** A provider's non-manual Auto-sort sources, each with its precomputed order, cached so editors stay generic. */
export interface ComputedSorts {
  /** Available sources beyond `"manual"`. */
  sorts: Array<{ id: string; label: string }>;
  /** Precomputed order, per source id. */
  sortOrders: Record<string, string[]>;
  /** Live leaderboard quality scores, keyed by catalog id; empty when the provider does not opt into `"leaderboard"`. */
  scores: Record<string, number>;
  /** Provenance of {@link scores}, e.g. `"Artificial Analysis via OpenRouter"`; `""` when there are none. */
  scoreSource: string;
}

/**
 * Computes every non-manual Auto-sort source a provider opts into, via `def.sorts`.
 *
 * @param nameOf maps a catalog id to its display name; the leaderboard ranks by NAME since the id is an opaque API rawId. Defaults to identity when names aren't available
 */
export async function computeSorts(
  def: ProviderDef,
  ranking: string[],
  nameOf: (id: string) => string = (id) => id,
): Promise<ComputedSorts> {
  const ids = Array.isArray(ranking) ? ranking : [];
  const sorts: Array<{ id: string; label: string }> = [];    // offered sources beyond manual
  const sortOrders: Record<string, string[]> = {};           // precomputed order per source
  let scores: Record<string, number> = {};                   // live leaderboard quality scores
  let scoreSource = "";             // provenance of those scores (e.g. "Artificial Analysis via OpenRouter")

  for (const entry of (def && def.sorts) || []) {
    try {
      if (entry === "leaderboard" || (entry && entry.id === "leaderboard")) {
        if (!ids.length) continue;
        sorts.push({ id: "leaderboard", label: BUILTIN_LABEL.leaderboard });
        sortOrders.leaderboard = await computeLeaderboardOrder(ids, nameOf);
        scores = await computeLeaderboardScores(ids, nameOf);
        scoreSource = await leaderboardSource();
      } else if (entry && typeof entry === "object" && entry.id && typeof entry.compute === "function") {
        sorts.push({ id: entry.id, label: entry.label || entry.id });
        const order = await entry.compute(ids);
        sortOrders[entry.id] = Array.isArray(order) && order.length ? order : ids.slice();
      }
    } catch (e) {
      const entryId = entry && typeof entry === "object" ? entry.id : entry;
      log("sort '" + entryId + "' failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  return { sorts, sortOrders, scores, scoreSource };
}
