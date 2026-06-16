"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
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
      <div className="h-80 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
    );
  }

  if (status === "error") {
    return (
      <section className="rounded-xl border border-error-200 bg-error-50 p-5 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
        <p className="font-semibold">โหลด System status ไม่สำเร็จ</p>
        <p className="mt-1 text-sm leading-6">{errorMessage}</p>
        <Button
          className="mt-4 h-10 px-4 py-0"
          onClick={() => void load()}
          type="button"
        >
          รีเฟรช
        </Button>
      </section>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              Runtime readiness
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              แสดงเฉพาะสถานะที่ admin ต้องรู้ ไม่แสดง secret value กลับมาบน UI
            </p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600"
            href="/owner/settings"
          >
            แก้ system config
          </Link>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Fact
            label="Config source"
            ok={data?.source === "encrypted_store"}
            value={formatSource(data?.source)}
          />
          <Fact
            label="Encryption"
            ok={Boolean(data?.encryption_configured)}
            value={data?.encryption_configured ? "พร้อม" : "ยังไม่พร้อม"}
          />
          <Fact
            label="App base URL"
            ok={Boolean(data?.app_base_url)}
            value={data?.app_base_url ?? "ยังไม่ตั้ง"}
          />
          <Fact
            label="Public API URL"
            ok={Boolean(data?.public_api_base_url)}
            value={data?.public_api_base_url ?? "ยังไม่ตั้ง"}
          />
          <Fact
            label="Report signing"
            ok={Boolean(data?.report_viewer_signing_secret_configured)}
            value={
              data?.report_viewer_signing_secret_configured
                ? `${data.report_viewer_link_ttl_hours ?? 72} ชั่วโมง`
                : "ยังไม่ตั้ง"
            }
          />
          <Fact
            label="Worker token"
            ok={Boolean(data?.worker_heartbeat_token_configured)}
            value={data?.worker_id ?? "ยังไม่ตั้ง"}
          />
          <Fact
            label="Backup"
            ok={Boolean(data?.backup_configured)}
            value={
              data?.backup_configured
                ? formatDateTime(data.system_last_backup_at)
                : "ยังต้องตั้ง"
            }
          />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          Bootstrap
        </h2>
        <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
          ค่าเริ่มต้นที่ service ต้องใช้ก่อนอ่าน encrypted store
        </p>
        <div className="mt-4 space-y-3">
          <Fact
            label="Bootstrap file"
            ok={Boolean(data?.bootstrap?.exists)}
            value={data?.bootstrap?.exists ? "พบไฟล์" : "ยังไม่พบ"}
          />
          <Fact
            label="System DB"
            ok={Boolean(data?.bootstrap?.system_database_configured)}
            value={
              data?.bootstrap?.system_database_configured
                ? "configured"
                : "missing"
            }
          />
          <Fact
            label="Secret key"
            ok={Boolean(data?.bootstrap?.secret_key_present)}
            value={data?.bootstrap?.secret_key_present ? "present" : "missing"}
          />
          {data?.bootstrap?.read_error ? (
            <p className="rounded-lg border border-error-200 bg-error-50 p-3 text-sm leading-6 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
              {data.bootstrap.read_error}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Fact({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        <Badge color={ok ? "success" : "warning"}>{ok ? "พร้อม" : "ต้องดู"}</Badge>
      </div>
      <p className="mt-2 break-words text-sm font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
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
