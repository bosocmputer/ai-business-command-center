"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  tenant_slug: string;
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
  | { status: "not_found"; message: string }
  | { status: "error"; message: string };

type CustomerDashboardProps = {
  tenantSlug?: string;
};

type ExecutiveNoteModel = {
  description: string;
  title: string;
  tone?: "neutral" | "warning" | "success";
};

export default function CustomerDashboard({ tenantSlug }: CustomerDashboardProps) {
  const [state, setState] = useState<DashboardState>({ status: "loading" });

  const loadDashboard = useCallback(async () => {
    if (!tenantSlug) {
      return;
    }

    setState({ status: "loading" });
    try {
      const safeTenantSlug = encodeURIComponent(tenantSlug);
      const sessionResponse = await fetch(
        `${API_BASE_URL}/api/app/${safeTenantSlug}/session`,
      );
      if (sessionResponse.status === 404) {
        setState({
          status: "not_found",
          message:
            "ไม่พบลิงก์ร้านค้านี้ กรุณาตรวจสอบลิงก์ที่ได้รับจากผู้ดูแล",
        });
        return;
      }
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
        `${API_BASE_URL}/api/app/${safeTenantSlug}/reports/sales_goods_services/latest`,
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
  }, [tenantSlug]);

  useEffect(() => {
    if (!tenantSlug) {
      return;
    }
    void loadDashboard();
  }, [loadDashboard, tenantSlug]);

  if (!tenantSlug) {
    return (
      <CustomerShell title="AI Business สำหรับร้านค้า">
        <div className="mx-auto mt-10 max-w-2xl rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <Badge color="light">Customer Viewer</Badge>
          <h1 className="mt-4 text-2xl font-semibold text-gray-900">
            กรุณาใช้ลิงก์ร้านค้าที่ได้รับจากผู้ดูแล
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            หน้านี้ไม่เลือกข้อมูลร้านให้อัตโนมัติ เพื่อป้องกันการเห็นข้อมูลผิดร้าน
            หากคุณเป็นลูกค้า ให้เปิดลิงก์เฉพาะร้านที่ผู้ดูแลส่งให้เท่านั้น
          </p>
        </div>
      </CustomerShell>
    );
  }

  if (state.status === "loading") {
    return (
      <CustomerShell title="กำลังโหลดรายงาน">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <Badge color="light">กำลังโหลด</Badge>
          <div className="mt-4 h-7 w-56 rounded bg-gray-100" />
          <div className="mt-3 h-4 w-full max-w-xl rounded bg-gray-100" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {["sales", "docs", "lines", "qty"].map((item) => (
              <div
                className="h-20 rounded-lg border border-gray-100 bg-gray-50"
                key={item}
              />
            ))}
          </div>
        </section>
      </CustomerShell>
    );
  }

  if (state.status === "blocked") {
    return (
      <CustomerShell title="บัญชีร้านค้านี้ยังไม่พร้อมใช้งาน">
        <div className="mx-auto mt-10 max-w-xl rounded-xl border border-warning-200 bg-warning-50 p-6 text-center">
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
        <div className="mx-auto mt-10 max-w-xl rounded-xl border border-error-200 bg-error-50 p-6 text-center text-error-700">
          {state.message}
        </div>
      </CustomerShell>
    );
  }

  if (state.status === "not_found") {
    return (
      <CustomerShell title="ไม่พบร้านค้า">
        <div className="mx-auto mt-10 max-w-xl rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <Badge color="warning">ไม่พบลิงก์ร้านค้า</Badge>
          <h1 className="mt-4 text-2xl font-semibold text-gray-900">
            เปิด Dashboard ร้านค้านี้ไม่ได้
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            {state.message}
          </p>
        </div>
      </CustomerShell>
    );
  }

  if (state.status === "empty") {
    return (
      <CustomerShell tenant={state.session.tenant} title="Dashboard ร้านค้า">
        <div className="rounded-xl border border-gray-200 bg-white p-6">
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
  const executiveNotes = useMemo(
    () => buildExecutiveNotes(snapshot, trust),
    [snapshot, trust],
  );
  const periodLabel =
    snapshot.params.date_from === snapshot.params.date_to
      ? formatThaiDate(snapshot.params.date_from)
      : `${formatThaiDate(snapshot.params.date_from)} ถึง ${formatThaiDate(snapshot.params.date_to)}`;
  const branchItems = snapshot.branch_sales.slice(0, 5).map((branch) => ({
    label: formatBranchLabel(branch.branch_code),
    value: `${formatCurrency(branch.total_amount)} บาท`,
    meta: `${formatNumber(branch.document_count)} บิล · ${formatNumber(
      branch.line_count,
    )} รายการ`,
    share: formatShare(branch.total_amount, snapshot.summary.total_sales),
  }));
  const productItems = snapshot.top_products.slice(0, 5).map((product) => ({
    label: product.item_name,
    value: `${formatCurrency(product.sum_amount)} บาท`,
    meta: `${formatNumber(product.qty)} หน่วย · ${formatNumber(
      product.line_count,
    )} รายการ`,
  }));

  return (
    <CustomerShell tenant={session.tenant} title="รายงานร้านค้า">
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={trust.color}>{trust.label}</Badge>
                <Badge color="light">อ่านอย่างเดียว</Badge>
                <Badge color="light">ข้อมูลเฉพาะร้านนี้</Badge>
              </div>
              <h1 className="mt-3 text-xl font-semibold text-gray-900 sm:text-2xl">
                รายงานขายสินค้าและบริการ
              </h1>
              <p className="mt-1 text-sm leading-6 text-gray-500">
                {session.tenant.name} · วันที่ข้อมูล {periodLabel} · อัปเดต{" "}
                {formatDateTime(snapshot.generated_at)}
              </p>
            </div>
            <button
              className="inline-flex h-9 w-fit items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
              onClick={onRefresh}
              type="button"
            >
              รีเฟรช
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1.2fr)_380px]">
          <div className="px-4 py-4 sm:px-5">
            <p className="text-xs font-medium text-gray-500">ยอดขายสุทธิ</p>
            <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="text-4xl font-semibold tracking-normal text-gray-900">
                {formatCurrency(snapshot.summary.total_sales)}
              </p>
              <p className="pb-1 text-lg font-semibold text-gray-700">บาท</p>
            </div>
            <div className="mt-4 grid overflow-hidden rounded-lg border border-gray-100 sm:grid-cols-3">
              <Kpi
                label="บิลขาย"
                value={`${formatNumber(snapshot.summary.document_count)} ใบ`}
              />
              <Kpi
                label="รายการขาย"
                value={`${formatNumber(snapshot.summary.line_count)} รายการ`}
              />
              <Kpi
                label="จำนวนขายรวม"
                value={formatNumber(snapshot.summary.total_qty)}
              />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <MiniSummary
                label="สาขาหลัก"
                value={
                  topBranch
                    ? formatBranchLabel(topBranch.branch_code)
                    : "ไม่มีข้อมูล"
                }
                detail={
                  topBranch
                    ? `${formatCurrency(topBranch.total_amount)} บาท`
                    : "ยังไม่มีข้อมูลสาขาในช่วงวันที่นี้"
                }
              />
              <MiniSummary
                label="สินค้าหลัก"
                value={topProduct?.item_name ?? "ไม่มีข้อมูล"}
                detail={
                  topProduct
                    ? `${formatCurrency(topProduct.sum_amount)} บาท`
                    : "ยังไม่มีสินค้าในช่วงวันที่นี้"
                }
              />
            </div>
          </div>

          <aside className="border-t border-gray-100 bg-gray-50 px-4 py-4 sm:px-5 lg:border-l lg:border-t-0">
            <h2 className="text-base font-semibold text-gray-900">
              วันนี้ควรรู้อะไร
            </h2>
            <div className="mt-3 space-y-2">
              {executiveNotes.map((note) => (
                <ExecutiveNote key={note.title} {...note} />
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        <InfoPanel
          subtitle="ดูแนวโน้มเบื้องต้นจาก snapshot ล่าสุด"
          title="เทียบยอด"
        >
          <ComparisonLine
            currentSales={snapshot.summary.total_sales}
            label="วันก่อนหน้า"
            point={snapshot.comparison?.previous_day ?? null}
          />
          <ComparisonLine
            currentSales={snapshot.summary.total_sales}
            label="สัปดาห์ก่อน"
            point={snapshot.comparison?.same_weekday_last_week ?? null}
          />
        </InfoPanel>

        <InfoPanel
          subtitle="ตัวเลขนี้ช่วยชี้ว่ารายงานพร้อมใช้หรือควรตรวจยอดก่อนตัดสินใจ"
          title="ความน่าเชื่อถือของข้อมูล"
        >
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <p className="text-sm font-semibold text-gray-900">
              {trust.description}
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              ใช้ยอดขายหลักจากหัวบิล SML และเก็บรอบประมวลผลไว้สำหรับตรวจย้อนกลับ
            </p>
          </div>
        </InfoPanel>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <RankPanel
          emptyLabel="ไม่มีข้อมูลสาขาในช่วงวันที่นี้"
          items={branchItems}
          title="ยอดขายตามสาขา"
        />
        <RankPanel
          emptyLabel="ไม่มีข้อมูลสินค้าขายในช่วงวันที่นี้"
          items={productItems}
          title="สินค้าขายดี"
        />
      </section>

      <details className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs leading-5 text-gray-500">
        <summary className="cursor-pointer select-none font-semibold text-gray-700">
          รายละเอียดแหล่งข้อมูล
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <DetailItem label="ร้านค้า" value={session.tenant.name} />
          <DetailItem label="ช่วงวันที่" value={periodLabel} />
          <DetailItem
            label="แหล่งข้อมูล"
            value={
              snapshot.source === "sml_postgres"
                ? "ข้อมูลจากระบบขาย SML"
                : "ข้อมูลตัวอย่าง"
            }
          />
          <DetailItem label="รอบประมวลผล" value={snapshot.run_id} />
        </div>
        <p className="mt-3">
          หน้านี้เป็น read-only และอ่านเฉพาะ snapshot ล่าสุดของร้านนี้เท่านั้น
          ลูกค้าไม่สามารถแก้ config, datasource, LINE OA หรือสิทธิ์จากหน้านี้ได้
        </p>
      </details>
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
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div>
            <p className="text-xs font-semibold text-brand-500">AI Business</p>
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
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6">
        {children}
      </div>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-gray-100 bg-gray-50 p-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function MiniSummary({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-100 bg-white p-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-gray-900">
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-gray-500">{detail}</p>
    </div>
  );
}

function InfoPanel({
  children,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {subtitle ? (
        <p className="mt-1 text-xs leading-5 text-gray-500">{subtitle}</p>
      ) : null}
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function ExecutiveNote({
  description,
  title,
  tone = "neutral",
}: {
  description: string;
  title: string;
  tone?: "neutral" | "warning" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "border-warning-200 bg-warning-50"
      : tone === "success"
      ? "border-success-200 bg-success-50"
      : "border-gray-200 bg-white";

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-1 text-xs leading-5 text-gray-600">
        {description}
      </p>
    </div>
  );
}

function ComparisonLine({
  currentSales,
  label,
  point,
}: {
  currentSales: number;
  label: string;
  point: SalesComparisonPoint | null;
}) {
  if (!point) {
    return (
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <p className="mt-1 text-sm font-semibold text-gray-900">
          ยังไม่มีข้อมูลอ้างอิง
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-sm font-semibold text-gray-900">
            {formatThaiDate(point.date_from)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-gray-900">
            {formatCurrency(point.total_sales)} บาท
          </p>
          <p className="text-xs text-gray-500">
            {formatNumber(point.document_count)} บิล
          </p>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-gray-600">
        {formatComparisonNarrative(point, currentSales)}
      </p>
    </div>
  );
}

function RankPanel({
  emptyLabel,
  items,
  title,
}: {
  emptyLabel: string;
  items: Array<{
    label: string | null;
    meta: string;
    share?: string | null;
    value: string;
  }>;
  title: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {items.length ? (
          <span className="text-xs text-gray-500">Top {items.length}</span>
        ) : null}
      </div>
      <div className="mt-3 divide-y divide-gray-100">
        {items.length ? (
          items.map((item, index) => (
            <div
              className="flex items-start justify-between gap-4 py-3"
              key={`${item.label}-${index}`}
            >
              <div className="flex min-w-0 gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {item.label || "ไม่ระบุ"}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {item.meta}
                    {item.share ? ` · ${item.share}` : ""}
                  </p>
                </div>
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

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-medium text-gray-500">{label}</p>
      <p className="mt-1 break-all font-semibold text-gray-800">{value}</p>
    </div>
  );
}

function getTrustStatus(snapshot: SalesGoodsServicesSnapshot) {
  if (snapshot.summary.document_count === 0) {
    return {
      color: "warning" as const,
      label: "ไม่มีข้อมูล",
      description:
        "ไม่พบยอดขายในช่วงวันที่นี้ ควรตรวจว่าร้านหยุดขายหรือยังไม่มีการปิดบิล",
    };
  }

  if (snapshot.reconciliation.status === "reconciled_with_warning") {
    return {
      color: "warning" as const,
      label: "ควรตรวจยอด",
      description:
        "ยอดหัวบิลและรายการสินค้าไม่เท่ากัน ระบบใช้ยอดหัวบิลเป็นยอดขายหลัก",
    };
  }

  return {
    color: "success" as const,
    label: "พร้อมใช้",
    description: "ข้อมูลรายงานพร้อมใช้และ trace กลับไปยังรอบประมวลผลได้",
  };
}

function buildExecutiveNotes(
  snapshot: SalesGoodsServicesSnapshot,
  trust: ReturnType<typeof getTrustStatus>,
): ExecutiveNoteModel[] {
  if (snapshot.summary.document_count === 0) {
    return [
      {
        title: "ไม่พบยอดขาย",
        description:
          "ช่วงวันที่นี้ไม่พบยอดขาย อาจเป็นวันหยุดขาย หรือยังไม่มีการปิดบิลใน SML",
        tone: "warning" as const,
      },
      {
        title: "ควรตรวจช่วงวันที่",
        description:
          "หากร้านเปิดขายตามปกติ ให้ตรวจว่าช่วงวันที่รายงานและการบันทึกบิลถูกต้องหรือไม่",
      },
      {
        title: trust.label,
        description: trust.description,
      },
    ];
  }

  const topBranch = snapshot.branch_sales[0];
  const topProduct = snapshot.top_products[0];
  const notes: ExecutiveNoteModel[] = [
    {
      title: "ยอดขายล่าสุด",
      description: `${formatCurrency(snapshot.summary.total_sales)} บาท จาก ${formatNumber(
        snapshot.summary.document_count,
      )} บิล`,
      tone: "success" as const,
    },
    {
      title: "สาขาที่ทำยอดหลัก",
      description: topBranch
        ? `${formatBranchLabel(topBranch.branch_code)} ทำยอด ${formatCurrency(
            topBranch.total_amount,
          )} บาท`
        : "ยังไม่มีข้อมูลสาขาสำหรับช่วงวันที่นี้",
    },
    {
      title: "สินค้าขายดี",
      description: topProduct
        ? `${topProduct.item_name} ทำยอด ${formatCurrency(
            topProduct.sum_amount,
          )} บาท`
        : "ยังไม่มีสินค้าในช่วงวันที่นี้",
    },
  ];

  if (trust.color === "warning") {
    notes.push({
      title: trust.label,
      description: trust.description,
      tone: "warning" as const,
    });
  }

  return notes.slice(0, 4);
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
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    dateStyle: "medium",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${value}T00:00:00+07:00`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function formatComparisonNarrative(
  point: SalesComparisonPoint,
  currentSales: number,
) {
  if (point.direction === "no_reference") {
    return "ยังไม่มีข้อมูลเพียงพอสำหรับเทียบแนวโน้ม";
  }

  if (point.direction === "flat") {
    return "ยอดขายใกล้เคียงกับวันอ้างอิง";
  }

  const direction = point.direction === "up" ? "สูงกว่า" : "ต่ำกว่า";
  const percentage =
    point.difference_percent === null
      ? ""
      : ` (${Math.abs(point.difference_percent).toFixed(1)}%)`;

  if (currentSales === 0 && point.total_sales > 0) {
    return `วันนี้ยังไม่มียอดขาย จึง${direction}วันอ้างอิง ${formatCurrency(
      Math.abs(point.difference_amount),
    )} บาท${percentage}`;
  }

  return `วันนี้${direction}วันอ้างอิง ${formatCurrency(
    Math.abs(point.difference_amount),
  )} บาท${percentage}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatShare(value: number, total: number) {
  if (total <= 0) {
    return null;
  }

  return `${new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format((value / total) * 100)}% ของยอดขาย`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 3,
  }).format(value);
}
