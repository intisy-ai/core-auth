// A provider declares its settings ONCE as a ProviderSettingsSchema and derives
// both consumer shapes from it, instead of hand-maintaining two field lists in
// two vocabularies (capabilities.ts's boolean/select/multiline + {value,label}
// options vs settings-menu.ts's bool/enum/number/string + bare-string options).
//
// toSettingsGroups() emits the driver.settings.groups shape the loader TUI
// (ui/settings-menu.ts) consumes; toCapabilitiesFields() emits the fields[]
// shape core's defineCapabilities() consumes. Both walk the same schema, so
// the two surfaces can never drift out of key-set sync again.

export type SettingsFieldType = "bool" | "enum" | "number" | "string" | "multiline";

export interface SettingsFieldOption {
  value: string;
  label?: string;
}

export interface SettingsField {
  key: string;
  label: string;
  type: SettingsFieldType;
  options?: (string | SettingsFieldOption)[];
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

export interface SettingsGroupSchema {
  title: string;
  fields: SettingsField[];
}

export type ProviderSettingsSchema = SettingsGroupSchema[];

export interface SettingsMenuField {
  key: string;
  label: string;
  type: "bool" | "enum" | "number" | "string";
  options?: string[];
  min?: number;
  max?: number;
  hint?: string;
}

export interface SettingsMenuGroup {
  title: string;
  fields: SettingsMenuField[];
}

export interface CapabilitiesField {
  key: string;
  type: "boolean" | "select" | "multiline" | "number" | "string";
  label: string;
  group: string;
  description?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
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
