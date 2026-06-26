"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  findSensitiveTenantNoteHints,
  suggestTenantIdFromName,
  type PlanCode,
  type Tenant,
  type TenantId,
} from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { ArrowRightIcon, PlusIcon, TaskIcon } from "@/icons";
import { ownerV2Fetch } from "./api";
import {
  Fact,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  primaryActionClass,
  secondaryActionClass,
} from "./ui";

type TenantCreateDryRunPreview = {
  will_mutate: false;
  tenant_id: TenantId;
  name: string;
  status: Tenant["status"];
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

type TenantCreateInput = {
  tenant_id: string;
  name: string;
  description: string;
  status: Tenant["status"];
  plan_code: PlanCode;
  viewer_email?: string;
  current_period_end?: string;
};

const BANGKOK_TZ = "Asia/Bangkok";

function formatTrialEndDate(days: number): string {
  const end = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: BANGKOK_TZ,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(end);
}

// Client-side format rules matching the server tenantId schema.
const TENANT_ID_PATTERN = /^[a-z0-9_-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function OwnerV2NewTenant() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [description, setDescription] = useState("");
  const [viewerEmail, setViewerEmail] = useState("");
  const [planCode, setPlanCode] = useState<PlanCode>("starter");
  const [status, setStatus] = useState<Tenant["status"]>("trial");
  const [trialDays, setTrialDays] = useState<number>(14);
  const [preview, setPreview] = useState<TenantCreateDryRunPreview | null>(null);
  const [busy, setBusy] = useState<"dry-run" | "create" | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "warning" | "error";
    text: string;
  } | null>(null);

  const suggestedTenantId = useMemo(() => suggestTenantIdFromName(name), [name]);
  const sensitiveHints = findSensitiveTenantNoteHints(description);

  // Client-side validation gates — surfaces issues before the server round-trip.
  const tenantIdFormatOk =
    tenantId.trim().length >= 3 && TENANT_ID_PATTERN.test(tenantId.trim());
  const viewerEmailFormatOk =
    viewerEmail.trim().length === 0 || EMAIL_PATTERN.test(viewerEmail.trim());
  const canDryRun =
    name.trim().length >= 2 &&
    tenantIdFormatOk &&
    viewerEmailFormatOk &&
    sensitiveHints.length === 0;
  const previewMatchesForm =
    preview?.tenant_id === tenantId.trim() &&
    preview?.name === name.trim() &&
    preview?.plan_code === planCode &&
    preview?.status === status &&
    preview?.viewer_email ===
      (viewerEmail.trim() || `viewer+${tenantId.trim()}@ai-business.local`);
  const previewHasBlockingCheck =
    preview?.checks.some((check) => !check.ok) ?? false;

  const buildPayload = (): TenantCreateInput => ({
    tenant_id: tenantId.trim(),
    name: name.trim(),
    description: description.trim(),
    status,
    plan_code: planCode,
    viewer_email: viewerEmail.trim() || undefined,
    current_period_end:
      status === "trial" && trialDays > 0
        ? new Date(Date.now() + trialDays * 86_400_000).toISOString()
        : undefined,
  });

  const runDryRun = async (event?: FormEvent) => {
    event?.preventDefault();
    setMessage(null);
    if (!canDryRun) {
      setMessage({
        tone: "warning",
        text: sensitiveHints.length
          ? "คำอธิบายร้านเหมือนมีข้อมูลลับ กรุณาลบก่อนตรวจตัวอย่าง"
          : !tenantIdFormatOk
            ? "รหัสร้านต้องเป็น lowercase, ตัวเลข, _ หรือ - อย่างน้อย 3 ตัว"
            : !viewerEmailFormatOk
              ? "รูปแบบอีเมลผู้ดูแดชบอร์ดไม่ถูกต้อง"
              : "กรอกชื่อร้านและรหัสร้านให้ครบก่อนตรวจตัวอย่าง",
      });
      return;
    }
    setBusy("dry-run");
    try {
      const data = await ownerV2Fetch<TenantCreateDryRunPreview>(
        "/api/owner/tenants/dry-run",
        { method: "POST", body: buildPayload() },
      );
      // Guard the dry-run response slices: the API could omit checks/warnings
      // on edge cases (e.g. partial errors), and the unguarded .every would
      // throw and leave the preview stuck.
      const checks = data.checks ?? [];
      const warnings = data.warnings ?? [];
      const guarded: TenantCreateDryRunPreview = { ...data, checks, warnings };
      setPreview(guarded);
      setMessage({
        tone: checks.every((check) => check.ok) ? "success" : "warning",
        text: checks.every((check) => check.ok)
          ? "ตรวจแล้ว สร้างร้านจริงได้"
          : "ยังมีรายการที่ต้องแก้ก่อนสร้างร้านจริง",
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "ตรวจตัวอย่างไม่สำเร็จ กรุณาลองใหม่",
      });
    } finally {
      setBusy(null);
    }
  };

  const createTenant = async () => {
    setMessage(null);
    if (!preview || !previewMatchesForm || previewHasBlockingCheck) {
      setMessage({
        tone: "warning",
        text: "ต้องตรวจตัวอย่างล่าสุดให้ผ่านก่อนสร้างร้านจริง",
      });
      return;
    }
    setBusy("create");
    try {
      await ownerV2Fetch<{ tenant: Tenant }>("/api/owner/tenants", {
        method: "POST",
        body: buildPayload(),
      });
      router.push(`/owner-v2/stores/${encodeURIComponent(tenantId.trim())}`);
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "สร้างร้านไม่สำเร็จ กรุณาลองใหม่",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4 md:gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      {/* Left — create form */}
      <Panel>
        <PanelHeader
          action={
            <Badge color={previewMatchesForm ? "success" : "info"}>
              {previewMatchesForm ? "ตรวจล่าสุดตรงกับฟอร์มนี้" : "ต้องตรวจก่อน"}
            </Badge>
          }
          description="สร้างร้านและผู้ดูแดชบอร์ดเริ่มต้นเท่านั้น ยังไม่บันทึกค่าลับของ SML หรือ LINE"
          title="เพิ่มร้านใหม่"
        />
        <PanelBody spaced>
          <form className="space-y-6" onSubmit={runDryRun}>
            <div>
              <label
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                htmlFor="new-tenant-name"
              >
                ชื่อร้าน
              </label>
              <input
                className="owner-v2-input"
                id="new-tenant-name"
                onChange={(event) => {
                  setName(event.target.value);
                  if (!tenantId.trim()) {
                    setTenantId(suggestTenantIdFromName(event.target.value));
                  }
                  setPreview(null);
                }}
                placeholder="เช่น กระบี่ สาขาใหญ่"
                value={name}
              />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <label
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                  htmlFor="new-tenant-id"
                >
                  รหัสร้าน
                </label>
                <input
                  className={`owner-v2-input font-mono ${
                    tenantId.trim() && !tenantIdFormatOk
                      ? "border-error-300 focus:border-error-300 focus:ring-error-500/10"
                      : ""
                  }`}
                  id="new-tenant-id"
                  onChange={(event) => {
                    setTenantId(event.target.value);
                    setPreview(null);
                  }}
                  placeholder="tenant_krabi"
                  value={tenantId}
                />
                <p
                  className={`mt-1.5 block text-xs leading-5 ${
                    tenantId.trim() && !tenantIdFormatOk
                      ? "text-error-500"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {tenantId.trim() && !tenantIdFormatOk
                    ? "ใช้ lowercase, ตัวเลข, _ หรือ - เท่านั้น (อย่างน้อย 3 ตัว)"
                    : suggestedTenantId && suggestedTenantId !== tenantId
                      ? `แนะนำ: ${suggestedTenantId}`
                      : "ใช้ lowercase, ตัวเลข, _ หรือ - เท่านั้น"}
                </p>
              </div>
              <div>
                <label
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                  htmlFor="new-tenant-email"
                >
                  อีเมลผู้ดูแดชบอร์ด
                </label>
                <input
                  className={`owner-v2-input ${
                    viewerEmail.trim() && !viewerEmailFormatOk
                      ? "border-error-300 focus:border-error-300 focus:ring-error-500/10"
                      : ""
                  }`}
                  id="new-tenant-email"
                  onChange={(event) => {
                    setViewerEmail(event.target.value);
                    setPreview(null);
                  }}
                  placeholder="owner@example.com"
                  type="email"
                  value={viewerEmail}
                />
                <p
                  className={`mt-1.5 block text-xs leading-5 ${
                    viewerEmail.trim() && !viewerEmailFormatOk
                      ? "text-error-500"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {viewerEmail.trim() && !viewerEmailFormatOk
                    ? "รูปแบบอีเมลไม่ถูกต้อง"
                    : "ถ้าเว้นว่าง ระบบจะสร้างอีเมลผู้ดูแดชบอร์ดให้อัตโนมัติ"}
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                  htmlFor="new-tenant-plan"
                >
                  แพ็กเกจ
                </label>
                <select
                  className="owner-v2-input"
                  id="new-tenant-plan"
                  onChange={(event) => {
                    setPlanCode(event.target.value as PlanCode);
                    setPreview(null);
                  }}
                  value={planCode}
                >
                  <option value="starter">starter</option>
                  <option value="business">business</option>
                  <option value="pro">pro</option>
                </select>
              </div>
              <div>
                <label
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                  htmlFor="new-tenant-status"
                >
                  สถานะเริ่มต้น
                </label>
                <select
                  className="owner-v2-input"
                  id="new-tenant-status"
                  onChange={(event) => {
                    setStatus(event.target.value as Tenant["status"]);
                    setTrialDays(14);
                    setPreview(null);
                  }}
                  value={status}
                >
                  <option value="trial">ทดลองใช้</option>
                  <option value="active">ใช้งาน</option>
                  <option value="past_due">ค้างชำระ</option>
                  <option value="suspended">ระงับ</option>
                </select>
              </div>
            </div>
            {status === "trial" ? (
              <div>
                <label
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                  htmlFor="new-tenant-trial-days"
                >
                  ระยะเวลาทดลองใช้
                </label>
                <select
                  className="owner-v2-input"
                  id="new-tenant-trial-days"
                  onChange={(event) => {
                    setTrialDays(Number(event.target.value));
                    setPreview(null);
                  }}
                  value={trialDays}
                >
                  <option value={7}>7 วัน</option>
                  <option value={14}>14 วัน</option>
                  <option value={30}>30 วัน</option>
                </select>
                <p className="mt-1.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                  หมดวันที่ {formatTrialEndDate(trialDays)}
                </p>
              </div>
            ) : null}
            <div>
              <label
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                htmlFor="new-tenant-description"
              >
                หมายเหตุ
              </label>
              <textarea
                className="owner-v2-input min-h-24"
                id="new-tenant-description"
                onChange={(event) => {
                  setDescription(event.target.value);
                  setPreview(null);
                }}
                placeholder="บริบทสั้น ๆ ของร้าน"
                value={description}
              />
              <p
                className={`mt-1.5 block text-xs leading-5 ${
                  sensitiveHints.length
                    ? "text-error-500"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {sensitiveHints.length
                  ? `พบคำที่เสี่ยงเป็นข้อมูลลับ: ${sensitiveHints.join(", ")}`
                  : "ห้ามใส่ข้อมูลลับ เช่น token, password หรือ secret ในช่องนี้"}
              </p>
            </div>

            {message ? (
              <Notice
                tone={message.tone}
                title="สถานะการสร้างร้าน"
                text={message.text}
              />
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              {/* Secondary: dry-run first (a check, not the commit). */}
              <Button
                className="w-full sm:w-auto"
                disabled={busy !== null || !canDryRun}
                startIcon={<TaskIcon className="h-4 w-4" />}
                type="submit"
                variant="outline"
              >
                {busy === "dry-run" ? "กำลังตรวจ..." : "ตรวจตัวอย่างก่อนสร้าง"}
              </Button>
              {/* Primary: the actual create, gated on a passing dry-run. */}
              <button
                className={primaryActionClass}
                disabled={
                  busy !== null ||
                  !preview ||
                  !previewMatchesForm ||
                  previewHasBlockingCheck
                }
                onClick={() => void createTenant()}
                type="button"
              >
                {busy === "create" ? (
                  "กำลังสร้าง..."
                ) : (
                  <>
                    <PlusIcon className="h-4 w-4" />
                    สร้างร้านจริง
                  </>
                )}
              </button>
              {/* Cancel — always available so the admin can back out. */}
              <Link
                className={secondaryActionClass}
                href="/owner-v2/stores"
              >
                ยกเลิก
              </Link>
            </div>
            <p className="text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
              ปุ่มสร้างร้านจะเปิดได้หลังตรวจตัวอย่างผ่าน และข้อมูลฟอร์มยังไม่เปลี่ยน
            </p>
          </form>
        </PanelBody>
      </Panel>

      {/* Right — dry-run preview / flow guide */}
      <Panel>
        <PanelHeader
          action={
            <Badge
              color={
                preview
                  ? previewHasBlockingCheck
                    ? "warning"
                    : "success"
                  : "light"
              }
            >
              {preview ? "มีตัวอย่าง" : "ยังไม่มี"}
            </Badge>
          }
          description="ตรวจผลกระทบและรายการตรวจ ก่อนสร้างข้อมูลจริงในระบบ"
          title="ตัวอย่างก่อนสร้าง"
        />
        {preview ? (
          <PanelBody spaced>
            <div className="grid grid-cols-1 gap-3">
              <Fact label="รหัสร้าน" value={preview.tenant_id} />
              <Fact label="หน้าแดชบอร์ด" value={preview.dashboard_path} />
              <Fact label="ผู้ดูแดชบอร์ด" value={preview.viewer_email} />
            </div>
            <div className="custom-scrollbar flex max-h-[360px] flex-col gap-2 overflow-y-auto">
              {(preview.checks ?? []).map((check) => (
                <div
                  className="flex items-start justify-between gap-4 rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]"
                  key={check.key}
                >
                  <div className="min-w-0">
                    <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                      {check.label}
                    </p>
                    <p className="mt-1 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
                      {check.detail}
                    </p>
                  </div>
                  <Badge color={check.ok ? "success" : "warning"}>
                    {check.ok ? "ผ่าน" : "ต้องแก้"}
                  </Badge>
                </div>
              ))}
            </div>
            {(preview.warnings ?? []).length ? (
              <Notice
                tone="warning"
                title="คำเตือนจากการตรวจ"
                text={(preview.warnings ?? []).join(" ")}
              />
            ) : null}
          </PanelBody>
        ) : (
          <PanelBody spaced>
            {/* Empty state — icon + heading + numbered flow (skill convention) */}
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-white/[0.05] dark:text-gray-500">
                <TaskIcon className="h-6 w-6" />
              </span>
              <div>
                <p className="text-base font-semibold text-gray-800 dark:text-white/90">
                  ยังไม่มีตัวอย่าง
                </p>
                <p className="mx-auto mt-1 max-w-xs text-sm leading-6 text-gray-500 dark:text-gray-400">
                  กรอกข้อมูลร้านทางซ้ายแล้วกดตรวจตัวอย่าง ระบบจะแสดงสิ่งที่จะถูกสร้างก่อนลงข้อมูลจริง
                </p>
              </div>
            </div>
            <ol className="space-y-3">
              {[
                "กรอกชื่อร้าน, รหัสร้าน, แพ็กเกจ และสถานะ",
                "กด “ตรวจตัวอย่างก่อนสร้าง” เพื่อจำลองการสร้าง",
                "ตรวจรายการตรวจและคำเตือนทางขวา",
                "กด “สร้างร้านจริง” เมื่อทุกข้อผ่าน",
              ].map((step, index) => (
                <li className="flex items-start gap-3" key={step}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                    {index + 1}
                  </span>
                  <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
                    {step}
                  </p>
                </li>
              ))}
            </ol>
            <Link
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 transition hover:text-brand-700 dark:text-brand-400"
              href="/owner-v2/stores"
            >
              กลับหน้าร้านทั้งหมด
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </PanelBody>
        )}
      </Panel>
    </div>
  );
}
