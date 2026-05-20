"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  SalesComparisonPoint,
  SalesGoodsServicesSnapshot,
  Tenant,
} from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import { getCommandCenterApiBaseUrl } from "@/components/command-center/apiBaseUrl";

const API_BASE_URL = getCommandCenterApiBaseUrl();

type CustomerSession = {
  role: "tenant_viewer";
  tenant: Tenant;
  access: {
    enabled: boolean;
    status: string;
    message: string;
  };
};

type DashboardState =
  | { status: "loading" }
  | { status: "ready"; session: CustomerSession; snapshot: SalesGoodsServicesSnapshot }
  | { status: "empty"; session: CustomerSession; message: string }
  | { status: "blocked"; message: string; tenantStatus?: string }
  | { status: "error"; message: string };

export default function CustomerDashboard() {
  const [state, setState] = useState<DashboardState>({ status: "loading" });

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function loadDashboard() {
    setState({ status: "loading" });
    try {
      const sessionResponse = await fetch(`${API_BASE_URL}/api/app/session`);
      if (!sessionResponse.ok) {
        const payload = (await sessionResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "เปิด session ร้านค้าไม่สำเร็จ");
      }
      const sessionPayload = (await sessionResponse.json()) as {
        data: CustomerSession;
      };

      if (!sessionPayload.data.access.enabled) {
        setState({
          status: "blocked",
          message: sessionPayload.data.access.message,
          tenantStatus: sessionPayload.data.tenant.status,
        });
        return;
      }

      const reportResponse = await fetch(
        `${API_BASE_URL}/api/app/reports/sales_goods_services/latest`,
      );
      if (reportResponse.status === 403) {
        const payload = (await reportResponse.json().catch(() => ({}))) as {
          error?: string;
          tenant_status?: string;
        };
        setState({
          status: "blocked",
          message: payload.error || "บัญชีนี้ยังไม่พร้อมใช้งาน",
          tenantStatus: payload.tenant_status,
        });
        return;
      }
      if (reportResponse.status === 404) {
        setState({
          status: "empty",
          session: sessionPayload.data,
          message:
            "ยังไม่มีรายงานล่าสุด หลังเชื่อม SML แล้วระบบจะเริ่มแสดงยอดขายที่นี่",
        });
        return;
      }
      if (!reportResponse.ok) {
        const payload = (await reportResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "โหลดรายงานร้านค้าไม่สำเร็จ");
      }

      const reportPayload = (await reportResponse.json()) as {
        data: SalesGoodsServicesSnapshot;
      };
      setState({
        status: "ready",
        session: sessionPayload.data,
        snapshot: reportPayload.data,
      });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "โหลด dashboard ไม่สำเร็จ",
      });
    }
  }

  if (state.status === "loading") {
    return <CustomerShell title="กำลังโหลดข้อมูลร้านค้า" />;
  }

  if (state.status === "blocked") {
    return (
      <CustomerShell title="บัญชีร้านค้านี้ยังไม่พร้อมใช้งาน">
        <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-warning-200 bg-warning-50 p-6 text-center">
          <Badge color="warning">
            {formatTenantStatus(state.tenantStatus ?? "suspended")}
          </Badge>
          <h1 className="mt-4 text-2xl font-semibold text-gray-900">
            ถูกระงับการใช้งานชั่วคราว
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            {state.message}
          </p>
        </div>
      </CustomerShell>
    );
  }

  if (state.status === "error") {
    return (
      <CustomerShell title="โหลดข้อมูลไม่สำเร็จ">
        <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-error-200 bg-error-50 p-6 text-center text-error-700">
          {state.message}
        </div>
      </CustomerShell>
    );
  }

  if (state.status === "empty") {
    return (
      <CustomerShell tenant={state.session.tenant} title="Dashboard ร้านค้า">
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <Badge color="warning">ยังไม่มีรายงาน</Badge>
          <h1 className="mt-4 text-2xl font-semibold text-gray-900">
            รอข้อมูลรายงานแรกจาก SML
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            {state.message}
          </p>
        </div>
      </CustomerShell>
    );
  }

  return (
    <CustomerDashboardContent
      session={state.session}
      snapshot={state.snapshot}
      onRefresh={loadDashboard}
    />
  );
}

function CustomerDashboardContent({
  session,
  snapshot,
  onRefresh,
}: {
  session: CustomerSession;
  snapshot: SalesGoodsServicesSnapshot;
  onRefresh: () => void;
}) {
  const topBranch = snapshot.branch_sales[0] ?? null;
  const topProduct = snapshot.top_products[0] ?? null;
  const trust = useMemo(() => getTrustStatus(snapshot), [snapshot]);

  return (
    <CustomerShell tenant={session.tenant} title="Dashboard ร้านค้า">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge color={trust.color}>{trust.label}</Badge>
              <Badge color="light">{formatTenantStatus(session.tenant.status)}</Badge>
              <Badge color="light">{session.tenant.planCode}</Badge>
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-gray-900">
              รายงานขายสินค้าและบริการ
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              วันที่ข้อมูล {formatThaiDate(snapshot.params.date_from)}
              {snapshot.params.date_from !== snapshot.params.date_to
                ? ` ถึง ${formatThaiDate(snapshot.params.date_to)}`
                : ""}{" "}
              · อัปเดต {formatDateTime(snapshot.generated_at)}
            </p>
          </div>
          <button
            className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={onRefresh}
            type="button"
          >
            รีเฟรช
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="ยอดขายสุทธิ" value={`${formatCurrency(snapshot.summary.total_sales)} บาท`} />
          <Kpi label="บิลขาย" value={`${formatNumber(snapshot.summary.document_count)} ใบ`} />
          <Kpi label="รายการขาย" value={`${formatNumber(snapshot.summary.line_count)} รายการ`} />
          <Kpi label="จำนวนขายรวม" value={formatNumber(snapshot.summary.total_qty)} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <InfoPanel title="วันนี้ควรรู้อะไร">
          <InsightLine
            label="สาขาหลัก"
            value={
              topBranch
                ? `${formatBranchLabel(topBranch.branch_code)} · ${formatCurrency(topBranch.total_amount)} บาท`
                : "ยังไม่มีข้อมูลสาขา"
            }
          />
          <InsightLine
            label="สินค้าหลัก"
            value={
              topProduct
                ? `${topProduct.item_name} · ${formatCurrency(topProduct.sum_amount)} บาท`
                : "ยังไม่มีสินค้าในช่วงเวลานี้"
            }
          />
          <InsightLine
            label="ความน่าเชื่อถือ"
            value={trust.description}
          />
        </InfoPanel>

        <InfoPanel title="เทียบยอด">
          <ComparisonLine
            label="วันก่อนหน้า"
            point={snapshot.comparison?.previous_day ?? null}
          />
          <ComparisonLine
            label="สัปดาห์ก่อน"
            point={snapshot.comparison?.same_weekday_last_week ?? null}
          />
        </InfoPanel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <RankPanel
          emptyLabel="ยังไม่มีข้อมูลสาขา"
          items={snapshot.branch_sales.slice(0, 5).map((branch) => ({
            label: formatBranchLabel(branch.branch_code),
            value: `${formatCurrency(branch.total_amount)} บาท`,
            meta: `${formatNumber(branch.document_count)} บิล`,
          }))}
          title="ยอดขายตามสาขา"
        />
        <RankPanel
          emptyLabel="ยังไม่มีสินค้าในช่วงเวลานี้"
          items={snapshot.top_products.slice(0, 5).map((product) => ({
            label: product.item_name,
            value: `${formatCurrency(product.sum_amount)} บาท`,
            meta: `${formatNumber(product.qty)} ${product.line_count ? "หน่วย" : ""}`.trim(),
          }))}
          title="สินค้าขายดี"
        />
      </section>
    </CustomerShell>
  );
}

function CustomerShell({
  children,
  tenant,
  title,
}: {
  children?: React.ReactNode;
  tenant?: Tenant;
  title: string;
}) {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-500">
              AI Business
            </p>
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>
          {tenant ? (
            <div className="text-right">
              <p className="text-sm font-semibold">{tenant.name}</p>
              <p className="text-xs text-gray-500">อ่านรายงานอย่างเดียว</p>
            </div>
          ) : null}
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
        {children}
      </div>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function InfoPanel({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function InsightLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-6 text-gray-900">
        {value}
      </p>
    </div>
  );
}

function ComparisonLine({
  label,
  point,
}: {
  label: string;
  point: SalesComparisonPoint | null;
}) {
  if (!point) {
    return <InsightLine label={label} value="ยังไม่มีข้อมูลอ้างอิง" />;
  }

  const prefix =
    point.direction === "up"
      ? "สูงกว่า"
      : point.direction === "down"
      ? "ต่ำกว่า"
      : "ใกล้เคียง";

  return (
    <InsightLine
      label={label}
      value={`${prefix} ${formatCurrency(Math.abs(point.difference_amount))} บาท จากยอดอ้างอิง ${formatCurrency(point.total_sales)} บาท`}
    />
  );
}

function RankPanel({
  emptyLabel,
  items,
  title,
}: {
  emptyLabel: string;
  items: Array<{ label: string | null; value: string; meta: string }>;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <div className="mt-4 divide-y divide-gray-100">
        {items.length ? (
          items.map((item, index) => (
            <div className="flex items-start justify-between gap-4 py-3" key={`${item.label}-${index}`}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {index + 1}. {item.label || "ไม่ระบุ"}
                </p>
                <p className="mt-1 text-xs text-gray-500">{item.meta}</p>
              </div>
              <p className="shrink-0 text-sm font-semibold text-gray-900">
                {item.value}
              </p>
            </div>
          ))
        ) : (
          <p className="py-4 text-sm text-gray-500">{emptyLabel}</p>
        )}
      </div>
    </div>
  );
}

function getTrustStatus(snapshot: SalesGoodsServicesSnapshot) {
  if (snapshot.summary.document_count === 0) {
    return {
      color: "warning" as const,
      label: "ไม่มีข้อมูล",
      description: "ไม่พบยอดขายในช่วงวันที่นี้ ควรตรวจว่าร้านหยุดขายหรือยังไม่มีการปิดบิล",
    };
  }

  if (snapshot.reconciliation.status === "reconciled_with_warning") {
    return {
      color: "warning" as const,
      label: "ควรตรวจยอด",
      description: "ยอดหัวบิลและรายการสินค้าไม่เท่ากัน ระบบใช้ยอดหัวบิลเป็นยอดขายหลัก",
    };
  }

  return {
    color: "success" as const,
    label: "พร้อมใช้",
    description: "ข้อมูลรายงานพร้อมใช้และ trace กลับไปยังรอบประมวลผลได้",
  };
}

function formatTenantStatus(status: string) {
  const labels: Record<string, string> = {
    trial: "ทดลองใช้",
    active: "ใช้งาน",
    past_due: "ค้างชำระ",
    suspended: "ระงับ",
    cancelled: "ยกเลิก",
  };
  return labels[status] ?? status;
}

function formatBranchLabel(value: string) {
  if (value === "no_branch") {
    return "ไม่ระบุสาขา";
  }
  return `สาขา ${value}`;
}

function formatThaiDate(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${value}T00:00:00+07:00`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 3,
  }).format(value);
}
