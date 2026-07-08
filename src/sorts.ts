// @ts-nocheck
// Generic "Auto" sort framework. Every provider gets "manual" for free (the user's
// hand-ordered list, handled in config.ts; always on) and may OPT INTO more via
// def.sorts (none required):
//   - "leaderboard" : built-in, core computes a quality order (leaderboard.ts)
//   - { id, label, compute(ids) } : a custom sort the provider defines
// (The old automatic "recommended" = the provider's natural order was removed — it was
// often inaccurate; "leaderboard" is the quality source now.)
// computeSorts returns the available non-manual sources + their precomputed orders,
// which get cached so editors (loader tab, oc auth menu) stay generic.

import { computeLeaderboardOrder, computeLeaderboardScores } from "./leaderboard.js";
import { log } from "./log.js";

const BUILTIN_LABEL = { leaderboard: "Leaderboard (quality)" };

// nameOf maps a catalog id -> its display name; the leaderboard ranks by NAME (the id
// is an opaque API rawId). Defaults to identity when names aren't available.
export async function computeSorts(def, ranking, nameOf = (id) => id) {
  const ids = Array.isArray(ranking) ? ranking : [];
  const sorts = [];                 // [{ id, label }] — offered sources beyond manual
  const sortOrders = {};            // { id: [modelId] } — precomputed order per source
  let scores = {};                  // { id: number } — live leaderboard quality scores

  for (const entry of (def && def.sorts) || []) {
    try {
      if (entry === "leaderboard" || (entry && entry.id === "leaderboard")) {
        if (!ids.length) continue;
        sorts.push({ id: "leaderboard", label: BUILTIN_LABEL.leaderboard });
        sortOrders.leaderboard = await computeLeaderboardOrder(ids, nameOf);
        scores = await computeLeaderboardScores(ids, nameOf);
      } else if (entry && typeof entry === "object" && entry.id && typeof entry.compute === "function") {
        sorts.push({ id: entry.id, label: entry.label || entry.id });
        const order = await entry.compute(ids);
        sortOrders[entry.id] = Array.isArray(order) && order.length ? order : ids.slice();
      }
    } catch (e) {
      log("sort '" + (entry && entry.id || entry) + "' failed: " + e);
    }
  }

  return { sorts, sortOrders, scores };
}
