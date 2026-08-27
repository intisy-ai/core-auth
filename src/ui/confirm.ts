import { select, type SelectItem } from "./select.js";

/** Prompts a Yes/No choice via {@link select}; returns `false` on Esc/Ctrl-C. */
export async function confirm(message: string, defaultYes = false): Promise<boolean> {
  const items: SelectItem<boolean>[] = defaultYes
    ? [{ label: "Yes", value: true }, { label: "No", value: false }]
    : [{ label: "No", value: false }, { label: "Yes", value: true }];
  const result = await select(items, { message });
  return result ?? false;
}
