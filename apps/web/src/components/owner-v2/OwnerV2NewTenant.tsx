"use client";

import type { FormEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
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
import {
  AlertIcon,
  CheckCircleIcon,
  InfoIcon,
  PlusIcon,
  TaskIcon,
} from "@/icons";
import { ownerV2Fetch } from "./api";

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
};

export default function OwnerV2NewTenant() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [description, setDescription] = useState("");
  const [viewerEmail, setViewerEmail] = useState("");
  const [planCode, setPlanCode] = useState<PlanCode>("starter");
  const [status, setStatus] = useState<Tenant["status"]>("trial");
  const [preview, setPreview] = useState<TenantCreateDryRunPreview | null>(null);
  const [busy, setBusy] = useState<"dry-run" | "create" | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "warning" | "error";
    text: string;
  } | null>(null);

  const suggestedTenantId = useMemo(() => suggestTenantIdFromName(name), [name]);
  const sensitiveHints = findSensitiveTenantNoteHints(description);
  const canDryRun =
    name.trim().length >= 2 &&
    tenantId.trim().length >= 3 &&
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
  });

  const runDryRun = async (event?: FormEvent) => {
    event?.preventDefault();
    setMessage(null);
    if (!canDryRun) {
      setMessage({
        tone: "warning",
        text: sensitiveHints.length
          ? "คำอธิบายร้านเหมือนมีข้อมูลลับ กรุณาลบก่อนตรวจตัวอย่าง"
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
      setPreview(data);
      // Guard the dry-run response slices: the API could omit checks/warnings
      // on edge cases (e.g. partial errors), and the unguarded .every would
      // throw and leave the preview stuck.
      const checks = data.checks ?? [];
      const warnings = data.warnings ?? [];
      setMessage({
        tone: checks.every((check) => check.ok) ? "success" : "warning",
        text: checks.every((check) => check.ok)
          ? "ตรวจแล้ว สร้างร้านจริงได้"
          : "ยังมีรายการที่ต้องแก้ก่อนสร้างร้านจริง",
      });
      // Re-attach the guarded slices to the stored preview so downstream
      // rendering (.map) is safe too.
      setPreview({ ...data, checks, warnings });
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
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
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

        <PanelBody>
          <form className="space-y-6" onSubmit={runDryRun}>
            <Field label="ชื่อร้าน">
              <input
                className="owner-v2-input"
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
            </Field>
            <div className="grid gap-5 lg:grid-cols-2">
              <Field
                help={
                  suggestedTenantId && suggestedTenantId !== tenantId
                    ? `แนะนำ: ${suggestedTenantId}`
                    : "ใช้ lowercase, ตัวเลข, _ หรือ - เท่านั้น"
                }
                label="รหัสร้าน"
              >
                <input
                  className="owner-v2-input font-mono"
                  onChange={(event) => {
                    setTenantId(event.target.value);
                    setPreview(null);
                  }}
                  placeholder="tenant_krabi"
                  value={tenantId}
                />
              </Field>
              <Field
                help="ถ้าเว้นว่าง ระบบจะสร้างอีเมลผู้ดูแดชบอร์ดให้อัตโนมัติ"
                label="อีเมลผู้ดูแดชบอร์ด"
              >
                <input
                  className="owner-v2-input"
                  onChange={(event) => {
                    setViewerEmail(event.target.value);
                    setPreview(null);
                  }}
                  placeholder="owner@example.com"
                  type="email"
                  value={viewerEmail}
                />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="แพ็กเกจ">
                <select
                  className="owner-v2-input"
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
              </Field>
              <Field label="สถานะเริ่มต้น">
                <select
                  className="owner-v2-input"
                  onChange={(event) => {
                    setStatus(event.target.value as Tenant["status"]);
                    setPreview(null);
                  }}
                  value={status}
                >
                  <option value="trial">ทดลองใช้</option>
                  <option value="active">ใช้งาน</option>
                  <option value="past_due">ค้างชำระ</option>
                  <option value="suspended">ระงับ</option>
                </select>
              </Field>
            </div>
            <Field
              help={
                sensitiveHints.length
                  ? `พบคำที่เสี่ยงเป็นข้อมูลลับ: ${sensitiveHints.join(", ")}`
                  : "ห้ามใส่ข้อมูลลับ เช่น token, password หรือ secret ในช่องนี้"
              }
              label="หมายเหตุ"
            >
              <textarea
                className="owner-v2-input min-h-24"
                onChange={(event) => {
                  setDescription(event.target.value);
                  setPreview(null);
                }}
                placeholder="บริบทสั้น ๆ ของร้าน"
                value={description}
              />
            </Field>

            {message ? <Notice tone={message.tone} text={message.text} /> : null}

            <div className="flex flex-wrap gap-3">
              <Button
                className="w-full sm:w-auto"
                disabled={busy !== null || !canDryRun}
                startIcon={<TaskIcon className="h-4 w-4" />}
                type="submit"
              >
                {busy === "dry-run" ? "กำลังตรวจ..." : "ตรวจตัวอย่างก่อนสร้าง"}
              </Button>
              <Button
                className="w-full sm:w-auto"
                disabled={
                  busy !== null ||
                  !preview ||
                  !previewMatchesForm ||
                  previewHasBlockingCheck
                }
                onClick={() => void createTenant()}
                startIcon={<PlusIcon className="h-4 w-4" />}
                type="button"
                variant="outline"
              >
                {busy === "create" ? "กำลังสร้าง..." : "สร้างร้านจริง"}
              </Button>
            </div>
            <p className="text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
              ปุ่มสร้างร้านจะเปิดได้หลังตรวจตัวอย่างผ่าน และข้อมูลฟอร์มยังไม่เปลี่ยน
            </p>
          </form>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          action={
            <Badge
              color={
                preview ? (previewHasBlockingCheck ? "warning" : "success") : "light"
              }
            >
              {preview ? "มีตัวอย่าง" : "ยังไม่มี"}
            </Badge>
          }
          description="ตรวจผลกระทบและรายการตรวจ ก่อนสร้างข้อมูลจริงในระบบ"
          title="ตัวอย่างก่อนสร้าง"
        />
        {preview ? (
          <PanelBody>
            <div className="grid grid-cols-1 gap-3">
              <Fact label="รหัสร้าน" value={preview.tenant_id} />
              <Fact label="หน้าแดชบอร์ด" value={preview.dashboard_path} />
              <Fact label="ผู้ดูแดชบอร์ด" value={preview.viewer_email} />
            </div>
            <div className="custom-scrollbar flex max-h-[360px] flex-col gap-2 overflow-y-auto">
              {preview.checks.map((check) => (
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
            {preview.warnings.length ? (
              <Notice tone="warning" text={preview.warnings.join(" ")} />
            ) : null}
          </PanelBody>
        ) : (
          <PanelBody>
            <Notice
              text="กรอกข้อมูลร้านแล้วกดตรวจตัวอย่าง ระบบจะแสดงรหัสร้าน, แดชบอร์ด, ผู้ดู และรายการตรวจก่อนสร้างจริง"
              tone="info"
            />
          </PanelBody>
        )}
      </Panel>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      {children}
    </section>
  );
}

function PanelHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 className="break-words text-lg font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function PanelBody({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}

function Field({
  children,
  help,
  label,
}: {
  children: ReactNode;
  help?: string;
  label: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
        {label}
      </span>
      <span className="block">{children}</span>
      {help ? (
        <span className="mt-1.5 block text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
          {help}
        </span>
      ) : null}
    </label>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 break-words text-theme-sm font-medium text-gray-800 dark:text-white/90">
        {value}
      </p>
    </div>
  );
}

function Notice({
  text,
  tone,
}: {
  text: string;
  tone: "success" | "warning" | "error" | "info";
}) {
  const Icon =
    tone === "success" ? CheckCircleIcon : tone === "info" ? InfoIcon : AlertIcon;
  const classes = {
    success:
      "border-success-500 bg-success-50 dark:border-success-500/30 dark:bg-success-500/15",
    warning:
      "border-warning-500 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/15",
    error:
      "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15",
    info: "border-blue-light-500 bg-blue-light-50 dark:border-blue-light-500/30 dark:bg-blue-light-500/15",
  }[tone];
  const iconClass = {
    success: "text-success-500",
    warning: "text-warning-500 dark:text-orange-400",
    error: "text-error-500",
    info: "text-blue-light-500 dark:text-blue-light-400",
  }[tone];
  const title = {
    success: "พร้อมดำเนินการ",
    warning: "ต้องตรวจข้อมูล",
    error: "ดำเนินการไม่สำเร็จ",
    info: "ก่อนสร้างร้าน",
  }[tone];

  return (
    <div className={`rounded-xl border p-4 ${classes}`}>
      <div className="flex items-start gap-3">
        <Icon className={`-mt-0.5 h-6 w-6 shrink-0 ${iconClass}`} />
        <div>
          <h4 className="mb-1 text-sm font-semibold text-gray-800 dark:text-white/90">
            {title}
          </h4>
          <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}
