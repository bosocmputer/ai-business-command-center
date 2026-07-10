import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BusinessSignalRecord,
  LineDeliveryRecord,
  NotificationRuleRecord,
  NotificationRuleRunRecord,
  ReportRunChunkRecord,
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
  it("binds report viewer tokens to one browser session and supports recovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-bcc-store-"));
    tempDirs.push(dir);
    process.env.SYSTEM_STORE_FILE = join(dir, "system-store.json");
    const store = createSystemStore();
    await store.initialize({ tenants: [], reportDefinitions: [] });
    const expiresAt = new Date(Date.now() + 60_000);

    await store.createViewerToken({
      tokenHash: "token-hash-1",
      tokenVersion: 2,
      tenantId: "tenant_demo_remote",
      reportKey: "sales_goods_services",
      runId: "run_1",
      jti: "jti_1",
      targetIdHash: "target-hash-1",
      expiresAt,
    });

    await expect(
      store.claimViewerToken({
        tokenHash: "token-hash-1",
        sessionId: "session-a",
      }),
    ).resolves.toMatchObject({ ok: true, newlyBound: true });
    await expect(
      store.claimViewerToken({
        tokenHash: "token-hash-1",
        sessionId: "session-a",
      }),
    ).resolves.toMatchObject({ ok: true, newlyBound: false });
    await expect(
      store.claimViewerToken({
        tokenHash: "token-hash-1",
        sessionId: "session-b",
      }),
    ).resolves.toEqual({ ok: false, reason: "session_mismatch" });
    await expect(
      store.getViewerSessionAccess({
        sessionId: "session-a",
        tenantId: "tenant_demo_remote",
        reportKey: "sales_goods_services",
      }),
    ).resolves.toMatchObject({ ok: true, token: { jti: "jti_1" } });

    await expect(
      store.updateViewerAccessForTarget({
        tenantId: "tenant_demo_remote",
        targetIdHash: "target-hash-1",
        action: "reset_binding",
      }),
    ).resolves.toBe(1);
    await expect(
      store.getViewerSessionAccess({
        sessionId: "session-a",
        tenantId: "tenant_demo_remote",
        reportKey: "sales_goods_services",
      }),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(
      store.claimViewerToken({
        tokenHash: "token-hash-1",
        sessionId: "session-b",
      }),
    ).resolves.toMatchObject({ ok: true, newlyBound: true });

    await expect(
      store.updateViewerAccessForTarget({
        tenantId: "tenant_demo_remote",
        targetIdHash: "target-hash-1",
        action: "revoke",
      }),
    ).resolves.toBe(1);
    await expect(
      store.getViewerSessionAccess({
        sessionId: "session-b",
        tenantId: "tenant_demo_remote",
        reportKey: "sales_goods_services",
      }),
    ).resolves.toEqual({ ok: false, reason: "revoked" });
    await expect(
      store.claimViewerToken({
        tokenHash: "token-hash-1",
        sessionId: "session-b",
      }),
    ).resolves.toEqual({ ok: false, reason: "revoked" });

    await store.close();
  });

  it("allows only one winner for concurrent report viewer claims", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-bcc-store-"));
    tempDirs.push(dir);
    process.env.SYSTEM_STORE_FILE = join(dir, "system-store.json");
    const store = createSystemStore();
    await store.initialize({ tenants: [], reportDefinitions: [] });

    await store.createViewerToken({
      tokenHash: "token-hash-concurrent",
      tokenVersion: 2,
      tenantId: "tenant_demo_remote",
      reportKey: "sales_goods_services",
      runId: "run_1",
      jti: "jti_concurrent",
      targetIdHash: "target-hash-concurrent",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        store.claimViewerToken({
          tokenHash: "token-hash-concurrent",
          sessionId: `session-${index}`,
        }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter(
        (result) => !result.ok && result.reason === "session_mismatch",
      ),
    ).toHaveLength(49);
    await store.close();
  });

  it("purges expired report viewer tokens in bounded batches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-bcc-store-"));
    tempDirs.push(dir);
    process.env.SYSTEM_STORE_FILE = join(dir, "system-store.json");
    const store = createSystemStore();
    await store.initialize({ tenants: [], reportDefinitions: [] });

    for (const index of [1, 2]) {
      await store.createViewerToken({
        tokenHash: `expired-${index}`,
        tokenVersion: 2,
        tenantId: "tenant_demo_remote",
        reportKey: "sales_goods_services",
        runId: `run_${index}`,
        jti: `expired_jti_${index}`,
        targetIdHash: "target-hash-expired",
        expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });
    }

    await expect(store.purgeExpiredViewerTokens(1)).resolves.toBe(1);
    await expect(store.purgeExpiredViewerTokens(100)).resolves.toBe(1);
    await expect(store.purgeExpiredViewerTokens(100)).resolves.toBe(0);
    await store.close();
  });

  it("deduplicates concurrent viewer mismatch audit entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-bcc-store-"));
    tempDirs.push(dir);
    process.env.SYSTEM_STORE_FILE = join(dir, "system-store.json");
    const store = createSystemStore();
    await store.initialize({ tenants: [], reportDefinitions: [] });

    const entry = {
      tenant_id: "tenant_demo_remote" as const,
      actor_id: null,
      action: "report_viewer_session_mismatch",
      target_type: "report_viewer_token",
      target_id: "jti_audit_once",
      metadata_json: {
        jti: "jti_audit_once",
        window_key: "2026-07-08T15",
      },
    };
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        store.appendAuditLogIfAbsent({
          entry,
          dedupeKey: "report_viewer_session_mismatch:jti_audit_once:2026-07-08T15",
        }),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(
      (await store.listAuditLogs(100)).filter(
        (log) => log.action === "report_viewer_session_mismatch",
      ),
    ).toHaveLength(1);
    await store.close();
  });

  it("does not overwrite an owner-edited tenant name when seeds are reloaded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-bcc-store-"));
    tempDirs.push(dir);
    process.env.SYSTEM_STORE_FILE = join(dir, "system-store.json");

    const seedTenant: Tenant = {
      id: "tenant_demo_remote",
      name: "DEMO SHOP",
      databaseName: "demo",
      description: "seed description",
      datasourceConfigured: false,
      status: "active",
      planCode: "business",
      suspendedReason: null,
      currentPeriodEnd: null,
      billingCycle: null,
    };

    const firstStore = createSystemStore();
    await firstStore.initialize({
      tenants: [seedTenant],
      reportDefinitions: [],
    });
    await firstStore.upsertTenant({
      ...seedTenant,
      name: "กระบี่",
      databaseName: "krabi",
      description: "owner edited",
    });
    await firstStore.close();

    const secondStore = createSystemStore();
    await secondStore.initialize({
      tenants: [seedTenant],
      reportDefinitions: [],
    });

    await expect(secondStore.listTenants()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tenant_demo_remote",
          name: "กระบี่",
          databaseName: "krabi",
          description: "owner edited",
        }),
      ]),
    );

    await secondStore.close();
  });

  it("preserves notification report order across JSON store restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-bcc-store-"));
    tempDirs.push(dir);
    process.env.SYSTEM_STORE_FILE = join(dir, "system-store.json");

    const tenant: Tenant = {
      id: "tenant_demo_remote",
      name: "Demo Remote",
      databaseName: "demo",
      description: "seed description",
      datasourceConfigured: false,
      status: "active",
      planCode: "business",
      suspendedReason: null,
      currentPeriodEnd: null,
      billingCycle: null,
    };
    const reportDefinitions = [
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
      {
        report_key: "cash_bank_payments",
        name: "Cash Bank Payments",
        version: "0.1.0",
        contract_json: {},
      },
    ] as const;

    const firstStore = createSystemStore();
    await firstStore.initialize({
      tenants: [tenant],
      reportDefinitions: [...reportDefinitions],
    });
    await firstStore.upsertNotificationRule({
      id: "notification_rule_ordered",
      tenant_id: tenant.id,
      name: "Ordered digest",
      enabled: true,
      timezone: "Asia/Bangkok",
      period_preset: "yesterday",
      period_strategy: "executive_checkpoints",
      schedule: [{ weekdays: [1], times: ["08:00"] }],
      report_keys: [
        "cash_bank_payments",
        "sales_goods_services",
        "cash_bank_payments",
        "purchase_goods_payables",
      ],
      target_ids: ["line_target_demo"],
      message_packaging: "digest",
      digest_mode: "all_reports",
      retry_policy: { max_attempts: 2, retry_delay_minutes: 3 },
      last_run_at: null,
      last_run_status: null,
      last_safe_error_message: null,
      created_at: "2026-06-24T01:00:00.000Z",
      updated_at: "2026-06-24T01:00:00.000Z",
    });
    await firstStore.close();

    const secondStore = createSystemStore();
    await secondStore.initialize({
      tenants: [tenant],
      reportDefinitions: [...reportDefinitions],
    });

    await expect(
      secondStore.getNotificationRule("notification_rule_ordered"),
    ).resolves.toMatchObject({
      report_keys: [
        "cash_bank_payments",
        "sales_goods_services",
        "purchase_goods_payables",
      ],
    });

    await secondStore.close();
  });

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
      billingCycle: null,
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
      firstStore.getLatestSnapshotByParams(
        "tenant_demo_remote",
        "sales_goods_services",
        latest?.params ?? { date_from: "2026-05-18", date_to: "2026-05-18" },
      ),
    ).resolves.toMatchObject({
      tenant_id: "tenant_demo_remote",
      report_key: "sales_goods_services",
    });
    await expect(
      firstStore.getLatestSnapshotByParams(
        "tenant_demo_remote",
        "sales_goods_services",
        { date_from: "2099-01-01", date_to: "2099-01-01" },
      ),
    ).resolves.toBeNull();
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
      period_strategy: "executive_checkpoints",
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
      period_from_time: null,
      period_to_time: null,
      period_strategy: "executive_checkpoints",
      unknown_doc_time_count: 0,
      status: "failed",
      mode: "send",
      source: "worker_due",
      attempt: 1,
      idempotency_key:
        "notification_rule:notification_rule_persisted:2026-05-19:08:00:1",
      report_run_ids: [run.id],
      report_results: [
        {
          report_key: "sales_goods_services",
          status: "failed",
          freshness: "unavailable",
          run_id: run.id,
          snapshot_generated_at: null,
          duration_ms: 1000,
          row_count: 0,
          degraded_reason: null,
        },
      ],
      delivery_ids: [delivery.id],
      safe_error_message: "LINE push failed with status 500.",
      started_at: "2026-05-19T01:00:06.000Z",
      finished_at: "2026-05-19T01:00:07.000Z",
      queued_at: null,
      claimed_at: null,
      worker_id: null,
      client_request_id: null,
      target_ids_override: null,
      next_retry_at: "2026-05-19T01:03:07.000Z",
      progress_stage: "failed",
      progress_percent: 100,
      progress_current_report_key: null,
      progress_done_reports: 0,
      progress_total_reports: 1,
      progress_updated_at: "2026-05-19T01:00:07.000Z",
      created_at: "2026-05-19T01:00:06.000Z",
      updated_at: "2026-05-19T01:00:07.000Z",
    };
    await firstStore.upsertNotificationRuleRun(notificationRun);
    await firstStore.upsertDashboardViewerToken({
      token_hash: "dashboard_token_hash",
      tenant_id: "tenant_demo_remote",
      source_run_id: run.id,
      jti: "dash_test_jti",
      scope_json: {
        allowed_report_keys: ["sales_goods_services"],
        max_date_window_days: 31,
        lookback_days: 31,
      },
      expires_at: "2026-05-20T01:00:00.000Z",
      revoked_at: null,
      last_used_at: null,
      created_at: "2026-05-19T01:00:08.000Z",
    });
    await firstStore.upsertExecutiveDashboardRun({
      id: "executive_dashboard_run_persisted",
      tenant_id: "tenant_demo_remote",
      token_hash: "dashboard_token_hash",
      token_jti: "dash_test_jti",
      source_run_id: run.id,
      params: { date_from: "2026-05-18", date_to: "2026-05-18" },
      report_keys: ["sales_goods_services"],
      status: "queued",
      report_run_ids: [],
      report_results: [],
      safe_error_message: null,
      queued_at: "2026-05-19T01:00:09.000Z",
      claimed_at: null,
      started_at: null,
      finished_at: null,
      worker_id: null,
      progress_stage: "queued",
      progress_percent: 5,
      progress_current_report_key: null,
      progress_done_reports: 0,
      progress_total_reports: 1,
      progress_updated_at: "2026-05-19T01:00:09.000Z",
      created_at: "2026-05-19T01:00:09.000Z",
      updated_at: "2026-05-19T01:00:09.000Z",
    });
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
    await firstStore.upsertSecretRecord({
      id: "secret_flowaccount_client_credentials",
      tenant_id: "tenant_demo_remote",
      scope: "flowaccount",
      secret_key: "client_credentials",
      encrypted_value: "v1.flowaccount-encrypted-envelope",
      encryption_key_id: "test-key",
      metadata_json: {
        environment: "sandbox",
        auth_mode: "client_credentials",
      },
      created_at: "2026-05-19T01:00:05.000Z",
      updated_at: "2026-05-19T01:00:05.000Z",
    });
    await firstStore.upsertFlowAccountConnection({
      tenant_id: "tenant_demo_remote",
      environment: "sandbox",
      auth_mode: "client_credentials",
      status: "connected",
      company_id: "company-123",
      support_code: null,
      access_token_expires_at: "2026-05-20T01:00:00.000Z",
      last_tested_at: "2026-05-19T01:00:05.000Z",
      last_error: null,
      created_at: "2026-05-19T01:00:05.000Z",
      updated_at: "2026-05-19T01:00:05.000Z",
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
      secondStore.findAuditLogByTenantActionAndMetadata({
        tenantId: "tenant_demo_remote",
        action: "report_run_failed",
        metadata: { report_key: "sales_goods_services" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        tenant_id: "tenant_demo_remote",
        action: "report_run_failed",
      }),
    );
    await expect(
      secondStore.findAuditLogByTenantActionAndMetadata({
        tenantId: "tenant_demo_remote",
        action: "report_run_failed",
        metadata: { report_key: "purchase_goods_payables" },
      }),
    ).resolves.toBeNull();
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
        expect.objectContaining({
          id: "secret_flowaccount_client_credentials",
          scope: "flowaccount",
          secret_key: "client_credentials",
          has_encrypted_value: true,
        }),
      ]),
    );
    expect(JSON.stringify(secretMetadata)).not.toContain("v1.encrypted-envelope");
    expect(JSON.stringify(secretMetadata)).not.toContain(
      "v1.flowaccount-encrypted-envelope",
    );
    await expect(
      secondStore.getFlowAccountConnection("tenant_demo_remote"),
    ).resolves.toMatchObject({
      tenant_id: "tenant_demo_remote",
      environment: "sandbox",
      auth_mode: "client_credentials",
      status: "connected",
      company_id: "company-123",
      access_token_expires_at: "2026-05-20T01:00:00.000Z",
    });
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
      report_results: [
        expect.objectContaining({
          report_key: "sales_goods_services",
          freshness: "unavailable",
        }),
      ],
    });
    await expect(
      secondStore.getDashboardViewerToken("dashboard_token_hash"),
    ).resolves.toMatchObject({
      tenant_id: "tenant_demo_remote",
      jti: "dash_test_jti",
      scope_json: expect.objectContaining({
        allowed_report_keys: ["sales_goods_services"],
      }),
    });
    await expect(
      secondStore.findActiveExecutiveDashboardRun({
        tenantId: "tenant_demo_remote",
        tokenHash: "dashboard_token_hash",
        params: { date_from: "2026-05-18", date_to: "2026-05-18" },
      }),
    ).resolves.toMatchObject({
      id: "executive_dashboard_run_persisted",
      status: "queued",
      progress_stage: "queued",
    });
    const claimedDashboardRun = await secondStore.claimExecutiveDashboardRun({
      runId: "executive_dashboard_run_persisted",
      claimedAt: "2026-05-19T01:00:10.000Z",
      workerId: "worker_dashboard",
    });
    expect(claimedDashboardRun).toMatchObject({
      id: "executive_dashboard_run_persisted",
      status: "running",
      worker_id: "worker_dashboard",
      progress_stage: "claimed",
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
      billingCycle: null,
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
      period_strategy: "executive_checkpoints",
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

  it("claims queued notification runs once and fails stale jobs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-bcc-store-"));
    tempDirs.push(dir);
    process.env.SYSTEM_STORE_FILE = join(dir, "system-store.json");

    const tenant: Tenant = {
      id: "tenant_demo_remote",
      name: "Demo Remote",
      databaseName: "demo",
      description: "test",
      datasourceConfigured: true,
      status: "active",
      planCode: "business",
      suspendedReason: null,
      currentPeriodEnd: null,
      billingCycle: null,
    };
    const store = createSystemStore();
    await store.initialize({
      tenants: [tenant],
      reportDefinitions: [
        {
          report_key: "sales_goods_services",
          name: "Sales Goods and Services",
          version: "0.1.0",
          contract_json: {},
        },
      ],
    });

    const rule: NotificationRuleRecord = {
      id: "notification_rule_queue",
      tenant_id: "tenant_demo_remote",
      name: "Queued digest",
      enabled: true,
      timezone: "Asia/Bangkok",
      period_preset: "yesterday",
      period_strategy: "executive_checkpoints",
      schedule: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], times: ["08:00"] }],
      report_keys: ["sales_goods_services"],
      target_ids: ["line_target_exec"],
      message_packaging: "digest",
      digest_mode: "action_only",
      retry_policy: { max_attempts: 2, retry_delay_minutes: 3 },
      last_run_at: null,
      last_run_status: null,
      last_safe_error_message: null,
      created_at: "2026-06-09T00:55:00.000Z",
      updated_at: "2026-06-09T00:55:00.000Z",
    };
    await store.upsertNotificationRule(rule);

    const queuedRun: NotificationRuleRunRecord = {
      id: "notification_run_queue",
      rule_id: rule.id,
      tenant_id: "tenant_demo_remote",
      scheduled_local_date: "2026-06-09",
      scheduled_local_time: "08:00",
      timezone: "Asia/Bangkok",
      period_from: "2026-06-08",
      period_to: "2026-06-08",
      period_from_time: "00:00",
      period_to_time: "23:59",
      period_strategy: "executive_checkpoints",
      unknown_doc_time_count: 0,
      status: "queued",
      mode: "send",
      source: "manual_run_now",
      attempt: 1,
      idempotency_key: "notification_rule:queue:2026-06-09:08:00:1:manual",
      report_run_ids: [],
      report_results: null,
      delivery_ids: [],
      safe_error_message: null,
      started_at: null,
      finished_at: null,
      queued_at: "2026-06-09T00:55:00.000Z",
      claimed_at: null,
      worker_id: null,
      client_request_id: "client-1",
      target_ids_override: null,
      next_retry_at: null,
      progress_stage: "queued",
      progress_percent: 5,
      progress_current_report_key: null,
      progress_done_reports: 0,
      progress_total_reports: 1,
      progress_updated_at: "2026-06-09T00:55:00.000Z",
      created_at: "2026-06-09T00:55:00.000Z",
      updated_at: "2026-06-09T00:55:00.000Z",
    };
    await store.upsertNotificationRuleRun(queuedRun);

    await expect(
      store.findActiveNotificationRuleRun({
        ruleId: rule.id,
        scheduledLocalDate: "2026-06-09",
        scheduledLocalTime: "08:00",
        mode: "send",
        source: "manual_run_now",
        clientRequestId: "client-1",
      }),
    ).resolves.toMatchObject({
      id: queuedRun.id,
      status: "queued",
      progress_stage: "queued",
      progress_percent: 5,
      progress_total_reports: 1,
    });
    const overrideRun: NotificationRuleRunRecord = {
      ...queuedRun,
      id: "notification_run_queue_target_override",
      status: "running",
      client_request_id: "client-2",
      target_ids_override: ["line_target_boss"],
      idempotency_key:
        "notification_rule:queue:2026-06-09:08:00:1:manual:line_target_boss",
      started_at: "2026-06-09T00:55:01.000Z",
      claimed_at: "2026-06-09T00:55:01.000Z",
      worker_id: "worker-override",
      progress_stage: "claimed",
      progress_percent: 10,
      created_at: "2026-06-09T00:55:01.000Z",
      updated_at: "2026-06-09T00:55:01.000Z",
    };
    await store.upsertNotificationRuleRun(overrideRun);
    await expect(
      store.findActiveNotificationRuleRun({
        ruleId: rule.id,
        scheduledLocalDate: "2026-06-09",
        scheduledLocalTime: "08:00",
        mode: "send",
        source: "manual_run_now",
        targetIdsOverride: ["line_target_boss"],
      }),
    ).resolves.toMatchObject({
      id: overrideRun.id,
      target_ids_override: ["line_target_boss"],
    });
    await expect(
      store.findActiveNotificationRuleRun({
        ruleId: rule.id,
        scheduledLocalDate: "2026-06-09",
        scheduledLocalTime: "08:00",
        mode: "send",
        source: "manual_run_now",
        targetIdsOverride: ["line_target_other"],
      }),
    ).resolves.toBeNull();
    await store.upsertNotificationRuleRun({
      ...overrideRun,
      status: "success",
      finished_at: "2026-06-09T00:55:02.000Z",
      progress_stage: "completed",
      progress_percent: 100,
      updated_at: "2026-06-09T00:55:02.000Z",
    });
    await expect(store.listQueuedNotificationRuleRuns(1)).resolves.toEqual([
      expect.objectContaining({ id: queuedRun.id }),
    ]);

    const claimed = await store.claimQueuedNotificationRuleRun({
      runId: queuedRun.id,
      claimedAt: "2026-06-09T00:55:05.000Z",
      workerId: "worker-test",
    });
    expect(claimed).toMatchObject({
      id: queuedRun.id,
      status: "running",
      worker_id: "worker-test",
      progress_stage: "claimed",
      progress_percent: 10,
    });
    await expect(
      store.claimQueuedNotificationRuleRun({
        runId: queuedRun.id,
        claimedAt: "2026-06-09T00:55:06.000Z",
        workerId: "worker-second",
      }),
    ).resolves.toBeNull();

    await store.upsertNotificationRuleRun({
      ...claimed!,
      progress_stage: "waiting_chunked_report",
      progress_percent: 32,
      progress_current_report_key: "stock_balance",
      progress_updated_at: "2026-06-09T00:55:05.000Z",
      report_run_ids: ["report_run_chunked_1"],
      updated_at: "2026-06-09T00:55:05.000Z",
    });
    await expect(store.listQueuedNotificationRuleRuns(1)).resolves.toEqual([]);
    await expect(
      store.listResumableNotificationRuleRuns({
        limit: 5,
        pollBefore: "2026-06-09T00:55:04.000Z",
      }),
    ).resolves.toEqual([]);
    await expect(
      store.listResumableNotificationRuleRuns({
        limit: 5,
        pollBefore: "2026-06-09T00:56:05.000Z",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: queuedRun.id,
        status: "running",
        progress_stage: "waiting_chunked_report",
        progress_current_report_key: "stock_balance",
        report_run_ids: ["report_run_chunked_1"],
      }),
    ]);

    const stale = await store.markStaleNotificationRuleRunsFailed({
      staleBefore: "2026-06-09T01:20:00.000Z",
      failedAt: "2026-06-09T01:20:01.000Z",
      safeErrorMessage: "stale",
    });
    expect(stale).toEqual([
      expect.objectContaining({
        id: queuedRun.id,
        status: "failed",
        safe_error_message: "stale",
        progress_stage: "failed",
        progress_percent: 100,
      }),
    ]);

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
      billingCycle: null,
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
      billingCycle: null,
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

  it("tracks chunked report runs and safely requeues stale chunks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-bcc-store-"));
    tempDirs.push(dir);
    process.env.SYSTEM_STORE_FILE = join(dir, "system-store.json");

    const tenant: Tenant = {
      id: "tenant_demo_remote",
      name: "Demo Remote",
      databaseName: "demo",
      description: "test",
      datasourceConfigured: true,
      status: "active",
      planCode: "business",
      suspendedReason: null,
      currentPeriodEnd: null,
      billingCycle: null,
    };
    const store = createSystemStore();
    await store.initialize({
      tenants: [tenant],
      reportDefinitions: [
        {
          report_key: "stock_balance",
          name: "Stock Balance",
          version: "0.1.0",
          contract_json: {},
        },
      ],
    });

    const queuedRun: ReportRunRecord = {
      id: "run_chunked_stock_1",
      tenant_id: tenant.id,
      report_key: "stock_balance",
      params: { date_from: "2026-06-01", date_to: "2026-06-10" },
      status: "queued",
      queued_at: "2026-06-10T01:00:00.000Z",
      claimed_at: null,
      worker_id: null,
      execution_strategy: "chunked",
      progress_stage: "queued",
      progress_percent: 0,
      progress_updated_at: "2026-06-10T01:00:00.000Z",
      started_at: "2026-06-10T01:00:00.000Z",
      finished_at: null,
      row_count: 0,
      safe_error_message: null,
    };
    await store.upsertRun(queuedRun);

    await expect(
      store.findActiveReportRun({
        tenantId: tenant.id,
        reportKey: "stock_balance",
        params: queuedRun.params,
      }),
    ).resolves.toMatchObject({ id: queuedRun.id, status: "queued" });

    const claimed = await store.claimReportRun({
      runId: queuedRun.id,
      claimedAt: "2026-06-10T01:00:01.000Z",
      workerId: "worker_report_runs",
    });
    expect(claimed).toMatchObject({
      id: queuedRun.id,
      status: "running",
      worker_id: "worker_report_runs",
    });

    await store.upsertRun({
      ...queuedRun,
      id: "run_chunked_stock_2",
      queued_at: "2026-06-10T01:00:02.000Z",
      started_at: "2026-06-10T01:00:02.000Z",
    });
    await expect(
      store.claimReportRun({
        runId: "run_chunked_stock_2",
        claimedAt: "2026-06-10T01:00:03.000Z",
        workerId: "worker_report_runs",
      }),
    ).resolves.toBeNull();

    const chunk: ReportRunChunkRecord = {
      id: "chunk_1",
      tenant_id: tenant.id,
      report_run_id: queuedRun.id,
      report_key: "stock_balance",
      chunk_no: 1,
      chunk_key: "chunk_1_key",
      status: "running",
      attempt: 1,
      unit_start_index: 0,
      unit_count: 500,
      total_units: 1000,
      row_count: 0,
      cursor_from: null,
      cursor_to: "SKU-0500",
      started_at: "2026-06-10T01:00:00.000Z",
      finished_at: null,
      duration_ms: null,
      safe_error_message: null,
      metadata_json: { preflight_units: 500 },
      created_at: "2026-06-10T01:00:00.000Z",
      updated_at: "2026-06-10T01:00:00.000Z",
    };
    await store.upsertRunChunk(chunk);

    await expect(
      store.requeueStaleReportRunChunks({
        staleBefore: "2026-06-10T01:05:00.000Z",
        updatedAt: "2026-06-10T01:06:00.000Z",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "chunk_1",
        status: "queued",
        started_at: null,
      }),
    ]);
    await expect(store.listRunChunks(queuedRun.id)).resolves.toEqual([
      expect.objectContaining({
        chunk_no: 1,
        status: "queued",
        cursor_from: null,
        cursor_to: "SKU-0500",
        metadata_json: { preflight_units: 500 },
      }),
    ]);

    await store.close();
  });

  it("persists operational alert targets, deliveries, and local locks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-bcc-store-"));
    tempDirs.push(dir);
    process.env.SYSTEM_STORE_FILE = join(dir, "system-store.json");

    const store = createSystemStore();
    await store.initialize({ tenants: [], reportDefinitions: [] });

    await expect(
      store.upsertOperationalAlertTarget({
        id: "op_alert_tg_1",
        channel: "telegram",
        display_name: "Owner",
        target_id_encrypted: "encrypted-chat-id",
        target_id_masked: "12...7890",
        target_id_hash: "hash",
        enabled: true,
        created_at: "2026-06-12T03:00:00.000Z",
        updated_at: "2026-06-12T03:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      channel: "telegram",
      target_id_masked: "12...7890",
    });

    await expect(store.listOperationalAlertTargets("telegram")).resolves.toEqual([
      expect.objectContaining({ id: "op_alert_tg_1", enabled: true }),
    ]);

    await expect(
      store.saveOperationalAlertDelivery({
        id: "delivery_1",
        channel: "telegram",
        target_id_masked: "12...7890",
        alert_type: "javaws_failure",
        severity: "critical",
        status: "success",
        dedupe_key:
          "javaws_failure:tenant_demo_remote:rule_1:2026-06-12:08:00:sales_goods_services:critical",
        message_text: "แจ้งเตือน AI-BCC Ops",
        provider_response_json: { ok: true, message_id: 1 },
        safe_error_message: null,
        created_at: "2026-06-12T03:01:00.000Z",
        sent_at: "2026-06-12T03:01:01.000Z",
      }),
    ).resolves.toMatchObject({ status: "success" });

    await expect(
      store.findSuccessfulOperationalAlertDeliveryByDedupeKey({
        channel: "telegram",
        dedupeKey:
          "javaws_failure:tenant_demo_remote:rule_1:2026-06-12:08:00:sales_goods_services:critical",
      }),
    ).resolves.toMatchObject({ id: "delivery_1" });

    await expect(store.tryAcquireLock({ lockKey: "worker" })).resolves.toBe(true);
    await expect(store.tryAcquireLock({ lockKey: "worker" })).resolves.toBe(false);
    await store.releaseLock({ lockKey: "worker" });
    await expect(store.tryAcquireLock({ lockKey: "worker" })).resolves.toBe(true);

    await store.close();
  });
});
