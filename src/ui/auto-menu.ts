// @ts-nocheck
// TUI for editing the "Auto" meta-model: the ranking SOURCE (manual / recommended
// / leaderboard) plus which models are included and, in manual mode, their order.
// Auto tries the included models top-to-bottom, skipping rate-limited ones.

import { select } from "./select.js";
import { getAutoConfig, setAutoConfig } from "../config.js";
import { readModelCache } from "./../models-cache.js";
import { computeLeaderboardOrder, hasLeaderboardKey } from "./../leaderboard.js";

const SOURCE_LABEL = {
  manual: "Manual (your order)",
  recommended: "Recommended (provider order)",
  leaderboard: "Leaderboard (Artificial Analysis)",
};
const SOURCE_CYCLE = { manual: "recommended", recommended: "leaderboard", leaderboard: "manual" };

function displayName(providerId, rawId) {
  const cache = readModelCache(providerId);
  const entry = cache && cache.models && cache.models["antigravity-" + rawId];
  return (entry && entry.name) || rawId;
}

// Recompute + persist the leaderboard order from the user's API key (no-op
// without a key — the effective order then falls back to recommended).
async function refreshLeaderboard(providerId) {
  const cache = readModelCache(providerId);
  const candidates = (cache && cache.ranking) || [];
  const order = await computeLeaderboardOrder(candidates);
  if (order) setAutoConfig(providerId, { leaderboardOrder: order });
  return order;
}

async function editModel(providerId, rawId, source) {
  const { order, excluded } = getAutoConfig(providerId);
  const included = !excluded.includes(rawId);
  const pos = order.indexOf(rawId);

  const items = [
    { label: "Back", value: { type: "back" } },
    { label: included ? "Exclude from Auto" : "Include in Auto", value: { type: "toggle" }, color: included ? "yellow" : "green" },
  ];
  if (source === "manual") {
    items.push({ label: "Move up", value: { type: "up" } });
    items.push({ label: "Move down", value: { type: "down" } });
  }
  const r = await select(items, {
    message: displayName(providerId, rawId),
    subtitle: source === "manual" ? "" : "Order is automatic in " + source + " mode; switch to Manual to reorder.",
    clearScreen: true,
  });
  if (!r || r.type === "back") return;

  if (r.type === "toggle") {
    const next = included ? [...excluded, rawId] : excluded.filter((id) => id !== rawId);
    setAutoConfig(providerId, { excluded: next });
  } else if (r.type === "up" && pos > 0) {
    const next = order.slice();
    [next[pos - 1], next[pos]] = [next[pos], next[pos - 1]];
    setAutoConfig(providerId, { order: next });
  } else if (r.type === "down" && pos >= 0 && pos < order.length - 1) {
    const next = order.slice();
    [next[pos + 1], next[pos]] = [next[pos], next[pos + 1]];
    setAutoConfig(providerId, { order: next });
  }
}

export async function runAutoMenu(def) {
  const providerId = def.id;
  while (true) {
    const { order, excluded, source } = getAutoConfig(providerId);
    if (!order.length) {
      await select([{ label: "Back", value: { type: "back" } }], {
        message: def.label + " — Auto", subtitle: "No models yet. Sign in first, then configure Auto.", clearScreen: true,
      });
      return;
    }

    const items = [
      { label: "Done", value: { type: "done" } },
      { label: "Ranking source: " + SOURCE_LABEL[source], value: { type: "source" }, color: "cyan" },
    ];
    if (source === "manual") items.push({ label: "Reset to default order", value: { type: "reset" }, color: "yellow" });
    if (source === "leaderboard") items.push({ label: "Refresh leaderboard now", value: { type: "refresh" }, color: "cyan" });
    items.push({ label: "", value: { type: "noop" }, separator: true });
    items.push({ label: "Ranking (top = preferred)", value: { type: "noop" }, kind: "heading" });
    order.forEach((id, i) => {
      const inc = !excluded.includes(id);
      items.push({ label: (inc ? "[x] " : "[ ] ") + (i + 1) + ". " + displayName(providerId, id), hint: inc ? "" : "excluded", value: { type: "model", id } });
    });

    const subtitleBySource = {
      manual: "Auto tries these top-to-bottom. Enter a model to reorder/include.",
      recommended: "Order follows the provider's recommended ranking. Enter a model to include/exclude.",
      leaderboard: hasLeaderboardKey() ? "Order follows Artificial Analysis quality scores." : "Order follows a built-in quality ranking; add leaderboard.apiKey to core-auth.json for live scores.",
    };
    const r = await select(items, { message: def.label + " — Auto model ranking", subtitle: subtitleBySource[source], clearScreen: true });
    if (!r || r.type === "done" || r.type === "noop") return;
    if (r.type === "reset") { setAutoConfig(providerId, { order: [] }); continue; }
    if (r.type === "source") {
      const nextSource = SOURCE_CYCLE[source];
      setAutoConfig(providerId, { source: nextSource });
      if (nextSource === "leaderboard") await refreshLeaderboard(providerId);
      continue;
    }
    if (r.type === "refresh") { await refreshLeaderboard(providerId); continue; }
    if (r.type === "model") await editModel(providerId, r.id, source);
  }
}
