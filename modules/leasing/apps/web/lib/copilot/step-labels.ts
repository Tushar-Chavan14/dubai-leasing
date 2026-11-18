export interface StepLabel {
  label: string;
  /** Where a legal or money value comes from, shown in small mono text. */
  source: string | null;
}

const RULEBOOK = "rulebook";
const SRI = "Smart Rental Index";
const EJARI = "Ejari (simulated)";

const L = (label: string, source: string | null = null): StepLabel => ({ label, source });

const LABELS: Record<string, StepLabel> = {
  add_contract_clause: L("Preparing a contract clause change"),
  add_suggested_clause: L("Adding the suggested clause"),
  compute_renewal_cap: L("Working out the renewal rent cap", RULEBOOK),
  contract_status: L("Checking the contract and Ejari", EJARI),
  create_task: L("Preparing a task"),
  draft_approval_note: L("Drafting an approval note"),
  draft_email: L("Drafting an email"),
  edit_kyc_config: L("Preparing a KYC checks change"),
  explain_rule: L("Looking up the rulebook", RULEBOOK),
  find_available_units: L("Finding available units"),
  get_case_pack: L("Reading the case pack"),
  get_company_settings: L("Reading the company settings"),
  get_emirate_setup: L("Looking up the registration setup", RULEBOOK),
  get_enquiry: L("Reading the enquiry"),
  get_helper_run: L("Reading a helper run"),
  get_kyc_config: L("Reading the KYC checks"),
  get_lease: L("Reading the lease"),
  get_lease_timeline: L("Reading the lease timeline"),
  get_registration_status: L("Reading the registration status"),
  get_record: L("Reading the record"),
  get_unit: L("Reading the unit and its price limits", SRI),
  list_approvals: L("Checking approvals"),
  list_companies: L("Listing companies"),
  list_deadlines: L("Checking deadlines", RULEBOOK),
  list_enquiries: L("Checking enquiries"),
  list_outbound_messages: L("Checking sent emails"),
  list_payments: L("Checking rent payments"),
  list_records: L("Listing records"),
  list_tasks: L("Checking tasks"),
  list_tickets: L("Checking maintenance tickets"),
  offer_choices: L("Preparing choices for you"),
  pipeline_summary: L("Counting the pipeline"),
  propose_application: L("Preparing an application"),
  propose_approval: L("Preparing an approval request"),
  propose_prepare_contract: L("Preparing the contract"),
  propose_request_documents: L("Preparing a document request"),
  propose_resend_signing_link: L("Preparing a signing link resend"),
  propose_viewing_invite: L("Preparing a site visit invitation"),
  save_contract_rule: L("Preparing a contract rule change"),
  save_registration_settings: L("Preparing a registration settings change"),
  save_rent_rule: L("Preparing a rent rule change", RULEBOOK),
  save_sri_value: L("Preparing a Smart Rental Index change", SRI),
  search_entities: L("Searching units and leases"),
  show_decision: L("Preparing a decision card"),
  summarise_case: L("Summarising the case"),
  viewing_slots: L("Checking free site visit slots"),
};

const FALLBACK = L("Working on it");

/** Plain present-tense phrase for a tool call. Arguments are never put in the label (they may hold personal data). */
export function stepLabel(name: string, _args: Record<string, unknown>): StepLabel {
  return LABELS[name] ?? FALLBACK;
}
