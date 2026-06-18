// @ts-nocheck
// core-auth config: the active provider and harness settings, stored in
// config/core-auth.json (preferred) with a top-level fallback.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { configFolder, getConfigDir } from "./env.js";
import { readModelCache } from "./models-cache.js";

function paths() {
  const dir = getConfigDir();
  return { preferred: join(dir, "config", "core-auth.json"), fallback: join(dir, "core-auth.json") };
}

export function readConfig(): Record<string, any> {
  const { preferred, fallback } = paths();
  const p = existsSync(preferred) ? preferred : existsSync(fallback) ? fallback : null;
  try { return p ? JSON.parse(readFileSync(p, "utf8")) : {}; } catch { return {}; }
}

export function writeConfig(cfg: Record<string, any>): void {
  const { preferred } = paths();
  try {
    if (!existsSync(configFolder())) mkdirSync(configFolder(), { recursive: true });
    writeFileSync(preferred, JSON.stringify(cfg, null, 2), "utf8");
  } catch {}
}

export function activeProvider(): string {
  return readConfig().provider || "";
}

export function setActiveProvider(name: string): void {
  const cfg = readConfig();
  cfg.provider = name;
  writeConfig(cfg);
}

// --- Auto model ranking/inclusion (the "Auto" meta-model's config) ---
// Stored under cfg.auto[providerId] = { order: [rawId...], excluded: [rawId...] }.
// Always reconciled against the live catalog: new models append, removed ones drop,
// so the config never goes stale relative to what the account actually offers.

export function getAutoConfig(providerId: string): { order: string[]; excluded: string[] } {
  const stored = (readConfig().auto || {})[providerId] || {};
  const cache = readModelCache(providerId);
  const catalogOrder: string[] = (cache && cache.ranking) || [];

  let order = Array.isArray(stored.order) && stored.order.length ? stored.order.slice() : catalogOrder.slice();
  for (const id of catalogOrder) if (!order.includes(id)) order.push(id);   // append new models
  order = order.filter((id) => catalogOrder.includes(id));                  // drop removed models

  const excluded = (Array.isArray(stored.excluded) ? stored.excluded : []).filter((id) => catalogOrder.includes(id));
  return { order, excluded };
}

export function setAutoConfig(providerId: string, auto: { order?: string[]; excluded?: string[] }): void {
  const cfg = readConfig();
  cfg.auto = cfg.auto || {};
  cfg.auto[providerId] = { order: auto.order || [], excluded: auto.excluded || [] };
  writeConfig(cfg);
}

// The ranked, included raw model ids Auto should try (top preference first).
export function getAutoCandidates(providerId: string): string[] {
  const { order, excluded } = getAutoConfig(providerId);
  const ex = new Set(excluded);
  return order.filter((id) => !ex.has(id));
}
