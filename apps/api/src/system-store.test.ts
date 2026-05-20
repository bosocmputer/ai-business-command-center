import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LineDeliveryRecord, ReportRunRecord, Tenant } from "@ai-bcc/shared";
import { createSystemStore } from "./system-store.js";
import { buildEnvFallbackLineTarget } from "./line-targets.js";

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
    await secondStore.close();
  });
});
