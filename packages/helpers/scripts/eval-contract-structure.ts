/**
 * Contract-structure eval against the real chat model. `bun run eval -- contract-structure` (needs
 * Ollama with CHAT_MODEL). Four fictional sample PDFs are generated with pdf-lib (serif and sans,
 * blanks in different styles, header, footer, coloured headings, a small logo; one has look-alike
 * DLD header text). Hard limits (code, must be exact): every blank found, every kept mapping valid
 * for the catalogue and type, section count, the style fields, and the DLD flag with the header
 * not reused. Mapping accuracy (the model's part) is reported and gated at 60%.
 */
import { EnvSchema } from "@leasing/core";
import { OllamaLlm } from "@leasing/llm";
import { type ContractStructureData, contractStructureHelper, FIELD_CATALOGUE, isFieldName } from "../src/index.ts";
import { generatePdf, SAMPLES } from "../src/contract-structure/evals/fixtures.ts";

const env = EnvSchema.pick({ OLLAMA_URL: true, CHAT_MODEL: true, CONTRACT_AI_MODEL: true, VISION_MODEL: true }).parse(
  process.env,
);
const llm = new OllamaLlm({
  url: env.OLLAMA_URL,
  chatModel: env.CONTRACT_AI_MODEL || env.CHAT_MODEL,
  visionModel: env.VISION_MODEL,
});
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

let wantBlanks = 0;
let foundBlanks = 0;
let wantMaps = 0;
let goodMaps = 0;
let invalid = 0;
let sectionsOk = 0;
let styleChecks = 0;
let styleOk = 0;
const problems: string[] = [];
const cases = SAMPLES.filter((s) => !only.length || only.includes(s.spec.id));

for (const s of cases) {
  const bytes = await generatePdf(s.spec);
  const helper = contractStructureHelper(llm, { readFile: async () => bytes });
  const started = performance.now();
  const r = await helper.run({
    runId: s.spec.id,
    entity: { kind: "company", id: s.spec.id },
    step: "extract_structure",
    context: { docId: s.spec.id },
    rulesVersion: "dubai-2025-01",
    now: new Date().toISOString(),
  });
  const d = (r as { data?: ContractStructureData }).data;
  if (!d) {
    console.log(`x ${s.spec.id}: ${r.status} ${r.reasons.join(" ")}`);
    wantBlanks += s.expect.blanks;
    wantMaps += s.expect.maps.length;
    problems.push(`${s.spec.id}: no result`);
    continue;
  }
  const e = s.expect;
  wantBlanks += e.blanks;
  foundBlanks += Math.min(d.blanks.length, e.blanks);
  if (d.blanks.length !== e.blanks) problems.push(`${s.spec.id}: ${d.blanks.length} blanks, expected ${e.blanks}`);
  const headed = d.sections.items.filter((x) => x.heading !== null).length;
  if (headed === e.sections) sectionsOk++;
  else problems.push(`${s.spec.id}: ${headed} sections, expected ${e.sections}`);
  for (const b of d.blanks) {
    if (b.field !== "unmapped" && (!isFieldName(b.field) || FIELD_CATALOGUE[b.field].type !== b.fieldType)) invalid++;
  }
  for (const m of e.maps) {
    wantMaps++;
    const b = d.blanks.find((x) => x.before.slice(-30).includes(m.near));
    if (b?.field === m.field) goodMaps++;
    else console.log(`  ${s.spec.id}: "${m.near}" -> ${b?.field ?? "(no blank)"}, expected ${m.field}`);
  }
  const check = (ok: boolean, what: string) => {
    styleChecks++;
    if (ok) styleOk++;
    else problems.push(`${s.spec.id}: style ${what}`);
  };
  const st = d.style;
  check(st.font.family === e.style.family, "font family");
  check(st.page.widthPt === e.style.page[0] && st.page.heightPt === e.style.page[1], "page size");
  check(Math.abs(st.margins.leftPt - s.spec.leftMargin) <= 2, "left margin");
  check(st.sizes.bodyPt === 11 && st.sizes.headingPt === 14 && st.sizes.titlePt === 20, "sizes");
  check(st.headingBold, "heading weight");
  if (e.style.accent) check(st.accentColour === e.style.accent, "accent colour");
  if (e.style.headerHas) check((st.header ?? "").includes(e.style.headerHas), "header text");
  if (e.style.footerHas) check((st.footer ?? "").includes(e.style.footerHas), "footer text");
  check((d.logo !== null) === e.style.logo, "logo");
  check(st.flags.authorityMarks === e.style.authorityMarks, "authority flag");
  if (e.style.authorityMarks) check(st.header === null, "DLD header not reused");
  console.log(
    `${s.spec.id}: ${d.sections.items.length} sections, ${d.blanks.length} blanks, ${d.unmappedBlanks} unmapped, ${Math.round(performance.now() - started)} ms`,
  );
}

const acc = wantMaps ? goodMaps / wantMaps : 0;
console.log(`\nBlank recall: ${foundBlanks}/${wantBlanks}`);
console.log(`Mapping accuracy: ${goodMaps}/${wantMaps} (${Math.round(acc * 100)}%)`);
console.log(`Section counts right: ${sectionsOk}/${cases.length}`);
console.log(`Style fields right: ${styleOk}/${styleChecks}`);
console.log(`Kept mappings invalid for catalogue or type: ${invalid} (must be 0)`);
const failures = [
  foundBlanks < wantBlanks && "a blank was missed",
  invalid > 0 && "a kept mapping was invalid",
  sectionsOk < cases.length && "a section count was wrong",
  styleOk < styleChecks && "a style field was wrong",
  acc < 0.6 && "mapping accuracy under 60%",
].filter(Boolean);
for (const p of problems) console.error(`  ${p}`);
for (const f of failures) console.error(`FAIL: ${f}.`);
process.exit(failures.length ? 1 : 0);
