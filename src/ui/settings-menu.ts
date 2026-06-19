// @ts-nocheck
// Generic, schema-driven settings editor — the mechanism lives in core so every
// provider can expose its config in the same UI (oc loader tab + `oc auth login`),
// while the field list stays provider-specific. A provider declares:
//
//   def.settings = {
//     groups: [ { title, fields: Field[] } ],
//     get(key) -> current value (dotted keys like "health_score.initial" allowed),
//     set(key, value) -> persist (value === undefined resets to default),
//   }
//   Field = { key, label, type: "bool"|"enum"|"number"|"string",
//             options?: string[], min?, max?, hint? }
//
// bool toggles in place, enum cycles, number/string open the in-tab input. Values
// shown are the effective ones (provider resolves defaults); "(default)" means unset.

function formatValue(field, value) {
  if (field.type === "bool") return value ? "on" : "off";
  if (value === undefined || value === null || value === "") return "default";
  return String(value);
}

function fieldItem(def, field) {
  const settings = def.settings;
  const value = settings.get(field.key);
  const label = field.label + "  " + "[" + formatValue(field, value) + "]";
  if (field.type === "bool") {
    return { label, hint: field.hint || "", run: () => { settings.set(field.key, !value); return { refresh: true }; } };
  }
  if (field.type === "enum") {
    const options = field.options || [];
    return { label, hint: field.hint || "", run: () => { const i = options.indexOf(value); settings.set(field.key, options[(i + 1) % options.length]); return { refresh: true }; } };
  }
  // number | string -> in-tab input (blank resets to default)
  const range = field.type === "number" && (field.min != null || field.max != null)
    ? "  (range " + (field.min != null ? field.min : "") + "–" + (field.max != null ? field.max : "") + ")" : "";
  return {
    label, hint: field.hint || "",
    run: () => ({ input: {
      title: field.label,
      message: (field.hint ? field.hint + "\n\n" : "") + "Current: " + formatValue(field, value) + range + "\n\nEnter a new value (blank resets to default):",
      complete: (text) => {
        const t = (text || "").trim();
        if (t === "") { settings.set(field.key, undefined); return { refresh: true }; }
        if (field.type === "number") {
          const n = Number(t);
          if (!isFinite(n)) return { refresh: true };
          if (field.min != null && n < field.min) return { refresh: true };
          if (field.max != null && n > field.max) return { refresh: true };
          settings.set(field.key, n);
        } else {
          settings.set(field.key, t);
        }
        return { refresh: true };
      },
    } }),
  };
}

export function buildSettingsMenu(def, groupIndex) {
  const groups = (def.settings && def.settings.groups) || [];
  // more than one section: top level lists the sections
  if (groupIndex === undefined && groups.length > 1) {
    const items = [{ label: "Back", run: () => ({ pop: true }) }];
    groups.forEach((g, i) => items.push({ label: g.title, hint: (g.fields || []).length + " options", run: () => ({ push: () => buildSettingsMenu(def, i) }) }));
    return { title: def.label + " — Settings", subtitle: "Pick a section · changes apply on restart · Esc to go back", items };
  }
  const group = groups[groupIndex || 0] || { title: "Settings", fields: [] };
  const items = [{ label: "Back", run: () => ({ pop: true }) }];
  for (const field of group.fields) items.push(fieldItem(def, field));
  return { title: def.label + " — " + group.title, subtitle: "Enter to change · blank input resets to default · applies on restart", items };
}
