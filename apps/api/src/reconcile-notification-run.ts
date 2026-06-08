import { readFile } from "node:fs/promises";
import {
  getReportCatalogEntry,
  reportKeyValues,
  type NotificationRuleRunRecord,
  type ReportKey,
  type ReportSnapshot,
} from "@ai-bcc/shared";
import { createSystemStore } from "./system-store.js";
import {
  normalizeReconciliationExpected,
  reconcileSnapshot,
  type ReconciliationExpectedInput,
  type ReconciliationReportResult,
} from "./reconciliation.js";

type CliOptions = {
  expectedPath?: string;
  json: boolean;
  notificationRunId?: string;
  ruleId?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  tenantId?: string;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const store = createSystemStore();
  try {
    const run = await resolveNotificationRun(store, options);
    const expectedInput = options.expectedPath
      ? (JSON.parse(
          await readFile(options.expectedPath, "utf8"),
        ) as ReconciliationExpectedInput)
      : null;
    const expected = normalizeReconciliationExpected(expectedInput);
    const snapshots = await resolveSnapshotsForRun(store, run);
    const results = snapshots.map((snapshot) => reconcileSnapshot(snapshot, expected));
    const missingRunIds = run.report_run_ids.filter(
      (runId) => !snapshots.some((snapshot) => snapshot.run_id === runId),
    );

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            notification_run: run,
            status: resolveOverallStatus(results, missingRunIds),
            missing_report_run_ids: missingRunIds,
            reports: results,
          },
          null,
          2,
        ),
      );
      return;
    }

    printReport({
      run,
      results,
      missingRunIds,
      expectedLoaded: Boolean(options.expectedPath),
    });
  } finally {
    await store.close();
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "--":
        break;
      case "--expected":
        options.expectedPath = requireValue(arg, next);
        index += 1;
        break;
      case "--json":
        options.json = true;
        break;
      case "--notification-run-id":
        options.notificationRunId = requireValue(arg, next);
        index += 1;
        break;
      case "--rule-id":
        options.ruleId = requireValue(arg, next);
        index += 1;
        break;
      case "--scheduled-date":
        options.scheduledDate = requireValue(arg, next);
        index += 1;
        break;
      case "--scheduled-time":
        options.scheduledTime = requireValue(arg, next);
        index += 1;
        break;
      case "--tenant-id":
        options.tenantId = requireValue(arg, next);
        index += 1;
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.notificationRunId && !options.ruleId && !options.tenantId) {
    throw new Error(
      "กรุณาระบุ --notification-run-id, --rule-id หรือ --tenant-id เพื่อกันตรวจผิดรอบ",
    );
  }
  return options;
}

function requireValue(flag: string, value: string | undefined) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function resolveNotificationRun(
  store: ReturnType<typeof createSystemStore>,
  options: CliOptions,
) {
  const runs = await store.listNotificationRuleRuns({
    tenantId: options.tenantId,
    ruleId: options.ruleId,
    limit: 100,
  });
  const run = runs.find((candidate) => {
    if (
      options.notificationRunId &&
      candidate.id !== options.notificationRunId
    ) {
      return false;
    }
    if (
      options.scheduledDate &&
      candidate.scheduled_local_date !== options.scheduledDate
    ) {
      return false;
    }
    if (
      options.scheduledTime &&
      candidate.scheduled_local_time !== options.scheduledTime
    ) {
      return false;
    }
    return true;
  });
  if (!run) {
    throw new Error(
      "ไม่พบ notification run ตามเงื่อนไขที่ระบุ กรุณาใส่ --rule-id หรือ --tenant-id พร้อมรอบที่ถูกต้อง",
    );
  }
  return run;
}

async function resolveSnapshotsForRun(
  store: ReturnType<typeof createSystemStore>,
  run: NotificationRuleRunRecord,
) {
  const snapshots: ReportSnapshot[] = [];
  for (const runId of run.report_run_ids) {
    const snapshot = await findSnapshotByRunId(store, run.tenant_id, runId);
    if (snapshot) {
      snapshots.push(snapshot);
    }
  }
  return snapshots;
}

async function findSnapshotByRunId(
  store: ReturnType<typeof createSystemStore>,
  tenantId: string,
  runId: string,
) {
  for (const reportKey of reportKeyValues) {
    const snapshot = await store.getSnapshotByRunId(
      tenantId,
      runId,
      reportKey,
    );
    if (snapshot) {
      return snapshot;
    }
  }
  return null;
}

function printReport(input: {
  expectedLoaded: boolean;
  missingRunIds: string[];
  results: ReconciliationReportResult[];
  run: NotificationRuleRunRecord;
}) {
  console.log("AI Business reconciliation");
  console.log(
    [
      `run=${input.run.id}`,
      `rule=${input.run.rule_id}`,
      `tenant=${input.run.tenant_id}`,
      `scheduled=${input.run.scheduled_local_date} ${input.run.scheduled_local_time}`,
      `period=${formatPeriod(input.run)}`,
      `expected=${input.expectedLoaded ? "loaded" : "not provided"}`,
    ].join(" | "),
  );
  console.log("");
  console.table(
    input.results.map((result) => ({
      status: result.status,
      report: getReportCatalogEntry(result.report_key).shortLabel,
      report_key: result.report_key,
      basis: result.basis,
      run_id: result.run_id,
      warnings: result.warnings.join(", "),
    })),
  );
  for (const result of input.results) {
    console.log(`\n${result.report_key}`);
    console.table(
      result.metrics.map((metric) => ({
        status: metric.status,
        metric: metric.key,
        actual: metric.actual,
        expected: metric.expected ?? "",
        diff: metric.diff ?? "",
        tolerance: metric.tolerance ?? "",
      })),
    );
  }
  if (input.missingRunIds.length) {
    console.log("\nMissing snapshots:");
    for (const runId of input.missingRunIds) {
      console.log(`- ${runId}`);
    }
  }
  console.log(`\nOverall: ${resolveOverallStatus(input.results, input.missingRunIds)}`);
}

function resolveOverallStatus(
  results: ReconciliationReportResult[],
  missingRunIds: string[],
) {
  if (missingRunIds.length || results.some((result) => result.status === "fail")) {
    return "fail";
  }
  if (results.some((result) => result.status === "warning")) {
    return "warning";
  }
  return "pass";
}

function formatPeriod(run: NotificationRuleRunRecord) {
  const fromTime = run.period_from_time ? ` ${run.period_from_time}` : "";
  const toTime = run.period_to_time ? ` ${run.period_to_time}` : "";
  return `${run.period_from}${fromTime}..${run.period_to}${toTime}`;
}

function printHelp() {
  console.log(`
Usage:
  pnpm --filter @ai-bcc/api reconcile:notification-run -- --rule-id <rule_id>
  pnpm --filter @ai-bcc/api reconcile:notification-run -- --tenant-id <tenant_id> --scheduled-date YYYY-MM-DD --scheduled-time HH:mm

Options:
  --expected <path>             Compare against reviewed SML expected metrics JSON
  --json                        Print JSON instead of console tables
  --notification-run-id <id>    Reconcile one exact notification run
  --rule-id <id>                Filter by notification rule
  --tenant-id <tenant_id>       Filter by tenant
  --scheduled-date YYYY-MM-DD   Filter by scheduled local date
  --scheduled-time HH:mm        Filter by scheduled local time
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
