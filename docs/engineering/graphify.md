# Graphify Auto-Lite Pilot

## Status

Pilot. Use Graphify as a codebase context map for cross-subsystem work, not as the source of truth.

## Version

Pinned local tool version: `graphifyy==0.8.35`.

We first tested the original baseline `graphifyy==0.3.18`, but that CLI did not expose the `update` and `extract` commands required by this pilot workflow. Version `0.8.35` is pinned because it supports:

- `graphify update`
- `graphify query`
- `graphify path`
- `graphify explain`
- `graphify codex install`

Install or repair the isolated tool with:

```bash
uv tool install graphifyy==0.8.35 --force
graphify --version
```

Do not add Graphify to app package dependencies. It is a developer/agent tool only.

## When To Use

Use Graphify before broad code searches when a task crosses several AI-Business subsystems:

- report registry, report runners, snapshots, and LINE cards
- signed viewer token, viewer APIs, and PDF/export behavior
- tenant datasource config, secrets, permissions, and audit logs
- worker schedules, notification rules, and delivery history
- deployment or architecture questions that span `api`, `web`, `worker`, `shared`, and `reports`

Skip Graphify for small, single-file edits, exact symbol lookups, log inspection, or test failure triage where `rg` and source reads are faster.

## Safety Rules

- Graphify is a map, not source of truth.
- Always open source files before editing.
- If the graph disagrees with the code, trust the code and update the graph after the task.
- Never index secrets, customer exports, screenshots, PDFs, runtime databases, cache, or build artifacts.
- Do not commit `graphify-out/` until `graph:preflight` passes and the graph output has been reviewed.

## Commands

```bash
corepack pnpm graph:update
corepack pnpm graph:preflight
corepack pnpm graph:query runAndPersistReportByKey
```

Useful symbol-level questions:

```bash
corepack pnpm graph:query buildNotificationReportPreview
corepack pnpm graph:query verifySignedViewerRequest
corepack pnpm graph:query readStoredDatasourceConfig
```

The pilot graph is AST-only and does not run semantic LLM extraction. Symbol-level queries are more reliable than broad natural-language prompts. Use natural-language graph queries only as a quick hint, then confirm with real source files.

## Output Policy

Commit these files first:

- `.graphifyignore`
- `scripts/graphify-update.sh`
- `scripts/graphify-query.sh`
- `scripts/graphify-preflight.sh`
- this document

Review before committing any `graphify-out/` files. Keep local-only files ignored:

- `graphify-out/manifest.json`
- `graphify-out/cost.json`
- `graphify-out/cache/`
- `graphify-out/converted/`
- `graphify-out/GRAPH_TREE.html`

## Review Checklist

Before committing graph output:

1. Run `corepack pnpm graph:preflight`.
2. Confirm `graphify-out/graph.json` size is reasonable.
   The current preflight budget is 20 MB and can be tightened or relaxed with
   `GRAPHIFY_MAX_GRAPH_BYTES` during local review.
3. Search the graph for `.env`, token-like strings, customer exports, screenshots, PDFs, and runtime/cache paths.
4. Ask at least three smoke questions: `runAndPersistReportByKey`, `buildNotificationReportPreview`, `verifySignedViewerRequest`.
5. Open source files for one answer and verify the graph's flow against real code.

## Pilot KPIs

Track qualitatively during the next few architecture tasks:

- fewer source files opened before finding the right entrypoint
- less repeated context requested from the user
- faster mapping of report/LINE/viewer flows
- zero stale-graph incidents that cause incorrect edits
- no privacy leakage into `graphify-out/`

## Rollout

Phase 1: local pilot only. Build graph and query it locally.

Phase 2: commit reviewed graph output only if it is small and safe.

Phase 3: add Graphify update to architecture-change release checklist.

Phase 4: consider `graphify hook install` only after one or two weeks of stable pilot use. Hooks must be advisory and must not block deploy.
