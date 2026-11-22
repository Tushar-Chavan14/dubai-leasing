/** Plain-words messages for the emailed buyer and seller pages (design.md §7.3, §8). No AML wording, ever. */
export interface LinkProblem {
  title: string;
  body: string;
}

export function linkProblem(status: number, code: string | undefined, page?: "portal"): LinkProblem {
  if (status === 404)
    return {
      title: "This link isn't valid",
      body: "Open the link from your latest email, or ask your agent for a new one.",
    };
  if (code === "link_used" && page === "portal")
    return {
      title: "You have already sent your documents",
      body: "Nothing more is needed from you here. If your agent asks for more, you will get a new link by email.",
    };
  if (code === "link_closed")
    return { title: "This purchase is closed", body: "Nothing more is needed from you here." };
  if (code === "link_superseded" && page === "portal")
    return {
      title: "This link has been replaced",
      body: "Please open the link in your newest email, or ask your agent for a new one.",
    };
  if (code === "link_used")
    return { title: "This link has already been used", body: "Nothing more is needed from you here." };
  if (code === "link_expired")
    return { title: "This link has expired", body: "Please ask your agent to send you a new one." };
  if (code === "link_superseded")
    return { title: "This agreement has been replaced", body: "Your agent will send you a new link." };
  if (code === "offer_expired") return { title: "This offer has expired", body: "It can no longer be answered." };
  if (code === "offer_closed") return { title: "This offer is closed", body: "It can no longer be answered." };
  return { title: "Something went wrong", body: "Please try again in a moment, or ask your agent." };
}

/** What a refused signature says (the engine's code), so a signer knows how to fix it. */
export function signError(code: string | undefined): string {
  switch (code) {
    case "name_mismatch":
      return "Type your full name exactly as it is written on the agreement.";
    case "not_your_turn":
      return "An earlier signer has not signed yet. Please try again later.";
    case "consent_required":
    case "invalid_request":
      return "Type your full name and tick the box to confirm.";
    default:
      return "We could not record your signature. Please try again.";
  }
}

/** What a refused upload or send says, by the engine's code: plain words, never a status or a code. */
export function uploadError(code: string | undefined): string {
  switch (code) {
    case "kind_not_asked":
      return "That is not one of the documents we asked you for. Please choose from the list.";
    case "invalid_file":
      return "Please upload a PDF or an image (JPEG, PNG or WebP) up to 10 MB.";
    case "rate_limited":
      return "You have uploaded a lot of files this hour. Please try again a little later.";
    case "nothing_uploaded":
      return "Please upload at least one document first.";
    case "link_used":
      return "You have already sent your documents.";
    case "link_expired":
    case "link_superseded":
      return "This link is no longer valid. Please open the link in your newest email, or ask your agent.";
    case "deal_closed":
      return "This purchase is closed, so no more documents are needed.";
    default:
      return "We could not take that. Please try again in a moment, or ask your agent.";
  }
}
