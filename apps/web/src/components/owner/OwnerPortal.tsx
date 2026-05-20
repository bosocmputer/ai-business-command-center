"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LineChannelRecord, Tenant } from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { AdminSecurityDialogs } from "@/components/command-center/AdminSecurityDialogs";
import {
  buildAdminJsonHeaders,
  buildRememberedAdminJsonHeaders,
  forgetAdminToken,
} from "@/components/command-center/adminAuth";
import { getCommandCenterApiBaseUrl } from "@/components/command-center/apiBaseUrl";

const API_BASE_URL = getCommandCenterApiBaseUrl();

type TenantSummary = {
  tenant: Tenant;
  customer_dashboard_path: string | null;
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

type OwnerDataStatus = "checking" | "auth_required" | "ready" | "error";

type DatasourceTestResult = {
  ok: boolean;
  checked_at: string;
  latency_ms: number;
  database_name: string | null;
  user_name_masked: string | null;
  required_tables: {
    ic_trans: boolean;
    ic_trans_detail: boolean;
    ar_customer: boolean;
  };
  safe_error_message: string | null;
};

export default function OwnerPortal() {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [lineChannels, setLineChannels] = useState<LineChannelRecord[]>([]);
  const [datasourceTests, setDatasourceTests] = useState<
    Record<string, DatasourceTestResult>
  >({});
  const [loading, setLoading] = useState(true);
  const [dataStatus, setDataStatus] =
    useState<OwnerDataStatus>("checking");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [newTenantName, setNewTenantName] = useState("");
  const [newTenantId, setNewTenantId] = useState("");
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [lineChannelName, setLineChannelName] = useState("");
  const [lineTokenConfigured, setLineTokenConfigured] = useState(true);
  const [lineSecretConfigured, setLineSecretConfigured] = useState(true);
  const [publicOrigin, setPublicOrigin] = useState("");

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
  const selectedTenantSummary = tenants.find(
    (item) => item.tenant.id === selectedTenantId,
  );
  const selectedTenantLineChannels = selectedTenantId
    ? lineChannels.filter((channel) => channel.tenant_id === selectedTenantId)
    : lineChannels;

  useEffect(() => {
    void loadOwnerData({ promptForToken: false });
  }, []);

  useEffect(() => {
    setPublicOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!selectedTenantId && tenants[0]) {
      setSelectedTenantId(tenants[0].tenant.id);
    }
  }, [selectedTenantId, tenants]);

  async function loadOwnerData({
    promptForToken = true,
  }: { promptForToken?: boolean } = {}) {
    setLoading(true);
    setResult(null);
    try {
      const headers = promptForToken
        ? await buildAdminJsonHeaders({
            actionLabel: "เปิด Owner Admin Portal",
            description:
              "หน้านี้เห็นทุกร้านและใช้จัดการ subscription/config ระดับระบบ",
          })
        : buildRememberedAdminJsonHeaders();
      if (!headers) {
        setDataStatus("auth_required");
        return;
      }

      const [tenantsResponse, channelsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/owner/tenants`, { headers }),
        fetch(`${API_BASE_URL}/api/owner/line-channels`, { headers }),
      ]);

      if (tenantsResponse.status === 401 || tenantsResponse.status === 403) {
        forgetAdminToken();
        setDataStatus("auth_required");
        setResult({
          tone: "warning",
          message: "Admin token ใช้ไม่ได้หรือหมดอายุ กรุณายืนยันสิทธิ์อีกครั้ง",
        });
        return;
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
      setDataStatus("ready");
    } catch (error) {
      setDataStatus("error");
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

  async function testDatasource(tenantId: string) {
    const tenant = tenants.find((item) => item.tenant.id === tenantId)?.tenant;
    if (!tenant) {
      setResult({ tone: "warning", message: "ไม่พบร้านค้าที่ต้องการทดสอบ" });
      return;
    }

    await runOwnerAction(`datasource-${tenantId}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: `ทดสอบ SML datasource ของ ${tenant.name}`,
        description:
          "ตรวจการเชื่อมต่อฐานข้อมูล SML และตารางหลัก โดยไม่แสดง password หรือ credential เต็มใน UI",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนทดสอบ SML datasource");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${tenantId}/datasource/test`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: DatasourceTestResult;
        error?: string;
      };

      if (payload.data) {
        setDatasourceTests((previous) => ({
          ...previous,
          [tenantId]: payload.data as DatasourceTestResult,
        }));
        await loadOwnerData();
        setResult({
          tone: payload.data.ok ? "success" : "warning",
          message: payload.data.ok
            ? `เชื่อมต่อ SML ของ ${tenant.name} สำเร็จ`
            : toDatasourceBusinessMessage(payload.data.safe_error_message),
        });
        return;
      }

      throw new Error(payload.error || "ทดสอบ SML datasource ไม่สำเร็จ");
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

      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-brand-500">
              ภาพรวมเจ้าของ
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
              AI Business SaaS Pilot
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              เพิ่มร้านค้า คุมสถานะ subscription เชื่อม SML และจัดการ LINE OA
              ของแต่ละร้านจากที่เดียว
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge color={dataStatus === "ready" ? "success" : "light"}>
              ใช้งาน {dataStatus === "ready" ? activeCount : "-"}
            </Badge>
            <Badge color={suspendedCount ? "warning" : "light"}>
              ระงับ {dataStatus === "ready" ? suspendedCount : "-"}
            </Badge>
            <Badge color="light">
              {dataStatus === "ready" ? lineChannels.length : "-"} LINE OA
            </Badge>
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

      {dataStatus === "auth_required" ? (
        <OwnerAuthGate onVerify={() => void loadOwnerData({ promptForToken: true })} />
      ) : null}

      {dataStatus === "checking" ? <OwnerLoadingState /> : null}

      {dataStatus === "ready" ? (
        <>
          <OwnerSetupPanel
            busy={busy}
            createTenant={createTenant}
            newTenantId={newTenantId}
            newTenantName={newTenantName}
            setNewTenantId={setNewTenantId}
            setNewTenantName={setNewTenantName}
          />

      <section
        className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]"
        id="tenants"
      >
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="p-5 pb-0">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                ร้านค้าและสิทธิ์การใช้งาน
              </h2>
              <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                ร้านที่ถูกระงับจะเข้า `/app` ไม่ได้ และ scheduler จะไม่ส่ง Morning Brief
                ให้ทุกกลุ่มของร้านนั้น
              </p>
            </div>
            <select
              className="mx-5 mt-5 h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-white md:mx-5 md:mt-5"
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

          <div className="mt-4 divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
            {loading ? (
              <div className="p-5 text-sm text-gray-500 dark:text-gray-400">
                กำลังโหลดข้อมูลร้านค้า...
              </div>
            ) : (
              tenants.map((item) => (
                <TenantCard
                  busy={busy}
                  datasourceTest={datasourceTests[item.tenant.id]}
                  item={item}
                  key={item.tenant.id}
                  onSelectTenant={setSelectedTenantId}
                  onUpdateStatus={updateTenantStatus}
                  selected={item.tenant.id === selectedTenantId}
                />
              ))
            )}
          </div>
        </div>

        <div className="space-y-4">
          <TenantDetailPanel
            busy={busy}
            datasourceTest={
              selectedTenantId ? datasourceTests[selectedTenantId] : undefined
            }
            item={selectedTenantSummary}
            onTestDatasource={testDatasource}
          />

          <LineOnboardingGuide
            publicOrigin={publicOrigin}
            tenantName={selectedTenant?.name ?? "ร้านที่เลือก"}
          />

          <LineChannelPanel
            busy={busy}
            createLineChannel={createLineChannel}
            lineChannelName={lineChannelName}
            lineSecretConfigured={lineSecretConfigured}
            lineTokenConfigured={lineTokenConfigured}
            selectedTenant={selectedTenant}
            selectedTenantId={selectedTenantId}
            selectedTenantLineChannels={selectedTenantLineChannels}
            setLineChannelName={setLineChannelName}
            setLineSecretConfigured={setLineSecretConfigured}
            setLineTokenConfigured={setLineTokenConfigured}
            setSelectedTenantId={setSelectedTenantId}
            tenants={tenants}
          />
        </div>
      </section>
        </>
      ) : null}

    </div>
  );
}

function OwnerAuthGate({ onVerify }: { onVerify: () => void }) {
  return (
    <section className="rounded-xl border border-warning-200 bg-warning-50 p-5 dark:border-warning-500/30 dark:bg-warning-500/10">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Badge color="warning">ต้องยืนยันสิทธิ์</Badge>
          <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">
            ยืนยัน Admin token เพื่อโหลดข้อมูลร้านค้า
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
            เพื่อไม่ให้หน้า owner แสดงข้อมูลผิดหรือโหลดค้าง ระบบจะยังไม่แสดง tenant,
            datasource และ LINE config จนกว่าจะยืนยันสิทธิ์ผู้ดูแล
          </p>
        </div>
        <Button onClick={onVerify} size="sm">
          ยืนยันสิทธิ์ผู้ดูแล
        </Button>
      </div>
    </section>
  );
}

function OwnerLoadingState() {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <Badge color="light">กำลังโหลด</Badge>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="h-20 rounded-lg bg-gray-100 dark:bg-white/[0.04]" />
        <div className="h-20 rounded-lg bg-gray-100 dark:bg-white/[0.04]" />
        <div className="h-20 rounded-lg bg-gray-100 dark:bg-white/[0.04]" />
      </div>
    </section>
  );
}

function OwnerSetupPanel({
  busy,
  createTenant,
  newTenantId,
  newTenantName,
  setNewTenantId,
  setNewTenantName,
}: {
  busy: string | null;
  createTenant: (event: FormEvent<HTMLFormElement>) => void;
  newTenantId: string;
  newTenantName: string;
  setNewTenantId: (value: string) => void;
  setNewTenantName: (value: string) => void;
}) {
  return (
    <details className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              ตั้งค่าเพิ่มเติม
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              เพิ่มร้านใหม่เมื่อเริ่ม pilot ลูกค้ารายถัดไป ส่วน flow หลักคือเลือก tenant ด้านล่างแล้วจัดการต่อ
            </p>
          </div>
          <Badge color="light">คลิกเพื่อเปิด</Badge>
        </div>
      </summary>

      <form
        className="mt-5 border-t border-gray-100 pt-5 dark:border-gray-800"
        onSubmit={createTenant}
      >
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          เพิ่มร้านค้าใหม่
        </h3>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
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
    </details>
  );
}

function LineChannelPanel({
  busy,
  createLineChannel,
  lineChannelName,
  lineSecretConfigured,
  lineTokenConfigured,
  selectedTenant,
  selectedTenantId,
  selectedTenantLineChannels,
  setLineChannelName,
  setLineSecretConfigured,
  setLineTokenConfigured,
  setSelectedTenantId,
  tenants,
}: {
  busy: string | null;
  createLineChannel: (event: FormEvent<HTMLFormElement>) => void;
  lineChannelName: string;
  lineSecretConfigured: boolean;
  lineTokenConfigured: boolean;
  selectedTenant?: Tenant;
  selectedTenantId: string;
  selectedTenantLineChannels: LineChannelRecord[];
  setLineChannelName: (value: string) => void;
  setLineSecretConfigured: (value: boolean) => void;
  setLineTokenConfigured: (value: boolean) => void;
  setSelectedTenantId: (value: string) => void;
  tenants: TenantSummary[];
}) {
  return (
    <details className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              LINE OA ของร้าน
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              เพิ่ม LINE OA metadata เมื่อพร้อมผูกช่องทางจริง
            </p>
          </div>
          <Badge color="light">
            {selectedTenantLineChannels.length} ช่องทาง
          </Badge>
        </div>
      </summary>

      <form
        className="mt-5 border-t border-gray-100 pt-5 dark:border-gray-800"
        onSubmit={createLineChannel}
      >
        <div className="space-y-3">
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

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
              <input
                checked={lineTokenConfigured}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
                onChange={(event) =>
                  setLineTokenConfigured(event.target.checked)
                }
                type="checkbox"
              />
              <span>มี Channel access token แล้ว</span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
              <input
                checked={lineSecretConfigured}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
                onChange={(event) =>
                  setLineSecretConfigured(event.target.checked)
                }
                type="checkbox"
              />
              <span>มี Channel secret สำหรับ webhook แล้ว</span>
            </label>
          </div>

          <Button disabled={busy === "create-line-channel"} size="sm">
            เพิ่ม LINE OA
          </Button>
        </div>
      </form>

      <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800">
        <p className="text-xs font-semibold uppercase text-gray-400">
          LINE OA ที่ผูกกับ {selectedTenant?.name ?? "ร้านนี้"}
        </p>
        <div className="mt-3 space-y-2">
          {selectedTenantLineChannels.length ? (
            selectedTenantLineChannels.map((channel) => (
              <div
                className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
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
                  token:{" "}
                  {channel.channel_access_token_configured ? "มี" : "ยังไม่มี"}{" "}
                  · secret:{" "}
                  {channel.channel_secret_configured ? "มี" : "ยังไม่มี"} ·
                  source: {channel.source}
                </p>
              </div>
            ))
          ) : (
            <p className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
              ยังไม่มี LINE OA สำหรับร้านนี้
            </p>
          )}
        </div>
      </div>
    </details>
  );
}

function TenantCard({
  item,
  busy,
  selected,
  datasourceTest,
  onSelectTenant,
  onUpdateStatus,
}: {
  item: TenantSummary;
  busy: string | null;
  selected: boolean;
  datasourceTest?: DatasourceTestResult;
  onSelectTenant: (tenantId: string) => void;
  onUpdateStatus: (tenant: Tenant, status: Tenant["status"]) => Promise<void>;
}) {
  const tenant = item.tenant;
  const readiness = getTenantReadiness(item, datasourceTest);
  return (
    <div
      className={`bg-white p-4 transition-colors dark:bg-white/[0.02] ${
        selected
          ? "bg-brand-50/40 dark:bg-brand-500/[0.08]"
          : "hover:bg-gray-50 dark:hover:bg-white/[0.04]"
      }`}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {tenant.name}
            </h3>
            <Badge color={tenantStatusTone(tenant.status)}>
              {formatTenantStatus(tenant.status)}
            </Badge>
            <Badge color="light">{tenant.planCode}</Badge>
            <Badge color={readiness.tone}>
              {readiness.label}
            </Badge>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {tenant.id} · ฐานข้อมูล {tenant.databaseName || "ยังไม่ตั้งค่า"}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {item.access.message}
          </p>

          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 2xl:grid-cols-4">
            <CompactFact
              label="SML"
              value={
                datasourceTest
                  ? datasourceTest.ok
                    ? "ทดสอบผ่าน"
                    : "ต้องตรวจ"
                  : item.health.datasource_configured
                    ? "พร้อม"
                    : "ยังไม่พร้อม"
              }
            />
            <CompactFact
              label="LINE"
              value={`${item.health.line_channels} OA · ${item.health.line_targets_enabled}/${item.health.line_targets_total} กลุ่ม`}
            />
            <CompactFact
              label="รายงานล่าสุด"
              value={
                item.health.latest_snapshot_at
                  ? formatDateTime(item.health.latest_snapshot_at)
                  : "ยังไม่มี"
              }
            />
            <CompactFact label="Dashboard" value={item.customer_dashboard_path ?? "-"} />
          </dl>
        </div>
        <div className="flex flex-wrap gap-2 xl:max-w-[260px] xl:justify-end">
          <Button
            disabled={selected}
            size="sm"
            variant="outline"
            onClick={() => onSelectTenant(tenant.id)}
          >
            {selected ? "เลือกอยู่" : "จัดการ"}
          </Button>
          {item.customer_dashboard_path ? (
            <Link
              className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.03]"
              href={item.customer_dashboard_path}
              rel="noreferrer"
              target="_blank"
            >
              Dashboard
            </Link>
          ) : null}
          <Button
            disabled={busy === `${tenant.id}-active`}
            size="sm"
            variant="outline"
            onClick={() => void onUpdateStatus(tenant, "active")}
          >
            เปิด
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
    </div>
  );
}

function TenantDetailPanel({
  item,
  busy,
  datasourceTest,
  onTestDatasource,
}: {
  item?: TenantSummary;
  busy: string | null;
  datasourceTest?: DatasourceTestResult;
  onTestDatasource: (tenantId: string) => Promise<void>;
}) {
  if (!item) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
        เลือกร้านค้าเพื่อดูรายละเอียดการตั้งค่า
      </div>
    );
  }

  const tenant = item.tenant;
  const datasourceBusy = busy === `datasource-${tenant.id}`;
  const readiness = getTenantReadiness(item, datasourceTest);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-gray-400">
            ร้านที่กำลังจัดการ
          </p>
          <h2 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
            {tenant.name}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {tenant.id}
          </p>
        </div>
        <Badge color={tenantStatusTone(tenant.status)}>
          {formatTenantStatus(tenant.status)}
        </Badge>
      </div>

      <dl className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
        <DetailRow label="แพ็กเกจ" value={tenant.planCode} />
        <DetailRow
          label="Dashboard ลูกค้า"
          value={item.customer_dashboard_path ?? "ยังไม่มี slug"}
        />
        <DetailRow
          label="ฐานข้อมูล SML"
          value={tenant.databaseName || "ยังไม่ระบุ"}
        />
        <DetailRow
          label="สถานะบริการ"
          value={item.access.enabled ? "เปิดใช้งาน" : "ถูกบล็อก"}
        />
      </dl>

      <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
        <details className="mb-4 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <summary className="cursor-pointer list-none">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  Pilot readiness checklist
                </p>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  เปิดดูเฉพาะตอนเตรียม rollout ร้านนี้
                </p>
              </div>
              <Badge color={readiness.tone}>{readiness.label}</Badge>
            </div>
          </summary>
          <div className="mt-3 grid gap-2">
            {readiness.items.map((check) => (
              <ReadinessRow key={check.label} item={check} />
            ))}
          </div>
        </details>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              SML PostgreSQL datasource
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              ตรวจว่า API server เชื่อมฐานข้อมูลได้ และพบตาราง SML ที่รายงานนี้ต้องใช้
            </p>
          </div>
          <Button
            disabled={datasourceBusy}
            size="sm"
            variant="outline"
            onClick={() => void onTestDatasource(tenant.id)}
          >
            {datasourceBusy ? "กำลังทดสอบ..." : "ทดสอบ SML"}
          </Button>
        </div>

        <DatasourceTestSummary result={datasourceTest} />

        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3 text-xs leading-5 text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          Secret readiness: รอบนี้วางฐาน encrypted secret store แล้ว แต่หน้า config ยังไม่รับ password/token ดิบจนกว่าจะเปิด workflow บันทึก secret แบบ masked + audited.
        </div>
      </div>
    </div>
  );
}

function LineOnboardingGuide({
  publicOrigin,
  tenantName,
}: {
  publicOrigin: string;
  tenantName: string;
}) {
  const webhookUrl = publicOrigin
    ? `${publicOrigin}/api/line/webhook`
    : "/api/line/webhook";

  return (
    <details className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-400">
              LINE OA onboarding
            </p>
            <h2 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
              วิธีให้ {tenantName} เริ่มรับ Morning Brief
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              ดึง OA เข้ากลุ่ม → พิมพ์ test → owner อนุมัติสิทธิ์
            </p>
          </div>
          <Badge color="light">ไม่ auto-enable กลุ่มใหม่</Badge>
        </div>
      </summary>

      <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Webhook URL สำหรับ trycloudflare รอบนี้
        </p>
        <p className="mt-2 break-all rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-white">
          {webhookUrl}
        </p>
      </div>

      <div className="mt-4 space-y-2">
        {[
          "เพิ่มหรือเลือก LINE OA ของร้านใน LINE Developers",
          "ตั้ง Webhook URL และเปิด Use webhook",
          "ให้ลูกค้าดึง OA เข้ากลุ่ม LINE ที่ต้องการรับรายงาน",
          "ให้ลูกค้าพิมพ์ test ในกลุ่ม เพื่อให้ระบบ discover target",
          "กลับมาหน้า LINE OA/สิทธิ์กลุ่ม แล้วอนุมัติ profile เช่น ผู้บริหาร หรือฝ่ายขาย",
          "กดส่งทดสอบเฉพาะกลุ่มก่อนเปิด Morning Brief ประจำวัน",
        ].map((step, index) => (
          <div
            className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
            key={step}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
              {index + 1}
            </span>
            <p className="text-sm leading-6 text-gray-700 dark:text-gray-300">
              {step}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}

function DatasourceTestSummary({
  result,
}: {
  result?: DatasourceTestResult;
}) {
  if (!result) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-gray-200 p-3 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        ยังไม่ได้ทดสอบในรอบนี้ กด “ทดสอบ SML” เพื่อเช็ค connection จริงจาก server
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={result.ok ? "success" : "warning"}>
          {result.ok ? "เชื่อมต่อได้" : "ควรตรวจสอบ"}
        </Badge>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          ตรวจล่าสุด {formatDateTime(result.checked_at)} · {result.latency_ms} ms
        </span>
      </div>
      {result.safe_error_message ? (
        <p className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
          {toDatasourceBusinessMessage(result.safe_error_message)}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <HealthFact
          label="Database"
          value={result.database_name ?? "ไม่ทราบชื่อ"}
        />
        <HealthFact
          label="DB user"
          value={result.user_name_masked ?? "ไม่เปิดเผย"}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {Object.entries(result.required_tables).map(([table, ok]) => (
          <div
            className="rounded-lg border border-gray-100 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900"
            key={table}
          >
            <p className="font-semibold text-gray-900 dark:text-white">
              {table}
            </p>
            <p
              className={`mt-1 text-xs ${
                ok ? "text-success-600" : "text-warning-600"
              }`}
            >
              {ok ? "พบตาราง" : "ไม่พบตาราง"}
            </p>
          </div>
        ))}
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

function CompactFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 truncate font-semibold text-gray-900 dark:text-white">
        {value}
      </dd>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-3 py-2.5 text-sm">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="min-w-0 truncate font-semibold text-gray-900 dark:text-white">
        {value}
      </dd>
    </div>
  );
}

type ReadinessCheck = {
  ok: boolean;
  label: string;
  detail: string;
};

function ReadinessRow({ item }: { item: ReadinessCheck }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <div>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {item.label}
        </p>
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
          {item.detail}
        </p>
      </div>
      <Badge color={item.ok ? "success" : "warning"}>
        {item.ok ? "พร้อม" : "ต้องทำ"}
      </Badge>
    </div>
  );
}

function getTenantReadiness(
  item: TenantSummary,
  datasourceTest?: DatasourceTestResult,
) {
  const hasLineRoute =
    item.health.line_channels > 0 && item.health.line_targets_enabled > 0;
  const checks: ReadinessCheck[] = [
    {
      ok: item.access.enabled,
      label: "Subscription เปิดใช้งาน",
      detail: item.access.enabled
        ? "ลูกค้าเข้า dashboard และ scheduler ส่ง LINE ได้ตามสิทธิ์"
        : item.access.message,
    },
    {
      ok: datasourceTest ? datasourceTest.ok : item.health.datasource_configured,
      label: "SML datasource เชื่อมได้",
      detail: datasourceTest
        ? datasourceTest.ok
          ? `ทดสอบผ่าน ${datasourceTest.latency_ms} ms`
          : toDatasourceBusinessMessage(datasourceTest.safe_error_message)
        : item.health.datasource_configured
          ? "มี datasource config แล้ว ควรกดทดสอบก่อน rollout"
          : "ยังไม่ได้ตั้งค่า datasource สำหรับร้านนี้",
    },
    {
      ok: Boolean(item.health.latest_snapshot_at),
      label: "มีรายงานล่าสุด",
      detail: item.health.latest_snapshot_at
        ? `ล่าสุด ${formatDateTime(item.health.latest_snapshot_at)}`
        : "ยังไม่มี snapshot ให้ลูกค้าดู",
    },
    {
      ok: item.health.line_channels > 0,
      label: "LINE OA ลงทะเบียนแล้ว",
      detail: item.health.line_channels
        ? `${item.health.line_channels} LINE OA`
        : "ยังไม่มี LINE OA metadata สำหรับร้านนี้",
    },
    {
      ok: item.health.line_targets_enabled > 0,
      label: "มีกลุ่ม LINE ที่อนุมัติแล้ว",
      detail: `${item.health.line_targets_enabled}/${item.health.line_targets_total} target เปิดรับ Morning Brief`,
    },
    {
      ok: hasLineRoute && item.health.latest_line_delivery_status === "success",
      label: "ส่ง LINE ทดสอบสำเร็จ",
      detail: !hasLineRoute
        ? "ต้องตั้ง LINE OA และอนุมัติกลุ่มก่อน จึงค่อยนับผลส่งทดสอบ"
        : item.health.latest_line_delivery_at
        ? `${formatLineDeliveryStatus(item.health.latest_line_delivery_status)} · ${formatDateTime(item.health.latest_line_delivery_at)}`
        : "ยังไม่มี delivery log สำเร็จ",
    },
  ];
  const readyCount = checks.filter((check) => check.ok).length;
  const tone =
    readyCount === checks.length
      ? ("success" as const)
      : readyCount >= 4
        ? ("warning" as const)
        : ("error" as const);

  return {
    items: checks,
    readyCount,
    tone,
    label:
      readyCount === checks.length
        ? "พร้อม pilot"
        : `${readyCount}/${checks.length} พร้อม`,
  };
}

function formatLineDeliveryStatus(status: string | null) {
  if (status === "success") {
    return "ส่งสำเร็จ";
  }
  if (status === "failed") {
    return "ส่งไม่สำเร็จ";
  }
  if (status === "skipped") {
    return "ข้ามการส่ง";
  }
  return "ยังไม่ทราบสถานะ";
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

function toDatasourceBusinessMessage(value: string | null) {
  if (!value) {
    return "เชื่อมต่อได้";
  }
  if (value.includes("not configured")) {
    return "ยังไม่ได้ตั้งค่าฐานข้อมูล SML สำหรับร้านนี้บน server";
  }
  if (value.includes("authentication")) {
    return "ชื่อผู้ใช้หรือรหัสผ่านฐานข้อมูลไม่ถูกต้อง";
  }
  if (value.includes("timed out")) {
    return "เชื่อมต่อฐานข้อมูลช้าเกินเวลาที่กำหนด";
  }
  if (value.includes("unreachable")) {
    return "ติดต่อฐานข้อมูลไม่ได้ กรุณาตรวจ host, port หรือ network/VPN";
  }
  if (value.includes("required SML tables")) {
    return "เชื่อมต่อได้ แต่ยังไม่พบตาราง SML ที่รายงานนี้ต้องใช้ครบ";
  }
  return "ทดสอบ datasource ไม่สำเร็จ กรุณาตรวจการตั้งค่าฐานข้อมูล";
}
