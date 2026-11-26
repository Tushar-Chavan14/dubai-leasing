"use server";

import type { EnquiryState } from "../../../../lib/enquiry-submit";
import { sendEnquiry } from "../../../../lib/enquiry-submit";
import { requestHeaders } from "../../../../lib/request-headers";

/** The public enquiry and booking form (S79). The checks and the post to the engine are in `lib/enquiry-submit.ts`. */
export async function submitEnquiry(_prev: EnquiryState, form: FormData): Promise<EnquiryState> {
  return sendEnquiry(form, await requestHeaders());
}
