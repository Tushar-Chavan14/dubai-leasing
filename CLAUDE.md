# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- **Domain knowledge:** load the `dubai-leasing` skill before touching the rulebook, state
  machines, notices, Ejari, approval gates or any helper.
- **New helper:** follow the `new-helper` skill step by step.
- **New copilot tool:** follow the `new-copilot-tool` skill step by step.
- **Compliance review:** before finishing any change to `packages/rulebook`,
  `packages/core/src/state`, `packages/core/src/gates.ts`, notice templates, the Ejari
  adapters or `packages/copilot` (tools or prompt), run the `compliance-reviewer` subagent on
  the diff and address what it finds.
- **Plan first** (plan mode) for changes that touch more than three packages or the database
  schema.
- **Real tenant data:** never open files in `data/uploads/`. Use fixtures in
  `packages/*/test/fixtures` and `packages/helpers/*/evals`.
- **Roadmap:** when you finish a task from `docs/roadmap.md`, tick it there.
- **Models:** don't change model tags in `.env.example` or pinned package versions without
  saying so in your summary.
