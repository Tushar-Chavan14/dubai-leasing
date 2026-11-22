/**
 * Generates the fictional ID specimens for the `spa:kyc` eval (S49, C17):
 * `bun modules/spa/packages/helpers/scripts/make-kyc-specimens.ts`. Writes 40 PNGs (10 invented people × a valid and an
 * expired passport, a valid and an expired Emirates ID front) and `cases.jsonl` into `src/kyc/evals/specimens/`.
 *
 * Every person, number and document is invented and marked SPECIMEN · FICTIONAL: no national emblems, colours or copies
 * of real card designs. Numbers are valid in form (Luhn, MRZ check digits) so the code checks can be exercised.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { luhnCheckDigit } from "@platform/kernel/emirates-id";
import { makeTd3 } from "@platform/kernel/mrz";
import { Resvg } from "@resvg/resvg-js";

const OUT = join(import.meta.dir, "../src/kyc/evals/specimens");
export const TODAY = "2026-11-19";
const VALID = "2030-09-14";
const EXPIRED = "2026-04-30";

interface Person {
  key: string;
  given: string;
  surname: string;
  nationality: string; // ISO 3166 alpha-3 style code, as in an MRZ
  nationalityName: string;
  birthDate: string;
  sex: "M" | "F";
  serial: string; // 7 digits
  passportNo: string;
}
const PEOPLE: Person[] = [
  ["ana", "Ana", "Sample Ribeiro", "UTO", "Utopia", "1988-02-11", "F", "3011842", "UT3011842"],
  ["bilal", "Bilal", "Example Qureshi", "UTO", "Utopia", "1979-07-03", "M", "5120076", "BQ5120076"],
  ["chen", "Chen", "Placeholder Wu", "UTO", "Utopia", "1992-12-25", "M", "6203319", "CW6203319"],
  ["dalia", "Dalia", "Specimen Nasser", "UTO", "Utopia", "1985-05-19", "F", "7314450", "DN7314450"],
  ["emeka", "Emeka", "Demo Obi", "UTO", "Utopia", "1990-09-30", "M", "8420561", "EO8420561"],
  ["farah", "Farah", "Imaginary Khan", "UTO", "Utopia", "1983-01-08", "F", "9531672", "FK9531672"],
  ["goran", "Goran", "Fictional Petrov", "UTO", "Utopia", "1975-10-17", "M", "1642783", "GP1642783"],
  ["hana", "Hana", "Invented Sato", "UTO", "Utopia", "1996-04-02", "F", "2753894", "HS2753894"],
  ["ivan", "Ivan", "Test Morales", "UTO", "Utopia", "1981-08-26", "M", "3864905", "IM3864905"],
  ["jana", "Jana", "Mock Novak", "UTO", "Utopia", "1994-06-14", "F", "4975016", "JN4975016"],
].map(([key, given, surname, nationality, nationalityName, birthDate, sex, serial, passportNo]) => ({
  key,
  given,
  surname,
  nationality,
  nationalityName,
  birthDate,
  sex,
  serial,
  passportNo,
})) as Person[];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const fmt = (iso: string) => iso.split("-").toReversed().join("/");
const fullName = (p: Person) => `${p.given} ${p.surname}`;
const eidNo = (p: Person) => {
  const digits = `784${p.birthDate.slice(0, 4)}${p.serial}`;
  return `784-${p.birthDate.slice(0, 4)}-${p.serial}-${luhnCheckDigit(digits)}`;
};

const W = 1100;
const H = 700;
function frame(title: string, body: string) {
  const watermark = `<text x="${W / 2}" y="${H / 2 + 40}" font-family="DejaVu Sans" font-size="64" font-weight="bold" fill="#c0392b" fill-opacity="0.13" text-anchor="middle" transform="rotate(-18 ${W / 2} ${H / 2})">SPECIMEN · FICTIONAL</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>
    <rect width="${W}" height="${H}" rx="28" fill="#f4f6f3" stroke="#9aa39c" stroke-width="3"/>
    <rect x="0" y="0" width="${W}" height="92" rx="28" fill="#dfe6e0"/><rect x="0" y="60" width="${W}" height="32" fill="#dfe6e0"/>
    <text x="40" y="58" font-family="DejaVu Sans" font-size="34" font-weight="bold" fill="#1f2a24">${esc(title)}</text>
    <text x="${W - 40}" y="58" font-family="DejaVu Sans" font-size="20" fill="#5b665f" text-anchor="end">Demo specimen · not a real document</text>
    ${body}${watermark}</svg>`;
}
const photo = `<rect x="40" y="130" width="220" height="280" rx="12" fill="#cfd6d0"/><circle cx="150" cy="230" r="58" fill="#aeb8b0"/><rect x="72" y="300" width="156" height="90" rx="40" fill="#aeb8b0"/>`;
const rows = (items: [string, string][], x = 300, y = 140, gap = 78) =>
  items
    .map(
      ([label, value], i) =>
        `<text x="${x}" y="${y + i * gap}" font-family="DejaVu Sans" font-size="20" fill="#5b665f">${esc(label)}</text><text x="${x}" y="${y + i * gap + 30}" font-family="DejaVu Sans" font-size="30" font-weight="bold" fill="#14201a">${esc(value)}</text>`,
    )
    .join("");

const eidFront = (p: Person, expiresOn: string) =>
  frame(
    "Identity Card",
    photo +
      rows([
        ["ID Number", eidNo(p)],
        ["Name", fullName(p)],
        ["Nationality", p.nationalityName],
        ["Date of Birth", fmt(p.birthDate)],
        ["Sex", p.sex],
        ["Expiry Date", fmt(expiresOn)],
      ]),
  );
function passport(p: Person, expiresOn: string) {
  const [l1, l2] = makeTd3({
    issuingState: p.nationality,
    surname: p.surname,
    givenNames: p.given,
    passportNo: p.passportNo,
    nationality: p.nationality,
    birthDate: p.birthDate,
    sex: p.sex,
    expiresOn,
  });
  const mrz = [l1, l2]
    .map(
      (l, i) =>
        `<text x="40" y="${610 + i * 48}" font-family="DejaVu Sans Mono" font-size="31" letter-spacing="1.2" fill="#14201a">${esc(l)}</text>`,
    )
    .join("");
  return frame(
    "Passport · data page",
    photo +
      rows(
        [
          ["Type / Country code / Passport No.", `P   ${p.nationality}   ${p.passportNo}`],
          ["Surname", p.surname.toUpperCase()],
          ["Given names", p.given.toUpperCase()],
          ["Nationality", p.nationalityName.toUpperCase()],
        ],
        300,
        130,
        66,
      ) +
      rows(
        [
          ["Date of birth", fmt(p.birthDate)],
          ["Sex", p.sex],
          ["Date of expiry", fmt(expiresOn)],
        ],
        760,
        130,
        66,
      ) +
      `<rect x="20" y="565" width="${W - 40}" height="120" fill="#ffffff" fill-opacity="0.6"/>${mrz}`,
  );
}

interface Case {
  id: string;
  title: string;
  today: string;
  applicant: { nameEn: string };
  document: { file: string; kind: "passport" | "emirates_id_front" };
  svg: string;
  expect: { expired: boolean; fields: Record<string, string> };
}
const cases: Case[] = [];
for (const p of PEOPLE)
  for (const expired of [false, true]) {
    const exp = expired ? EXPIRED : VALID;
    const tag = expired ? "expired" : "valid";
    cases.push({
      id: `${p.key}-passport-${tag}`,
      title: `Passport, ${tag}`,
      today: TODAY,
      applicant: { nameEn: fullName(p) },
      document: { file: `${p.key}-passport-${tag}.png`, kind: "passport" },
      svg: passport(p, exp),
      expect: {
        expired,
        fields: { passportNo: p.passportNo, birthDate: p.birthDate, passportExpiresOn: exp },
      },
    });
    cases.push({
      id: `${p.key}-eid-${tag}`,
      title: `Emirates ID front, ${tag}`,
      today: TODAY,
      applicant: { nameEn: fullName(p) },
      document: { file: `${p.key}-eid-front-${tag}.png`, kind: "emirates_id_front" },
      svg: eidFront(p, exp),
      expect: {
        expired,
        fields: { emiratesIdNo: eidNo(p), birthDate: p.birthDate, idExpiresOn: exp },
      },
    });
  }

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".png") || f === "cases.jsonl") rmSync(join(OUT, f));
for (const c of cases)
  writeFileSync(
    join(OUT, c.document.file),
    new Resvg(c.svg, { font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" } }).render().asPng(),
  );
writeFileSync(join(OUT, "cases.jsonl"), `${cases.map(({ svg: _svg, ...c }) => JSON.stringify(c)).join("\n")}\n`);
console.log(`wrote ${cases.length} images and cases to ${OUT}`);
