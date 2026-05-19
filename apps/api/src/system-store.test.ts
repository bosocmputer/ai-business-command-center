import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LineDeliveryRecord, ReportRunRecord, Tenant } from "@ai-bcc/shared";
import { createSystemStore } from "./system-store.js";

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
    await secondStore.close();
  });
});
