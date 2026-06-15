import type { PlanCode, TenantId, TenantStatus } from "@ai-bcc/shared";

export type TenantCreateDryRunPreview = {
  will_mutate: false;
  tenant_id: TenantId;
  name: string;
  status: TenantStatus;
  plan_code: PlanCode;
  viewer_email: string;
  dashboard_path: string;
  will_create_user_id: string;
  checks: Array<{
    key: string;
    label: string;
    ok: boolean;
    detail: string;
  }>;
  next_action: {
    label: string;
    href: string;
    detail: string;
  };
  warnings: string[];
};

export function buildTenantCreateDryRunPreview(input: {
  dashboardPath: string;
  duplicateTenantName?: string | null;
  name: string;
  planCode: PlanCode;
  status: TenantStatus;
  tenantId: TenantId;
  viewerEmail?: string | null;
}): TenantCreateDryRunPreview {
  const viewerEmail =
    input.viewerEmail?.trim() || `viewer+${input.tenantId}@ai-business.local`;
  const duplicateTenantName = input.duplicateTenantName?.trim();
  const checks = [
    {
      key: "tenant_id_unique",
      label: "tenant_id ไม่ซ้ำ",
      ok: !duplicateTenantName,
      detail: duplicateTenantName
        ? `ซ้ำกับร้าน ${duplicateTenantName}`
        : "พร้อมใช้เป็นรหัสหลักของร้านนี้",
    },
    {
      key: "dashboard_link",
      label: "dashboard link",
      ok: Boolean(input.dashboardPath),
      detail: input.dashboardPath
        ? `ลูกค้าจะเปิดได้ที่ ${input.dashboardPath}`
        : "ยังไม่มี path สำหรับ dashboard ลูกค้า",
    },
    {
      key: "viewer_user",
      label: "viewer เริ่มต้น",
      ok: Boolean(viewerEmail),
      detail: `ระบบจะสร้าง viewer ${viewerEmail}`,
    },
    {
      key: "secrets_not_saved",
      label: "ยังไม่บันทึก secret",
      ok: true,
      detail: "ขั้นนี้ไม่แตะ SML/LINE token ต้องตั้งค่าในหน้าที่เข้ารหัสถัดไป",
    },
  ];

  const warnings = [
    input.tenantId.startsWith("tenant_store_")
      ? "tenant_id นี้มาจากชื่อร้านที่แปลงเป็น fallback hash ควรแก้ให้อ่านง่ายก่อนสร้างจริง"
      : null,
    input.status === "active"
      ? "กำลังตั้งร้านเป็น active ตั้งแต่แรก ตรวจให้แน่ใจว่าพร้อมเปิด dashboard/LINE แล้ว"
      : null,
    duplicateTenantName
      ? "ยังสร้างไม่ได้จนกว่าจะเปลี่ยน tenant_id ให้ไม่ซ้ำ"
      : null,
  ].filter((warning): warning is string => Boolean(warning));

  return {
    will_mutate: false,
    tenant_id: input.tenantId,
    name: input.name,
    status: input.status,
    plan_code: input.planCode,
    viewer_email: viewerEmail,
    dashboard_path: input.dashboardPath,
    will_create_user_id: `user_${input.tenantId}_viewer`,
    checks,
    next_action: {
      label: "เชื่อม SML JavaWS",
      href: `/owner/sml-connections?tenant=${encodeURIComponent(input.tenantId)}`,
      detail:
        "หลังสร้างร้านจริง ขั้นต่อไปคือบันทึกและทดสอบ SML JavaWS ก่อนรันรายงาน",
    },
    warnings,
  };
}
