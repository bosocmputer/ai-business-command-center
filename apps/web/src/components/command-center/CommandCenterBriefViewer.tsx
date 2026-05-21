"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type {
  BranchSales,
  SalesComparisonPoint,
  SalesDetailRow,
  SalesGoodsServicesSnapshot,
  SalesHeaderRow,
  TopProduct,
} from "@ai-bcc/shared";
import { getCommandCenterApiBaseUrl } from "./apiBaseUrl";

const API_BASE_URL = getCommandCenterApiBaseUrl();

type SnapshotResponse = {
  data?: SalesGoodsServicesSnapshot;
  error?: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; snapshot: SalesGoodsServicesSnapshot }
  | { status: "error"; message: string };

export function CommandCenterBriefFallback() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-4 text-gray-800 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="h-16 animate-pulse rounded-lg bg-white dark:bg-white/[0.04]" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-24 animate-pulse rounded-lg bg-white dark:bg-white/[0.04]"
            />
          ))}
        </div>
      </div>
    </main>
  );
}

export default function CommandCenterBriefViewer() {
  const searchParams = useSearchParams();
  const tenantId = searchParams.get("tenant_id");
  const runId = searchParams.get("run_id");
  const token = searchParams.get("token");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!tenantId || !runId || !token) {
      setState({
        status: "error",
        message: "ลิงก์รายงานไม่ครบถ้วน กรุณาเปิดจากข้อความ LINE ล่าสุดอีกครั้ง",
      });
      return;
    }

    const safeTenantId = tenantId;
    const safeRunId = runId;
    const safeToken = token;
    const controller = new AbortController();
    async function loadSnapshot() {
      setState({ status: "loading" });
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/reports/${encodeURIComponent(
            safeTenantId,
          )}/sales_goods_services/snapshots/${encodeURIComponent(
            safeRunId,
          )}?token=${encodeURIComponent(safeToken)}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as SnapshotResponse;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error || "เปิดรายงานไม่สำเร็จ");
        }
        setState({ status: "ready", snapshot: payload.data });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "เปิดรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
        });
      }
    }

    void loadSnapshot();
    return () => controller.abort();
  }, [runId, tenantId, token]);

  if (state.status === "loading") {
    return <CommandCenterBriefFallback />;
  }

  if (state.status === "error") {
    return <BriefErrorState message={state.message} />;
  }

  return <BriefReport snapshot={state.snapshot} />;
}

function BriefReport({ snapshot }: { snapshot: SalesGoodsServicesSnapshot }) {
  const [selectedBillKey, setSelectedBillKey] = useState<string | null>(null);
  const insights = useMemo(() => buildInsights(snapshot), [snapshot]);
  const billPreviews = useMemo(() => buildBillPreviews(snapshot), [snapshot]);
  const selectedBill = selectedBillKey
    ? billPreviews.find((bill) => bill.key === selectedBillKey) ?? null
    : null;
  const topBranchTotal = snapshot.branch_sales[0]?.total_amount ?? 0;
  const maxProductTotal = snapshot.top_products[0]?.sum_amount ?? 0;
  const hasWarning =
    snapshot.quality_status === "reconciled_with_warning" ||
    Math.abs(snapshot.reconciliation.difference_amount) > 0.01;

  return (
    <main className="min-h-screen bg-gray-50 text-gray-800 dark:bg-gray-950 dark:text-gray-100">
      <div className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-500">
              AI Business Center
            </p>
            <h1 className="mt-1 truncate text-xl font-semibold text-gray-900 dark:text-white">
              รายงานขายสินค้าและบริการ
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {formatTenantName(snapshot.tenant_id)} · วันที่ข้อมูล{" "}
              {formatReportPeriod(snapshot.params.date_from, snapshot.params.date_to)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <StatusPill tone={hasWarning ? "warning" : "success"}>
              {formatTrustStatus(snapshot)}
            </StatusPill>
            <StatusPill tone={snapshot.source === "sml_postgres" ? "success" : "warning"}>
              {formatSource(snapshot.source)}
            </StatusPill>
            <StatusPill tone="neutral">
              อัปเดต {formatDateTime(snapshot.generated_at)}
            </StatusPill>
            <a
              href="#sales-details"
              className="rounded-full bg-brand-500 px-3 py-1 font-medium text-white transition hover:bg-brand-600"
            >
              ดูรายละเอียดบิล/สินค้า
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-4 px-4 py-4 md:px-6">
        <section aria-label="ภาพรวม" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiBlock
            label="ยอดขายสุทธิ"
            value={`${formatMoney(snapshot.summary.total_sales)} บาท`}
            emphasis
          />
          <KpiBlock
            label="บิลขาย"
            value={`${formatInteger(snapshot.summary.document_count)} ใบ`}
          />
          <KpiBlock
            label="จำนวนรายการขาย"
            value={`${formatInteger(snapshot.summary.line_count)} รายการ`}
          />
          <KpiBlock
            label="จำนวนขายรวม"
            value={formatQty(snapshot.summary.total_qty)}
          />
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <SectionTitle
            title="วันนี้ควรรู้อะไร"
            caption="แปลยอดขายเมื่อวานเป็นภาษาธุรกิจสำหรับตัดสินใจเร็ว"
          />
          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            {insights.map((insight, index) => (
              <InsightItem key={insight.title} index={index + 1} {...insight} />
            ))}
          </div>
        </section>

        {snapshot.comparison && (
          <section className="grid gap-3 md:grid-cols-2">
            <ComparisonCard
              title="เทียบกับวันก่อนหน้า"
              point={snapshot.comparison.previous_day}
            />
            <ComparisonCard
              title="เทียบกับวันเดียวกันสัปดาห์ก่อน"
              point={snapshot.comparison.same_weekday_last_week}
            />
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
            <SectionTitle
              title="ยอดขายตามสาขา"
              caption="เรียงจากยอดขายสูงสุด ถ้าขึ้นสาขาเดียวทั้งหมดอาจเป็นร้านสาขาเดียวหรือยังไม่ได้ตั้งค่า branch"
            />
            <div className="mt-4 space-y-3">
              {snapshot.branch_sales.slice(0, 6).map((branch) => (
                <BranchRow
                  key={branch.branch_code}
                  branch={branch}
                  maxTotal={topBranchTotal}
                />
              ))}
              {!snapshot.branch_sales.length && (
                <EmptyInline text="ไม่มีข้อมูลสาขาในช่วงวันที่นี้" />
              )}
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
            <SectionTitle
              title="สินค้าขายดี"
              caption="สินค้าที่สร้างยอดขายมากสุดจากรายการขาย"
            />
            <div className="mt-4 space-y-3">
              {snapshot.top_products.slice(0, 6).map((product) => (
                <ProductRow
                  key={`${product.item_code}-${product.item_name}`}
                  product={product}
                  maxTotal={maxProductTotal}
                />
              ))}
              {!snapshot.top_products.length && (
                <EmptyInline text="ไม่มีสินค้าในช่วงวันที่นี้" />
              )}
            </div>
          </section>
        </div>

        <section
          id="sales-details"
          className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <SectionTitle
            title="รายละเอียดบิลขาย"
            caption="กดเลือกบิลเพื่อดูสินค้าในบิลแบบอ่านง่าย เหมาะกับการเปิดจาก LINE บนมือถือ"
          />
          {hasWarning && (
            <p className="mt-4 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-orange-300">
              หมายเหตุ: ยอดหัวเอกสารและยอดรายละเอียดไม่เท่ากัน ระบบใช้ ic_trans.total_amount
              เป็นยอดขายหลัก
            </p>
          )}
          <div className="mt-4 space-y-3">
            <ExecutiveBillList
              bills={billPreviews}
              totalDocuments={snapshot.summary.document_count}
              onSelect={(bill) => setSelectedBillKey(bill.key)}
            />
            <BriefDetails
              title="ข้อมูลเทคนิค/ที่มา"
              count={4}
              caption="เปิดเฉพาะเมื่อต้อง trace รอบรันหรือเช็คความถูกต้องของยอด"
            >
              <div className="grid gap-3 text-sm md:grid-cols-4">
                <Fact label="เลขอ้างอิง" value={snapshot.run_id} />
                <Fact label="ช่วงวันที่" value={formatReportPeriod(snapshot.params.date_from, snapshot.params.date_to)} />
                <Fact label="ยอดหัวบิล" value={`${formatMoney(snapshot.reconciliation.header_total_amount)} บาท`} />
                <Fact label="ส่วนต่าง" value={`${formatMoney(snapshot.reconciliation.difference_amount)} บาท`} />
              </div>
            </BriefDetails>
          </div>
        </section>
      </div>
      <BillDetailDrawer
        bill={selectedBill}
        onClose={() => setSelectedBillKey(null)}
        hasReportWarning={hasWarning}
      />
    </main>
  );
}

function BriefErrorState({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 dark:bg-gray-950">
      <div className="mx-auto max-w-2xl rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-500">
          AI Business Center
        </p>
        <h1 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">
          เปิดรายงานไม่ได้
        </h1>
        <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
          {message}
        </p>
        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          เพื่อความปลอดภัย ลิงก์รายงานจาก LINE จะผูกกับบริษัทและรอบรายงานที่ส่งจริงเท่านั้น
        </p>
      </div>
    </main>
  );
}

function KpiBlock({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03] md:p-4">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={`mt-2 truncate font-semibold ${
          emphasis
            ? "text-xl text-gray-900 dark:text-white md:text-2xl"
            : "text-lg text-gray-800 dark:text-white/90"
        }`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function SectionTitle({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {title}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">{caption}</p>
      </div>
    </div>
  );
}

function InsightItem({
  index,
  title,
  body,
  tone,
}: {
  index: number;
  title: string;
  body: string;
  tone: "success" | "warning" | "neutral";
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-gray-100 px-3 py-3 dark:border-gray-800">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          tone === "warning"
            ? "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-orange-300"
            : tone === "success"
            ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-400"
            : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300"
        }`}
      >
        {index}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {title}
        </p>
        <p className="mt-1 text-sm leading-5 text-gray-600 dark:text-gray-300">
          {body}
        </p>
      </div>
    </div>
  );
}

function ComparisonCard({
  title,
  point,
}: {
  title: string;
  point: SalesComparisonPoint | null;
}) {
  if (!point) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {title}
        </p>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          ยังไม่มีข้อมูลอ้างอิงสำหรับเทียบยอด
        </p>
      </div>
    );
  }

  const tone =
    point.direction === "up"
      ? "success"
      : point.direction === "down"
      ? "warning"
      : "neutral";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {title}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            เทียบกับ {formatReportPeriod(point.date_from, point.date_to)}
          </p>
        </div>
        <StatusPill tone={tone}>{formatComparisonDirection(point.direction)}</StatusPill>
      </div>
      <p className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">
        {formatSignedMoney(point.difference_amount)} บาท
        {point.difference_percent !== null
          ? ` (${formatSignedPercent(point.difference_percent)})`
          : ""}
      </p>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        ยอดอ้างอิง {formatMoney(point.total_sales)} บาท จาก{" "}
        {formatInteger(point.document_count)} บิล
      </p>
    </div>
  );
}

function BranchRow({
  branch,
  maxTotal,
}: {
  branch: BranchSales;
  maxTotal: number;
}) {
  const width = maxTotal > 0 ? Math.max(8, (branch.total_amount / maxTotal) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 dark:text-white">
            {formatBranchLabel(branch.branch_code)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {formatInteger(branch.document_count)} บิล · {formatInteger(branch.line_count)} รายการ
          </p>
        </div>
        <p className="shrink-0 font-semibold text-gray-900 dark:text-white">
          {formatMoney(branch.total_amount)}
        </p>
      </div>
      <div className="mt-2 h-2 rounded-full bg-gray-100 dark:bg-white/10">
        <div
          className="h-2 rounded-full bg-brand-500"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function ProductRow({
  product,
  maxTotal,
}: {
  product: TopProduct;
  maxTotal: number;
}) {
  const width = maxTotal > 0 ? Math.max(8, (product.sum_amount / maxTotal) * 100) : 0;
  return (
    <div>
      <div className="flex items-start justify-between gap-3 text-sm">
        <div className="min-w-0">
          <p className="line-clamp-2 font-semibold text-gray-900 dark:text-white">
            {product.item_name}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {formatQty(product.qty)} หน่วย · {formatInteger(product.line_count)} รายการ
          </p>
        </div>
        <p className="shrink-0 font-semibold text-gray-900 dark:text-white">
          {formatMoney(product.sum_amount)}
        </p>
      </div>
      <div className="mt-2 h-2 rounded-full bg-gray-100 dark:bg-white/10">
        <div
          className="h-2 rounded-full bg-success-500"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/[0.04]">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 truncate font-semibold text-gray-900 dark:text-white" title={value}>
        {value}
      </p>
    </div>
  );
}

function BriefDetails({
  title,
  count,
  caption,
  children,
}: {
  title: string;
  count: number;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-gray-100 dark:border-gray-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {title}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {caption ??
              `แสดงตัวอย่าง 20 แถวแรกจาก ${formatInteger(count)} แถวที่เก็บในรายงาน`}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 group-open:bg-brand-50 group-open:text-brand-600 dark:bg-white/10 dark:text-gray-300">
          เปิดดู
        </span>
      </summary>
      <div className="border-t border-gray-100 p-3 dark:border-gray-800">
        {children}
      </div>
    </details>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "success" | "warning" | "neutral";
  children: ReactNode;
}) {
  const classes =
    tone === "success"
      ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-400"
      : tone === "warning"
      ? "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-orange-300"
      : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300";
  return (
    <span className={`rounded-full px-3 py-1 font-medium ${classes}`}>
      {children}
    </span>
  );
}

function EmptyInline({ text }: { text: string }) {
  return (
    <p className="rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">
      {text}
    </p>
  );
}

type BillPreview = {
  key: string;
  document: SalesHeaderRow;
  lines: SalesDetailRow[];
  detailTotal: number;
  totalQty: number;
  topItem: SalesDetailRow | null;
  branchCode: string;
  hasDifference: boolean;
};

function ExecutiveBillList({
  bills,
  totalDocuments,
  onSelect,
}: {
  bills: BillPreview[];
  totalDocuments: number;
  onSelect: (bill: BillPreview) => void;
}) {
  if (!bills.length) {
    return (
      <EmptyInline text="ไม่มีบิลขายในช่วงวันที่นี้ หากร้านมีการขายจริงควรตรวจการปิดบิลใน SML" />
    );
  }

  const visibleBills = bills.slice(0, 20);
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1 rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-600 dark:bg-white/[0.04] dark:text-gray-300 sm:flex-row sm:items-center sm:justify-between">
        <span>
          แสดง {formatInteger(visibleBills.length)} บิลแรกจาก{" "}
          {formatInteger(totalDocuments)} บิลในรายงาน
        </span>
        <span className="font-medium text-gray-900 dark:text-white">
          แตะบิลเพื่อดูสินค้าและยอดขาย
        </span>
      </div>

      <div className="space-y-2">
        {visibleBills.map((bill) => (
          <button
            key={bill.key}
            type="button"
            onClick={() => onSelect(bill)}
            className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-left transition hover:border-brand-300 hover:bg-brand-50/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {bill.document.doc_no}
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {formatThaiDate(bill.document.doc_date)}
                  {bill.document.doc_time ? ` · ${formatTime(bill.document.doc_time)}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {formatMoney(bill.document.total_amount)} บาท
                </p>
                <p className="mt-0.5 text-xs text-brand-600 dark:text-brand-400">
                  ดูสินค้า
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-2 text-xs text-gray-500 dark:text-gray-400 sm:grid-cols-3">
              <BillListMeta
                label="ลูกค้า"
                value={bill.document.cust_name || bill.document.cust_code || "ไม่ระบุลูกค้า"}
              />
              <BillListMeta
                label="สินค้า"
                value={
                  bill.topItem?.item_name
                    ? `${bill.topItem.item_name} ${bill.lines.length > 1 ? `+${bill.lines.length - 1}` : ""}`
                    : `${formatInteger(bill.lines.length)} รายการ`
                }
              />
              <BillListMeta
                label="สาขา"
                value={formatBranchLabel(bill.branchCode)}
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function BillListMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </span>
      <span className="mt-0.5 block truncate font-medium text-gray-700 dark:text-gray-200">
        {value}
      </span>
    </div>
  );
}

function BillDetailDrawer({
  bill,
  onClose,
  hasReportWarning,
}: {
  bill: BillPreview | null;
  onClose: () => void;
  hasReportWarning: boolean;
}) {
  useEffect(() => {
    if (!bill) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [bill, onClose]);

  if (!bill) {
    return null;
  }

  const difference = bill.document.total_amount - bill.detailTotal;
  const hasBillDifference = Math.abs(difference) > 0.01;

  return (
    <div
      className="fixed inset-0 z-[99999] bg-gray-900/45 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`รายละเอียดบิล ${bill.document.doc_no}`}
      onClick={onClose}
    >
      <div
        className="fixed inset-x-0 bottom-0 max-h-[90vh] overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-gray-950 md:inset-y-0 md:left-auto md:right-0 md:h-full md:max-h-none md:w-[560px] md:rounded-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-gray-200 px-4 py-4 dark:border-gray-800">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-500">
                  รายละเอียดบิลขาย
                </p>
                <h3 className="mt-1 truncate text-lg font-semibold text-gray-900 dark:text-white">
                  {bill.document.doc_no}
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {formatThaiDate(bill.document.doc_date)}
                  {bill.document.doc_time ? ` · ${formatTime(bill.document.doc_time)}` : ""} ·{" "}
                  {bill.document.cust_name || bill.document.cust_code || "ไม่ระบุลูกค้า"}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xl leading-none text-gray-500 transition hover:bg-gray-200 hover:text-gray-800 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/15"
                aria-label="ปิดรายละเอียดบิล"
              >
                ×
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <BillMetric
                label="ยอดตามบิล"
                value={`${formatMoney(bill.document.total_amount)} บาท`}
                emphasis
              />
              <BillMetric
                label="รายการสินค้า"
                value={`${formatInteger(bill.lines.length)} รายการ`}
              />
              <BillMetric label="จำนวนขายรวม" value={formatQty(bill.totalQty)} />
              <BillMetric label="สาขา" value={formatBranchLabel(bill.branchCode)} />
            </div>

            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.04]">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                ข้อมูลบิล
              </p>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <BillFact label="ลูกค้า" value={bill.document.cust_name || bill.document.cust_code || "-"} />
                <BillFact label="แคชเชียร์" value={bill.document.cashier_code || "-"} />
                <BillFact label="ยอดก่อนส่วนลด" value={`${formatMoney(bill.document.total_value)} บาท`} />
                <BillFact label="ส่วนลดรวม" value={`${formatMoney(bill.document.total_discount)} บาท`} />
                <BillFact label="VAT" value={`${formatMoney(bill.document.total_vat_value)} บาท`} />
                <BillFact label="ยอดรายการสินค้า" value={`${formatMoney(bill.detailTotal)} บาท`} />
              </dl>
            </div>

            {(hasReportWarning || hasBillDifference) && (
              <p className="mt-3 rounded-lg bg-warning-50 px-3 py-2 text-sm leading-6 text-warning-700 dark:bg-warning-500/10 dark:text-orange-300">
                ยอดตามบิลกับยอดรายการสินค้าอาจไม่เท่ากันจาก VAT ส่วนลด หรือโครงสร้างบิลของ SML
                ระบบใช้ยอดตามบิลเป็นยอดขายหลัก
                {hasBillDifference ? ` ส่วนต่างบิลนี้ ${formatMoney(difference)} บาท` : ""}
              </p>
            )}

            <div className="mt-5">
              <SectionTitle
                title="สินค้าในบิลนี้"
                caption="เรียงตามลำดับรายการจากระบบ SML"
              />
              <div className="mt-3 space-y-2">
                {bill.lines.length ? (
                  bill.lines.map((line, index) => (
                    <BillLineItem
                      key={`${bill.key}-${line.item_code}-${line.line_number ?? index}-${index}`}
                      line={line}
                      index={index + 1}
                    />
                  ))
                ) : (
                  <EmptyInline text="ไม่พบรายการสินค้าใน snapshot ของบิลนี้" />
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-950">
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-600"
            >
              กลับไปดูรายงาน
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BillMetric({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p
        className={`mt-1 truncate font-semibold ${
          emphasis ? "text-lg text-gray-900 dark:text-white" : "text-gray-800 dark:text-white/90"
        }`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function BillFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-gray-900 dark:text-white" title={value}>
        {value}
      </dd>
    </div>
  );
}

function BillLineItem({ line, index }: { line: SalesDetailRow; index: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-brand-500">รายการที่ {index}</p>
          <p className="mt-1 line-clamp-2 text-sm font-semibold text-gray-900 dark:text-white">
            {line.item_name || line.item_code || "ไม่ระบุสินค้า"}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {line.item_code || "-"}
            {line.barcode ? ` · Barcode ${line.barcode}` : ""}
          </p>
        </div>
        <p className="shrink-0 text-right text-sm font-semibold text-gray-900 dark:text-white">
          {formatMoney(line.sum_amount)} บาท
        </p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-white/[0.04]">
        <BillLineStat label="จำนวน" value={formatQty(line.qty)} />
        <BillLineStat label="หน่วย" value={line.unit_name || line.unit_code || "-"} />
        <BillLineStat label="ราคา" value={formatMoney(line.price)} />
      </div>
      {(line.discount || line.discount_amount > 0) && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          ส่วนลด {line.discount || "-"} · {formatMoney(line.discount_amount)} บาท
        </p>
      )}
    </div>
  );
}

function BillLineStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-0.5 truncate font-semibold text-gray-900 dark:text-white" title={value}>
        {value}
      </p>
    </div>
  );
}

function buildBillPreviews(snapshot: SalesGoodsServicesSnapshot): BillPreview[] {
  const linesByDocument = new Map<string, SalesDetailRow[]>();

  for (const line of snapshot.lines) {
    const key = buildBillKey(line.doc_date, line.doc_no);
    const existing = linesByDocument.get(key) ?? [];
    existing.push(line);
    linesByDocument.set(key, existing);
  }

  return snapshot.documents.map((document) => {
    const key = buildBillKey(document.doc_date, document.doc_no);
    const lines = linesByDocument.get(key) ?? [];
    const detailTotal = lines.reduce((sum, line) => sum + line.sum_amount, 0);
    const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
    const topItem =
      lines.length > 0
        ? [...lines].sort((a, b) => b.sum_amount - a.sum_amount)[0] ?? null
        : null;
    const branchCode =
      document.branch_code ||
      lines.find((line) => line.branch_code)?.branch_code ||
      "no_branch";

    return {
      key,
      document,
      lines,
      detailTotal,
      totalQty,
      topItem,
      branchCode,
      hasDifference: Math.abs(document.total_amount - detailTotal) > 0.01,
    };
  });
}

function buildBillKey(docDate: string, docNo: string) {
  return `${docDate}::${docNo}`;
}

function buildInsights(snapshot: SalesGoodsServicesSnapshot) {
  const insights: Array<{
    title: string;
    body: string;
    tone: "success" | "warning" | "neutral";
  }> = [];
  const topBranch = snapshot.branch_sales[0];
  const topProduct = snapshot.top_products[0];
  const noBranch = snapshot.branch_sales.find(
    (branch) => branch.branch_code === "no_branch",
  );

  if (snapshot.summary.document_count === 0) {
    insights.push({
      title: "ไม่พบยอดขายในช่วงวันที่นี้",
      body: "ควรตรวจว่าวันนั้นร้านหยุดขาย ระบบยังไม่ปิดบิล หรือช่วงวันที่ที่ส่งรายงานถูกต้องหรือไม่",
      tone: "warning",
    });
  } else if (topBranch) {
    const share = snapshot.summary.total_sales
      ? (topBranch.total_amount / snapshot.summary.total_sales) * 100
      : 0;
    insights.push({
      title: `ยอดหลักอยู่ที่ ${formatBranchLabel(topBranch.branch_code)}`,
      body:
        share >= 99
          ? `ยอดขายอยู่ที่สาขานี้เกือบทั้งหมด อาจเป็นร้านสาขาเดียว หรือยังไม่ได้ map สาขาใน SML`
          : `ทำยอด ${formatMoney(topBranch.total_amount)} บาท คิดเป็นประมาณ ${share.toFixed(1)}% ของยอดขายรวม`,
      tone: share >= 85 ? "warning" : "success",
    });
  }

  if (topProduct) {
    insights.push({
      title: "สินค้าขายดีอันดับหนึ่ง",
      body: `${topProduct.item_name} ทำยอด ${formatMoney(topProduct.sum_amount)} บาท จาก ${formatQty(topProduct.qty)} หน่วย`,
      tone: "neutral",
    });
  }

  if (noBranch && noBranch.total_amount > 0) {
    insights.push({
      title: "มีรายการขายที่ไม่ระบุสาขา",
      body: `พบยอด ${formatMoney(noBranch.total_amount)} บาทที่ยังไม่รู้สาขา ควรตรวจการตั้งค่า branch_code ใน SML`,
      tone: "warning",
    });
  }

  if (Math.abs(snapshot.reconciliation.difference_amount) > 0.01) {
    insights.push({
      title: "ยอดหัวบิลกับรายการสินค้าไม่ตรงกัน",
      body: `ส่วนต่าง ${formatMoney(snapshot.reconciliation.difference_amount)} บาท ระบบใช้ยอดหัวบิลเป็นยอดขายหลัก`,
      tone: "warning",
    });
  }

  if (!insights.length) {
    insights.push({
      title: "ข้อมูลพร้อมอ่าน",
      body: "ไม่พบสัญญาณผิดปกติจาก snapshot รอบนี้",
      tone: "success",
    });
  }

  return insights.slice(0, 3);
}

function formatTenantName(tenantId: string) {
  if (tenantId === "tenant_demo_remote") {
    return "DEMO SHOP";
  }
  if (tenantId === "tenant_office_sml1_2026") {
    return "248 SHOP";
  }
  return tenantId;
}

function formatSource(source: SalesGoodsServicesSnapshot["source"]) {
  return source === "sml_postgres" ? "ข้อมูลจากระบบขาย SML" : "ข้อมูลตัวอย่าง";
}

function formatTrustStatus(snapshot: SalesGoodsServicesSnapshot) {
  if (snapshot.summary.document_count === 0) {
    return "ไม่มีข้อมูล";
  }
  if (snapshot.quality_status === "stale" || snapshot.source === "sample_snapshot") {
    return "ข้อมูลเก่า";
  }
  if (
    snapshot.quality_status === "reconciled_with_warning" ||
    Math.abs(snapshot.reconciliation.difference_amount) > 0.01
  ) {
    return "ควรตรวจยอด";
  }
  return "พร้อมใช้";
}

function formatBranchLabel(branchCode: string) {
  if (branchCode === "no_branch") {
    return "รายการไม่ระบุสาขา";
  }
  return `สาขา ${branchCode}`;
}

function formatReportPeriod(dateFrom: string, dateTo: string) {
  if (dateFrom === dateTo) {
    return formatThaiDate(dateFrom);
  }
  return `${formatThaiDate(dateFrom)} - ${formatThaiDate(dateTo)}`;
}

function formatThaiDate(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatTime(value: string) {
  return value.length >= 5 ? value.slice(0, 5) : value;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatMoney(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedMoney(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatMoney(value)}`;
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("th-TH", {
    maximumFractionDigits: 1,
  })}%`;
}

function formatComparisonDirection(direction: SalesComparisonPoint["direction"]) {
  if (direction === "up") {
    return "เพิ่มขึ้น";
  }
  if (direction === "down") {
    return "ลดลง";
  }
  if (direction === "flat") {
    return "ทรงตัว";
  }
  return "ยังไม่มีฐานเทียบ";
}

function formatInteger(value: number) {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function formatQty(value: number) {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 3 });
}
