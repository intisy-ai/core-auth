import { describe, it, expect } from "vitest";
import { toCapabilitiesFields, toSettingsGroups } from "./settings-schema.js";
import type { ProviderSettingsSchema } from "./settings-schema.js";

const schema: ProviderSettingsSchema = [
  {
    title: "General",
    fields: [
      { key: "debug", label: "Debug logging", type: "bool", hint: "Enable debug logging to a file." },
      { key: "log_dir", label: "Log directory", type: "string" },
      { key: "response_text", label: "Canned response", type: "multiline", hint: "What the reply returns." },
    ],
  },
  {
    title: "Retry",
    fields: [
      { key: "max_retries", label: "Max retries", type: "number", min: 1, max: 20, hint: "How many attempts." },
      {
        key: "account_selection_strategy",
        label: "Account selection",
        type: "enum",
        options: [
          { value: "hybrid", label: "Hybrid (health + freshness)" },
          { value: "sticky", label: "Sticky (until rate-limited)" },
          "round-robin",
        ],
        hint: "How accounts are picked.",
      },
    ],
  },
];

describe("toSettingsGroups", () => {
  const groups = toSettingsGroups(schema);

  it("preserves group titles and field order", () => {
    expect(groups.map((g) => g.title)).toEqual(["General", "Retry"]);
    expect(groups[0].fields.map((f) => f.key)).toEqual(["debug", "log_dir", "response_text"]);
  });

  it("maps bool/number/string types straight through and collapses multiline to string", () => {
    const [debug, logDir, responseText] = groups[0].fields;
    expect(debug.type).toBe("bool");
    expect(logDir.type).toBe("string");
    expect(responseText.type).toBe("string");
  });

  it("maps enum options to bare strings, defaulting a labelled option's value", () => {
    const field = groups[1].fields.find((f) => f.key === "account_selection_strategy")!;
    expect(field.type).toBe("enum");
    expect(field.options).toEqual(["hybrid", "sticky", "round-robin"]);
  });

  it("carries min/max and hint through for number fields", () => {
    const field = groups[1].fields.find((f) => f.key === "max_retries")!;
    expect(field.min).toBe(1);
    expect(field.max).toBe(20);
    expect(field.hint).toBe("How many attempts.");
  });

  it("omits hint when the schema field has none", () => {
    const field = groups[0].fields.find((f) => f.key === "log_dir")!;
    expect(field.hint).toBeUndefined();
  });
});

describe("toCapabilitiesFields", () => {
  const fields = toCapabilitiesFields(schema);

  it("flattens groups into a group property on each field", () => {
    expect(fields.find((f) => f.key === "debug")!.group).toBe("General");
    expect(fields.find((f) => f.key === "max_retries")!.group).toBe("Retry");
  });

  it("maps bool to boolean and multiline stays multiline", () => {
    expect(fields.find((f) => f.key === "debug")!.type).toBe("boolean");
    expect(fields.find((f) => f.key === "response_text")!.type).toBe("multiline");
  });

  it("maps enum to select with {value,label} options, defaulting label to value for bare strings", () => {
    const field = fields.find((f) => f.key === "account_selection_strategy")!;
    expect(field.type).toBe("select");
    expect(field.options).toEqual([
      { value: "hybrid", label: "Hybrid (health + freshness)" },
      { value: "sticky", label: "Sticky (until rate-limited)" },
      { value: "round-robin", label: "round-robin" },
    ]);
  });

  it("maps hint to description", () => {
    expect(fields.find((f) => f.key === "debug")!.description).toBe("Enable debug logging to a file.");
  });

  it("carries min/max through for number fields", () => {
    const field = fields.find((f) => f.key === "max_retries")!;
    expect(field.min).toBe(1);
    expect(field.max).toBe(20);
  });
});

describe("cross-adapter key-set parity", () => {
  it("emits the identical key set from one schema", () => {
    const settingsKeys = toSettingsGroups(schema).flatMap((g) => g.fields.map((f) => f.key)).sort();
    const capabilitiesKeys = toCapabilitiesFields(schema).map((f) => f.key).sort();
    expect(settingsKeys).toEqual(capabilitiesKeys);
  });
});
