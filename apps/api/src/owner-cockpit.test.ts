import { describe, expect, it } from "vitest";
import {
  computeOwnerCockpitHealthMatrixRow,
  computeOwnerCockpitNextAction,
  deriveProductionProofStrip,
  type CockpitJavaWsFailure,
  type CockpitOperationsInput,
  type CockpitTenantInput,
} from "./owner-cockpit.js";

function makeTenant(
  overrides: Partial<CockpitTenantInput> = {},
): CockpitTenantInput {
  return {
    tenant_id: "tenant_a",
    tenant_name: "ร้าน A",
    status: "active",
    access_enabled: true,
    access_message: "",
    health: {
      datasource_configured: true,
      line_channels: 1,
      line_targets_total: 1,
      line_targets_enabled: 1,
      latest_report_run_at: "2026-06-18T01:00:00.000Z",
      latest_report_status: "success",
      latest_snapshot_at: "2026-06-18T01:00:00.000Z",
      latest_line_delivery_at: "2026-06-18T01:05:00.000Z",
      latest_line_delivery_status: "success",
      notification_rules_total: 1,
      notification_rules_enabled: 1,
      latest_notification_run_at: "2026-06-18T01:00:00.000Z",
      latest_notification_run_status: "success",
      latest_notification_run_error: null,
      open_business_signals: 0,
      critical_business_signals: 0,
      latest_business_signal_at: null,
    },
    ...overrides,
  };
}

function makeOps(
  overrides: Partial<CockpitOperationsInput> = {},
): CockpitOperationsInput {
  return {
    worker: { status: "ok" },
    telegram: {
      configured: true,
      targets: [{ enabled: true }],
    },
    latest_javaws_failure: null,
    heavy_report_runs: [],
    ...overrides,
  };
}

const javaWsFailure = (tenantId: string): CockpitJavaWsFailure => ({
  id: "run_1",
  tenant_id: tenantId,
  report_key: "sales_goods_services",
  status: "failed",
  finished_at: "2026-06-18T01:00:00.000Z",
  failure_kind: "sml_javaws",
  failure_phase: "invalid_zip",
  safe_error_message: null,
});

describe("computeOwnerCockpitNextAction", () => {
  it("returns an info action when there are no active tenants", () => {
    const action = computeOwnerCockpitNextAction([], makeOps());
    expect(action.tone).toBe("info");
    expect(action.href).toBe("/owner-v2/stores/new");
  });

  it("returns ready/success when all prerequisites are met", () => {
    const action = computeOwnerCockpitNextAction([makeTenant()], makeOps());
    expect(action.tone).toBe("success");
    expect(action.title).toContain("พร้อมรอบถัดไป");
  });

  it("prioritises a JavaWS incident over missing schedule and signals", () => {
    const tenant = makeTenant({
      health: {
        ...makeTenant().health,
        notification_rules_enabled: 0,
        critical_business_signals: 3,
      },
    });
    const action = computeOwnerCockpitNextAction(
      [tenant],
      makeOps({ latest_javaws_failure: javaWsFailure(tenant.tenant_id) }),
    );
    expect(action.title).toContain("JavaWS");
    expect(action.tone).toBe("error");
    expect(action.tenant_id).toBe(tenant.tenant_id);
  });

  it("flags a stale worker before per-tenant checks", () => {
    const action = computeOwnerCockpitNextAction(
      [makeTenant()],
      makeOps({ worker: { status: "missing" } }),
    );
    expect(action.title).toContain("worker");
    expect(action.tone).toBe("error");
  });

  it("reports blocked access before datasource checks", () => {
    const tenant = makeTenant({
      access_enabled: false,
      access_message: "ร้านถูกระงับ",
      status: "suspended",
    });
    const action = computeOwnerCockpitNextAction([tenant], makeOps());
    expect(action.title).toContain("สิทธิ์");
    expect(action.tenant_id).toBe(tenant.tenant_id);
  });

  it("asks to connect SML when datasource is missing", () => {
    const tenant = makeTenant({
      health: { ...makeTenant().health, datasource_configured: false },
    });
    const action = computeOwnerCockpitNextAction([tenant], makeOps());
    expect(action.title).toContain("SML");
    expect(action.tone).toBe("warning");
  });

  it("flags a LINE delivery problem", () => {
    const tenant = makeTenant({
      health: {
        ...makeTenant().health,
        line_channels: 0,
        line_targets_enabled: 0,
      },
    });
    const action = computeOwnerCockpitNextAction([tenant], makeOps());
    expect(action.title).toContain("LINE");
  });

  it("flags a missing schedule when LINE is ready", () => {
    const tenant = makeTenant({
      health: { ...makeTenant().health, notification_rules_enabled: 0 },
    });
    const action = computeOwnerCockpitNextAction([tenant], makeOps());
    expect(action.title).toContain("แผน");
  });

  it("flags a failed scheduled round", () => {
    const tenant = makeTenant({
      health: {
        ...makeTenant().health,
        latest_notification_run_status: "failed",
      },
    });
    const action = computeOwnerCockpitNextAction([tenant], makeOps());
    expect(action.title).toContain("ล้มเหลว");
    expect(action.tone).toBe("error");
  });

  it("flags open critical business signals", () => {
    const tenant = makeTenant({
      health: {
        ...makeTenant().health,
        critical_business_signals: 2,
        open_business_signals: 2,
      },
    });
    const action = computeOwnerCockpitNextAction([tenant], makeOps());
    expect(action.title).toContain("business signal");
  });

  it("flags incomplete proof when latest round did not succeed", () => {
    const tenant = makeTenant({
      health: {
        ...makeTenant().health,
        latest_notification_run_status: "queued",
        latest_line_delivery_status: null,
      },
    });
    const action = computeOwnerCockpitNextAction([tenant], makeOps());
    expect(action.title).toContain("proof");
    expect(action.tone).toBe("info");
  });

  it("warns about missing Telegram ops target when otherwise ready", () => {
    const action = computeOwnerCockpitNextAction(
      [makeTenant()],
      makeOps({
        telegram: { configured: true, targets: [] },
      }),
    );
    expect(action.title).toContain("Telegram");
    expect(action.tone).toBe("success");
  });

  it("picks the highest severity when several tenants differ", () => {
    const ready = makeTenant({ tenant_id: "ready", tenant_name: "พร้อม" });
    const broken = makeTenant({
      tenant_id: "broken",
      tenant_name: "เสีย",
      health: {
        ...makeTenant().health,
        latest_notification_run_status: "failed",
      },
    });
    const action = computeOwnerCockpitNextAction(
      [ready, broken],
      makeOps(),
    );
    expect(action.tenant_id).toBe("broken");
    expect(action.tone).toBe("error");
  });
});

describe("computeOwnerCockpitHealthMatrixRow", () => {
  it("builds success cells for a healthy tenant", () => {
    const row = computeOwnerCockpitHealthMatrixRow(makeTenant(), null);
    expect(row.sml.tone).toBe("success");
    expect(row.line.tone).toBe("success");
    expect(row.schedule.tone).toBe("success");
    expect(row.proof.tone).toBe("success");
    expect(row.incident.tone).toBe("success");
    expect(row.signals.tone).toBe("success");
    expect(row.href).toBe("/owner-v2/stores/tenant_a");
  });

  it("marks an incident when the tenant matches latest JavaWS failure", () => {
    const tenant = makeTenant({ tenant_id: "tenant_incident" });
    const row = computeOwnerCockpitHealthMatrixRow(
      tenant,
      javaWsFailure("tenant_incident"),
    );
    expect(row.incident.tone).toBe("error");
    expect(row.next_action_label).toContain("JavaWS");
  });

  it("shows critical tone for open critical signals", () => {
    const tenant = makeTenant({
      health: {
        ...makeTenant().health,
        critical_business_signals: 1,
        open_business_signals: 1,
      },
    });
    const row = computeOwnerCockpitHealthMatrixRow(tenant, null);
    expect(row.signals.tone).toBe("error");
  });
});

describe("deriveProductionProofStrip", () => {
  const now = new Date("2026-06-18T05:00:00.000Z"); // 12:00 Bangkok

  it("marks every day missing when there are no runs", () => {
    const strip = deriveProductionProofStrip({
      tenant_id: "tenant_a",
      eligible: true,
      runs: [],
      deliveries: [],
      now,
    });
    expect(strip.days).toHaveLength(7);
    expect(strip.days.every((day) => day.status === "missing")).toBe(true);
    expect(strip.missing_round_count).toBe(7);
    expect(strip.evidence_count).toBe(0);
  });

  it("counts a successful day when a scheduled run produced a sent delivery", () => {
    const strip = deriveProductionProofStrip({
      tenant_id: "tenant_a",
      eligible: true,
      runs: [
        {
          tenant_id: "tenant_a",
          status: "success",
          source: "worker_due",
          mode: "send",
          started_at: "2026-06-18T01:00:00.000Z",
          finished_at: "2026-06-18T01:02:00.000Z",
        },
      ],
      deliveries: [
        {
          tenant_id: "tenant_a",
          status: "success",
          delivery_type: "notification_rule",
          sent_at: "2026-06-18T01:05:00.000Z",
        },
      ],
      now,
    });
    const today = strip.days[6];
    expect(today.status).toBe("success");
    expect(strip.evidence_count).toBe(1);
    expect(strip.scheduled_run_count).toBe(1);
    expect(strip.line_delivery_success_count).toBe(1);
    expect(strip.latest_success_at).toBe("2026-06-18T01:05:00.000Z");
  });

  it("marks a day failed when a round ran but delivery failed", () => {
    const strip = deriveProductionProofStrip({
      tenant_id: "tenant_a",
      eligible: true,
      runs: [
        {
          tenant_id: "tenant_a",
          status: "success",
          source: "worker_due",
          mode: "send",
          started_at: "2026-06-18T01:00:00.000Z",
          finished_at: "2026-06-18T01:02:00.000Z",
        },
      ],
      deliveries: [
        {
          tenant_id: "tenant_a",
          status: "failed",
          delivery_type: "notification_rule",
          sent_at: "2026-06-18T01:05:00.000Z",
        },
      ],
      now,
    });
    expect(strip.days[6].status).toBe("failed");
    expect(strip.scheduled_failed_count).toBe(0); // run succeeded, delivery failed
    expect(strip.line_delivery_success_count).toBe(0);
    expect(strip.latest_problem_at).toBe("2026-06-18T01:05:00.000Z");
  });

  it("ignores dry-run and manual runs", () => {
    const strip = deriveProductionProofStrip({
      tenant_id: "tenant_a",
      eligible: true,
      runs: [
        {
          tenant_id: "tenant_a",
          status: "success",
          source: "manual",
          mode: "dry_run",
          started_at: "2026-06-18T01:00:00.000Z",
          finished_at: "2026-06-18T01:02:00.000Z",
        },
      ],
      deliveries: [],
      now,
    });
    expect(strip.days[6].status).toBe("missing");
  });

  it("ignores non-notification deliveries", () => {
    const strip = deriveProductionProofStrip({
      tenant_id: "tenant_a",
      eligible: true,
      runs: [
        {
          tenant_id: "tenant_a",
          status: "success",
          source: "worker_due",
          mode: "send",
          started_at: "2026-06-18T01:00:00.000Z",
          finished_at: "2026-06-18T01:02:00.000Z",
        },
      ],
      deliveries: [
        {
          tenant_id: "tenant_a",
          status: "success",
          delivery_type: "manual",
          sent_at: "2026-06-18T01:05:00.000Z",
        },
      ],
      now,
    });
    expect(strip.days[6].status).toBe("partial");
  });

  it("produces 7 ascending day buckets across Bangkok days", () => {
    const strip = deriveProductionProofStrip({
      tenant_id: "tenant_a",
      eligible: true,
      runs: [],
      deliveries: [],
      now,
    });
    expect(strip.days.map((day) => day.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(strip.days[6].date).toBe("2026-06-18");
    expect(strip.days[0].date).toBe("2026-06-12");
  });
});
