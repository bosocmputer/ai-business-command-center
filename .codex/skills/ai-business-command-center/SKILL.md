---
name: ai-business-command-center
description: Use this skill when working on the AI Business Command Center: multi-channel Morning Brief / Business Brief hub, SML PostgreSQL reports, FlowAccount finance brief foundation, dashboard, LINE OA Morning Brief, subscription/multi-tenant design, security, tests, deployment, or future chatbot over approved reports.
---

# AI Business Command Center Skill

## Purpose

Use this skill for all work in `/Users/nontawatwongnuk/dev_bos/AI-Business Command-Center`.

The product is a web-first multi-channel brief/subscription platform:

- SML is the first channel (`sml_reports`), not the permanent center of every integration
- FlowAccount is a future independent finance/accounting brief channel (`flowaccount_finance`), not an SML sync target
- tenant data, credentials, brief/report results, and LINE targets isolated by `tenant_id`
- each channel owns its auth, credential, runner, schedule, template, permission, and audit path
- Phase 1 = approved SML SQL report runner + dashboard + LINE Morning Brief
- Future chatbot = report router over approved reports, not an arbitrary SQL generator

Important: Do not assume new integrations are linked to SML. Treat each source as an independent brief channel unless the user explicitly requests sync/reconciliation.

## Quick Context (read this first — saves token vs reading all docs)

**Server:** `192.168.2.109` | SSH: `sshpass -p 'boss123456' ssh bosscatdog@192.168.2.109`
**Deploy dir:** `/home/bosscatdog/deployments/ai-business-command-center`
**Latest commit:** `050b2a2`

**Tenants:** `tenant_demo_remote` (DEMO SHOP, slug: demo-shop) | `tenant_office_sml1_2026` (248 SHOP, slug: 248-shop)

**Containers:** `ai-bcc-web` :3055 | `ai-bcc-api` :4055 | `ai-bcc-worker` | `ai-bcc-system-db`

**System DB:** `psql -U ai_bcc -d ai_business_command_center`
Tables: `tenants, report_runs, report_snapshots, line_deliveries, line_targets, line_channels, secrets, audit_logs, worker_heartbeats`

**Current channel:** `sml_reports`
**Reports:** `sales_goods_services` | `purchase_goods_payables`
**Planned channel:** `flowaccount_finance` foundation only; no SML sync/document creation by default
**PDF layout:** `sml-row-v5` | Max: 300 docs / 5,000 rows / 31 days

**Owner login:** `superadmin/superadmin` (pilot only)
**Mutation auth header:** `x-ai-bcc-admin-token`

**Morning Brief:** 08:00 Asia/Bangkok, period=yesterday, tenant_demo_remote only

**Memory files** (check for full context before reading docs):
- System overview + server: `.claude/memory/project_system_overview.md`
- Routes + auth: `.claude/memory/project_routes_and_auth.md`
- Deploy + ops: `.claude/memory/project_deploy_and_ops.md`
- SML reports + DB schema: `.claude/memory/project_sml_reports.md`
- LINE OA + webhook: `.claude/memory/project_line_oa.md`
- MVP gaps + next priorities: `.claude/memory/project_mvp_gaps.md`

## Required Reading (only when memory files are not enough)

- Current status: `docs/16_CURRENT_STATUS_2026-05-20_TH.md` (read this first for any work)
- Report contract: `docs/05_REPORT_CONTRACT_TH.md`
- SML knowledge model: `docs/06_SML_KNOWLEDGE_MODEL_TH.md`
- Engineering playbook: `docs/12_ENGINEERING_PLAYBOOK_TH.md`
- Active plan: `PLANS.md`
- Architecture: `docs/02_SYSTEM_ARCHITECTURE_TH.md`
- Data model: `docs/04_DATA_MODEL_TH.md`
- LINE OA: `docs/07_LINE_OA_MORNING_BRIEF_TH.md`
- Security/prod: `docs/08_SECURITY_AND_PRODUCTION_TH.md`
- Full roadmap: `docs/11_IMPLEMENTATION_ROADMAP_TH.md`

Read only the files needed for the current task.

## Graphify Auto-Lite

Use Graphify as a context map for cross-subsystem work, not as source of truth.

If `graphify-out/graph.json` exists, consult it before broad `rg`/file sweeps when the task spans several AI-Business areas:

- report registry, report runners, snapshots, and LINE cards
- signed viewer token, viewer APIs, PDF/export behavior
- tenant datasource config, secrets, permissions, and audit logs
- worker schedules, notification rules, and delivery history
- deployment or architecture questions spanning API, web, worker, shared, reports, infra, and scripts

Skip Graphify for small single-file edits, exact symbol lookups, log inspection, and test failure triage where direct source reads are faster.

Commands:

- `corepack pnpm graph:query runAndPersistReportByKey`
- `corepack pnpm graph:query buildNotificationReportPreview`
- `corepack pnpm graph:query verifySignedViewerRequest`
- `corepack pnpm graph:update`
- `corepack pnpm graph:preflight`

Rules:

- This pilot uses an AST-only graph, so symbol-level queries are more reliable than broad natural-language questions.
- Always open source files before editing.
- If Graphify disagrees with source code, source code wins.
- After flow or architecture changes, update the graph manually and run preflight.
- Do not commit `graphify-out/` until preflight passes and the output is reviewed for secrets, customer data, and size.
- Do not install Graphify hooks during the pilot; keep it Auto-Lite/manual-update.

## Non-Negotiable Rules

- Never commit real DB credentials, LINE tokens, or private host passwords.
- Production must not use DB superuser credentials.
- All report SQL must be approved, parameterized, and represented by a report contract.
- All non-SML partner/API calls must be represented by a channel contract or adapter contract before production use.
- AI/chatbot must not generate arbitrary production SQL.
- AI/chatbot must not assume one channel depends on another.
- Every customer data table and worker job must carry `tenant_id`.
- Dashboard and LINE should read from traceable `report_runs` or `report_snapshots`.
- Report runs and LINE deliveries must be audit/loggable.
- Treat this as a future paid subscription product, not a throwaway demo.

## Default Implementation Direction

Use the web-first stack unless the user explicitly changes direction:

- Next.js + React + Tailwind for dashboard
- Node.js + TypeScript + Fastify for API
- PostgreSQL for system DB
- Drizzle ORM preferred
- Node worker + cron for MVP, BullMQ/Redis when needed
- `node-postgres` for SML PostgreSQL
- Docker Compose for test deployment to `192.168.2.109`

Do not reintroduce OpenHuman as the codebase for Phase 1. OpenHuman/OpenClaw/Hermes are inspiration patterns only.

## Workflow

### When the user sends the first SML query

1. Do not build dashboard first.
2. Create/derive the report contract first.
3. Identify params, output schema, summary rules, branch behavior, and validation rules.
4. Note edge cases: no branch, empty result, negative values/returns, date period, timezone.
5. Then implement report runner.

### Before writing production-sensitive code

Apply the engineering playbook:

- Code review: Prompt 1
- Refactor: Prompt 2
- Debug: Prompt 3
- ADR: Prompt 4
- Production function: Prompt 5
- Mentor/challenge assumptions: Prompt 6
- Tests: Prompt 8
- Performance: Prompt 10
- Migration: Prompt 11

### Before finalizing a task

Report:

- files changed
- behavior implemented
- validation/tests run
- residual risks
- next action

## Guardrails For Future Chatbot

The chatbot may:

- identify intent
- select an approved report
- extract params
- summarize report output
- cite `report_key` and `report_run_id`

The chatbot must not:

- write arbitrary SQL
- expose data across tenants
- answer without a source when business numbers are involved
- invent metrics not defined in the report library
