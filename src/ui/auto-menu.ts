// @ts-nocheck
// TUI for editing the "Auto" meta-model: which models Auto may route to and in
// what order. Auto tries the included models top-to-bottom, skipping any whose
// quota is exhausted, so ranking = preference. Reached from the provider menu.

import { select } from "./select.js";
import { getAutoConfig, setAutoConfig } from "../config.js";
import { readModelCache } from "./../models-cache.js";

function displayName(providerId, rawId) {
  const cache = readModelCache(providerId);
  const entry = cache && cache.models && cache.models["antigravity-" + rawId];
  return (entry && entry.name) || rawId;
}

async function editModel(providerId, rawId) {
  const { order, excluded } = getAutoConfig(providerId);
  const included = !excluded.includes(rawId);
  const pos = order.indexOf(rawId);

  const items = [
    { label: "Back", value: { type: "back" } },
    { label: included ? "Exclude from Auto" : "Include in Auto", value: { type: "toggle" }, color: included ? "yellow" : "green" },
    { label: "Move up", value: { type: "up" } },
    { label: "Move down", value: { type: "down" } },
  ];
  const r = await select(items, { message: displayName(providerId, rawId), clearScreen: true });
  if (!r || r.type === "back") return;

  if (r.type === "toggle") {
    const next = included ? [...excluded, rawId] : excluded.filter((id) => id !== rawId);
    setAutoConfig(providerId, { order, excluded: next });
  } else if (r.type === "up" && pos > 0) {
    const next = order.slice();
    [next[pos - 1], next[pos]] = [next[pos], next[pos - 1]];
    setAutoConfig(providerId, { order: next, excluded });
  } else if (r.type === "down" && pos >= 0 && pos < order.length - 1) {
    const next = order.slice();
    [next[pos + 1], next[pos]] = [next[pos], next[pos + 1]];
    setAutoConfig(providerId, { order: next, excluded });
  }
}

export async function runAutoMenu(def) {
  const providerId = def.id;
  while (true) {
    const { order, excluded } = getAutoConfig(providerId);
    if (!order.length) {
      // no catalog yet (pre-login) — nothing to configure
      await select([{ label: "Back", value: { type: "back" } }], {
        message: def.label + " — Auto", subtitle: "No models yet. Sign in first, then configure Auto.", clearScreen: true,
      });
      return;
    }
    const items = [
      { label: "Done", value: { type: "done" } },
      { label: "Reset to default order", value: { type: "reset" }, color: "yellow" },
      { label: "", value: { type: "noop" }, separator: true },
      { label: "Ranking (top = preferred)", value: { type: "noop" }, kind: "heading" },
    ];
    order.forEach((id, i) => {
      const inc = !excluded.includes(id);
      items.push({
        label: `${inc ? ANSI_CHECK : ANSI_CROSS} ${i + 1}. ${displayName(providerId, id)}`,
        hint: inc ? "" : "excluded",
        value: { type: "model", id },
      });
    });

    const r = await select(items, {
      message: def.label + " — Auto model ranking",
      subtitle: "Auto tries these top-to-bottom, skipping rate-limited ones. Enter a model to reorder/include.",
      clearScreen: true,
    });
    if (!r || r.type === "done" || r.type === "noop") return;
    if (r.type === "reset") { setAutoConfig(providerId, { order: [], excluded: [] }); continue; }
    if (r.type === "model") await editModel(providerId, r.id);
  }
}

const ANSI_CHECK = "[x]";
const ANSI_CROSS = "[ ]";
