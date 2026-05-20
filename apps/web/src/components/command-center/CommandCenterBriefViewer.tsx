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
  const insights = useMemo(() => buildInsights(snapshot), [snapshot]);
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
            title="รายละเอียดบิล/สินค้า"
            caption="เปิดดูเมื่ออยากไล่รายการขายที่เป็นที่มาของตัวเลข"
          />
          {hasWarning && (
            <p className="mt-4 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-orange-300">
              หมายเหตุ: ยอดหัวเอกสารและยอดรายละเอียดไม่เท่ากัน ระบบใช้ ic_trans.total_amount
              เป็นยอดขายหลัก
            </p>
          )}
          <div className="mt-4 space-y-3">
            <BriefDetails title="บิลขาย" count={snapshot.documents.length}>
              <CompactTable
                headers={["วันที่", "เลขที่บิล", "ลูกค้า", "สาขา", "ยอดรวม"]}
                rows={snapshot.documents.slice(0, 20).map(mapDocumentRow)}
              />
            </BriefDetails>
            <BriefDetails title="รายการสินค้าและบริการ" count={snapshot.lines.length}>
              <CompactTable
                headers={["วันที่", "เลขที่บิล", "สินค้า/บริการ", "สาขา", "จำนวน", "ยอดขาย"]}
                rows={snapshot.lines.slice(0, 20).map(mapLineRow)}
              />
            </BriefDetails>
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

function CompactTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  if (!rows.length) {
    return <EmptyInline text="ไม่มีข้อมูลในตารางนี้" />;
  }

  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={`${row.join("-")}-${rowIndex}`}
              className="border-b border-gray-50 last:border-0 dark:border-gray-900"
            >
              {row.map((cell, index) => (
                <td
                  key={`${cell}-${index}`}
                  className="max-w-[280px] truncate px-3 py-2 text-gray-700 dark:text-gray-300"
                  title={cell}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function mapDocumentRow(document: SalesHeaderRow) {
  return [
    document.doc_date,
    document.doc_no,
    document.cust_name || document.cust_code || "-",
    document.branch_code || "ไม่ระบุสาขา",
    `${formatMoney(document.total_amount)} บาท`,
  ];
}

function mapLineRow(line: SalesDetailRow) {
  return [
    line.doc_date,
    line.doc_no,
    `${line.item_code || "-"} ${line.item_name || ""}`.trim(),
    line.branch_code || "ไม่ระบุสาขา",
    formatQty(line.qty),
    `${formatMoney(line.sum_amount)} บาท`,
  ];
}

function formatTenantName(tenantId: string) {
  if (tenantId === "tenant_demo_remote") {
    return "Demo Remote";
  }
  if (tenantId === "tenant_office_sml1_2026") {
    return "Office SML1 2026";
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
