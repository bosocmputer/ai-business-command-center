"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type {
  SalesComparisonPoint,
  SalesDetailRow,
  SalesDocumentDetail,
  SalesDocumentListItem,
  SalesDocumentPage,
  SalesGoodsServicesSnapshot,
  SalesGoodsServicesParams,
  SalesHeaderRow,
  Tenant,
} from "@ai-bcc/shared";
import Button from "@/components/ui/button/Button";
import Badge from "@/components/ui/badge/Badge";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Pagination from "@/components/tables/Pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  const [activeRange, setActiveRange] =
    useState<SalesGoodsServicesParams | null>(null);

  const loadDashboard = useCallback(async (range: SalesGoodsServicesParams | null = null) => {
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

      const reportUrl = range
        ? `${API_BASE_URL}/api/app/${safeTenantSlug}/reports/sales_goods_services?${new URLSearchParams(
            range,
          ).toString()}`
        : `${API_BASE_URL}/api/app/${safeTenantSlug}/reports/sales_goods_services/latest`;
      const reportResponse = await fetch(reportUrl);
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

  const refreshDashboard = useCallback(() => {
    void loadDashboard(activeRange);
  }, [activeRange, loadDashboard]);

  const applyDateRange = useCallback(
    (range: SalesGoodsServicesParams) => {
      setActiveRange(range);
      void loadDashboard(range);
    },
    [loadDashboard],
  );

  const useLatestSnapshot = useCallback(() => {
    setActiveRange(null);
    void loadDashboard(null);
  }, [loadDashboard]);

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
      activeRange={activeRange}
      onApplyRange={applyDateRange}
      session={state.session}
      snapshot={state.snapshot}
      onRefresh={refreshDashboard}
      onUseLatest={useLatestSnapshot}
    />
  );
}

function CustomerDashboardContent({
  activeRange,
  onApplyRange,
  session,
  snapshot,
  onRefresh,
  onUseLatest,
}: {
  activeRange: SalesGoodsServicesParams | null;
  onApplyRange: (range: SalesGoodsServicesParams) => void;
  session: CustomerSession;
  snapshot: SalesGoodsServicesSnapshot;
  onRefresh: () => void;
  onUseLatest: () => void;
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

      <CustomerReportToolbar
        activeRange={activeRange}
        onApplyRange={onApplyRange}
        onUseLatest={onUseLatest}
        snapshot={snapshot}
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <CustomerDetailDrilldown
          params={snapshot.params}
          snapshot={snapshot}
          tenantSlug={session.tenant_slug}
        />

        <aside className="min-w-0 space-y-4">
          <InfoPanel title="เทียบยอด">
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

          <InfoPanel title="ความน่าเชื่อถือของข้อมูล">
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <p className="text-sm font-semibold text-gray-900">
                {trust.description}
              </p>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                ใช้ยอดขายหลักจากหัวบิล SML และเก็บรอบประมวลผลไว้สำหรับตรวจย้อนกลับ
              </p>
            </div>
          </InfoPanel>

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
        </aside>
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
          หน้านี้เป็น read-only และอ่านเฉพาะช่วงรายงานของร้านนี้เท่านั้น
          ลูกค้าไม่สามารถแก้ config, datasource, LINE OA หรือสิทธิ์จากหน้านี้ได้
        </p>
      </details>
    </CustomerShell>
  );
}

function CustomerReportToolbar({
  activeRange,
  onApplyRange,
  onUseLatest,
  snapshot,
}: {
  activeRange: SalesGoodsServicesParams | null;
  onApplyRange: (range: SalesGoodsServicesParams) => void;
  onUseLatest: () => void;
  snapshot: SalesGoodsServicesSnapshot;
}) {
  const [dateFrom, setDateFrom] = useState(snapshot.params.date_from);
  const [dateTo, setDateTo] = useState(snapshot.params.date_to);

  useEffect(() => {
    setDateFrom(snapshot.params.date_from);
    setDateTo(snapshot.params.date_to);
  }, [snapshot.params.date_from, snapshot.params.date_to]);

  const rangeError = getRangeValidationMessage(dateFrom, dateTo);
  const quickRanges = useMemo(() => buildQuickRanges(), []);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-medium text-gray-800 dark:text-white/90">
            เลือกช่วงรายงาน
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            ลูกค้าดูรายงานได้อย่างเดียว ระบบจะรัน approved SQL ตามช่วงวันที่ที่เลือก
            และจำกัดไม่เกิน 31 วันต่อครั้งใน pilot
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickRanges.map((item) => (
            <button
              className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-theme-xs font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
              key={item.label}
              onClick={() => {
                setDateFrom(item.range.date_from);
                setDateTo(item.range.date_to);
                onApplyRange(item.range);
              }}
              type="button"
            >
              {item.label}
            </button>
          ))}
          {activeRange ? (
            <button
              className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-theme-xs font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
              onClick={onUseLatest}
              type="button"
            >
              รายงานล่าสุด
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,220px)_auto] lg:items-end">
        <div>
          <Label htmlFor="sales-date-from">จากวันที่</Label>
          <Input
            error={Boolean(rangeError)}
            id="sales-date-from"
            onChange={(event) => setDateFrom(event.target.value)}
            type="date"
            value={dateFrom}
          />
        </div>
        <div>
          <Label htmlFor="sales-date-to">ถึงวันที่</Label>
          <Input
            error={Boolean(rangeError)}
            id="sales-date-to"
            onChange={(event) => setDateTo(event.target.value)}
            type="date"
            value={dateTo}
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
          <Button
            className="h-11"
            disabled={Boolean(rangeError)}
            onClick={() =>
              onApplyRange({ date_from: dateFrom, date_to: dateTo })
            }
            size="sm"
          >
            ดูรายงาน
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1 text-xs leading-5 text-gray-500 sm:flex-row sm:items-center sm:justify-between">
        <p>
          ช่วงที่แสดงอยู่: {formatThaiDate(snapshot.params.date_from)} ถึง{" "}
          {formatThaiDate(snapshot.params.date_to)}
        </p>
        <p className={rangeError ? "font-medium text-error-600" : ""}>
          {rangeError ?? "เลือกช่วงไม่เกิน 31 วันเพื่อให้รายงานโหลดเร็ว"}
        </p>
      </div>
    </section>
  );
}

function CustomerDetailDrilldown({
  params,
  snapshot,
  tenantSlug,
}: {
  params: SalesGoodsServicesParams;
  snapshot: SalesGoodsServicesSnapshot;
  tenantSlug: string;
}) {
  const pageSize = 10;
  const [draftSearch, setDraftSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [documentPageState, setDocumentPageState] =
    useState<DocumentPageState>({ status: "loading" });
  const [expandedDocNo, setExpandedDocNo] = useState<string | null>(null);
  const [detailsByDoc, setDetailsByDoc] = useState<
    Record<string, DocumentDetailState>
  >({});
  const documentPage =
    documentPageState.status === "ready" || documentPageState.status === "empty"
      ? documentPageState.page
      : null;
  const documents: SalesDocumentListItem[] = documentPage?.documents ?? [];
  const totalItems = documentPage?.pagination.total_items ?? snapshot.summary.document_count;
  const activeSearch = documentPage?.pagination.search ?? (searchTerm || null);

  useEffect(() => {
    setExpandedDocNo(null);
    setDetailsByDoc({});
    setDraftSearch("");
    setSearchTerm("");
    setCurrentPage(1);
  }, [params.date_from, params.date_to, snapshot.run_id]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDocumentPage() {
      setDocumentPageState({ status: "loading" });
      try {
        const pageParams = new URLSearchParams({
          date_from: params.date_from,
          date_to: params.date_to,
          page: String(currentPage),
          page_size: String(pageSize),
        });
        if (searchTerm) {
          pageParams.set("search", searchTerm);
        }

        const response = await fetch(
          `${API_BASE_URL}/api/app/${encodeURIComponent(
            tenantSlug,
          )}/reports/sales_goods_services/documents?${pageParams.toString()}`,
          { signal: controller.signal },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          data?: SalesDocumentPage;
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error(payload.error || "โหลดรายการบิลไม่สำเร็จ");
        }

        if (
          payload.data.pagination.total_items > 0 &&
          currentPage > payload.data.pagination.total_pages
        ) {
          setCurrentPage(payload.data.pagination.total_pages);
          return;
        }

        setDocumentPageState({
          status: payload.data.documents.length ? "ready" : "empty",
          page: payload.data,
        });
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") {
          return;
        }
        setDocumentPageState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดรายการบิลไม่สำเร็จ",
        });
      }
    }

    void loadDocumentPage();
    return () => controller.abort();
  }, [currentPage, params.date_from, params.date_to, searchTerm, tenantSlug]);

  const loadDocumentDetail = useCallback(
    async (docNo: string) => {
      setDetailsByDoc((current) => ({
        ...current,
        [docNo]: { status: "loading", docNo },
      }));
      try {
        const detailParams = new URLSearchParams({
          doc_no: docNo,
          date_from: params.date_from,
          date_to: params.date_to,
        });
        const response = await fetch(
          `${API_BASE_URL}/api/app/${encodeURIComponent(
            tenantSlug,
          )}/reports/sales_goods_services/document-detail?${detailParams.toString()}`,
        );
        const payload = (await response.json().catch(() => ({}))) as {
          data?: SalesDocumentDetail;
          error?: string;
        };

        if (response.status === 404) {
          setDetailsByDoc((current) => ({
            ...current,
            [docNo]: {
              status: "empty",
              docNo,
              message:
                payload.error ||
                "ไม่พบบิลนี้ในช่วงวันที่ของรายงานล่าสุด อาจมีการรันรายงานใหม่แล้ว",
            },
          }));
          return;
        }

        if (!response.ok || !payload.data) {
          throw new Error(payload.error || "โหลดรายละเอียดบิลไม่สำเร็จ");
        }

        const detailData = payload.data;
        setDetailsByDoc((current) => ({
          ...current,
          [docNo]: { status: "ready", data: detailData },
        }));
      } catch (error) {
        setDetailsByDoc((current) => ({
          ...current,
          [docNo]: {
            status: "error",
            docNo,
            message:
              error instanceof Error
                ? error.message
                : "โหลดรายละเอียดบิลไม่สำเร็จ",
          },
        }));
      }
    },
    [params.date_from, params.date_to, tenantSlug],
  );

  const applySearch = useCallback(() => {
    setExpandedDocNo(null);
    setDetailsByDoc({});
    setCurrentPage(1);
    setSearchTerm(draftSearch.trim());
  }, [draftSearch]);

  const clearSearch = useCallback(() => {
    setExpandedDocNo(null);
    setDetailsByDoc({});
    setDraftSearch("");
    setSearchTerm("");
    setCurrentPage(1);
  }, []);

  const toggleDocument = useCallback(
    (docNo: string) => {
      if (expandedDocNo === docNo) {
        setExpandedDocNo(null);
        return;
      }

      setExpandedDocNo(docNo);
      if (!detailsByDoc[docNo]) {
        void loadDocumentDetail(docNo);
      }
    },
    [detailsByDoc, expandedDocNo, loadDocumentDetail],
  );

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          <h2 className="text-base font-medium text-gray-800 dark:text-white/90">
            รายละเอียดบิล/สินค้า
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            เลือกบิลเพื่อเปิดรายการสินค้าใต้บิลนั้น ข้อมูล detail จะโหลดจาก SML
            เฉพาะตอนกดดู
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <Badge color="light">
            {documentPageState.status === "loading"
              ? "กำลังโหลดบิล"
              : `${formatNumber(totalItems)} บิล${activeSearch ? "ที่ค้นพบ" : ""}`}
          </Badge>
          <p className="text-xs text-gray-500">
            รายงานนี้มีทั้งหมด {formatNumber(snapshot.summary.document_count)} บิล
          </p>
        </div>
      </div>

      <div className="border-t border-gray-100 px-5 py-4 dark:border-gray-800 sm:px-6">
        <form
          className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            applySearch();
          }}
        >
          <div className="max-w-md">
            <Label htmlFor="sales-document-search" className="mb-2">
              ค้นหาบิลจาก SML
            </Label>
            <Input
              id="sales-document-search"
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="เลขบิล, ลูกค้า, วันที่, ยอดขาย"
              type="text"
              value={draftSearch}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button className="h-11" size="sm">
              ค้นหา
            </Button>
            {draftSearch || searchTerm ? (
              <button
                className="inline-flex h-11 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50"
                onClick={clearSearch}
                type="button"
              >
                ล้าง
              </button>
            ) : null}
          </div>
        </form>
      </div>

      <div className="border-t border-gray-100 dark:border-gray-800">
        {documentPageState.status === "loading" ? (
          <DocumentTableLoading />
        ) : documentPageState.status === "error" ? (
          <div className="px-5 py-8 text-center">
            <Badge color="error">โหลดบิลไม่สำเร็จ</Badge>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              {documentPageState.message}
            </p>
          </div>
        ) : documents.length ? (
          <div className="max-w-full overflow-x-auto">
            <div className="min-w-[1080px]">
              <Table>
                <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                  <TableRow>
                    <TableCell
                      className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400"
                      isHeader
                    >
                      บิลขาย
                    </TableCell>
                    <TableCell
                      className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400"
                      isHeader
                    >
                      ลูกค้า
                    </TableCell>
                    <TableCell
                      className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400"
                      isHeader
                    >
                      สาขา
                    </TableCell>
                    <TableCell
                      className="px-5 py-3 text-right text-theme-xs font-medium text-gray-500 dark:text-gray-400"
                      isHeader
                    >
                      ยอดขายบิลนี้
                    </TableCell>
                    <TableCell
                      className="px-5 py-3 text-right text-theme-xs font-medium text-gray-500 dark:text-gray-400"
                      isHeader
                    >
                      รายการ
                    </TableCell>
                    <TableCell
                      className="px-5 py-3 text-right text-theme-xs font-medium text-gray-500 dark:text-gray-400"
                      isHeader
                    >
                      เปิดดู
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {documents.map((document) => {
                    const isExpanded = expandedDocNo === document.doc_no;
                    const detailState = detailsByDoc[document.doc_no] ?? {
                      status: "idle" as const,
                    };
                    const cachedLineCount =
                      detailState.status === "ready"
                        ? detailState.data.lines.length
                        : document.detail_line_count;

                    return (
                      <Fragment key={`${document.doc_date}-${document.doc_no}`}>
                        <TableRow
                          className={
                            isExpanded
                              ? "bg-brand-50/40"
                              : "bg-white hover:bg-gray-50 dark:bg-transparent dark:hover:bg-white/[0.03]"
                          }
                        >
                          <TableCell className="px-5 py-4 text-start sm:px-6">
                            <button
                              aria-expanded={isExpanded}
                              className="flex min-w-0 items-start gap-3 text-left"
                              onClick={() => toggleDocument(document.doc_no)}
                              type="button"
                            >
                              <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-xs font-semibold text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                                {isExpanded ? "⌃" : "⌄"}
                              </span>
                              <span className="min-w-0">
                                <span className="block font-medium text-gray-800 text-theme-sm dark:text-white/90">
                                  {document.doc_no}
                                </span>
                                <span className="mt-1 block text-theme-xs text-gray-500 dark:text-gray-400">
                                  {formatThaiDate(document.doc_date)}
                                  {document.doc_time
                                    ? ` · ${document.doc_time}`
                                    : ""}
                                </span>
                              </span>
                            </button>
                          </TableCell>
                          <TableCell className="max-w-[260px] truncate px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                            {document.cust_name || document.cust_code || "-"}
                          </TableCell>
                          <TableCell className="px-5 py-4 text-start text-theme-sm text-gray-500 dark:text-gray-400">
                            {formatBranchLabel(document.resolved_branch_code)}
                          </TableCell>
                          <TableCell className="px-5 py-4 text-right text-theme-sm font-medium text-gray-800 dark:text-white/90">
                            {formatCurrency(document.total_amount)} บาท
                          </TableCell>
                          <TableCell className="px-5 py-4 text-right">
                            <Badge
                              color={cachedLineCount ? "success" : "light"}
                              size="sm"
                            >
                              {formatNumber(cachedLineCount)} รายการ
                            </Badge>
                          </TableCell>
                          <TableCell className="px-5 py-4 text-right">
                            <button
                              className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-theme-xs font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
                              disabled={
                                detailState.status === "loading" &&
                                detailState.docNo === document.doc_no
                              }
                              onClick={() => toggleDocument(document.doc_no)}
                              type="button"
                            >
                              {detailState.status === "loading" &&
                              detailState.docNo === document.doc_no
                                ? "กำลังโหลด"
                                : isExpanded
                                  ? "ซ่อน"
                                  : "ดูรายการ"}
                            </button>
                          </TableCell>
                        </TableRow>
                        {isExpanded ? (
                          <TableRow className="bg-gray-50/80 dark:bg-white/[0.02]">
                            <TableCell className="px-5 py-4" colSpan={6}>
                              <DocumentDetailResult state={detailState} />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-gray-500">
            {searchTerm
              ? "ไม่พบบิลที่ตรงกับคำค้นหาในช่วงวันที่นี้"
              : "ไม่มีบิลขายในช่วงวันที่นี้"}
          </div>
        )}
      </div>

      {documentPage && documentPage.pagination.total_pages > 1 ? (
        <div className="flex flex-col gap-3 border-t border-gray-100 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-500">
            หน้า {formatNumber(documentPage.pagination.page)} จาก{" "}
            {formatNumber(documentPage.pagination.total_pages)} · แสดง{" "}
            {formatNumber(documents.length)} จาก{" "}
            {formatNumber(documentPage.pagination.total_items)} บิล
          </p>
          <Pagination
            currentPage={documentPage.pagination.page}
            nextLabel="ถัดไป"
            onPageChange={setCurrentPage}
            previousLabel="ก่อนหน้า"
            totalPages={documentPage.pagination.total_pages}
          />
        </div>
      ) : null}

      <p className="border-t border-gray-100 px-5 py-3 text-xs leading-5 text-gray-500 dark:border-gray-800">
        ตารางบิลใช้ server-side pagination/search จาก SML ตามช่วงวันที่ที่เลือก
        ส่วนรายการสินค้าในบิลดึงแบบ read-only เฉพาะบิลที่เลือก เพื่อให้รายงานช่วงใหญ่ยังโหลดเร็วและ trace ได้
      </p>
    </section>
  );
}

type DocumentPageState =
  | { status: "loading" }
  | { status: "ready"; page: SalesDocumentPage }
  | { status: "empty"; page: SalesDocumentPage }
  | { status: "error"; message: string };

type DocumentDetailState =
  | { status: "idle" }
  | { status: "loading"; docNo: string }
  | { status: "ready"; data: SalesDocumentDetail }
  | { status: "empty"; docNo: string; message: string }
  | { status: "error"; docNo: string; message: string };

function DocumentTableLoading() {
  return (
    <div className="max-w-full overflow-x-auto">
      <div className="min-w-[1080px]">
        <Table>
          <TableBody>
            {["row-1", "row-2", "row-3", "row-4"].map((row) => (
              <TableRow key={row}>
                <TableCell className="px-5 py-4">
                  <div className="h-4 w-36 rounded bg-gray-100" />
                  <div className="mt-2 h-3 w-24 rounded bg-gray-100" />
                </TableCell>
                <TableCell className="px-5 py-4">
                  <div className="h-4 w-44 rounded bg-gray-100" />
                </TableCell>
                <TableCell className="px-5 py-4">
                  <div className="h-4 w-20 rounded bg-gray-100" />
                </TableCell>
                <TableCell className="px-5 py-4">
                  <div className="ml-auto h-4 w-28 rounded bg-gray-100" />
                </TableCell>
                <TableCell className="px-5 py-4">
                  <div className="ml-auto h-6 w-20 rounded-full bg-gray-100" />
                </TableCell>
                <TableCell className="px-5 py-4">
                  <div className="ml-auto h-9 w-20 rounded-lg bg-gray-100" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DocumentDetailResult({ state }: { state: DocumentDetailState }) {
  if (state.status === "idle") {
    return (
      <p className="rounded-lg border border-gray-100 bg-white p-3 text-sm leading-6 text-gray-500">
        ระบบพร้อมโหลดรายการสินค้า/บริการจาก SML เมื่อเปิดบิลนี้
      </p>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="rounded-lg border border-gray-100 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <Badge color="light">กำลังโหลด</Badge>
          <p className="text-xs text-gray-500">บิล {state.docNo}</p>
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-4 w-2/3 rounded bg-gray-100" />
          <div className="h-4 w-full rounded bg-gray-100" />
          <div className="h-4 w-5/6 rounded bg-gray-100" />
        </div>
      </div>
    );
  }

  if (state.status === "empty" || state.status === "error") {
    return (
      <div className="rounded-lg border border-warning-100 bg-warning-50 p-3">
        <p className="text-sm font-semibold text-gray-900">
          เปิดรายละเอียดบิล {state.docNo} ไม่สำเร็จ
        </p>
        <p className="mt-1 text-xs leading-5 text-gray-600">
          {state.message}
        </p>
      </div>
    );
  }

  const { document, lines } = state.data;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <DocumentSummaryCard document={document} lines={lines} />
      {lines.length ? (
        <div className="max-w-full overflow-x-auto">
          <div className="min-w-[820px]">
            <Table>
              <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                <TableRow>
                  {[
                    "สินค้า/บริการ",
                    "Barcode",
                    "หน่วย",
                    "จำนวน",
                    "ราคา",
                    "ส่วนลด",
                    "ยอดขาย",
                  ].map((label, index) => (
                    <TableCell
                      className={`px-4 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 ${
                        index >= 3 ? "text-right" : "text-start"
                      }`}
                      isHeader
                      key={label}
                    >
                      {label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {lines.map((line, index) => (
                  <DocumentLineRow
                    key={`${line.doc_no}-${line.line_number ?? index}-${line.item_code ?? "item"}`}
                    line={line}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-500">
          บิลนี้ไม่มีรายการสินค้าในช่วงข้อมูลล่าสุด
        </p>
      )}
    </div>
  );
}

function DocumentSummaryCard({
  document,
  lines,
}: {
  document: SalesHeaderRow;
  lines: SalesDetailRow[];
}) {
  const detailTotal = lines.reduce((sum, line) => sum + line.sum_amount, 0);

  return (
    <div className="border-b border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-transparent">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            บิล {document.doc_no}
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            {formatThaiDate(document.doc_date)} ·{" "}
            {document.cust_name || document.cust_code || "ไม่ระบุลูกค้า"}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-sm font-semibold text-gray-900">
            {formatCurrency(document.total_amount)} บาท
          </p>
          <p className="text-xs text-gray-500">
            {formatNumber(lines.length)} รายการ · รายละเอียดยอด{" "}
            {formatCurrency(detailTotal)} บาท
          </p>
        </div>
      </div>
    </div>
  );
}

function DocumentLineRow({ line }: { line: SalesDetailRow }) {
  const unitLabel = line.unit_name || line.unit_code || "-";

  return (
    <TableRow>
      <TableCell className="max-w-[320px] px-4 py-3 text-start">
        <p className="truncate font-medium text-gray-800 dark:text-white/90">
          {line.item_name || line.item_code || "ไม่ระบุสินค้า"}
        </p>
        <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
          {line.item_code || "-"} · {formatBranchLabel(line.branch_code)}
        </p>
      </TableCell>
      <TableCell className="px-4 py-3 text-theme-sm text-gray-500 dark:text-gray-400">
        {line.barcode || "-"}
      </TableCell>
      <TableCell className="px-4 py-3 text-theme-sm text-gray-500 dark:text-gray-400">
        {unitLabel}
      </TableCell>
      <TableCell className="px-4 py-3 text-right text-theme-sm text-gray-500 dark:text-gray-400">
        {formatNumber(line.qty)}
      </TableCell>
      <TableCell className="px-4 py-3 text-right text-theme-sm text-gray-500 dark:text-gray-400">
        {formatCurrency(line.price)}
      </TableCell>
      <TableCell className="px-4 py-3 text-right text-theme-sm text-gray-500 dark:text-gray-400">
        {line.discount || line.discount_amount
          ? `${line.discount || ""}${line.discount ? " · " : ""}${formatCurrency(
              line.discount_amount,
            )}`
          : "-"}
      </TableCell>
      <TableCell className="px-4 py-3 text-right text-theme-sm font-medium text-gray-800 dark:text-white/90">
        {formatCurrency(line.sum_amount)} บาท
      </TableCell>
    </TableRow>
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
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
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
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
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

function buildQuickRanges() {
  const today = new Date();
  const yesterday = addDateDays(today, -1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  return [
    {
      label: "วันนี้",
      range: {
        date_from: toDateInputValue(today),
        date_to: toDateInputValue(today),
      },
    },
    {
      label: "เมื่อวาน",
      range: {
        date_from: toDateInputValue(yesterday),
        date_to: toDateInputValue(yesterday),
      },
    },
    {
      label: "เดือนนี้",
      range: {
        date_from: toDateInputValue(monthStart),
        date_to: toDateInputValue(today),
      },
    },
  ] satisfies Array<{
    label: string;
    range: SalesGoodsServicesParams;
  }>;
}

function getRangeValidationMessage(dateFrom: string, dateTo: string) {
  if (!dateFrom || !dateTo) {
    return "กรุณาเลือกวันที่เริ่มต้นและวันที่สิ้นสุด";
  }

  if (dateFrom > dateTo) {
    return "วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด";
  }

  const start = Date.parse(`${dateFrom}T00:00:00.000Z`);
  const end = Date.parse(`${dateTo}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "รูปแบบวันที่ไม่ถูกต้อง";
  }

  const inclusiveDays = Math.floor((end - start) / 86_400_000) + 1;
  if (inclusiveDays > 31) {
    return "ช่วงรายงานใน pilot จำกัดไม่เกิน 31 วัน";
  }

  return null;
}

function addDateDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
