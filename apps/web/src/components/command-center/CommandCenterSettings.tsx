"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deriveMorningBriefDateRange,
  type LineDeliveryRecord,
  type LineSendMode,
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

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000";

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
        ? `ปลายทาง ${tenantStatus.line_target_masked}`
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
            `ปลายทาง: ${tenantStatus?.line_target_masked ?? "ยังไม่ตั้งค่า"}`,
          ].join("\n"),
        )
      ) {
        return;
      }

      const payload = await postJson<{
        data?: {
          status?: "skipped";
          reason?: string;
          delivery?: LineDeliveryRecord;
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
      const delivery = payload.data.delivery;
      setActionResult({
        title: "ส่งสรุปเข้า LINE",
        status: skipped ? "warning" : delivery?.status === "success" ? "success" : "error",
        message: skipped
          ? "ระบบกันส่งซ้ำทำงานแล้ว จึงไม่ส่งข้อความซ้ำ"
          : delivery?.status === "success"
          ? "ส่งข้อความเข้า LINE สำเร็จ"
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
  const headers = buildAdminJsonHeaders();
  if (!headers) {
    throw new Error("ต้องกรอก Admin token ก่อนทำรายการ");
  }

  const response = await fetch(url, {
    method: "POST",
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
