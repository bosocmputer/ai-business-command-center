"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deriveMorningBriefDateRange,
  type LineAccessProfileKey,
  type LineDeliveryRecord,
  type LineSendMode,
  type LineTargetRecord,
  type ReportRunRecord,
  type SalesGoodsServicesSnapshot,
  type Tenant,
  type TenantId,
  type WorkerHeartbeatRecord,
} from "@ai-bcc/shared";
import ComponentCard from "@/components/common/ComponentCard";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Alert from "@/components/ui/alert/Alert";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import Select from "@/components/form/Select";
import Label from "@/components/form/Label";
import { buildAdminJsonHeaders, forgetAdminToken } from "./adminAuth";
import { getCommandCenterApiBaseUrl } from "./apiBaseUrl";

type OperationsStatus = {
  api: {
    ok: boolean;
    system_store: "postgres" | "local-json";
    time: string;
  };
  dashboard: {
    dashboard_url: string | null;
    app_base_url_configured: boolean;
    public_api_base_url_configured: boolean;
  };
  scheduler: {
    enabled: boolean;
    tenant_ids: string[];
    time: string;
    timezone: string;
    mode: LineSendMode;
    force: boolean;
  };
  worker: {
    heartbeat_configured: boolean;
    latest_heartbeat: WorkerHeartbeatRecord | null;
    age_seconds: number | null;
    status: WorkerHeartbeatRecord["status"] | "stale" | "missing";
  };
  tenants: Array<{
    id: TenantId;
    name: string;
    database_name: string;
    datasource_configured: boolean;
    line_configured: boolean;
    line_target_masked: string | null;
  }>;
};

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

type ActionResult = {
  title: string;
  status: "success" | "warning" | "error";
  message: string;
  details?: string;
};

const API_BASE_URL = getCommandCenterApiBaseUrl();

const defaultTenantId: TenantId = "tenant_demo_remote";

export default function CommandCenterSettings() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<TenantId>(defaultTenantId);
  const [operations, setOperations] = useState<OperationsStatus | null>(null);
  const [snapshot, setSnapshot] = useState<SalesGoodsServicesSnapshot | null>(
    null,
  );
  const [runs, setRuns] = useState<ReportRunRecord[]>([]);
  const [deliveries, setDeliveries] = useState<LineDeliveryRecord[]>([]);
  const [lineTargets, setLineTargets] = useState<LineTargetRecord[]>([]);
  const [datasourceTest, setDatasourceTest] =
    useState<DatasourceTestResult | null>(null);
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const yesterday = useMemo(
    () => deriveMorningBriefDateRange({ period: "yesterday" }),
    [],
  );

  const loadSettings = useCallback(async (nextTenantId: TenantId) => {
    setLoading(true);
    setError(null);
    try {
      const [
        tenantsResponse,
        operationsResponse,
        snapshotResponse,
        runsResponse,
        deliveriesResponse,
        lineTargetsResponse,
      ] = await Promise.all([
        fetch(`${API_BASE_URL}/api/tenants`),
        fetch(`${API_BASE_URL}/api/operations/status`),
        fetch(
          `${API_BASE_URL}/api/reports/${nextTenantId}/sales_goods_services/latest`,
        ),
        fetch(
          `${API_BASE_URL}/api/reports/${nextTenantId}/sales_goods_services/runs`,
        ),
        fetch(
          `${API_BASE_URL}/api/reports/${nextTenantId}/sales_goods_services/line-deliveries`,
        ),
        fetch(`${API_BASE_URL}/api/line-targets?tenant_id=${nextTenantId}`),
      ]);

      if (!tenantsResponse.ok || !operationsResponse.ok || !runsResponse.ok) {
        throw new Error("โหลดสถานะระบบไม่สำเร็จ");
      }

      const tenantsPayload = (await tenantsResponse.json()) as {
        data: Tenant[];
      };
      const operationsPayload = (await operationsResponse.json()) as {
        data: OperationsStatus;
      };
      const runsPayload = (await runsResponse.json()) as {
        data: ReportRunRecord[];
      };
      const deliveriesPayload = deliveriesResponse.ok
        ? ((await deliveriesResponse.json()) as { data: LineDeliveryRecord[] })
        : { data: [] };
      const lineTargetsPayload = lineTargetsResponse.ok
        ? ((await lineTargetsResponse.json()) as { data: LineTargetRecord[] })
        : { data: [] };
      const snapshotPayload = snapshotResponse.ok
        ? ((await snapshotResponse.json()) as {
            data: SalesGoodsServicesSnapshot;
          })
        : { data: null };

      setTenants(tenantsPayload.data);
      setOperations(operationsPayload.data);
      setSnapshot(snapshotPayload.data);
      setRuns(runsPayload.data);
      setDeliveries(deliveriesPayload.data);
      setLineTargets(lineTargetsPayload.data);
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "โหลดสถานะระบบไม่สำเร็จ",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setDatasourceTest(null);
    setActionResult(null);
    void loadSettings(tenantId);
  }, [loadSettings, tenantId]);

  const selectedTenant = tenants.find((tenant) => tenant.id === tenantId);
  const tenantStatus = operations?.tenants.find(
    (tenant) => tenant.id === tenantId,
  );
  const tenantOptions = tenants.map((tenant) => ({
    value: tenant.id,
    label: `${tenant.name} (ฐาน ${tenant.databaseName})`,
  }));
  const latestRun = runs[0] ?? null;
  const latestDelivery = deliveries[0] ?? null;
  const enabledLineTargetCount = lineTargets.filter(
    (target) =>
      target.enabled &&
      target.approved &&
      target.allowed_actions.includes("receive_morning_brief") &&
      target.allowed_report_keys.includes("sales_goods_services"),
  ).length;
  const yesterdaySuccessDelivery =
    deliveries.find(
      (delivery) =>
        delivery.delivery_type === "morning_brief" &&
        delivery.period_from === yesterday.date_from &&
        delivery.period_to === yesterday.date_to &&
        delivery.status === "success",
    ) ?? null;

  const readinessItems = [
    {
      label: "เชื่อมฐานข้อมูลบริษัท",
      description: tenantStatus?.datasource_configured
        ? `ฐาน ${tenantStatus.database_name}`
        : "ยังไม่ตั้งค่าฐานข้อมูล",
      ok: Boolean(tenantStatus?.datasource_configured),
    },
    {
      label: "ตาราง SML สำคัญพร้อม",
      description: datasourceTest
        ? datasourceTest.ok
          ? `ตรวจแล้ว ${datasourceTest.latency_ms} ms`
          : datasourceTest.safe_error_message ?? "ตรวจไม่ผ่าน"
        : "กดทดสอบเพื่อยืนยัน ic_trans, ic_trans_detail, ar_customer",
      ok: datasourceTest?.ok ?? null,
    },
    {
      label: "LINE OA พร้อมส่ง",
      description: tenantStatus?.line_configured
        ? enabledLineTargetCount
          ? `ส่งได้ ${enabledLineTargetCount} กลุ่ม/ปลายทาง`
          : `ปลายทาง ${tenantStatus.line_target_masked}`
        : "ยังไม่ตั้งค่า LINE OA",
      ok: Boolean(tenantStatus?.line_configured),
    },
    {
      label: "งานส่งอัตโนมัติทำงาน",
      description: operations
        ? `${operations.scheduler.time} ${operations.scheduler.timezone} · ${formatWorkerStatus(operations.worker.status)}`
        : "กำลังโหลด",
      ok: operations
        ? operations.scheduler.enabled && operations.worker.status === "ok"
        : false,
    },
    {
      label: "มีข้อมูลล่าสุดให้แสดง",
      description: snapshot
        ? `${formatReportPeriod(snapshot.params.date_from, snapshot.params.date_to)} · ${formatDateTime(snapshot.generated_at)}`
        : "ยังไม่มี snapshot",
      ok: Boolean(snapshot),
    },
    {
      label: "สรุปเช้าของเมื่อวาน",
      description: yesterdaySuccessDelivery
        ? `ส่งแล้ว ${formatDateTime(yesterdaySuccessDelivery.created_at)}`
        : `ยังไม่พบการส่งสำเร็จสำหรับ ${formatReportPeriod(yesterday.date_from, yesterday.date_to)}`,
      ok: Boolean(yesterdaySuccessDelivery),
    },
  ];

  const readyCount = readinessItems.filter((item) => item.ok === true).length;
  const requiredCount = readinessItems.length;

  async function testDatasource() {
    await runAction("datasource", async () => {
      const payload = await postJson<{ data: DatasourceTestResult }>(
        `${API_BASE_URL}/api/tenants/${tenantId}/datasource/test`,
        {},
      );
      setDatasourceTest(payload.data);
      setActionResult({
        title: "ทดสอบฐานข้อมูล",
        status: payload.data.ok ? "success" : "error",
        message: payload.data.ok
          ? "เชื่อมฐานข้อมูลและพบตาราง SML สำคัญครบ"
          : payload.data.safe_error_message ?? "เชื่อมฐานข้อมูลไม่สำเร็จ",
        details: `เวลาเชื่อมต่อ ${payload.data.latency_ms} ms`,
      });
      await loadSettings(tenantId);
    });
  }

  async function runYesterdayReport() {
    await runAction("report", async () => {
      const payload = await postJson<{
        data?: SalesGoodsServicesSnapshot;
        error?: string;
      }>(
        `${API_BASE_URL}/api/reports/${tenantId}/sales_goods_services/run`,
        yesterday,
      );

      if (!payload.data) {
        throw new Error(payload.error || "รันรายงานไม่สำเร็จ");
      }

      setActionResult({
        title: "รันรายงานเมื่อวาน",
        status: "success",
        message: "รันรายงานและอัปเดตข้อมูลล่าสุดแล้ว",
        details: `${formatReportPeriod(payload.data.params.date_from, payload.data.params.date_to)} · ${formatInteger(payload.data.summary.document_count)} บิล`,
      });
      await loadSettings(tenantId);
    });
  }

  async function dryRunMorningBrief() {
    await runAction("dry_run", async () => {
      const payload = await postJson<{
        data?: { delivery?: LineDeliveryRecord; status?: "skipped" };
        error?: string;
      }>(
        `${API_BASE_URL}/api/reports/${tenantId}/sales_goods_services/morning-brief/run-and-send`,
        { period: "yesterday", mode: "dry_run", force: true },
      );

      if (!payload.data) {
        throw new Error(payload.error || "ทดสอบข้อความไม่สำเร็จ");
      }

      setActionResult({
        title: "ทดสอบข้อความ LINE",
        status: "success",
        message: "สร้างข้อความสรุปเช้าแบบไม่ส่งจริงแล้ว",
        details: payload.data.delivery?.report_run_id,
      });
      await loadSettings(tenantId);
    });
  }

  async function sendMorningBrief() {
    await runAction("send", async () => {
      if (
        !window.confirm(
          [
            "ยืนยันส่ง LINE Morning Brief จริง?",
            `บริษัท: ${selectedTenant?.name ?? tenantId}`,
            `วันที่ข้อมูล: ${formatReportPeriod(yesterday.date_from, yesterday.date_to)}`,
            `ปลายทางที่มีสิทธิ์: ${enabledLineTargetCount || 0} กลุ่ม/ปลายทาง`,
          ].join("\n"),
        )
      ) {
        return;
      }

      const payload = await postJson<{
        data?: {
          status?: "skipped" | "sent" | "processed";
          reason?: string;
          delivery?: LineDeliveryRecord;
          deliveries?: LineDeliveryRecord[];
        };
        error?: string;
      }>(
        `${API_BASE_URL}/api/reports/${tenantId}/sales_goods_services/morning-brief/run-and-send`,
        { period: "yesterday", mode: "send", force: false },
      );

      if (!payload.data) {
        throw new Error(payload.error || "ส่ง LINE ไม่สำเร็จ");
      }

      const skipped = payload.data.status === "skipped";
      const deliveries = payload.data.deliveries ?? [];
      const delivery = payload.data.delivery ?? deliveries[0];
      const successCount = deliveries.filter(
        (item) => item.status === "success",
      ).length;
      const skippedCount = deliveries.filter(
        (item) => item.status === "skipped",
      ).length;
      setActionResult({
        title: "ส่งสรุปเข้า LINE",
        status: skipped
          ? "warning"
          : successCount > 0
          ? "success"
          : delivery?.status === "success"
          ? "success"
          : "error",
        message: skipped
          ? "ไม่มีปลายทางที่ต้องส่ง หรือระบบกันส่งซ้ำทำงานแล้ว"
          : successCount > 0
          ? `ส่ง LINE สำเร็จ ${successCount} ปลายทาง${skippedCount ? ` · ข้าม ${skippedCount}` : ""}`
          : delivery?.safe_error_message ?? "ส่ง LINE ไม่สำเร็จ",
        details: delivery?.report_run_id,
      });
      await loadSettings(tenantId);
    });
  }

  async function runAction(name: string, action: () => Promise<void>) {
    setBusyAction(name);
    setError(null);
    try {
      await action();
    } catch (unknownError) {
      setActionResult({
        title: "ทำรายการไม่สำเร็จ",
        status: "error",
        message:
          unknownError instanceof Error
            ? unknownError.message
            : "ทำรายการไม่สำเร็จ",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function approveLineTarget(
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) {
    await runAction(`approve-${target.id}`, async () => {
      const payload = await postJson<{ data?: LineTargetRecord; error?: string }>(
        `${API_BASE_URL}/api/line-targets/${target.id}/approve`,
        {
          access_profile_key: profileKey,
          enabled: true,
        },
      );
      if (!payload.data) {
        throw new Error(payload.error || "อนุมัติ LINE target ไม่สำเร็จ");
      }
      setActionResult({
        title: "อนุมัติ LINE target",
        status: "success",
        message: `เปิดใช้งาน ${payload.data.display_name} แล้ว`,
      });
      await loadSettings(tenantId);
    });
  }

  async function updateLineTargetProfile(
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) {
    await runAction(`profile-${target.id}-${profileKey}`, async () => {
      const payload = await patchJson<{ data?: LineTargetRecord; error?: string }>(
        `${API_BASE_URL}/api/line-targets/${target.id}`,
        {
          access_profile_key: profileKey,
        },
      );
      if (!payload.data) {
        throw new Error(payload.error || "เปลี่ยนสิทธิ์ LINE target ไม่สำเร็จ");
      }
      setActionResult({
        title: "เปลี่ยนสิทธิ์ LINE target",
        status: "success",
        message: `${payload.data.display_name}: ${formatAccessProfile(payload.data.access_profile_key)}`,
      });
      await loadSettings(tenantId);
    });
  }

  async function toggleLineTarget(target: LineTargetRecord) {
    await runAction(`toggle-${target.id}`, async () => {
      const payload = await patchJson<{ data?: LineTargetRecord; error?: string }>(
        `${API_BASE_URL}/api/line-targets/${target.id}`,
        {
          enabled: !target.enabled,
        },
      );
      if (!payload.data) {
        throw new Error(payload.error || "เปลี่ยนสถานะ LINE target ไม่สำเร็จ");
      }
      setActionResult({
        title: "เปลี่ยนสถานะ LINE target",
        status: "success",
        message: payload.data.enabled
          ? "เปิดรับ Morning Brief แล้ว"
          : "ปิดรับ Morning Brief แล้ว",
      });
      await loadSettings(tenantId);
    });
  }

  async function testLineTarget(target: LineTargetRecord) {
    await runAction(`target-test-${target.id}`, async () => {
      if (
        !window.confirm(
          [
            "ยืนยันส่ง LINE test จริงไปยังปลายทางนี้?",
            `ปลายทาง: ${target.display_name}`,
            `Target: ${target.target_id_masked}`,
            `สิทธิ์: ${formatAccessProfile(target.access_profile_key)}`,
          ].join("\n"),
        )
      ) {
        return;
      }

      const payload = await postJson<{
        data?: { delivery?: LineDeliveryRecord };
        error?: string;
      }>(`${API_BASE_URL}/api/line-targets/${target.id}/test-send`, {
        mode: "send",
      });
      if (!payload.data?.delivery) {
        throw new Error(payload.error || "ส่ง LINE test ไม่สำเร็จ");
      }
      setActionResult({
        title: "ส่ง LINE target test",
        status: payload.data.delivery.status === "success" ? "success" : "error",
        message:
          payload.data.delivery.status === "success"
            ? "ส่งทดสอบสำเร็จ"
            : payload.data.delivery.safe_error_message ?? "ส่งทดสอบไม่สำเร็จ",
      });
      await loadSettings(tenantId);
    });
  }

  return (
    <div className="space-y-6">
      <PageBreadcrumb
        pageTitle="ตั้งค่าระบบ"
        homeLabel="แดชบอร์ด"
        homeHref="/command-center"
      />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge color={readyCount === requiredCount ? "success" : "warning"}>
                พร้อม {readyCount}/{requiredCount}
              </Badge>
              <Badge color={operations?.api.system_store === "postgres" ? "success" : "warning"}>
                {operations?.api.system_store === "postgres"
                  ? "ฐานระบบพร้อม"
                  : "โหมดทดลอง"}
              </Badge>
            </div>
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
              ตั้งค่าระบบและความพร้อมของบริษัท
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              ตรวจฐานข้อมูล SML, LINE OA, งานส่งสรุปตอนเช้า และข้อมูลล่าสุดของแต่ละบริษัท
              ก่อนเปิดให้ลูกค้าทดลองใช้งานจริง
            </p>
          </div>

          <div className="w-full xl:max-w-md">
            <Label>บริษัท / ฐานข้อมูล</Label>
            <Select
              key={tenantId}
              options={tenantOptions.length ? tenantOptions : []}
              defaultValue={tenantId}
              onChange={(value) => setTenantId(value as TenantId)}
            />
          </div>
        </div>
      </div>

      {error && (
        <Alert
          variant="error"
          title="โหลดสถานะระบบไม่สำเร็จ"
          message={error}
        />
      )}

      {loading ? (
        <SettingsLoadingState />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.8fr)]">
            <ReadinessChecklist items={readinessItems} />
            <ActionPanel
              busyAction={busyAction}
              actionResult={actionResult}
              onTestDatasource={() => void testDatasource()}
              onRunYesterday={() => void runYesterdayReport()}
              onDryRunLine={() => void dryRunMorningBrief()}
              onSendLine={() => void sendMorningBrief()}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <StatusCard
              label="บริษัท"
              value={selectedTenant?.name ?? tenantId}
              detail={`ฐาน ${selectedTenant?.databaseName ?? tenantStatus?.database_name ?? "-"}`}
              tone="light"
            />
            <StatusCard
              label="ฐานข้อมูล SML"
              value={tenantStatus?.datasource_configured ? "เชื่อมต่อแล้ว" : "ยังไม่ตั้งค่า"}
              detail={
                datasourceTest
                  ? `ตรวจล่าสุด ${formatDateTime(datasourceTest.checked_at)}`
                  : "กดทดสอบเพื่อยืนยัน"
              }
              tone={tenantStatus?.datasource_configured ? "success" : "warning"}
            />
            <StatusCard
              label="LINE OA"
              value={tenantStatus?.line_configured ? "พร้อมส่ง" : "ยังไม่ตั้งค่า"}
              detail={tenantStatus?.line_target_masked ?? "ไม่มี target"}
              tone={tenantStatus?.line_configured ? "success" : "warning"}
            />
            <StatusCard
              label="งานส่งเช้า"
              value={
                operations?.scheduler.enabled
                  ? `${operations.scheduler.time} ${operations.scheduler.timezone}`
                  : "ปิดอยู่"
              }
              detail={`งานเบื้องหลัง ${formatWorkerStatus(operations?.worker.status ?? "missing")}`}
              tone={
                operations?.scheduler.enabled && operations.worker.status === "ok"
                  ? "success"
                  : "warning"
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <LatestSnapshotCard snapshot={snapshot} />
            <LatestRunCard run={latestRun} />
            <LatestLineDeliveryCard delivery={latestDelivery} />
          </div>

          <LineTargetsCard
            targets={lineTargets}
            busyAction={busyAction}
            onRefresh={() => void loadSettings(tenantId)}
            onApprove={(target, profileKey) =>
              void approveLineTarget(target, profileKey)
            }
            onSetProfile={(target, profileKey) =>
              void updateLineTargetProfile(target, profileKey)
            }
            onToggleEnabled={(target) => void toggleLineTarget(target)}
            onTestSend={(target) => void testLineTarget(target)}
          />
        </>
      )}
    </div>
  );

}

function ReadinessChecklist({
  items,
}: {
  items: Array<{
    label: string;
    description: string;
    ok: boolean | null;
  }>;
}) {
  return (
    <ComponentCard
      title="Checklist ความพร้อม"
      desc="ใช้เช็คก่อน demo หรือก่อนเปิด tenant ให้ลูกค้าใช้งานจริง"
      action={
        <Badge color="light">
          {items.filter((item) => item.ok === true).length}/{items.length}
        </Badge>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-gray-100 p-4 dark:border-gray-800"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                {item.label}
              </p>
              <Badge color={readinessTone(item.ok)}>
                {item.ok === true ? "พร้อม" : item.ok === false ? "ต้องตรวจ" : "รอทดสอบ"}
              </Badge>
            </div>
            <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
              {item.description}
            </p>
          </div>
        ))}
      </div>
    </ComponentCard>
  );
}

function LineTargetsCard({
  targets,
  busyAction,
  onRefresh,
  onApprove,
  onSetProfile,
  onToggleEnabled,
  onTestSend,
}: {
  targets: LineTargetRecord[];
  busyAction: string | null;
  onRefresh: () => void;
  onApprove: (target: LineTargetRecord, profileKey: LineAccessProfileKey) => void;
  onSetProfile: (target: LineTargetRecord, profileKey: LineAccessProfileKey) => void;
  onToggleEnabled: (target: LineTargetRecord) => void;
  onTestSend: (target: LineTargetRecord) => void;
}) {
  return (
    <ComponentCard
      title="กลุ่ม LINE และสิทธิ์การรับรายงาน"
      desc="กำหนดว่ากลุ่มไหนรับ Morning Brief หรือเปิดรายงานขายได้ ก่อนต่อ chatbot ในอนาคต"
      action={
        <div className="flex items-center gap-2">
          <Badge color="light">{targets.length} targets</Badge>
          <Button
            size="sm"
            variant="outline"
            className="px-3 py-2"
            disabled={Boolean(busyAction)}
            onClick={onRefresh}
          >
            รีเฟรช
          </Button>
        </div>
      }
    >
      <div className="mb-4 rounded-xl border border-blue-light-100 bg-blue-light-50 p-4 dark:border-blue-light-500/20 dark:bg-blue-light-500/10">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge color="info">เริ่มใช้งานกลุ่มใหม่</Badge>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            ขั้นตอนสำหรับผู้ดูแล
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 text-sm text-gray-600 dark:text-gray-300 md:grid-cols-5">
          {[
            ["1", "เพิ่ม OA เข้ากลุ่ม LINE"],
            ["2", "พิมพ์ test ในกลุ่ม"],
            ["3", "กลับมากดรีเฟรช"],
            ["4", "อนุมัติสิทธิ์ของกลุ่ม"],
            ["5", "กดส่งทดสอบ"],
          ].map(([step, label]) => (
            <div
              key={step}
              className="rounded-lg border border-white/70 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.04]"
            >
              <p className="mb-1 text-xs font-semibold text-brand-600 dark:text-brand-400">
                Step {step}
              </p>
              <p>{label}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
          ระบบจะพยายามดึงชื่อกลุ่มจาก LINE อัตโนมัติ ถ้ายังเห็นเป็นรหัสกลุ่ม ให้รอสักครู่แล้วกดรีเฟรช
          หรือส่งข้อความในกลุ่มอีกครั้งเพื่อให้ webhook อัปเดตข้อมูลล่าสุด
        </p>
      </div>

      {targets.length === 0 ? (
        <div className="rounded-xl border border-gray-100 p-4 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          ยังไม่พบกลุ่ม LINE ใหม่ ให้เพิ่ม OA เข้ากลุ่มแล้วพิมพ์ `test` ในกลุ่มก่อน ระบบจะบันทึกเป็นรายการรออนุมัติ
        </div>
      ) : (
        <div className="space-y-3">
          {targets.map((target) => {
            const isEnvFallback = target.source === "env_fallback";
            const canReceiveSales =
              target.approved &&
              target.enabled &&
              target.allowed_actions.includes("receive_morning_brief") &&
              target.allowed_report_keys.includes("sales_goods_services");
            return (
              <div
                key={target.id}
                className="rounded-xl border border-gray-100 p-4 dark:border-gray-800"
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-gray-800 dark:text-white/90">
                        {target.display_name}
                      </p>
                      <Badge color={canReceiveSales ? "success" : "warning"}>
                        {canReceiveSales ? "รับรายงานขายได้" : "ยังไม่พร้อมรับ"}
                      </Badge>
                      <Badge color={isEnvFallback ? "light" : "info"}>
                        {formatLineTargetSource(target.source)}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 gap-2 text-xs text-gray-500 dark:text-gray-400 md:grid-cols-2 xl:grid-cols-4">
                      <span>ประเภท: {formatLineTargetType(target.target_type)}</span>
                      <span>รหัสปลายทาง: {target.target_id_masked}</span>
                      <span>สิทธิ์: {formatAccessProfile(target.access_profile_key)}</span>
                      <span>
                        ล่าสุด: {target.last_delivery_at ? formatDateTime(target.last_delivery_at) : "-"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      รายงานที่เห็นได้: {formatAllowedReports(target)} · สิทธิ์การใช้งาน:{" "}
                      {formatAllowedActions(target)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 xl:justify-end">
                    {!target.approved && !isEnvFallback && (
                      <Button
                        size="sm"
                        className="px-3 py-2"
                        disabled={Boolean(busyAction)}
                        onClick={() => onApprove(target, "executive")}
                      >
                        อนุมัติผู้บริหาร
                      </Button>
                    )}
                    {(["executive", "sales_manager", "operations", "staff"] as LineAccessProfileKey[]).map(
                      (profileKey) => (
                        <Button
                          key={profileKey}
                          size="sm"
                          variant={target.access_profile_key === profileKey ? "primary" : "outline"}
                          className="px-3 py-2"
                          disabled={Boolean(busyAction) || isEnvFallback}
                          onClick={() => onSetProfile(target, profileKey)}
                        >
                          {formatAccessProfileShort(profileKey)}
                        </Button>
                      ),
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="px-3 py-2"
                      disabled={Boolean(busyAction) || isEnvFallback}
                      onClick={() => onToggleEnabled(target)}
                    >
                      {target.enabled ? "ปิดรับ" : "เปิดรับ"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="px-3 py-2"
                      disabled={Boolean(busyAction)}
                      onClick={() => onTestSend(target)}
                    >
                      ส่งทดสอบ
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ComponentCard>
  );
}

function ActionPanel({
  busyAction,
  actionResult,
  onTestDatasource,
  onRunYesterday,
  onDryRunLine,
  onSendLine,
}: {
  busyAction: string | null;
  actionResult: ActionResult | null;
  onTestDatasource: () => void;
  onRunYesterday: () => void;
  onDryRunLine: () => void;
  onSendLine: () => void;
}) {
  return (
    <ComponentCard
      title="ปุ่มทดสอบระบบ"
      desc="ใช้ทดสอบทีละขั้นโดยไม่ต้องเข้า server"
    >
      <div className="grid grid-cols-1 gap-3">
        <Button
          className="h-11 w-full justify-center"
          variant="outline"
          disabled={Boolean(busyAction)}
          onClick={onTestDatasource}
        >
          {busyAction === "datasource" ? "กำลังทดสอบ" : "ทดสอบฐานข้อมูล SML"}
        </Button>
        <Button
          className="h-11 w-full justify-center"
          variant="outline"
          disabled={Boolean(busyAction)}
          onClick={onRunYesterday}
        >
          {busyAction === "report" ? "กำลังรัน" : "รันรายงานเมื่อวาน"}
        </Button>
        <Button
          className="h-11 w-full justify-center"
          variant="outline"
          disabled={Boolean(busyAction)}
          onClick={onDryRunLine}
        >
          {busyAction === "dry_run" ? "กำลังสร้างข้อความ" : "ทดสอบข้อความ LINE"}
        </Button>
        <Button
          className="h-11 w-full justify-center"
          disabled={Boolean(busyAction)}
          onClick={onSendLine}
        >
          {busyAction === "send" ? "กำลังส่ง" : "ส่ง LINE ของเมื่อวาน"}
        </Button>
      </div>

      {actionResult && (
        <div className="mt-5 rounded-xl border border-gray-100 p-4 dark:border-gray-800">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
              {actionResult.title}
            </p>
            <Badge color={actionTone(actionResult.status)}>
              {actionResult.status === "success"
                ? "สำเร็จ"
                : actionResult.status === "warning"
                ? "ข้าม"
                : "ผิดพลาด"}
            </Badge>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {actionResult.message}
          </p>
          {actionResult.details && (
            <p className="mt-2 truncate text-xs text-gray-500 dark:text-gray-400">
              {actionResult.details}
            </p>
          )}
        </div>
      )}
    </ComponentCard>
  );
}

function StatusCard(props: {
  label: string;
  value: string;
  detail: string;
  tone: "success" | "warning" | "error" | "light";
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase text-gray-400">
          {props.label}
        </p>
        <Badge color={props.tone}>{props.tone === "success" ? "พร้อม" : props.tone === "warning" ? "ตรวจ" : props.tone === "error" ? "ผิดพลาด" : "ข้อมูล"}</Badge>
      </div>
      <p className="truncate text-base font-semibold text-gray-800 dark:text-white/90">
        {props.value}
      </p>
      <p className="mt-2 truncate text-xs text-gray-500 dark:text-gray-400">
        {props.detail}
      </p>
    </div>
  );
}

function LatestSnapshotCard({
  snapshot,
}: {
  snapshot: SalesGoodsServicesSnapshot | null;
}) {
  return (
    <InfoPanel
      title="ข้อมูลล่าสุด"
      rows={
        snapshot
          ? [
              ["ช่วงวันที่", formatReportPeriod(snapshot.params.date_from, snapshot.params.date_to)],
              ["อัปเดต", formatDateTime(snapshot.generated_at)],
              ["ยอดขาย", `${formatMoney(snapshot.summary.total_sales)} บาท`],
              ["บิลขาย", `${formatInteger(snapshot.summary.document_count)} ใบ`],
            ]
          : [["สถานะ", "ยังไม่มีข้อมูลล่าสุด"]]
      }
    />
  );
}

function LatestRunCard({ run }: { run: ReportRunRecord | null }) {
  return (
    <InfoPanel
      title="รอบรันล่าสุด"
      rows={
        run
          ? [
              ["สถานะ", formatRunStatus(run.status)],
              ["ช่วงวันที่", formatReportPeriod(run.params.date_from, run.params.date_to)],
              ["จำนวนแถว", formatInteger(run.row_count)],
              ["เลขอ้างอิง", run.id],
            ]
          : [["สถานะ", "ยังไม่มีประวัติรันรายงาน"]]
      }
    />
  );
}

function LatestLineDeliveryCard({
  delivery,
}: {
  delivery: LineDeliveryRecord | null;
}) {
  return (
    <InfoPanel
      title="การส่ง LINE ล่าสุด"
      rows={
        delivery
          ? [
              ["สถานะ", formatDeliveryStatus(delivery.status)],
              ["รูปแบบ", formatLineMessageType(delivery.message_type)],
              ["สร้างเมื่อ", formatDateTime(delivery.created_at)],
              ["ปลายทาง", delivery.target_id_masked ?? "ยังไม่ตั้งค่า"],
              ["เลขอ้างอิง", delivery.report_run_id],
            ]
          : [["สถานะ", "ยังไม่มีประวัติส่ง LINE"]]
      }
    />
  );
}

function InfoPanel({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <ComponentCard title={title}>
      <div className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={`${title}-${label}`} className="flex items-start justify-between gap-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
            <p className="max-w-[65%] truncate text-right text-sm font-medium text-gray-800 dark:text-white/90">
              {value}
            </p>
          </div>
        ))}
      </div>
    </ComponentCard>
  );
}

function SettingsLoadingState() {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {["Checklist", "Actions"].map((label) => (
        <div
          key={label}
          className="h-72 animate-pulse rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <div className="h-5 w-40 rounded bg-gray-100 dark:bg-gray-800" />
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="h-20 rounded-xl bg-gray-100 dark:bg-gray-800"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  return mutateJson<T>("POST", url, body);
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  return mutateJson<T>("PATCH", url, body);
}

async function mutateJson<T>(
  method: "PATCH" | "POST",
  url: string,
  body: unknown,
): Promise<T> {
  const headers = buildAdminJsonHeaders();
  if (!headers) {
    throw new Error("ต้องกรอก Admin token ก่อนทำรายการ");
  }

  const response = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };

  if (!response.ok && !("data" in (payload as Record<string, unknown>))) {
    if (response.status === 401 || response.status === 403) {
      forgetAdminToken();
    }
    throw new Error(payload.error || "ทำรายการไม่สำเร็จ");
  }

  return payload;
}

function readinessTone(value: boolean | null) {
  if (value === true) {
    return "success" as const;
  }

  if (value === false) {
    return "warning" as const;
  }

  return "light" as const;
}

function actionTone(status: ActionResult["status"]) {
  if (status === "success") {
    return "success" as const;
  }

  if (status === "warning") {
    return "warning" as const;
  }

  return "error" as const;
}

function formatWorkerStatus(
  status: OperationsStatus["worker"]["status"],
) {
  if (status === "ok") {
    return "ปกติ";
  }

  if (status === "warning") {
    return "มีคำเตือน";
  }

  if (status === "error") {
    return "ผิดพลาด";
  }

  if (status === "stale") {
    return "สัญญาณเก่า";
  }

  return "ยังไม่พบสัญญาณ";
}

function formatDeliveryStatus(status: LineDeliveryRecord["status"]) {
  if (status === "success") {
    return "ส่งสำเร็จ";
  }

  if (status === "failed") {
    return "ส่งไม่สำเร็จ";
  }

  if (status === "dry_run") {
    return "ทดสอบข้อความ";
  }

  return "ข้ามการส่ง";
}

function formatLineMessageType(messageType: LineDeliveryRecord["message_type"]) {
  if (messageType === "flex") {
    return "Flex + ปุ่มเปิดรายงาน";
  }

  return "ข้อความธรรมดา";
}

function formatAccessProfile(profileKey: LineAccessProfileKey) {
  if (profileKey === "executive") {
    return "ผู้บริหาร";
  }
  if (profileKey === "sales_manager") {
    return "ผู้จัดการฝ่ายขาย";
  }
  if (profileKey === "operations") {
    return "ปฏิบัติการ/คลังสินค้า";
  }
  return "พนักงานทั่วไป";
}

function formatAccessProfileShort(profileKey: LineAccessProfileKey) {
  if (profileKey === "executive") {
    return "ผู้บริหาร";
  }
  if (profileKey === "sales_manager") {
    return "ฝ่ายขาย";
  }
  if (profileKey === "operations") {
    return "ปฏิบัติการ";
  }
  return "พนักงาน";
}

function formatLineTargetType(targetType: LineTargetRecord["target_type"]) {
  if (targetType === "group") {
    return "กลุ่ม";
  }
  if (targetType === "room") {
    return "ห้องแชท";
  }
  return "รายคน";
}

function formatLineTargetSource(source: LineTargetRecord["source"]) {
  if (source === "env_fallback") {
    return "pilot env";
  }
  if (source === "webhook") {
    return "รออนุมัติ";
  }
  return "manual";
}

function formatAllowedReports(target: LineTargetRecord) {
  if (!target.allowed_report_keys.length) {
    return "ยังไม่มี";
  }

  return target.allowed_report_keys
    .map((reportKey) =>
      reportKey === "sales_goods_services"
        ? "รายงานขายสินค้าและบริการ"
        : reportKey,
    )
    .join(", ");
}

function formatAllowedActions(target: LineTargetRecord) {
  if (!target.allowed_actions.length) {
    return "ยังไม่มี";
  }

  const labels = target.allowed_actions.map((action) => {
    if (action === "receive_morning_brief") {
      return "รับ Morning Brief";
    }
    if (action === "ask_report") {
      return "ถามรายงาน";
    }
    return "เปิดรายงาน";
  });

  return labels.join(", ");
}

function formatRunStatus(status: ReportRunRecord["status"]) {
  if (status === "success") {
    return "สำเร็จ";
  }

  if (status === "running") {
    return "กำลังรัน";
  }

  return "ไม่สำเร็จ";
}

function formatReportPeriod(dateFrom: string, dateTo: string) {
  if (dateFrom === dateTo) {
    return formatDateOnly(dateFrom);
  }

  return `${formatDateOnly(dateFrom)} - ${formatDateOnly(dateTo)}`;
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function formatInteger(value: number) {
  return value.toLocaleString("th-TH");
}

function formatMoney(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
