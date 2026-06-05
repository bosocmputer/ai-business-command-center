import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BusinessSignalRecord,
  LineDeliveryRecord,
  NotificationRuleRecord,
  NotificationRuleRunRecord,
  ReportRunRecord,
  Tenant,
} from "@ai-bcc/shared";
import { createSystemStore } from "./system-store.js";
import {
  applyLineAccessProfileDefaults,
  buildEnvFallbackLineTarget,
} from "./line-targets.js";

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.SYSTEM_DATABASE_URL;
  delete process.env.SYSTEM_STORE_FILE;
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("local JSON system store", () => {
  it("persists report runs, snapshots, and audit logs across restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-bcc-store-"));
    tempDirs.push(dir);
    process.env.SYSTEM_STORE_FILE = join(dir, "system-store.json");

    const tenants: Tenant[] = [
      {
        id: "tenant_demo_remote",
        name: "Demo Remote",
        databaseName: "demo",
        description: "test",
        datasourceConfigured: false,
        status: "active",
        planCode: "business",
        suspendedReason: null,
        currentPeriodEnd: null,
      },
    ];

    const firstStore = createSystemStore();
    await firstStore.initialize({
      tenants,
      reportDefinitions: [
        {
          report_key: "sales_goods_services",
          name: "Sales Goods and Services",
          version: "0.1.0",
          contract_json: {},
        },
      ],
    });

    const latest = await firstStore.getLatestSnapshot("tenant_demo_remote");
    expect(latest?.tenant_id).toBe("tenant_demo_remote");
    await expect(
      firstStore.getSnapshotByRunId(
        "tenant_demo_remote",
        latest?.run_id ?? "missing",
      ),
    ).resolves.toMatchObject({
      tenant_id: "tenant_demo_remote",
      run_id: latest?.run_id,
    });

    const run: ReportRunRecord = {
      id: "run_persisted",
      tenant_id: "tenant_demo_remote",
      report_key: "sales_goods_services",
      params: { date_from: "2026-05-10", date_to: "2026-05-19" },
      status: "failed",
      started_at: "2026-05-19T01:00:00.000Z",
      finished_at: "2026-05-19T01:00:01.000Z",
      row_count: 0,
      safe_error_message: "test failure",
    };

    await firstStore.upsertRun(run);
    const delivery: LineDeliveryRecord = {
      id: "line_persisted",
      tenant_id: "tenant_demo_remote",
      report_key: "sales_goods_services",
      report_run_id: run.id,
      delivery_key:
        "tenant_demo_remote:sales_goods_services:morning_brief:2026-05-10:2026-05-10",
      delivery_type: "morning_brief",
      period_from: "2026-05-10",
      period_to: "2026-05-10",
      target_id_masked: "C123...cdef",
      message_type: "text",
      status: "success",
      sent_at: "2026-05-19T01:00:02.000Z",
      provider_response_json: {},
      safe_error_message: null,
      created_at: "2026-05-19T01:00:02.000Z",
    };
    await firstStore.saveLineDelivery(delivery);
    const lineTarget = buildEnvFallbackLineTarget({
      tenantId: "tenant_demo_remote",
      config: {
        channelAccessToken: "line-token",
        targetId: "C1234567890abcdef1234567890abcdef",
        targetType: "group",
      },
    });
    await firstStore.upsertLineTarget({
      ...lineTarget,
      id: "line_target_persisted",
      source: "manual",
      display_name: "Executive Group",
    });
    await firstStore.saveWorkerHeartbeat({
      worker_id: "worker_morning_brief_1",
      role: "morning_brief_scheduler",
      status: "ok",
      metadata_json: { enabled: true, runAt: "08:00" },
      checked_at: "2026-05-19T01:00:03.000Z",
    });
    const notificationRule: NotificationRuleRecord = {
      id: "notification_rule_persisted",
      tenant_id: "tenant_demo_remote",
      name: "Daily digest",
      enabled: true,
      timezone: "Asia/Bangkok",
      period_preset: "yesterday",
      schedule: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], times: ["08:00"] }],
      report_keys: ["sales_goods_services"],
      target_ids: ["line_target_persisted"],
      message_packaging: "digest",
      digest_mode: "action_only",
      retry_policy: { max_attempts: 2, retry_delay_minutes: 3 },
      last_run_at: null,
      last_run_status: null,
      last_safe_error_message: null,
      created_at: "2026-05-19T01:00:05.000Z",
      updated_at: "2026-05-19T01:00:05.000Z",
    };
    await firstStore.upsertNotificationRule(notificationRule);
    const notificationRun: NotificationRuleRunRecord = {
      id: "notification_run_persisted",
      rule_id: notificationRule.id,
      tenant_id: "tenant_demo_remote",
      scheduled_local_date: "2026-05-19",
      scheduled_local_time: "08:00",
      timezone: "Asia/Bangkok",
      period_from: "2026-05-18",
      period_to: "2026-05-18",
      status: "failed",
      attempt: 1,
      idempotency_key:
        "notification_rule:notification_rule_persisted:2026-05-19:08:00:1",
      report_run_ids: [run.id],
      delivery_ids: [delivery.id],
      safe_error_message: "LINE push failed with status 500.",
      started_at: "2026-05-19T01:00:06.000Z",
      finished_at: "2026-05-19T01:00:07.000Z",
      next_retry_at: "2026-05-19T01:03:07.000Z",
      created_at: "2026-05-19T01:00:06.000Z",
      updated_at: "2026-05-19T01:00:07.000Z",
    };
    await firstStore.upsertNotificationRuleRun(notificationRun);
    await firstStore.upsertSecretRecord({
      id: "secret_datasource_password",
      tenant_id: "tenant_demo_remote",
      scope: "datasource",
      secret_key: "sml_password",
      encrypted_value: "v1.encrypted-envelope",
      encryption_key_id: "test-key",
      metadata_json: { host: "masked-host", username_masked: "po...es" },
      created_at: "2026-05-19T01:00:04.000Z",
      updated_at: "2026-05-19T01:00:04.000Z",
    });
    await firstStore.appendAuditLog({
      tenant_id: "tenant_demo_remote",
      actor_id: null,
      action: "report_run_failed",
      target_type: "report_run",
      target_id: run.id,
      metadata_json: { report_key: "sales_goods_services" },
    });
    await firstStore.close();

    const secondStore = createSystemStore();
    await secondStore.initialize({
      tenants,
      reportDefinitions: [
        {
          report_key: "sales_goods_services",
          name: "Sales Goods and Services",
          version: "0.1.0",
          contract_json: {},
        },
      ],
    });

    await expect(secondStore.listRuns("tenant_demo_remote")).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: run.id })]),
    );
    await expect(secondStore.listAuditLogs(10)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "report_run_failed" }),
      ]),
    );
    await expect(
      secondStore.findSuccessfulLineDeliveryByKey({
        tenantId: "tenant_demo_remote",
        deliveryKey: delivery.delivery_key ?? "",
      }),
    ).resolves.toMatchObject({
      id: "line_persisted",
      delivery_type: "morning_brief",
        period_from: "2026-05-10",
      });
    await expect(secondStore.listLineTargets("tenant_demo_remote")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "line_target_persisted",
          display_name: "Executive Group",
          target_id_masked: "C1234...bcdef",
          access_profile_key: "executive",
        }),
      ]),
    );
    await expect(
      secondStore.getLatestWorkerHeartbeat("morning_brief_scheduler"),
    ).resolves.toMatchObject({
      worker_id: "worker_morning_brief_1",
      role: "morning_brief_scheduler",
      status: "ok",
      checked_at: "2026-05-19T01:00:03.000Z",
    });
    await expect(
      secondStore.getSecretRecord("secret_datasource_password"),
    ).resolves.toMatchObject({
      tenant_id: "tenant_demo_remote",
      scope: "datasource",
      secret_key: "sml_password",
      encrypted_value: "v1.encrypted-envelope",
    });
    const secretMetadata = await secondStore.listSecretMetadata(
      "tenant_demo_remote",
    );
    expect(secretMetadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "secret_datasource_password",
          has_encrypted_value: true,
        }),
      ]),
    );
    expect(JSON.stringify(secretMetadata)).not.toContain("v1.encrypted-envelope");
    await expect(
      secondStore.listNotificationRules("tenant_demo_remote"),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: notificationRule.id,
          message_packaging: "digest",
          digest_mode: "action_only",
          report_keys: ["sales_goods_services"],
        }),
      ]),
    );
    await expect(
      secondStore.getNotificationRuleRunByKey(notificationRun.idempotency_key),
    ).resolves.toMatchObject({
      id: notificationRun.id,
      status: "failed",
      next_retry_at: "2026-05-19T01:03:07.000Z",
    });
    await secondStore.close();
  });

  it("soft cancels tenants, disables enabled notification rules, and keeps history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-bcc-store-"));
    tempDirs.push(dir);
    process.env.SYSTEM_STORE_FILE = join(dir, "system-store.json");

    const tenants: Tenant[] = [
      {
        id: "tenant_demo_remote",
        name: "Demo Remote",
        databaseName: "demo",
        description: "test",
        datasourceConfigured: true,
        status: "active",
        planCode: "business",
        suspendedReason: null,
        currentPeriodEnd: null,
      },
    ];
    const store = createSystemStore();
    await store.initialize({
      tenants,
      reportDefinitions: [
        {
          report_key: "sales_goods_services",
          name: "Sales Goods and Services",
          version: "0.1.0",
          contract_json: {},
        },
      ],
    });

    const target = buildEnvFallbackLineTarget({
      tenantId: "tenant_demo_remote",
      config: {
        channelAccessToken: "line-token",
        targetId: "U1234567890abcdef1234567890abcdef",
        targetType: "user",
      },
    });
    await store.upsertLineTarget({
      ...target,
      id: "line_target_exec",
      source: "manual",
      display_name: "Executive",
    });

    const enabledRule: NotificationRuleRecord = {
      id: "notification_rule_enabled",
      tenant_id: "tenant_demo_remote",
      name: "Daily digest",
      enabled: true,
      timezone: "Asia/Bangkok",
      period_preset: "yesterday",
      schedule: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], times: ["08:00"] }],
      report_keys: ["sales_goods_services"],
      target_ids: ["line_target_exec"],
      message_packaging: "digest",
      digest_mode: "action_only",
      retry_policy: { max_attempts: 2, retry_delay_minutes: 3 },
      last_run_at: null,
      last_run_status: null,
      last_safe_error_message: null,
      created_at: "2026-06-02T01:00:00.000Z",
      updated_at: "2026-06-02T01:00:00.000Z",
    };
    await store.upsertNotificationRule(enabledRule);
    await store.upsertNotificationRule({
      ...enabledRule,
      id: "notification_rule_disabled",
      enabled: false,
    });

    const run: ReportRunRecord = {
      id: "run_before_cancel",
      tenant_id: "tenant_demo_remote",
      report_key: "sales_goods_services",
      params: { date_from: "2026-06-01", date_to: "2026-06-01" },
      status: "success",
      started_at: "2026-06-02T01:01:00.000Z",
      finished_at: "2026-06-02T01:01:05.000Z",
      row_count: 1,
      safe_error_message: null,
    };
    await store.upsertRun(run);

    const result = await store.cancelTenant({
      tenantId: "tenant_demo_remote",
      reason: "ลูกค้ายกเลิก pilot",
      cancelledAt: "2026-06-02T02:00:00.000Z",
    });

    expect(result).toMatchObject({
      disabledNotificationRuleCount: 1,
      alreadyCancelled: false,
      tenant: {
        id: "tenant_demo_remote",
        status: "cancelled",
        suspendedReason: "ลูกค้ายกเลิก pilot",
      },
    });
    await expect(store.listNotificationRules("tenant_demo_remote")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "notification_rule_enabled",
          enabled: false,
          updated_at: "2026-06-02T02:00:00.000Z",
        }),
        expect.objectContaining({
          id: "notification_rule_disabled",
          enabled: false,
        }),
      ]),
    );
    await expect(store.listLineTargets("tenant_demo_remote")).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "line_target_exec" })]),
    );
    await expect(store.listRuns("tenant_demo_remote")).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: run.id })]),
    );
    await expect(
      store.getLatestSnapshot("tenant_demo_remote"),
    ).resolves.toMatchObject({ tenant_id: "tenant_demo_remote" });

    const secondResult = await store.cancelTenant({
      tenantId: "tenant_demo_remote",
      reason: "กดซ้ำ",
      cancelledAt: "2026-06-02T03:00:00.000Z",
    });
    expect(secondResult).toMatchObject({
      disabledNotificationRuleCount: 0,
      alreadyCancelled: true,
      tenant: { status: "cancelled", suspendedReason: "ลูกค้ายกเลิก pilot" },
    });

    await store.close();
  });

  it("saves tenant report role permissions and syncs existing LINE targets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-bcc-store-"));
    tempDirs.push(dir);
    process.env.SYSTEM_STORE_FILE = join(dir, "system-store.json");

    const tenants: Tenant[] = [
      {
        id: "tenant_demo_remote",
        name: "Demo Remote",
        databaseName: "demo",
        description: "test",
        datasourceConfigured: false,
        status: "active",
        planCode: "business",
        suspendedReason: null,
        currentPeriodEnd: null,
      },
    ];
    const store = createSystemStore();
    await store.initialize({
      tenants,
      reportDefinitions: [
        {
          report_key: "sales_goods_services",
          name: "Sales Goods and Services",
          version: "0.1.0",
          contract_json: {},
        },
        {
          report_key: "purchase_goods_payables",
          name: "Purchase Goods and Payables",
          version: "0.1.0",
          contract_json: {},
        },
      ],
    });

    const executiveTarget = buildEnvFallbackLineTarget({
      tenantId: "tenant_demo_remote",
      config: {
        channelAccessToken: "line-token",
        targetId: "U1234567890abcdef1234567890abcdef",
        targetType: "user",
      },
    });
    const salesTarget = applyLineAccessProfileDefaults(
      buildEnvFallbackLineTarget({
        tenantId: "tenant_demo_remote",
        config: {
          channelAccessToken: "line-token",
          targetId: "Uabcdef1234567890abcdef1234567890",
          targetType: "user",
        },
      }),
      "sales_manager",
    );
    await store.upsertLineTarget({
      ...executiveTarget,
      id: "line_target_exec",
      source: "manual",
    });
    await store.upsertLineTarget({
      ...salesTarget,
      id: "line_target_sales",
      source: "manual",
    });

    const saved = await store.saveTenantReportRolePermissions({
      tenantId: "tenant_demo_remote",
      permissions: [
        {
          tenant_id: "tenant_demo_remote",
          access_profile_key: "executive",
          allowed_report_keys: ["purchase_goods_payables"],
          updated_at: "2026-06-02T04:00:00.000Z",
        },
        {
          tenant_id: "tenant_demo_remote",
          access_profile_key: "sales_manager",
          allowed_report_keys: ["sales_goods_services", "purchase_goods_payables"],
          updated_at: "2026-06-02T04:00:00.000Z",
        },
        {
          tenant_id: "tenant_demo_remote",
          access_profile_key: "operations",
          allowed_report_keys: [],
          updated_at: "2026-06-02T04:00:00.000Z",
        },
        {
          tenant_id: "tenant_demo_remote",
          access_profile_key: "staff",
          allowed_report_keys: [],
          updated_at: "2026-06-02T04:00:00.000Z",
        },
      ],
    });

    expect(saved.updatedTargetCount).toBe(2);
    await expect(
      store.listTenantReportRolePermissions("tenant_demo_remote"),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          access_profile_key: "executive",
          allowed_report_keys: ["purchase_goods_payables"],
        }),
      ]),
    );
    await expect(store.listLineTargets("tenant_demo_remote")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "line_target_exec",
          allowed_report_keys: ["purchase_goods_payables"],
        }),
        expect.objectContaining({
          id: "line_target_sales",
          allowed_report_keys: [
            "sales_goods_services",
            "purchase_goods_payables",
          ],
        }),
      ]),
    );

    await store.close();
  });

  it("persists business signals idempotently and keeps priority ordering", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-bcc-store-"));
    tempDirs.push(dir);
    process.env.SYSTEM_STORE_FILE = join(dir, "system-store.json");

    const tenants: Tenant[] = [
      {
        id: "tenant_demo_remote",
        name: "Demo Remote",
        databaseName: "demo",
        description: "test",
        datasourceConfigured: true,
        status: "active",
        planCode: "business",
        suspendedReason: null,
        currentPeriodEnd: null,
      },
    ];
    const store = createSystemStore();
    await store.initialize({
      tenants,
      reportDefinitions: [
        {
          report_key: "gross_profit_by_product",
          name: "Gross Profit by Product",
          version: "0.1.0",
          contract_json: {},
        },
      ],
    });

    const baseSignal: BusinessSignalRecord = {
      id: "business_signal_gp_low_margin",
      tenant_id: "tenant_demo_remote",
      signal_key: "gross_profit_by_product:low_margin",
      category: "profit",
      severity: "warning",
      title: "Margin สินค้าต่ำ",
      insight: "อัตรากำไรขั้นต้นต่ำกว่าเกณฑ์",
      recommended_action: "ตรวจสินค้าที่ margin ต่ำ",
      amount_impact: null,
      source_report_key: "gross_profit_by_product",
      source_run_id: "run_gp_1",
      period_from: "2026-06-01",
      period_to: "2026-06-01",
      dimension_type: "report",
      dimension_id: "gross_profit_by_product",
      rule_version: "business_signals_v1",
      status: "open",
      evidence_json: { gross_margin_percent: 3.2 },
      created_at: "2026-06-02T04:00:00.000Z",
      updated_at: "2026-06-02T04:00:00.000Z",
    };

    await store.upsertBusinessSignals([baseSignal]);
    await store.upsertBusinessSignals([
      {
        ...baseSignal,
        id: "business_signal_gp_low_margin_new_id",
        severity: "critical",
        title: "Margin สินค้าต่ำมาก",
        amount_impact: 5000,
        updated_at: "2026-06-02T05:00:00.000Z",
      },
    ]);

    await expect(
      store.listBusinessSignals({
        tenantId: "tenant_demo_remote",
        status: "open",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "business_signal_gp_low_margin",
        severity: "critical",
        title: "Margin สินค้าต่ำมาก",
        amount_impact: 5000,
      }),
    ]);

    await expect(
      store.updateBusinessSignalStatus({
        tenantId: "tenant_demo_remote",
        signalId: "business_signal_gp_low_margin",
        status: "resolved",
        updatedAt: "2026-06-02T06:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      id: "business_signal_gp_low_margin",
      status: "resolved",
      updated_at: "2026-06-02T06:00:00.000Z",
    });
    await expect(
      store.listBusinessSignals({
        tenantId: "tenant_demo_remote",
        status: "open",
      }),
    ).resolves.toEqual([]);
    await expect(
      store.listBusinessSignals({
        tenantId: "tenant_demo_remote",
        status: "resolved",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "business_signal_gp_low_margin",
        status: "resolved",
      }),
    ]);

    await store.close();
  });
});
