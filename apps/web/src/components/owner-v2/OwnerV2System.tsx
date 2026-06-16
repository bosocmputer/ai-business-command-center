"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
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
        error instanceof Error ? error.message : "โหลด system config ไม่สำเร็จ",
      );
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  if (status === "loading" && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6"
              key={index}
            />
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="h-96 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
          <div className="h-96 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <SystemNotice
        action={
          <Button
            className="mt-4 h-10 px-4 py-0"
            onClick={() => void load()}
            type="button"
            variant="outline"
          >
            รีเฟรช System
          </Button>
        }
        text={`${errorMessage} ลองรีเฟรชอีกครั้ง ถ้ายังไม่สำเร็จให้ตรวจ API และ session ผู้ดูแล`}
        title="โหลด System status ไม่สำเร็จ"
        tone="error"
      />
    );
  }

  const runtimeFacts = [
    {
      label: "Config source",
      ok: data?.source === "encrypted_store",
      value: formatSource(data?.source),
    },
    {
      label: "Encryption",
      ok: Boolean(data?.encryption_configured),
      value: data?.encryption_configured ? "พร้อม" : "ยังไม่พร้อม",
    },
    {
      label: "App base URL",
      ok: Boolean(data?.app_base_url),
      value: data?.app_base_url ?? "ยังไม่ตั้ง",
    },
    {
      label: "Public API URL",
      ok: Boolean(data?.public_api_base_url),
      value: data?.public_api_base_url ?? "ยังไม่ตั้ง",
    },
    {
      label: "Report signing",
      ok: Boolean(data?.report_viewer_signing_secret_configured),
      value: data?.report_viewer_signing_secret_configured
        ? `${data.report_viewer_link_ttl_hours ?? 72} ชั่วโมง`
        : "ยังไม่ตั้ง",
    },
    {
      label: "Worker token",
      ok: Boolean(data?.worker_heartbeat_token_configured),
      value: data?.worker_id ?? "ยังไม่ตั้ง",
    },
    {
      label: "Backup",
      ok: Boolean(data?.backup_configured),
      value: data?.backup_configured
        ? formatDateTime(data.system_last_backup_at)
        : "ยังต้องตั้ง",
    },
  ];

  const bootstrapFacts = [
    {
      label: "Bootstrap file",
      ok: Boolean(data?.bootstrap?.exists),
      value: data?.bootstrap?.exists ? "พบไฟล์" : "ยังไม่พบ",
    },
    {
      label: "System DB",
      ok: Boolean(data?.bootstrap?.system_database_configured),
      value: data?.bootstrap?.system_database_configured
        ? "configured"
        : "missing",
    },
    {
      label: "Secret key",
      ok: Boolean(data?.bootstrap?.secret_key_present),
      value: data?.bootstrap?.secret_key_present ? "present" : "missing",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SystemMetric
          icon={<PlugInIcon className="h-6 w-6" />}
          label="Config source"
          ok={data?.source === "encrypted_store"}
          value={formatSource(data?.source)}
        />
        <SystemMetric
          icon={<LockIcon className="h-6 w-6" />}
          label="Encryption"
          ok={Boolean(data?.encryption_configured)}
          value={data?.encryption_configured ? "พร้อม" : "ยังไม่พร้อม"}
        />
        <SystemMetric
          icon={<TimeIcon className="h-6 w-6" />}
          label="Report link TTL"
          ok={Boolean(data?.report_viewer_signing_secret_configured)}
          value={
            data?.report_viewer_signing_secret_configured
              ? `${data.report_viewer_link_ttl_hours ?? 72} ชั่วโมง`
              : "ยังไม่ตั้ง"
          }
        />
        <SystemMetric
          icon={<CheckCircleIcon className="h-6 w-6" />}
          label="Backup"
          ok={Boolean(data?.backup_configured)}
          value={
            data?.backup_configured
              ? formatDateTime(data.system_last_backup_at)
              : "ยังต้องตั้ง"
          }
        />
      </section>

      <SystemNotice
        text="หน้านี้แสดงเฉพาะสถานะที่ admin ต้องรู้ ไม่แสดง secret value, token, endpoint ลับ หรือ key จริงกลับมาบน UI"
        title="System readiness"
        tone="info"
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <SystemPanel
          badge={`${runtimeFacts.filter((fact) => fact.ok).length}/${
            runtimeFacts.length
          } พร้อม`}
          title="Runtime readiness"
        >
          <FactList facts={runtimeFacts} />
        </SystemPanel>

        <SystemPanel
          badge={`${bootstrapFacts.filter((fact) => fact.ok).length}/${
            bootstrapFacts.length
          } พร้อม`}
          title="Bootstrap"
        >
          <p className="mb-4 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
            ค่าเริ่มต้นที่ service ต้องใช้ก่อนอ่าน encrypted store
          </p>
          <FactList facts={bootstrapFacts} />
          {data?.bootstrap?.read_error ? (
            <SystemNotice
              text={data.bootstrap.read_error}
              title="อ่าน bootstrap ไม่สำเร็จ"
              tone="error"
            />
          ) : null}
        </SystemPanel>
      </section>
    </div>
  );
}

type FactItem = {
  label: string;
  ok: boolean;
  value: string;
};

function SystemMetric({
  icon,
  label,
  ok,
  value,
}: {
  icon: ReactNode;
  label: string;
  ok: boolean;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-white/90">
        {icon}
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <span className="text-theme-sm text-gray-500 dark:text-gray-400">
            {label}
          </span>
          <h4 className="mt-2 break-words text-base font-bold text-gray-800 dark:text-white/90">
            {value}
          </h4>
        </div>
        <Badge color={ok ? "success" : "warning"}>{ok ? "พร้อม" : "ต้องดู"}</Badge>
      </div>
    </div>
  );
}

function SystemPanel({
  badge,
  children,
  title,
}: {
  badge: string;
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h3>
        <Badge color="info">{badge}</Badge>
      </div>
      {children}
    </section>
  );
}

function FactList({ facts }: { facts: FactItem[] }) {
  return (
    <div className="custom-scrollbar flex max-h-[520px] flex-col overflow-y-auto pr-2">
      {facts.map((fact) => (
        <div
          className="flex items-start justify-between gap-4 border-b border-gray-200 pb-4 pt-4 first:pt-0 last:border-b-0 last:pb-0 dark:border-gray-800"
          key={fact.label}
        >
          <div className="min-w-0">
            <h4 className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
              {fact.label}
            </h4>
            <span className="mt-1 block break-words text-theme-xs text-gray-500 dark:text-gray-400">
              {fact.value}
            </span>
          </div>
          <Badge color={fact.ok ? "success" : "warning"}>
            {fact.ok ? "พร้อม" : "ต้องดู"}
          </Badge>
        </div>
      ))}
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
  tone: "info" | "error";
}) {
  const Icon = tone === "info" ? InfoIcon : AlertIcon;
  const toneClass = {
    info: "border-blue-light-500 bg-blue-light-50 text-blue-light-600 dark:border-blue-light-500/30 dark:bg-blue-light-500/15 dark:text-blue-light-400",
    error:
      "border-error-500 bg-error-50 text-error-700 dark:border-error-500/30 dark:bg-error-500/15 dark:text-error-400",
  }[tone];

  return (
    <section className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="flex items-start gap-3">
        <Icon className="-mt-0.5 h-6 w-6 shrink-0" />
        <div>
          <h4 className="mb-1 text-sm font-semibold text-gray-800 dark:text-white/90">
            {title}
          </h4>
          <p className="text-theme-sm leading-6 text-gray-600 dark:text-gray-300">
            {text}
          </p>
          {action}
        </div>
      </div>
    </section>
  );
}

function formatSource(value?: string | null) {
  if (value === "encrypted_store") {
    return "encrypted store";
  }
  if (value === "bootstrap") {
    return "bootstrap";
  }
  return value ?? "ยังไม่ทราบ";
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
