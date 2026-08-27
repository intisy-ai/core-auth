// A provider declares its settings ONCE as a ProviderSettingsSchema and derives
// both consumer shapes from it, instead of hand-maintaining two field lists in
// two vocabularies (capabilities.ts's boolean/select/multiline + {value,label}
// options vs settings-menu.ts's bool/enum/number/string + bare-string options).
//
// toSettingsGroups() emits the driver.settings.groups shape the loader TUI
// (ui/settings-menu.ts) consumes; toCapabilitiesFields() emits the fields[]
// shape core's defineCapabilities() consumes. Both walk the same schema, so
// the two surfaces can never drift out of key-set sync again.

/** A field's edit widget, in the vocabulary a {@link ProviderSettingsSchema} is authored in. */
export type SettingsFieldType = "bool" | "enum" | "number" | "string" | "multiline";

/** One choice for an `enum` {@link SettingsField}; `label` defaults to `value` when absent. */
export interface SettingsFieldOption {
  /** The stored value. */
  value: string;
  /** Display text; falls back to `value` when omitted. */
  label?: string;
}

/** One setting in a {@link ProviderSettingsSchema}, authored once and rendered by both consumer shapes. */
export interface SettingsField {
  /** The config key this field reads and writes. */
  key: string;
  /** Display label. */
  label: string;
  /** The edit widget to render. */
  type: SettingsFieldType;
  /** Choices for an `enum` field; ignored for other types. */
  options?: (string | SettingsFieldOption)[];
  /** Lower bound for a `number` field. */
  min?: number;
  /** Upper bound for a `number` field. */
  max?: number;
  /** Increment step for a `number` field. */
  step?: number;
  /** Short help text shown alongside the field. */
  hint?: string;
}

/** A titled group of {@link SettingsField}s within a {@link ProviderSettingsSchema}. */
export interface SettingsGroupSchema {
  /** Group heading. */
  title: string;
  /** Settings in this group. */
  fields: SettingsField[];
}

/**
 * A provider's settings, declared once and derived into both consumer shapes:
 * {@link toSettingsGroups} for the loader TUI, {@link toCapabilitiesFields} for the Cairn
 * dashboard. Declaring the schema once keeps the two surfaces from drifting out of key-set sync.
 */
export type ProviderSettingsSchema = SettingsGroupSchema[];

/** A field in the loader TUI's settings menu, as produced by {@link toSettingsGroups}. */
export interface SettingsMenuField {
  /** The config key this field reads and writes. */
  key: string;
  /** Display label. */
  label: string;
  /** `multiline` collapses to `string` here; the TUI renders any non-bool/enum field as free text. */
  type: "bool" | "enum" | "number" | "string";
  /** Option values only; {@link SettingsField.options} labels are dropped for this surface. */
  options?: string[];
  /** Lower bound for a `number` field. */
  min?: number;
  /** Upper bound for a `number` field. */
  max?: number;
  /** Short help text shown alongside the field. */
  hint?: string;
}

/** A titled group of {@link SettingsMenuField}s, as produced by {@link toSettingsGroups}. */
export interface SettingsMenuGroup {
  /** Group heading. */
  title: string;
  /** Fields in this group. */
  fields: SettingsMenuField[];
}

/** A field in the Cairn dashboard's capabilities list, as produced by {@link toCapabilitiesFields}. */
export interface CapabilitiesField {
  /** The config key this field reads and writes. */
  key: string;
  /** The edit widget. */
  type: "boolean" | "select" | "multiline" | "number" | "string";
  /** Display label. */
  label: string;
  /** The group heading this field belongs under. */
  group: string;
  /** Carries {@link SettingsField.hint} when present. */
  description?: string;
  /** Choices for a `select` field. */
  options?: {
    /** The stored value. */
    value: string;
    /** Display text. */
    label: string;
  }[];
  /** Lower bound for a `number` field. */
  min?: number;
  /** Upper bound for a `number` field. */
  max?: number;
  /** Increment step for a `number` field. */
  step?: number;
}

// settings-menu.ts has no multiline field type; it renders any non-bool/enum
// field as a free-text in-tab input, so multiline collapses to string there.
const SETTINGS_MENU_TYPES: Record<SettingsFieldType, "bool" | "enum" | "number" | "string"> = {
  bool: "bool",
  enum: "enum",
  number: "number",
  string: "string",
  multiline: "string",
};

const CAPABILITIES_TYPES: Record<SettingsFieldType, "boolean" | "select" | "multiline" | "number" | "string"> = {
  bool: "boolean",
  enum: "select",
  number: "number",
  string: "string",
  multiline: "multiline",
};

function optionValue(opt: string | SettingsFieldOption): string {
  return typeof opt === "string" ? opt : opt.value;
}

function optionLabel(opt: string | SettingsFieldOption): string {
  if (typeof opt === "string") return opt;
  return opt.label ?? opt.value;
}

/** Derives the loader TUI's settings.groups shape from a provider's schema. */
export function toSettingsGroups(schema: ProviderSettingsSchema): SettingsMenuGroup[] {
  return schema.map((group) => ({
    title: group.title,
    fields: group.fields.map((field): SettingsMenuField => {
      const out: SettingsMenuField = { key: field.key, label: field.label, type: SETTINGS_MENU_TYPES[field.type] };
      if (field.options) out.options = field.options.map(optionValue);
      if (field.min != null) out.min = field.min;
      if (field.max != null) out.max = field.max;
      if (field.hint) out.hint = field.hint;
      return out;
    }),
  }));
}

/** Derives the Cairn dashboard's `defineCapabilities()` fields shape from a provider's schema. */
export function toCapabilitiesFields(schema: ProviderSettingsSchema): CapabilitiesField[] {
  const fields: CapabilitiesField[] = [];
  for (const group of schema) {
    for (const field of group.fields) {
      const out: CapabilitiesField = { key: field.key, type: CAPABILITIES_TYPES[field.type], label: field.label, group: group.title };
      if (field.hint) out.description = field.hint;
      if (field.options) out.options = field.options.map((opt) => ({ value: optionValue(opt), label: optionLabel(opt) }));
      if (field.min != null) out.min = field.min;
      if (field.max != null) out.max = field.max;
      if (field.step != null) out.step = field.step;
      fields.push(out);
    }
  }
  return fields;
}
