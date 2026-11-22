/** How a data-sheet value is written into a blank. `enum` fields print as their words. */
export type FieldType = "text" | "money_fils" | "date" | "int" | "enum";

export interface FieldInfo {
  type: FieldType;
  label: string;
}
