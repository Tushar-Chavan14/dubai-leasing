/** The document kinds a project's template can be for (S13). Words for the select on the Inventory form. */
export const SPA_TEMPLATE_KIND_LIST = ["spa", "mou", "assignment", "listing_agreement"] as const;
export const TEMPLATE_KIND_WORDS: Record<(typeof SPA_TEMPLATE_KIND_LIST)[number], string> = {
  spa: "Sale and purchase agreement",
  mou: "Memorandum of understanding",
  assignment: "Assignment",
  listing_agreement: "Listing agreement",
};
