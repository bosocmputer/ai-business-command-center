import {
  getReportPresetEntry,
  type ReportPresetKey,
  reportPresetKeyValues,
} from "@ai-bcc/shared";
import {
  buildNotificationReportPresetUpdate,
  defaultNotificationReportPresetRuleIds,
} from "./notification-report-presets.js";
import { createSystemStore } from "./system-store.js";

type CliOptions = {
  dryRun: boolean;
  presetKey: ReportPresetKey;
  ruleIds: string[];
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const preset = getReportPresetEntry(options.presetKey);
  const store = createSystemStore();
  try {
    for (const ruleId of options.ruleIds) {
      const rule = await store.getNotificationRule(ruleId);
      if (!rule) {
        throw new Error(`ไม่พบ notification rule: ${ruleId}`);
      }
      const update = buildNotificationReportPresetUpdate({
        presetKey: options.presetKey,
        rule,
        updatedAt: new Date().toISOString(),
      });
      console.log(
        [
          options.dryRun ? "DRY-RUN" : "UPDATE",
          rule.id,
          rule.tenant_id,
          `preset=${preset.key}`,
          `changed=${update.changed ? "yes" : "no"}`,
        ].join(" | "),
      );
      console.log(`  old=${JSON.stringify(update.oldReportKeys)}`);
      console.log(`  new=${JSON.stringify(update.newReportKeys)}`);
      if (options.dryRun || !update.changed) {
        continue;
      }

      await store.upsertNotificationRule(update.updatedRule);
      await store.appendAuditLog({
        tenant_id: rule.tenant_id,
        actor_id: null,
        action: "notification_rule_report_preset_applied",
        target_type: "notification_rule",
        target_id: rule.id,
        metadata_json: update.auditMetadata,
      });
    }
  } finally {
    await store.close();
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    presetKey: "executive_full",
    ruleIds: [...defaultNotificationReportPresetRuleIds],
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "--":
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--preset":
        options.presetKey = parsePresetKey(requireValue(arg, next));
        index += 1;
        break;
      case "--rule-id":
        if (options.ruleIds.length === defaultNotificationReportPresetRuleIds.length) {
          options.ruleIds = [];
        }
        options.ruleIds.push(requireValue(arg, next));
        index += 1;
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.ruleIds.length) {
    throw new Error("ต้องระบุ rule อย่างน้อย 1 รายการ");
  }
  return options;
}

function parsePresetKey(value: string): ReportPresetKey {
  if (reportPresetKeyValues.includes(value as ReportPresetKey)) {
    return value as ReportPresetKey;
  }
  throw new Error(`Unknown preset: ${value}`);
}

function requireValue(flag: string, value: string | undefined) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`
Usage:
  pnpm --filter @ai-bcc/api notification-preset:apply -- --dry-run
  pnpm --filter @ai-bcc/api notification-preset:apply -- --preset executive_full

Options:
  --dry-run          Print old/new report keys without updating
  --preset <key>     Preset key, default executive_full
  --rule-id <id>     Rule id to update. Repeatable. Defaults to the two pilot rules.
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
