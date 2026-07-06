"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import {
  AlertIcon,
  CheckCircleIcon,
  LockIcon,
  PlugInIcon,
  TimeIcon,
} from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import {
  Fact,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  formatDateTime,
  secondaryActionClass,
} from "./ui";

type SystemConfigStatus = {
  source?: string;
  encryption_configured?: boolean;
  app_base_url?: string | null;
  public_api_base_url?: string | null;
  report_viewer_signing_secret_configured?: boolean;
  report_viewer_link_ttl_hours?: number | null;
  worker_id?: string | null;
  worker_heartbeat_token_configured?: boolean;
  backup_configured?: boolean;
  system_last_backup_at?: string | null;
  morning_brief_enabled?: boolean;
  morning_brief_tenant_ids?: string[];
  morning_brief_time?: string;
  morning_brief_timezone?: string;
  morning_brief_mode?: "dry_run" | "send";
  morning_brief_force?: boolean;
  bootstrap?: {
    exists?: boolean;
    path?: string | null;
    system_database_configured?: boolean;
    secret_key_present?: boolean;
    read_error?: string | null;
  };
};

type SystemCheck = {
  id: string;
  label: string;
  ok: boolean;
  status: string;
  detail: string;
  action: string;
  priority: "critical" | "warning" | "info";
};

type MetricTone = "success" | "warning" | "error";

export default function OwnerV2System() {
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [data, setData] = useState<SystemConfigStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const load = async (signal?: AbortSignal) => {
    setStatus("loading");
    setErrorMessage("");
    try {
      const result = await ownerV2Fetch<SystemConfigStatus>(
        "/api/owner/system/config",
        { signal },
      );
      if (signal?.aborted) {
        return;
      }
      setData(result);
      setStatus("success");
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "โหลดสถานะระบบกลางไม่สำเร็จ",
      );
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  const checks = useMemo(() => buildSystemChecks(data), [data]);
  const requiredChecks = checks.filter((check) => check.priority !== "info");
  const actionItems = checks.filter(
    (check) => !check.ok && check.priority !== "info",
  );
  const readyCount = requiredChecks.filter((check) => check.ok).length;
  const allRequiredReady =
    requiredChecks.length > 0 && readyCount === requiredChecks.length;

  if (status === "loading" && !data) {
    return <SystemSkeleton />;
  }

  if (status === "error") {
    return (
      <Panel>
        <PanelBody spaced>
          <Notice
            tone="error"
            title="โหลดสถานะระบบกลางไม่สำเร็จ"
            text={`${errorMessage} ลองโหลดใหม่อีกครั้ง ถ้ายังไม่สำเร็จให้ตรวจ API และสิทธิ์ผู้ดูแล`}
          />
          <div>
            <Button
              className="w-full sm:w-auto"
              onClick={() => void load()}
              type="button"
              variant="outline"
            >
              โหลดสถานะใหม่
            </Button>
          </div>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Action toolbar — refresh always available */}
      <div className="flex items-center justify-end">
        <Button
          onClick={() => void load()}
          size="sm"
          type="button"
          variant="outline"
        >
          รีเฟรชสถานะ
        </Button>
      </div>

      {/* Metric cards — TailAdmin metric-group-01 pattern */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SystemMetric
          icon={<CheckCircleIcon className="h-6 w-6" />}
          label="พร้อมใช้งาน"
          tone={allRequiredReady ? "success" : "warning"}
          value={`${readyCount}/${requiredChecks.length}`}
        />
        <SystemMetric
          icon={<LockIcon className="h-6 w-6" />}
          label="ความปลอดภัย"
          tone={
            data?.encryption_configured &&
            data?.report_viewer_signing_secret_configured
              ? "success"
              : "warning"
          }
          value={
            data?.encryption_configured &&
            data?.report_viewer_signing_secret_configured
              ? "พร้อม"
              : "ต้องตั้งค่า"
          }
        />
        <SystemMetric
          icon={<TimeIcon className="h-6 w-6" />}
          label="ลิงก์รายงาน"
          tone={
            data?.report_viewer_signing_secret_configured
              ? "success"
              : "warning"
          }
          value={
            data?.report_viewer_signing_secret_configured
              ? `${data.report_viewer_link_ttl_hours ?? 72} ชม.`
              : "ยังไม่พร้อม"
          }
        />
        <SystemMetric
          icon={<PlugInIcon className="h-6 w-6" />}
          label="งานอัตโนมัติ"
          tone={
            data?.worker_heartbeat_token_configured ? "success" : "warning"
          }
          value={
            data?.worker_heartbeat_token_configured
              ? "พร้อม"
              : "ต้องตั้งค่า"
          }
        />
      </div>

      {/* Action items or success notice */}
      {actionItems.length ? (
        <ActionPanel checks={actionItems} />
      ) : (
        <Notice
          tone="success"
          title="ระบบกลางพร้อมใช้งาน"
          text="ระบบกลางพร้อมสำหรับการสร้างลิงก์รายงาน ตรวจงานอัตโนมัติ และเก็บค่าระบบแบบปลอดภัยแล้ว"
        />
      )}

      {/* Readiness checks + safe facts — 7/5 grid */}
      <div className="grid gap-4 md:gap-6 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <Panel>
            <PanelHeader
              action={
                <Badge color="light">
                  {readyCount}/{requiredChecks.length} พร้อม
                </Badge>
              }
              description="แสดงเฉพาะสถานะที่ผู้ดูแลต้องรู้ ไม่แสดงค่าลับ, กุญแจเข้ารหัส, URL เต็ม หรือตำแหน่งไฟล์"
              title="สถานะระบบกลาง"
            />
            <PanelBody>
              <div className="grid gap-3 md:grid-cols-2">
                {requiredChecks.map((check) => (
                  <CheckCard check={check} key={check.id} />
                ))}
              </div>
            </PanelBody>
          </Panel>
        </div>

        <div className="xl:col-span-5">
          <Panel>
            <PanelHeader
              description="ใช้ยืนยันว่าระบบอ่านค่าที่จำเป็นได้ แต่ไม่ต้องแก้จากหน้านี้"
              title="หลักฐานปลอดภัย"
            />
            <PanelBody spaced>
              <Fact
                label="แหล่งเก็บค่าระบบ"
                value={formatConfigSource(data?.source)}
              />
              <Fact
                label="ลิงก์แอปกลาง"
                value={data?.app_base_url ? "ตั้งค่าแล้ว" : "ยังไม่ตั้ง"}
              />
              <Fact
                label="API สำหรับลิงก์รายงาน"
                value={
                  data?.public_api_base_url ? "ตั้งค่าแล้ว" : "ยังไม่ตั้ง"
                }
              />
              <Fact
                label="สำรองข้อมูลล่าสุด"
                value={
                  data?.backup_configured
                    ? formatDateTime(data.system_last_backup_at)
                    : "ยังไม่พบหลักฐาน"
                }
              />
              {data?.bootstrap?.read_error ? (
                <Notice
                  tone="error"
                  title="ต้องตรวจค่าเริ่มต้น"
                  text="ระบบอ่านค่าเริ่มต้นไม่ได้ ให้ตรวจไฟล์เริ่มต้นบนเครื่องแม่ข่าย โดยไม่ต้องเปิดเผยตำแหน่งไฟล์หรือค่าลับบนหน้านี้"
                />
              ) : null}
            </PanelBody>
          </Panel>
        </div>
      </div>

      {/* Config form */}
      <SystemConfigForm data={data} onSaved={() => void load()} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Metric card — TailAdmin metric-group-01 pattern
/* ------------------------------------------------------------------ */

const metricIconTile: Record<MetricTone, string> = {
  success: "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500",
  warning: "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-orange-400",
  error: "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500",
};

function SystemMetric({
  icon,
  label,
  tone,
  value,
}: {
  icon: ReactNode;
  label: string;
  tone: MetricTone;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl ${metricIconTile[tone]}`}
      >
        {icon}
      </div>
      <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <h4 className="mt-2 break-words text-title-sm font-bold text-gray-800 dark:text-white/90">
        {value}
      </h4>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Config form — TailAdmin form card (header band + body band)
/* ------------------------------------------------------------------ */

function SystemConfigForm({
  data,
  onSaved,
}: {
  data: SystemConfigStatus | null;
  onSaved: () => void;
}) {
  const [appBaseUrl, setAppBaseUrl] = useState(data?.app_base_url ?? "");
  const [publicApiBaseUrl, setPublicApiBaseUrl] = useState(
    data?.public_api_base_url ?? "",
  );
  const [signingSecret, setSigningSecret] = useState("");
  const [linkTtl, setLinkTtl] = useState(
    String(data?.report_viewer_link_ttl_hours ?? ""),
  );
  const [workerId, setWorkerId] = useState(data?.worker_id ?? "");
  const [heartbeatToken, setHeartbeatToken] = useState("");
  const [backupConfigured, setBackupConfigured] = useState(
    Boolean(data?.backup_configured),
  );
  const [lastBackupAt, setLastBackupAt] = useState(
    data?.system_last_backup_at ?? "",
  );
  const [morningBriefEnabled, setMorningBriefEnabled] = useState(
    Boolean(data?.morning_brief_enabled),
  );
  const [morningBriefTenantIds, setMorningBriefTenantIds] = useState(
    (data?.morning_brief_tenant_ids ?? []).join(", "),
  );
  const [morningBriefTime, setMorningBriefTime] = useState(
    data?.morning_brief_time ?? "08:00",
  );
  const [morningBriefTimezone, setMorningBriefTimezone] = useState(
    data?.morning_brief_timezone ?? "Asia/Bangkok",
  );
  const [morningBriefMode, setMorningBriefMode] = useState<"dry_run" | "send">(
    data?.morning_brief_mode ?? "dry_run",
  );
  const [morningBriefForce, setMorningBriefForce] = useState(
    Boolean(data?.morning_brief_force),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { tone: "success" | "error"; text: string } | null
  >(null);

  useEffect(() => {
    setAppBaseUrl(data?.app_base_url ?? "");
    setPublicApiBaseUrl(data?.public_api_base_url ?? "");
    setLinkTtl(String(data?.report_viewer_link_ttl_hours ?? ""));
    setWorkerId(data?.worker_id ?? "");
    setBackupConfigured(Boolean(data?.backup_configured));
    setLastBackupAt(data?.system_last_backup_at ?? "");
    setMorningBriefEnabled(Boolean(data?.morning_brief_enabled));
    setMorningBriefTenantIds((data?.morning_brief_tenant_ids ?? []).join(", "));
    setMorningBriefTime(data?.morning_brief_time ?? "08:00");
    setMorningBriefTimezone(data?.morning_brief_timezone ?? "Asia/Bangkok");
    setMorningBriefMode(data?.morning_brief_mode ?? "dry_run");
    setMorningBriefForce(Boolean(data?.morning_brief_force));
  }, [data]);

  const dirty =
    appBaseUrl !== (data?.app_base_url ?? "") ||
    publicApiBaseUrl !== (data?.public_api_base_url ?? "") ||
    signingSecret.trim().length > 0 ||
    linkTtl !== String(data?.report_viewer_link_ttl_hours ?? "") ||
    workerId !== (data?.worker_id ?? "") ||
    heartbeatToken.trim().length > 0 ||
    backupConfigured !== Boolean(data?.backup_configured) ||
    lastBackupAt !== (data?.system_last_backup_at ?? "") ||
    morningBriefEnabled !== Boolean(data?.morning_brief_enabled) ||
    morningBriefTenantIds !==
      (data?.morning_brief_tenant_ids ?? []).join(", ") ||
    morningBriefTime !== (data?.morning_brief_time ?? "08:00") ||
    morningBriefTimezone !== (data?.morning_brief_timezone ?? "Asia/Bangkok") ||
    morningBriefMode !== (data?.morning_brief_mode ?? "dry_run") ||
    morningBriefForce !== Boolean(data?.morning_brief_force);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !dirty) {
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        app_base_url: appBaseUrl.trim() || null,
        public_api_base_url: publicApiBaseUrl.trim() || null,
        report_viewer_link_ttl_hours: Number(linkTtl) || null,
        worker_id: workerId.trim() || null,
        backup_configured: backupConfigured,
        system_last_backup_at: lastBackupAt.trim() || null,
        morning_brief_enabled: morningBriefEnabled,
        morning_brief_tenant_ids: morningBriefTenantIds
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        morning_brief_time: morningBriefTime.trim() || "08:00",
        morning_brief_timezone: morningBriefTimezone.trim() || "Asia/Bangkok",
        morning_brief_mode: morningBriefMode,
        morning_brief_force: morningBriefForce,
      };
      if (signingSecret.trim()) {
        body.report_viewer_signing_secret = signingSecret.trim();
      }
      if (heartbeatToken.trim()) {
        body.worker_heartbeat_token = heartbeatToken.trim();
      }
      await ownerV2Fetch(`/api/owner/system/config`, {
        method: "PUT",
        body,
      });
      setSigningSecret("");
      setHeartbeatToken("");
      setResult({ tone: "success", text: "บันทึกค่าระบบแล้ว" });
      onSaved();
    } catch (error) {
      setResult({
        tone: "error",
        text: error instanceof Error ? error.message : "บันทึกไม่สำเร็จ",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      {/* Header band */}
      <div className="px-5 py-4 sm:px-6 sm:py-5">
        <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
          แก้ค่าระบบกลาง
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          ค่าที่แก้ที่นี่มีผลทันที ระวังการแก้รหัสเซ็นลิงก์รายงานหรือรหัสตรวจงานอัตโนมัติ
        </p>
      </div>
      {/* Body band */}
      <form
        className="space-y-6 border-t border-gray-100 p-5 sm:p-6 dark:border-gray-800"
        onSubmit={save}
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2">
          <label className="block min-w-0" htmlFor="sys-app-base-url">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              ลิงก์หน้าเว็บหลัก
            </span>
            <input
              className="owner-v2-input"
              id="sys-app-base-url"
              onChange={(event) => setAppBaseUrl(event.target.value)}
              placeholder="https://..."
              value={appBaseUrl}
            />
          </label>
          <label className="block min-w-0" htmlFor="sys-public-api">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              ลิงก์ API สำหรับรายงาน
            </span>
            <input
              className="owner-v2-input"
              id="sys-public-api"
              onChange={(event) => setPublicApiBaseUrl(event.target.value)}
              placeholder="https://..."
              value={publicApiBaseUrl}
            />
          </label>
          <label className="block min-w-0" htmlFor="sys-signing-secret">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              รหัสเซ็นลิงก์รายงาน (วางใหม่เพื่อหมุน)
            </span>
            <input
              autoComplete="new-password"
              className="owner-v2-input"
              id="sys-signing-secret"
              onChange={(event) => setSigningSecret(event.target.value)}
              placeholder={
                data?.report_viewer_signing_secret_configured
                  ? "ตั้งแล้ว — เว้นว่างเพื่อคงไว้"
                  : "ยังไม่ตั้ง"
              }
              type="password"
              value={signingSecret}
            />
          </label>
          <label className="block min-w-0" htmlFor="sys-link-ttl">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              อายุลิงก์รายงาน (ชั่วโมง)
            </span>
            <input
              className="owner-v2-input"
              id="sys-link-ttl"
              inputMode="numeric"
              onChange={(event) => setLinkTtl(event.target.value)}
              placeholder="72"
              type="number"
              value={linkTtl}
            />
          </label>
          <label className="block min-w-0" htmlFor="sys-worker-id">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              ชื่อระบบรันงานอัตโนมัติ
            </span>
            <input
              className="owner-v2-input"
              id="sys-worker-id"
              onChange={(event) => setWorkerId(event.target.value)}
              placeholder="bcc-worker"
              value={workerId}
            />
          </label>
          <label className="block min-w-0" htmlFor="sys-heartbeat-token">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              รหัสตรวจระบบรันงาน (วางใหม่เพื่อหมุน)
            </span>
            <input
              autoComplete="new-password"
              className="owner-v2-input"
              id="sys-heartbeat-token"
              onChange={(event) => setHeartbeatToken(event.target.value)}
              placeholder={
                data?.worker_heartbeat_token_configured
                  ? "ตั้งแล้ว — เว้นว่างเพื่อคงไว้"
                  : "ยังไม่ตั้ง"
              }
              type="password"
              value={heartbeatToken}
            />
          </label>
          <label className="flex min-w-0 cursor-pointer gap-3 rounded-lg border border-gray-100 p-3 text-sm dark:border-gray-800">
            <input
              checked={backupConfigured}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
              id="sys-backup-configured"
              onChange={(event) =>
                setBackupConfigured(event.target.checked)
              }
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block font-medium text-gray-800 dark:text-gray-200">
                ตั้งค่าสำรองข้อมูลแล้ว
              </span>
              <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                ทำเครื่องหมายเมื่อ backup ระบบพร้อมใช้งานจริง
              </span>
            </span>
          </label>
          <label className="block min-w-0" htmlFor="sys-last-backup">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              เวลาสำรองข้อมูลล่าสุด
            </span>
            <input
              className="owner-v2-input"
              id="sys-last-backup"
              onChange={(event) => setLastBackupAt(event.target.value)}
              placeholder="2026-06-19T01:00:00Z"
              value={lastBackupAt}
            />
          </label>
        </div>

        {/* Morning brief fieldset */}
        <fieldset className="space-y-4 rounded-xl border border-gray-100 p-4 dark:border-gray-800">
          <legend className="px-1 text-sm font-semibold text-gray-800 dark:text-white/90">
            รอบสรุปเช้าข้ามร้าน
          </legend>
          <p className="-mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
            ตั้งเวลาและร้านที่จะส่งสรุปอัตโนมัติทุกเช้า ระบบรันงานจะเริ่มรอบตามเวลานี้
          </p>
          <label className="flex min-w-0 cursor-pointer gap-3 rounded-lg border border-gray-100 p-3 text-sm dark:border-gray-800">
            <input
              checked={morningBriefEnabled}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
              id="sys-mb-enabled"
              onChange={(event) =>
                setMorningBriefEnabled(event.target.checked)
              }
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block font-medium text-gray-800 dark:text-gray-200">
                เปิดรอบสรุปเช้า
              </span>
              <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                ปิดแล้วระบบจะข้ามรอบสรุปเช้าทั้งหมด
              </span>
            </span>
          </label>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2">
            <label className="block min-w-0" htmlFor="sys-mb-time">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                เวลาส่ง (เฉพาะชั่วโมง:นาที)
              </span>
              <input
                className="owner-v2-input"
                id="sys-mb-time"
                onChange={(event) =>
                  setMorningBriefTime(event.target.value)
                }
                placeholder="08:00"
                value={morningBriefTime}
              />
            </label>
            <label className="block min-w-0" htmlFor="sys-mb-tz">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                เขตเวลา
              </span>
              <input
                className="owner-v2-input"
                id="sys-mb-tz"
                onChange={(event) =>
                  setMorningBriefTimezone(event.target.value)
                }
                placeholder="Asia/Bangkok"
                value={morningBriefTimezone}
              />
            </label>
            <label className="block min-w-0" htmlFor="sys-mb-tenants">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                รหัสร้านที่ส่งรอบสรุปเช้า (คั่นด้วยจุลภาค)
              </span>
              <input
                className="owner-v2-input"
                id="sys-mb-tenants"
                onChange={(event) =>
                  setMorningBriefTenantIds(event.target.value)
                }
                placeholder="tenant_demo_remote, seaandhill_demo"
                value={morningBriefTenantIds}
              />
            </label>
            <label className="block min-w-0" htmlFor="sys-mb-mode">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                โหมดการส่ง
              </span>
              <select
                className="owner-v2-input"
                id="sys-mb-mode"
                onChange={(event) =>
                  setMorningBriefMode(
                    event.target.value as "dry_run" | "send",
                  )
                }
                value={morningBriefMode}
              >
                <option value="dry_run">ทดลอง ไม่ส่งจริง</option>
                <option value="send">ส่งจริง</option>
              </select>
            </label>
          </div>
          <label className="flex min-w-0 cursor-pointer gap-3 rounded-lg border border-gray-100 p-3 text-sm dark:border-gray-800">
            <input
              checked={morningBriefForce}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
              id="sys-mb-force"
              onChange={(event) =>
                setMorningBriefForce(event.target.checked)
              }
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block font-medium text-gray-800 dark:text-gray-200">
                บังคับส่งแม้ยังไม่ครบเงื่อนไข (force)
              </span>
              <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                ใช้เฉพาะตอนทดสอบ — ปกติควรปิดเพื่อให้ระบบตรวจความพร้อมก่อนส่ง
              </span>
            </span>
          </label>
        </fieldset>

        {/* Action row */}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!dirty || busy} size="sm" type="submit">
            {busy ? "กำลังบันทึก..." : "บันทึกค่าระบบ"}
          </Button>
          <Link className={secondaryActionClass} href="/owner-v2">
            ยกเลิก
          </Link>
          {result ? (
            <span
              className={`text-theme-xs ${
                result.tone === "error"
                  ? "text-error-600"
                  : "text-success-600"
              }`}
            >
              {result.text}
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Readiness checks — data helpers
/* ------------------------------------------------------------------ */

function buildSystemChecks(data: SystemConfigStatus | null): SystemCheck[] {
  return [
    {
      action:
        "ตั้งค่าที่เก็บค่าลับแบบเข้ารหัสและกุญแจเข้ารหัสบนเครื่องแม่ข่ายก่อนเพิ่มค่าลับใหม่",
      detail:
        "ระบบต้องเข้ารหัสค่าลับของ SML, LINE และ Telegram ก่อนใช้งานจริง",
      id: "encryption",
      label: "เข้ารหัสค่าลับ",
      ok: Boolean(data?.encryption_configured),
      priority: "critical",
      status: data?.encryption_configured ? "พร้อม" : "ต้องตั้งค่า",
    },
    {
      action: "ตั้งค่าลับสำหรับเซ็นลิงก์ดูรายงานผู้บริหาร",
      detail:
        "ถ้าไม่พร้อม ระบบไม่ควรสร้างลิงก์รายงานที่เปิดจาก LINE หรือ browser",
      id: "report-signing",
      label: "ลิงก์รายงานปลอดภัย",
      ok: Boolean(data?.report_viewer_signing_secret_configured),
      priority: "critical",
      status: data?.report_viewer_signing_secret_configured
        ? `${data?.report_viewer_link_ttl_hours ?? 72} ชั่วโมง`
        : "ยังไม่พร้อม",
    },
    {
      action: "ตั้งรหัสตรวจระบบรันงาน เพื่อให้ระบบรู้ว่างานอัตโนมัติยังทำงาน",
      detail:
        "ใช้แยกปัญหาระหว่างระบบแจ้งเตือนหยุดทำงานกับรายงานของร้านมีปัญหา",
      id: "worker-heartbeat",
      label: "ตรวจงานอัตโนมัติได้",
      ok: Boolean(data?.worker_heartbeat_token_configured),
      priority: "warning",
      status: data?.worker_heartbeat_token_configured
        ? "พร้อม"
        : "ต้องตั้งรหัส",
    },
    {
      action: "ตั้ง URL ของแอปและ API ให้ตรงกับ production URL",
      detail:
        "ใช้สร้างลิงก์รายงาน, webhook และหน้าที่ผู้บริหารเปิดจากข้อความแจ้งเตือน",
      id: "public-links",
      label: "ลิงก์ภายนอกพร้อม",
      ok: Boolean(data?.app_base_url && data.public_api_base_url),
      priority: "warning",
      status:
        data?.app_base_url && data.public_api_base_url
          ? "ตั้งค่าแล้ว"
          : "ยังไม่ครบ",
    },
    {
      action: "ตรวจไฟล์เริ่มต้นและค่าเชื่อมต่อฐานข้อมูลระบบบนเครื่องแม่ข่าย",
      detail:
        "ระบบต้องอ่านค่าเริ่มต้นได้ก่อนเข้าแหล่งเก็บค่าลับและฐานข้อมูลระบบ",
      id: "bootstrap",
      label: "ค่าเริ่มต้นระบบ",
      ok: Boolean(
        data?.bootstrap?.exists &&
          data.bootstrap.system_database_configured &&
          data.bootstrap.secret_key_present &&
          !data.bootstrap.read_error,
      ),
      priority: "warning",
      status:
        data?.bootstrap?.exists && !data.bootstrap.read_error
          ? "อ่านได้"
          : "ต้องตรวจเครื่องแม่ข่าย",
    },
    {
      action: "ตั้ง backup job หรือยืนยันว่ามี backup ล่าสุดในระบบปฏิบัติการ",
      detail:
        "ไม่บล็อกการใช้งานรายวัน แต่ควรมีหลักฐานก่อนเปิดใช้งานหลายร้านจริง",
      id: "backup",
      label: "สำรองข้อมูล",
      ok: Boolean(data?.backup_configured),
      priority: "warning",
      status: data?.backup_configured
        ? formatDateTime(data.system_last_backup_at)
        : "ยังไม่พบหลักฐาน",
    },
    {
      action: "ใช้เป็นหลักฐานประกอบเท่านั้น",
      detail:
        "หน้านี้ไม่แสดง URL เต็มหรือตำแหน่งไฟล์บนเครื่องแม่ข่ายให้ผู้ดูแลเห็นโดยตรง",
      id: "safe-display",
      label: "ไม่แสดงค่าลับ",
      ok: true,
      priority: "info",
      status: "ปลอดภัย",
    },
  ];
}

function ActionPanel({ checks }: { checks: SystemCheck[] }) {
  if (checks.length === 0) {
    return null;
  }
  const failing = checks.filter((check) => !check.ok);
  return (
    <section className="rounded-2xl border border-warning-500 bg-warning-50 p-4 dark:border-warning-500/30 dark:bg-warning-500/15 md:p-6">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-warning-600 dark:bg-gray-900 dark:text-warning-300">
          <AlertIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {failing.length > 0
              ? `มี ${failing.length} จุดที่ยังไม่พร้อม`
              : "ทุกจุดพร้อมแล้ว"}
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
            ตรวจรายการที่ยังไม่พร้อมก่อนแก้ค่าระบบด้านล่าง หรือแก้จากแหล่งเก็บค่าลับบนเครื่องแม่ข่ายเมื่อเป็นค่าที่ไม่ควรบันทึกผ่านหน้าเว็บ
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {checks.map((check) => (
          <div
            className="rounded-lg bg-white p-4 dark:bg-gray-900"
            key={check.id}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {check.label}
              </p>
              <Badge
                color={check.priority === "critical" ? "error" : "warning"}
                size="sm"
              >
                {check.status}
              </Badge>
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
              {check.action}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CheckCard({ check }: { check: SystemCheck }) {
  return (
    <div className="rounded-lg bg-gray-50 p-4 dark:bg-white/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {check.label}
          </p>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {check.detail}
          </p>
        </div>
        <Badge color={check.ok ? "success" : "warning"} size="sm">
          {check.ok ? "พร้อม" : "ต้องดู"}
        </Badge>
      </div>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        สถานะ: {check.status}
      </p>
    </div>
  );
}

function SystemSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
            key={index}
          />
        ))}
      </div>
      <div className="h-28 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      <div className="grid gap-4 md:gap-6 xl:grid-cols-12">
        <div className="h-96 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] xl:col-span-7" />
        <div className="h-96 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] xl:col-span-5" />
      </div>
    </div>
  );
}

function formatConfigSource(value?: string | null) {
  if (value === "encrypted_store") {
    return "ใช้ที่เก็บค่าแบบเข้ารหัส";
  }
  if (value === "bootstrap") {
    return "อ่านจากค่าเริ่มต้น";
  }
  if (value === "env") {
    return "อ่านจาก environment";
  }
  return "ยังไม่ทราบ";
}
