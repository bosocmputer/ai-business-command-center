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
  const hasExplicitViewerEmail = Boolean(input.viewerEmail?.trim());
  const duplicateTenantName = input.duplicateTenantName?.trim();
  const checks = [
    {
      key: "tenant_id_unique",
      label: "รหัสร้านไม่ซ้ำ",
      ok: !duplicateTenantName,
      detail: duplicateTenantName
        ? `ซ้ำกับร้าน ${duplicateTenantName}`
        : "พร้อมใช้เป็นรหัสร้านสำหรับตั้งค่าระบบ",
    },
    {
      key: "dashboard_link",
      label: "หน้าแดชบอร์ดพร้อม",
      ok: Boolean(input.dashboardPath),
      detail: input.dashboardPath
        ? "ระบบจะสร้างหน้าสำหรับเปิดแดชบอร์ดของร้านนี้"
        : "ยังไม่พบเส้นทางสำหรับหน้าแดชบอร์ดของร้านนี้",
    },
    {
      key: "viewer_user",
      label: "ผู้ดูแลแดชบอร์ดเริ่มต้น",
      ok: Boolean(viewerEmail),
      detail: hasExplicitViewerEmail
        ? `ระบบจะสร้างผู้ดูแลแดชบอร์ดด้วยอีเมล ${viewerEmail}`
        : "ระบบจะสร้างบัญชีผู้ดูแลแดชบอร์ดเริ่มต้นให้อัตโนมัติ",
    },
    {
      key: "secrets_not_saved",
      label: "ยังไม่บันทึกค่าลับ",
      ok: true,
      detail:
        "ขั้นนี้ไม่แตะรหัส SML หรือ LINE ต้องตั้งค่าในหน้าที่เข้ารหัสหลังสร้างร้าน",
    },
  ];

  const warnings = [
    input.tenantId.startsWith("tenant_store_")
      ? "รหัสร้านนี้มาจากระบบแปลงชื่ออัตโนมัติ ควรแก้ให้อ่านง่ายก่อนสร้างจริง"
      : null,
    input.status === "active"
      ? "กำลังตั้งร้านเป็นใช้งานทันที ตรวจให้แน่ใจว่าพร้อมเปิดแดชบอร์ดและ LINE แล้ว"
      : null,
    duplicateTenantName
      ? "ยังสร้างไม่ได้จนกว่าจะเปลี่ยนรหัสร้านให้ไม่ซ้ำ"
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
