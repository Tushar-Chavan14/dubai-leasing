/** The only words an Inventory error can show: one fixed sentence per outcome, never the engine's text. */
export const errorWords = (code: string): string =>
  ({
    invalid: "That wasn't saved. Check every field, including the code and the prices, and try again.",
    exists: "That code is already used. Pick another.",
    refused: "That wasn't saved. Only an admin changes the inventory, and the company must keep one.",
  })[code] ?? "That wasn't saved. Try again.";

export const savedWords = (code: string): string | null =>
  ({
    project: "Project added.",
    updated: "Project saved.",
    building: "Building added.",
    unit: "Unit added.",
    draft: "Saved as a draft version. Publish it when it is ready.",
    published: "Published. It is now the version in use.",
  })[code] ?? null;
