"use client";

import { FormEvent, useMemo, useState } from "react";
import type React from "react";
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
          ? "คำอธิบายร้านเหมือนมี token/password/secret กรุณาลบข้อมูลลับก่อน"
          : "กรอกชื่อร้านและ tenant_id ให้ครบก่อนตรวจ",
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
      setMessage({
        tone: data.checks.every((check) => check.ok) ? "success" : "warning",
        text: data.checks.every((check) => check.ok)
          ? "ตรวจแล้ว สร้างร้านจริงได้"
          : "ยังมีรายการที่ต้องแก้ก่อนสร้างร้านจริง",
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "ตรวจ dry-run ไม่สำเร็จ กรุณาลองใหม่",
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
        text: "ต้องตรวจ dry-run ล่าสุดให้ผ่านก่อนสร้างร้านจริง",
      });
      return;
    }
    setBusy("create");
    try {
      await ownerV2Fetch<{ tenant: Tenant }>("/api/owner/tenants", {
        method: "POST",
        body: buildPayload(),
      });
      router.push(`/owner-v2?tenant=${encodeURIComponent(tenantId.trim())}`);
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            เพิ่มร้านใหม่
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            ขั้นนี้สร้าง tenant และ viewer เริ่มต้นเท่านั้น ไม่แตะ SML หรือ LINE secret
          </p>
        </div>

        <form className="mt-5 space-y-4" onSubmit={runDryRun}>
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
          <Field
            help={
              suggestedTenantId && suggestedTenantId !== tenantId
                ? `แนะนำ: ${suggestedTenantId}`
                : "ใช้ lowercase, ตัวเลข, _ หรือ - เท่านั้น"
            }
            label="tenant_id"
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
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Plan">
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
          <Field help="ถ้าเว้นว่าง ระบบจะสร้าง viewer+tenant_id@ai-business.local" label="Viewer email">
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
          <Field
            help={
              sensitiveHints.length
                ? `พบคำที่เสี่ยงเป็นข้อมูลลับ: ${sensitiveHints.join(", ")}`
                : "ห้ามใส่ token/password/secret ในช่องนี้"
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

          {message ? (
            <Notice tone={message.tone} text={message.text} />
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button disabled={busy !== null || !canDryRun} type="submit">
              {busy === "dry-run" ? "กำลังตรวจ..." : "ตรวจ dry-run"}
            </Button>
            <Button
              disabled={
                busy !== null ||
                !preview ||
                !previewMatchesForm ||
                previewHasBlockingCheck
              }
              onClick={() => void createTenant()}
              type="button"
              variant="outline"
            >
              {busy === "create" ? "กำลังสร้าง..." : "สร้างร้านจริง"}
            </Button>
          </div>
          <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
            ปุ่มสร้างร้านจะเปิดได้หลัง dry-run ล่าสุดผ่านและข้อมูลฟอร์มยังไม่เปลี่ยน
          </p>
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          Preview ก่อนสร้าง
        </h2>
        {preview ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3">
              <Fact label="tenant_id" value={preview.tenant_id} />
              <Fact label="Dashboard" value={preview.dashboard_path} />
              <Fact label="Viewer" value={preview.viewer_email} />
            </div>
            <div className="space-y-2">
              {preview.checks.map((check) => (
                <div
                  className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
                  key={check.key}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {check.label}
                    </p>
                    <Badge color={check.ok ? "success" : "warning"}>
                      {check.ok ? "ผ่าน" : "ต้องแก้"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    {check.detail}
                  </p>
                </div>
              ))}
            </div>
            {preview.warnings.length ? (
              <Notice tone="warning" text={preview.warnings.join(" ")} />
            ) : null}
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm leading-6 text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
            กรอกข้อมูลร้านแล้วกดตรวจ dry-run ระบบจะแสดงผลกระทบก่อนสร้างจริง
          </p>
        )}
      </section>
    </div>
  );
}

function Field({
  children,
  help,
  label,
}: {
  children: React.ReactNode;
  help?: string;
  label: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
      {help ? (
        <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
          {help}
        </span>
      ) : null}
    </label>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-gray-900 dark:text-white">
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
  tone: "success" | "warning" | "error";
}) {
  const classes = {
    success:
      "border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300",
    warning:
      "border-warning-200 bg-warning-50 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300",
    error:
      "border-error-200 bg-error-50 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300",
  }[tone];
  return <p className={`rounded-lg border p-3 text-sm leading-6 ${classes}`}>{text}</p>;
}
