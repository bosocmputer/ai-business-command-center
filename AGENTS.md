# AI-Business Command Center Agent Notes

## Graphify Auto-Lite

This project may have a reviewed knowledge graph at `graphify-out/graph.json`.

Use Graphify as a context map, not as source of truth.

Use Graphify before broad raw searches when the task crosses multiple AI-Business subsystems:

- report registry, report runners, snapshots, and LINE cards
- signed viewer token, viewer APIs, and PDF/export behavior
- tenant datasource config, secrets, permissions, and audit logs
- worker schedules, notification rules, and delivery history
- deployment or architecture questions spanning API, web, worker, shared, reports, infra, and scripts

Skip Graphify for small single-file edits, exact symbol lookups, log inspection, or test failure triage where `rg` and source reads are faster.

Commands:

```bash
corepack pnpm graph:query runAndPersistReportByKey
corepack pnpm graph:query buildNotificationReportPreview
corepack pnpm graph:query verifySignedViewerRequest
corepack pnpm graph:update
corepack pnpm graph:preflight
```

Rules:

- If `graphify-out/graph.json` exists, query it first for cross-subsystem context.
- This pilot uses an AST-only graph, so symbol-level queries are more reliable than broad natural-language questions.
- Always open the real source files before editing.
- If Graphify output conflicts with source code, trust source code and update the graph after the task.
- Do not commit `graphify-out/` until `corepack pnpm graph:preflight` passes and the output has been reviewed for secrets, customer data, and size.
- Do not install Graphify hooks during the pilot; update manually after flow or architecture changes.
