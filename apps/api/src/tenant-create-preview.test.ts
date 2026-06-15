import { describe, expect, it } from "vitest";
import { buildTenantCreateDryRunPreview } from "./tenant-create-preview.js";

describe("tenant create dry-run preview", () => {
  it("describes the tenant create side effects without mutating data", () => {
    const preview = buildTenantCreateDryRunPreview({
      dashboardPath: "/app/tenant_krabi_shop",
      name: "Krabi Shop",
      planCode: "starter",
      status: "trial",
      tenantId: "tenant_krabi_shop",
      viewerEmail: null,
    });

    expect(preview).toMatchObject({
      will_mutate: false,
      tenant_id: "tenant_krabi_shop",
      dashboard_path: "/app/tenant_krabi_shop",
      viewer_email: "viewer+tenant_krabi_shop@ai-business.local",
      will_create_user_id: "user_tenant_krabi_shop_viewer",
      next_action: {
        label: "เชื่อม SML JavaWS",
        href: "/owner/sml-connections?tenant=tenant_krabi_shop",
      },
    });
    expect(preview.checks.map((check) => check.key)).toEqual([
      "tenant_id_unique",
      "dashboard_link",
      "viewer_user",
      "secrets_not_saved",
    ]);
  });

  it("flags duplicate and fallback tenant ids before a real create", () => {
    const preview = buildTenantCreateDryRunPreview({
      dashboardPath: "/app/tenant_store_abc123",
      duplicateTenantName: "Existing Shop",
      name: "ร้านใหม่",
      planCode: "business",
      status: "trial",
      tenantId: "tenant_store_abc123",
      viewerEmail: "owner@example.com",
    });

    expect(preview.checks.find((check) => check.key === "tenant_id_unique")).toMatchObject({
      ok: false,
      detail: "ซ้ำกับร้าน Existing Shop",
    });
    expect(preview.warnings).toEqual([
      "tenant_id นี้มาจากชื่อร้านที่แปลงเป็น fallback hash ควรแก้ให้อ่านง่ายก่อนสร้างจริง",
      "ยังสร้างไม่ได้จนกว่าจะเปลี่ยน tenant_id ให้ไม่ซ้ำ",
    ]);
  });
});
