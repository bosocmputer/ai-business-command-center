---
name: ai-business-command-center
description: Use this skill when working on the AI Business Command Center for SML: planning, architecture, report contracts, SML PostgreSQL report runner, dashboard, LINE OA Morning Brief, subscription/multi-tenant design, security, tests, deployment, or future chatbot over approved reports.
---

# AI Business Command Center Skill

## Purpose

Use this skill for all work in `/Users/nontawatwongnuk/dev_bos/AI-Business Command-Center`.

The product is a web-first SML report intelligence/subscription platform:

- 1 company = 1 SML PostgreSQL database
- shared SML report knowledge across tenants
- tenant data, credentials, report results, and LINE targets isolated by `tenant_id`
- Phase 1 = approved SQL report runner + dashboard + LINE Morning Brief
- Future chatbot = report router over approved reports, not an arbitrary SQL generator

## Required Reading

Before major work, read the relevant docs:

- Product direction: `docs/01_PRODUCT_BLUEPRINT_TH.md`
- Architecture: `docs/02_SYSTEM_ARCHITECTURE_TH.md`
- Data flow: `docs/03_DATA_FLOW_TH.md`
- Data model: `docs/04_DATA_MODEL_TH.md`
- Report contract: `docs/05_REPORT_CONTRACT_TH.md`
- SML knowledge model: `docs/06_SML_KNOWLEDGE_MODEL_TH.md`
- LINE OA: `docs/07_LINE_OA_MORNING_BRIEF_TH.md`
- Security/prod: `docs/08_SECURITY_AND_PRODUCTION_TH.md`
- Tech/deploy: `docs/09_TECH_STACK_AND_DEPLOYMENT_TH.md`
- Inspirations: `docs/10_INSPIRATION_OPENHUMAN_OPENCLAW_HERMES_TH.md`
- Roadmap: `docs/11_IMPLEMENTATION_ROADMAP_TH.md`
- Engineering playbook: `docs/12_ENGINEERING_PLAYBOOK_TH.md`
- Active plan: `PLANS.md`

Read only the files needed for the current task.

## Non-Negotiable Rules

- Never commit real DB credentials, LINE tokens, or private host passwords.
- Production must not use DB superuser credentials.
- All report SQL must be approved, parameterized, and represented by a report contract.
- AI/chatbot must not generate arbitrary production SQL.
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

