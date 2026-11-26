import { z } from "zod";
import { fence } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Input = z.object({ templateId: z.uuid().optional() });
const Version = z.object({
  version: z.number().int(),
  status: z.string(),
  rulesVersion: z.string().nullable(),
  blockers: z.number().int(),
  warnings: z.number().int(),
});
const Output = z.object({
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      documentKind: z.string(),
      inUseVersion: z.number().int().nullable(),
      latestVersion: z.number().int().nullable(),
      latestStatus: z.string().nullable(),
      versions: z.array(Version),
    }),
  ),
});
const RawList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      documentKind: z.string(),
      inUse: z.object({ version: z.number().int() }).nullable().optional(),
      latest: z.object({ version: z.number().int(), status: z.string() }).nullable().optional(),
    }),
  ),
});
const RawOne = z.object({
  id: z.string(),
  name: z.string(),
  documentKind: z.string(),
  versions: z.array(
    z.object({
      version: z.number().int(),
      status: z.string(),
      rulesVersion: z.string().nullable().optional(),
      blockers: z.number().int().optional(),
      warnings: z.number().int().optional(),
    }),
  ),
});

export const getTemplateStatus: CopilotTool<typeof Input, typeof Output> = {
  name: "get_template_status",
  description:
    "The agreement templates and their versions: which version is in use, the latest version's status and the number of blocking checks and warnings. Pass a template id for its versions.",
  kind: "read",
  roles: ["admin", "legal", "sales_manager"],
  input: Input,
  output: Output,
  async run(client, a) {
    if (a.templateId) {
      const t = RawOne.parse(await client.get(`/api/templates/${a.templateId}`));
      const inUse = t.versions.find((v) => v.status === "approved");
      const latest = t.versions[0];
      return Output.parse({
        templates: [
          {
            id: t.id,
            name: fence(t.name),
            documentKind: t.documentKind,
            inUseVersion: inUse?.version ?? null,
            latestVersion: latest?.version ?? null,
            latestStatus: latest?.status ?? null,
            versions: t.versions.map((v) => ({
              version: v.version,
              status: v.status,
              rulesVersion: v.rulesVersion ?? null,
              blockers: v.blockers ?? 0,
              warnings: v.warnings ?? 0,
            })),
          },
        ],
      });
    }
    const r = RawList.parse(await client.get("/api/templates"));
    return Output.parse({
      templates: r.items.slice(0, 20).map((t) => ({
        id: t.id,
        name: fence(t.name),
        documentKind: t.documentKind,
        inUseVersion: t.inUse?.version ?? null,
        latestVersion: t.latest?.version ?? null,
        latestStatus: t.latest?.status ?? null,
        versions: [],
      })),
    });
  },
};
