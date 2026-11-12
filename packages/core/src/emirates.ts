import { z } from "zod";

/** The seven emirates a unit, rulebook or rent rule can belong to. */
export const Emirate = z.enum([
  "dubai",
  "abu_dhabi",
  "sharjah",
  "ajman",
  "ras_al_khaimah",
  "fujairah",
  "umm_al_quwain",
]);
export type Emirate = z.infer<typeof Emirate>;
export const EMIRATES: readonly Emirate[] = Emirate.options;

export const EMIRATE_LABELS: Record<Emirate, string> = {
  dubai: "Dubai",
  abu_dhabi: "Abu Dhabi",
  sharjah: "Sharjah",
  ajman: "Ajman",
  ras_al_khaimah: "Ras Al Khaimah",
  fujairah: "Fujairah",
  umm_al_quwain: "Umm Al Quwain",
};

const REGISTRATION_SYSTEMS: Record<Emirate, string> = {
  dubai: "Ejari",
  abu_dhabi: "Tawtheeq",
  sharjah: "Sharjah Municipality attestation",
  ajman: "Tasdeeq",
  ras_al_khaimah: "RAK Municipality attestation",
  fujairah: "Ejaar",
  umm_al_quwain: "UAQ Municipality attestation",
};

/** Name of the tenancy registration system in the emirate (internal ids keep the Ejari names). */
export function registrationSystemName(emirate: Emirate): string {
  return REGISTRATION_SYSTEMS[emirate];
}

/** One-word label for the registration step (stage trackers): the system's name, or "Attestation" for municipalities. */
export function registrationStageName(emirate: Emirate): string {
  const name = REGISTRATION_SYSTEMS[emirate];
  return name.includes(" ") ? "Attestation" : name;
}

/** Dubai's rent index is the Smart Rental Index; other emirates use a generic name. */
export function rentIndexName(emirate: Emirate): string {
  return emirate === "dubai" ? "Smart Rental Index" : "Rent index";
}
