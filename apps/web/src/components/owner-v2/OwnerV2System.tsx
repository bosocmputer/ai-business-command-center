"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import {
  AlertIcon,
  CheckCircleIcon,
  InfoIcon,
  LockIcon,
  PlugInIcon,
  TimeIcon,
} from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";

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
      <SystemNotice
        action={
          <Button
            className="mt-4 h-10 w-full px-4 py-0 sm:w-auto"
            onClick={() => void load()}
            type="button"
            variant="outline"
          >
            โหลดสถานะใหม่
          </Button>
        }
        text={`${errorMessage} ลองโหลดใหม่อีกครั้ง ถ้ายังไม่สำเร็จให้ตรวจ API และสิทธิ์ผู้ดูแล`}
        title="โหลดสถานะระบบกลางไม่สำเร็จ"
        tone="error"
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SystemMetric
          icon={<CheckCircleIcon className="h-5 w-5" />}
          label="พร้อมใช้งาน"
          tone={allRequiredReady ? "success" : "warning"}
          value={`${readyCount}/${requiredChecks.length}`}
        />
        <SystemMetric
          icon={<LockIcon className="h-5 w-5" />}
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
          icon={<TimeIcon className="h-5 w-5" />}
          label="ลิงก์รายงาน"
          tone={data?.report_viewer_signing_secret_configured ? "success" : "warning"}
          value={
            data?.report_viewer_signing_secret_configured
              ? `${data.report_viewer_link_ttl_hours ?? 72} ชม.`
              : "ยังไม่พร้อม"
          }
        />
        <SystemMetric
          icon={<PlugInIcon className="h-5 w-5" />}
          label="Worker"
          tone={data?.worker_heartbeat_token_configured ? "success" : "warning"}
          value={data?.worker_heartbeat_token_configured ? "พร้อมตรวจ" : "ต้องตั้งรหัส"}
        />
      </section>

      {actionItems.length ? (
        <ActionPanel checks={actionItems} />
      ) : (
        <SystemNotice
          text="ระบบกลางพร้อมสำหรับการสร้างลิงก์รายงาน, worker heartbeat และการเก็บ config แบบปลอดภัยแล้ว"
          title="ระบบกลางพร้อมใช้งาน"
          tone="success"
        />
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <SystemPanel
          badge={`${readyCount}/${requiredChecks.length} พร้อม`}
          description="แสดงเฉพาะสถานะที่ผู้ดูแลต้องรู้ ไม่แสดงค่าลับ, กุญแจเข้ารหัส, URL เต็ม หรือตำแหน่งไฟล์บนเครื่องแม่ข่าย"
          title="สถานะระบบกลาง"
        >
          <div className="grid gap-3 md:grid-cols-2">
            {requiredChecks.map((check) => (
              <CheckCard check={check} key={check.id} />
            ))}
          </div>
        </SystemPanel>

        <SystemPanel
          badge="ดูสถานะ"
          description="ใช้ยืนยันว่าระบบอ่านค่าที่จำเป็นได้ แต่ไม่ต้องแก้จากหน้านี้"
          title="หลักฐานปลอดภัย"
        >
          <SafeFact
            label="แหล่งเก็บค่าระบบ"
            value={formatConfigSource(data?.source)}
          />
          <SafeFact
            label="ลิงก์แอปกลาง"
            value={data?.app_base_url ? "ตั้งค่าแล้ว" : "ยังไม่ตั้ง"}
          />
          <SafeFact
            label="API สำหรับ public link"
            value={data?.public_api_base_url ? "ตั้งค่าแล้ว" : "ยังไม่ตั้ง"}
          />
          <SafeFact
            label="สำรองข้อมูลล่าสุด"
            value={
              data?.backup_configured
                ? formatDateTime(data.system_last_backup_at)
                : "ยังไม่พบหลักฐาน"
            }
          />
          {data?.bootstrap?.read_error ? (
            <SystemNotice
              text="ระบบอ่านค่าเริ่มต้นไม่ได้ ให้ตรวจไฟล์เริ่มต้นบนเครื่องแม่ข่าย โดยไม่ต้องเปิดเผยตำแหน่งไฟล์หรือค่าลับบนหน้านี้"
              title="ต้องตรวจค่าเริ่มต้น"
              tone="error"
            />
          ) : null}
        </SystemPanel>
      </section>
    </div>
  );
}

function buildSystemChecks(data: SystemConfigStatus | null): SystemCheck[] {
  return [
    {
      action: "ตั้งค่าที่เก็บค่าลับแบบเข้ารหัสและกุญแจเข้ารหัสบนเครื่องแม่ข่ายก่อนเพิ่มค่าลับใหม่",
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
      action: "ตั้งรหัสตรวจ worker เพื่อให้ระบบรู้ว่า worker ยังทำงาน",
      detail:
        "ใช้แยกปัญหาระหว่างระบบแจ้งเตือนหยุดทำงานกับรายงานของร้านมีปัญหา",
      id: "worker-heartbeat",
      label: "ตรวจ worker ได้",
      ok: Boolean(data?.worker_heartbeat_token_configured),
      priority: "warning",
      status: data?.worker_heartbeat_token_configured ? "พร้อม" : "ต้องตั้งรหัส",
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
      action: "ตรวจไฟล์เริ่มต้นและค่าเชื่อมต่อฐานข้อมูลระบบบน server",
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
          : "ต้องตรวจ server",
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
      detail: "หน้านี้ไม่แสดง URL เต็มหรือตำแหน่งไฟล์บนเครื่องแม่ข่ายให้ผู้ดูแลเห็นโดยตรง",
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
    <section className="rounded-xl border border-warning-500 bg-warning-50 p-4 dark:border-warning-500/30 dark:bg-warning-500/15">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-warning-600 dark:bg-gray-900 dark:text-warning-300">
          <AlertIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {failing.length > 0
              ? `มี ${failing.length} จุดที่ยังไม่พร้อม`
              : "ทุกจุดพร้อมแล้ว"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
            แก้จากค่าระบบบนเครื่องแม่ข่ายหรือแหล่งเก็บค่าลับแบบเข้ารหัสตามรายการด้านล่าง หน้านี้ใช้ดูสถานะเท่านั้น เพื่อไม่ให้แก้ค่าระบบผิดโดยไม่ตั้งใจ
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
              <Badge color={check.priority === "critical" ? "error" : "warning"} size="sm">
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

function SystemMetric({
  icon,
  label,
  tone,
  value,
}: {
  icon: ReactNode;
  label: string;
  tone: "success" | "warning";
  value: string;
}) {
  const toneClass = {
    success:
      "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400",
    warning:
      "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-300",
  }[tone];
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneClass}`}>
        {icon}
      </div>
      <p className="mt-4 text-theme-xs text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 break-words text-xl font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function SystemPanel({
  badge,
  children,
  description,
  title,
}: {
  badge: string;
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {description}
          </p>
        </div>
        <Badge color="info">{badge}</Badge>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function SafeFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
          {label}
        </p>
        <p className="mt-1 break-words text-theme-xs text-gray-500 dark:text-gray-400">
          {value}
        </p>
      </div>
    </div>
  );
}

function SystemNotice({
  action,
  text,
  title,
  tone,
}: {
  action?: ReactNode;
  text: string;
  title: string;
  tone: "success" | "info" | "error";
}) {
  const toneConfig = {
    error: {
      className:
        "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15",
      icon: <AlertIcon className="size-6 fill-current" />,
      iconClassName: "text-error-500",
    },
    info: {
      className:
        "border-blue-light-500 bg-blue-light-50 dark:border-blue-light-500/30 dark:bg-blue-light-500/15",
      icon: <InfoIcon className="size-6 fill-current" />,
      iconClassName: "text-blue-light-500 dark:text-blue-light-400",
    },
    success: {
      className:
        "border-success-500 bg-success-50 dark:border-success-500/30 dark:bg-success-500/15",
      icon: <CheckCircleIcon className="size-6 fill-current" />,
      iconClassName: "text-success-500",
    },
  }[tone];

  return (
    <section className={`rounded-xl border p-4 ${toneConfig.className}`}>
      <div className="flex items-start gap-3">
        <div className={`-mt-0.5 shrink-0 ${toneConfig.iconClassName}`}>
          {toneConfig.icon}
        </div>
        <div className="min-w-0">
          <h2 className="mb-1 text-sm font-semibold text-gray-800 dark:text-white/90">
            {title}
          </h2>
          <p className="text-theme-sm leading-6 text-gray-600 dark:text-gray-300">
            {text}
          </p>
          {action}
        </div>
      </div>
    </section>
  );
}

function SystemSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            className="h-32 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
            key={index}
          />
        ))}
      </div>
      <div className="h-28 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="h-96 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
        <div className="h-96 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
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

function formatDateTime(value?: string | null) {
  if (!value) {
    return "ยังไม่มีเวลา";
  }
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}
