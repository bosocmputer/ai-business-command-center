"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { LineChannelRecord, Tenant } from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { AdminSecurityDialogs } from "@/components/command-center/AdminSecurityDialogs";
import {
  buildAdminJsonHeaders,
  forgetAdminToken,
} from "@/components/command-center/adminAuth";
import { getCommandCenterApiBaseUrl } from "@/components/command-center/apiBaseUrl";

const API_BASE_URL = getCommandCenterApiBaseUrl();

type TenantSummary = {
  tenant: Tenant;
  access: {
    enabled: boolean;
    status: string;
    message: string;
  };
  health: {
    datasource_configured: boolean;
    line_channels: number;
    line_targets_total: number;
    line_targets_enabled: number;
    users: number;
    latest_report_run_at: string | null;
    latest_report_status: string | null;
    latest_snapshot_at: string | null;
    latest_line_delivery_at: string | null;
    latest_line_delivery_status: string | null;
  };
};

type ActionResult = {
  tone: "success" | "error" | "warning";
  message: string;
};

export default function OwnerPortal() {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [lineChannels, setLineChannels] = useState<LineChannelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [newTenantName, setNewTenantName] = useState("");
  const [newTenantId, setNewTenantId] = useState("");
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [lineChannelName, setLineChannelName] = useState("");
  const [lineTokenConfigured, setLineTokenConfigured] = useState(true);
  const [lineSecretConfigured, setLineSecretConfigured] = useState(true);

  const activeCount = useMemo(
    () =>
      tenants.filter((item) =>
        ["trial", "active", "past_due"].includes(item.tenant.status),
      ).length,
    [tenants],
  );
  const suspendedCount = tenants.filter(
    (item) => item.tenant.status === "suspended",
  ).length;
  const selectedTenant = tenants.find(
    (item) => item.tenant.id === selectedTenantId,
  )?.tenant;
  const selectedTenantLineChannels = selectedTenantId
    ? lineChannels.filter((channel) => channel.tenant_id === selectedTenantId)
    : lineChannels;

  useEffect(() => {
    void loadOwnerData();
  }, []);

  useEffect(() => {
    if (!selectedTenantId && tenants[0]) {
      setSelectedTenantId(tenants[0].tenant.id);
    }
  }, [selectedTenantId, tenants]);

  async function loadOwnerData() {
    setLoading(true);
    setResult(null);
    try {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "เปิด Owner Admin Portal",
        description:
          "หน้านี้เห็นทุกร้านและใช้จัดการ subscription/config ระดับระบบ",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนเปิด Owner Admin");
      }

      const [tenantsResponse, channelsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/owner/tenants`, { headers }),
        fetch(`${API_BASE_URL}/api/owner/line-channels`, { headers }),
      ]);

      if (tenantsResponse.status === 401 || tenantsResponse.status === 403) {
        forgetAdminToken();
      }

      if (!tenantsResponse.ok) {
        const payload = (await tenantsResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "โหลด tenant ไม่สำเร็จ");
      }

      const tenantsPayload = (await tenantsResponse.json()) as {
        data: TenantSummary[];
      };
      const channelsPayload = channelsResponse.ok
        ? ((await channelsResponse.json()) as { data: LineChannelRecord[] })
        : { data: [] };
      setTenants(tenantsPayload.data);
      setLineChannels(channelsPayload.data);
    } catch (error) {
      setResult({
        tone: "error",
        message:
          error instanceof Error ? error.message : "โหลด Owner Admin ไม่สำเร็จ",
      });
    } finally {
      setLoading(false);
    }
  }

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tenantName = newTenantName.trim();
    const tenantId = (newTenantId.trim() || slugifyTenantId(tenantName)).trim();
    if (!tenantName || !tenantId) {
      setResult({ tone: "warning", message: "กรุณากรอกชื่อร้านค้า" });
      return;
    }

    await runOwnerAction("create", async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "เพิ่มร้านค้าใหม่",
        description: "สร้าง tenant ใหม่ในระบบ SaaS pilot",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนเพิ่มร้านค้า");
      }

      const response = await fetch(`${API_BASE_URL}/api/owner/tenants`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          tenant_id: tenantId,
          name: tenantName,
          status: "trial",
          plan_code: "starter",
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "เพิ่มร้านค้าไม่สำเร็จ");
      }

      setNewTenantName("");
      setNewTenantId("");
      setSelectedTenantId(tenantId);
      setResult({ tone: "success", message: "เพิ่มร้านค้าใหม่แล้ว" });
      await loadOwnerData();
    });
  }

  async function createLineChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = lineChannelName.trim();
    if (!selectedTenantId || !displayName) {
      setResult({
        tone: "warning",
        message: "กรุณาเลือกร้านค้าและกรอกชื่อ LINE OA",
      });
      return;
    }

    await runOwnerAction("create-line-channel", async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "เพิ่ม LINE OA ให้ร้านค้า",
        description:
          "บันทึก LINE OA metadata สำหรับ tenant นี้ โดยไม่แสดง token/secret ใน UI",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนเพิ่ม LINE OA");
      }

      const response = await fetch(`${API_BASE_URL}/api/owner/line-channels`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          tenant_id: selectedTenantId,
          display_name: displayName,
          channel_access_token_configured: lineTokenConfigured,
          channel_secret_configured: lineSecretConfigured,
          enabled: true,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "เพิ่ม LINE OA ไม่สำเร็จ");
      }

      setLineChannelName("");
      setResult({ tone: "success", message: "เพิ่ม LINE OA ให้ร้านค้าแล้ว" });
      await loadOwnerData();
    });
  }

  async function updateTenantStatus(
    tenant: Tenant,
    status: Tenant["status"],
  ) {
    await runOwnerAction(`${tenant.id}-${status}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: `เปลี่ยนสถานะร้าน ${tenant.name}`,
        description:
          status === "suspended"
            ? "ร้านนี้จะถูกบล็อก dashboard และหยุดส่ง LINE"
            : "อัปเดตสถานะ subscription ของร้านนี้",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนเปลี่ยนสถานะร้าน");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${tenant.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            status,
            suspended_reason:
              status === "suspended" ? "ระงับโดย Owner Admin" : null,
          }),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "เปลี่ยนสถานะร้านไม่สำเร็จ");
      }

      setResult({ tone: "success", message: "อัปเดตสถานะร้านแล้ว" });
      await loadOwnerData();
    });
  }

  async function runOwnerAction(name: string, action: () => Promise<void>) {
    setBusy(name);
    try {
      await action();
    } catch (error) {
      setResult({
        tone: "error",
        message:
          error instanceof Error ? error.message : "ทำรายการไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <AdminSecurityDialogs />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-brand-500">Owner Admin</p>
            <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
              AI Business SaaS Control
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              ควบคุมร้านค้า subscription, tenant health และ LINE OA จากที่เดียว
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge color="success">ใช้งาน {activeCount}</Badge>
            <Badge color={suspendedCount ? "warning" : "light"}>
              ระงับ {suspendedCount}
            </Badge>
            <Badge color="light">{lineChannels.length} LINE OA</Badge>
            <Button size="sm" variant="outline" onClick={() => void loadOwnerData()}>
              รีเฟรช
            </Button>
          </div>
        </div>
      </div>

      {result && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            result.tone === "success"
              ? "border-success-200 bg-success-50 text-success-700"
              : result.tone === "warning"
              ? "border-warning-200 bg-warning-50 text-warning-700"
              : "border-error-200 bg-error-50 text-error-700"
          }`}
        >
          {result.message}
        </div>
      )}

      <form
        className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
        onSubmit={createTenant}
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          เพิ่มร้านค้าใหม่
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input
            className="h-11 rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
            onChange={(event) => setNewTenantName(event.target.value)}
            placeholder="ชื่อร้านค้า"
            value={newTenantName}
          />
          <input
            className="h-11 rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
            onChange={(event) => setNewTenantId(event.target.value)}
            placeholder="tenant_id เช่น tenant_demo_remote"
            value={newTenantId}
          />
          <Button disabled={busy === "create"} size="sm">
            เพิ่มร้านค้า
          </Button>
        </div>
      </form>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                ร้านค้าและสิทธิ์การใช้งาน
              </h2>
              <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                ร้านที่ถูกระงับจะเข้า `/app` ไม่ได้ และ scheduler จะไม่ส่ง Morning Brief
                ให้ทุกกลุ่มของร้านนั้น
              </p>
            </div>
            <select
              className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              onChange={(event) => setSelectedTenantId(event.target.value)}
              value={selectedTenantId}
            >
              {tenants.map((item) => (
                <option key={item.tenant.id} value={item.tenant.id}>
                  {item.tenant.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 grid gap-4">
            {loading ? (
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.02]">
                กำลังโหลดข้อมูลร้านค้า...
              </div>
            ) : (
              tenants.map((item) => (
                <TenantCard
                  busy={busy}
                  item={item}
                  key={item.tenant.id}
                  onUpdateStatus={updateTenantStatus}
                />
              ))
            )}
          </div>
        </div>

        <form
          className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
          onSubmit={createLineChannel}
        >
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            LINE OA ของร้าน
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            1 ร้านมีได้หลาย LINE OA และแต่ละ OA มีหลายกลุ่ม LINE ที่รออนุมัติจากหน้า Settings
          </p>

          <div className="mt-4 space-y-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              ร้านค้า
              <select
                className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                onChange={(event) => setSelectedTenantId(event.target.value)}
                value={selectedTenantId}
              >
                {tenants.map((item) => (
                  <option key={item.tenant.id} value={item.tenant.id}>
                    {item.tenant.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              ชื่อ LINE OA
              <input
                className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
                onChange={(event) => setLineChannelName(event.target.value)}
                placeholder="เช่น AI Business Center Demo"
                value={lineChannelName}
              />
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
              <input
                checked={lineTokenConfigured}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
                onChange={(event) => setLineTokenConfigured(event.target.checked)}
                type="checkbox"
              />
              <span>มี Channel access token แล้ว</span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
              <input
                checked={lineSecretConfigured}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
                onChange={(event) => setLineSecretConfigured(event.target.checked)}
                type="checkbox"
              />
              <span>มี Channel secret สำหรับ webhook แล้ว</span>
            </label>

            <Button disabled={busy === "create-line-channel"} size="sm">
              เพิ่ม LINE OA
            </Button>
          </div>

          <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800">
            <p className="text-xs font-semibold uppercase text-gray-400">
              LINE OA ที่ผูกกับ {selectedTenant?.name ?? "ร้านนี้"}
            </p>
            <div className="mt-3 space-y-2">
              {selectedTenantLineChannels.length ? (
                selectedTenantLineChannels.map((channel) => (
                  <div
                    className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
                    key={channel.id}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {channel.display_name}
                      </p>
                      <Badge color={channel.enabled ? "success" : "warning"}>
                        {channel.enabled ? "เปิดใช้" : "ปิด"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      token: {channel.channel_access_token_configured ? "มี" : "ยังไม่มี"} · secret:{" "}
                      {channel.channel_secret_configured ? "มี" : "ยังไม่มี"} · source:{" "}
                      {channel.source}
                    </p>
                  </div>
                ))
              ) : (
                <p className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  ยังไม่มี LINE OA สำหรับร้านนี้
                </p>
              )}
            </div>
          </div>
        </form>
      </section>

    </div>
  );
}

function TenantCard({
  item,
  busy,
  onUpdateStatus,
}: {
  item: TenantSummary;
  busy: string | null;
  onUpdateStatus: (tenant: Tenant, status: Tenant["status"]) => Promise<void>;
}) {
  const tenant = item.tenant;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {tenant.name}
            </h3>
            <Badge color={tenantStatusTone(tenant.status)}>
              {formatTenantStatus(tenant.status)}
            </Badge>
            <Badge color="light">{tenant.planCode}</Badge>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {tenant.id} · ฐานข้อมูล {tenant.databaseName || "ยังไม่ตั้งค่า"}
          </p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {item.access.message}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy === `${tenant.id}-active`}
            size="sm"
            variant="outline"
            onClick={() => void onUpdateStatus(tenant, "active")}
          >
            เปิดใช้งาน
          </Button>
          <Button
            disabled={busy === `${tenant.id}-suspended`}
            size="sm"
            variant="outline"
            onClick={() => void onUpdateStatus(tenant, "suspended")}
          >
            ระงับ
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <HealthFact
          label="Datasource"
          value={item.health.datasource_configured ? "พร้อม" : "ยังไม่พร้อม"}
        />
        <HealthFact
          label="LINE OA"
          value={`${item.health.line_channels} ช่องทาง`}
        />
        <HealthFact
          label="กลุ่ม LINE"
          value={`${item.health.line_targets_enabled}/${item.health.line_targets_total} เปิดรับ`}
        />
        <HealthFact
          label="รายงานล่าสุด"
          value={
            item.health.latest_snapshot_at
              ? formatDateTime(item.health.latest_snapshot_at)
              : "ยังไม่มี"
          }
        />
      </div>
    </div>
  );
}

function HealthFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function tenantStatusTone(status: Tenant["status"]) {
  if (status === "active" || status === "trial") {
    return "success" as const;
  }
  if (status === "past_due") {
    return "warning" as const;
  }
  if (status === "suspended" || status === "cancelled") {
    return "error" as const;
  }
  return "light" as const;
}

function formatTenantStatus(status: Tenant["status"]) {
  const labels: Record<Tenant["status"], string> = {
    trial: "ทดลองใช้",
    active: "ใช้งาน",
    past_due: "ค้างชำระ",
    suspended: "ระงับ",
    cancelled: "ยกเลิก",
  };
  return labels[status];
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function slugifyTenantId(value: string) {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized ? `tenant_${normalized}` : "";
}
