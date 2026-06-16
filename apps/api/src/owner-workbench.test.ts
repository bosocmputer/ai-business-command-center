import { describe, expect, it } from "vitest";
import {
  businessSignalThresholdsSchema,
  tenantFeatureFlagsSchema,
  type Tenant,
} from "@ai-bcc/shared";
import {
  collectOwnerWorkbenchSensitiveKeys,
  projectOwnerWorkbenchSelected,
  projectOwnerWorkbenchTenant,
  sanitizeWorkbenchDatasourceStatus,
} from "./owner-workbench.js";
import type { DatasourceConfigStatus } from "./tenant-secret-config.js";

const tenant: Tenant = {
  id: "tenant_krabi",
  name: "กระบี่",
  databaseName: "krabi",
  description: "",
  datasourceConfigured: true,
  status: "active",
  planCode: "business",
  featureFlags: tenantFeatureFlagsSchema.parse({}),
  businessSignalThresholds: businessSignalThresholdsSchema.parse({}),
  currentPeriodEnd: null,
  suspendedReason: null,
};

describe("owner workbench projection", () => {
  it("projects compact tenant readiness for the workbench", () => {
    const projected = projectOwnerWorkbenchTenant({
      tenant,
      customer_dashboard_path: "/app/krabi",
      access: {
        enabled: true,
        message: "บัญชีพร้อมใช้งาน",
      },
      health: {
        datasource_configured: true,
        line_targets_enabled: 2,
        notification_rules_enabled: 1,
        latest_report_status: "success",
        latest_notification_run_status: "success",
        critical_business_signals: 0,
      },
      setup_readiness: {
        ready: false,
        completed: 5,
        total: 6,
        next_action: {
          key: "notification_plan",
          ok: false,
          label: "มีแผนแจ้งเตือนที่เปิดใช้งาน",
          detail: "กำหนดรายงาน ผู้รับ วัน และเวลา",
          href: "/owner/notifications?tenant=tenant_krabi",
        },
        checks: [],
      },
    });

    expect(projected).toMatchObject({
      id: "tenant_krabi",
      name: "กระบี่",
      ready: false,
      completed_steps: 5,
      total_steps: 6,
      next_action: {
        key: "notification_plan",
        step: "notifications",
        action_label: "ตั้งแผน",
        href: "/owner-v2?tenant=tenant_krabi&step=notifications",
      },
    });
  });

  it("adds the report permission step without exposing legacy raw payloads", () => {
    const selected = projectOwnerWorkbenchSelected({
      tenant,
      customer_dashboard_path: "/app/krabi",
      access: {
        enabled: true,
        message: "บัญชีพร้อมใช้งาน",
      },
      health: {
        datasource_configured: true,
        line_targets_enabled: 2,
        notification_rules_enabled: 1,
        latest_report_status: "success",
        latest_notification_run_status: "success",
        critical_business_signals: 0,
      },
      setup_readiness: {
        ready: true,
        completed: 6,
        total: 6,
        next_action: null,
        checks: [
          {
            key: "sml_javaws",
            ok: true,
            label: "เชื่อม SML ผ่าน JavaWS",
            detail: "http://example.local:8080 · krabi",
            href: "/owner/sml-connections?tenant=tenant_krabi",
          },
        ],
      },
    });

    expect(selected.steps.map((step) => step.key)).toEqual([
      "sml_javaws",
      "report_permissions",
    ]);
    expect(selected.steps[0]?.detail).toBe(
      "เชื่อม SML JavaWS แล้ว ตรวจรายงานทดสอบถัดไป",
    );
    expect(collectOwnerWorkbenchSensitiveKeys(selected)).toEqual([]);
  });

  it("keeps datasource setup status safe for admin UI", () => {
    const datasource: DatasourceConfigStatus = {
      source: "encrypted_store",
      kind: "sml_javaws",
      host: null,
      port: null,
      database: "krabi",
      user: null,
      password_configured: true,
      base_url: "http://example.local:8080",
      webapp_path: "/SMLJavaWebService",
      endpoint: "DotNetFrameWork",
      config_file_name: "SMLConfigDATA.xml",
      query_method: "_queryCompress",
      auth_mode: "basic",
      auth_configured: true,
      encryption_configured: true,
      updated_at: "2026-06-16T00:00:00.000Z",
    };

    const projected = sanitizeWorkbenchDatasourceStatus(datasource);
    expect(projected).toEqual({
      source: "encrypted_store",
      kind: "sml_javaws",
      database: "krabi",
      config_file_name: "SMLConfigDATA.xml",
      auth_mode: "basic",
      auth_configured: true,
      password_configured: true,
      encryption_configured: true,
      updated_at: "2026-06-16T00:00:00.000Z",
    });
    expect(collectOwnerWorkbenchSensitiveKeys(projected)).toEqual([]);
    expect(projected).not.toHaveProperty("base_url");
    expect(projected).not.toHaveProperty("webapp_path");
    expect(projected).not.toHaveProperty("endpoint");
  });

  it("detects sensitive keys if a future endpoint accidentally includes them", () => {
    expect(
      collectOwnerWorkbenchSensitiveKeys({
        ok: true,
        nested: {
          channel_access_token: "secret",
          response_body: "<xml />",
          endpoint: "http://example.local:8080/SMLJavaWebService",
        },
      }),
    ).toEqual([
      "nested.channel_access_token",
      "nested.response_body",
      "nested.endpoint",
    ]);
  });
});
