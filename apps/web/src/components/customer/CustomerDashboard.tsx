"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  type BusinessSignalRecord,
  formatSmlBranchLabel,
  type PurchaseGoodsPayablesSnapshot,
  type ReportKey,
  type SalesComparisonPoint,
  type SalesDetailRow,
  type SalesDocumentDetail,
  type SalesDocumentListItem,
  type SalesDocumentPage,
  type SalesFinancialBreakdown,
  type SalesGoodsServicesSnapshot,
  type SalesGoodsServicesParams,
  type SalesHeaderRow,
  type Tenant,
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

type BusinessDigestState =
  | { status: "loading" }
  | { status: "ready"; signals: BusinessSignalRecord[] }
  | { status: "empty" }
  | { status: "error"; message: string };

type DocumentDrilldownCopy = {
  amountHeader: string;
  description: string;
  detailReadyText: string;
  documentHeader: string;
  documentNoun: string;
  emptyDetailLabel: string;
  emptyListLabel: string;
  emptySearchLabel: string;
  footnote: string;
  lineEmptyLabel: string;
  loadDetailError: string;
  loadDocumentsError: string;
  loadFailedBadge: string;
  loadingDocumentsLabel: string;
  notFoundMessage: string;
  partyFallback: string;
  partyHeader: string;
  searchLabel: string;
  searchPlaceholder: string;
  summaryDetailTotalLabel: string;
  summaryPrefix: string;
  title: string;
  viewButtonLabel: string;
};

const salesDrilldownCopy: DocumentDrilldownCopy = {
  amountHeader: "ยอดขายบิลนี้",
  description:
    "เลือกบิลเพื่อเปิดรายการสินค้าใต้บิลนั้น ข้อมูล detail จะโหลดจาก SML เฉพาะตอนกดดู",
  detailReadyText: "ระบบพร้อมโหลดรายการสินค้า/บริการจาก SML เมื่อเปิดบิลนี้",
  documentHeader: "บิลขาย",
  documentNoun: "บิล",
  emptyDetailLabel: "บิลนี้ไม่มีรายการสินค้าในช่วงข้อมูลล่าสุด",
  emptyListLabel: "ไม่มีบิลขายในช่วงวันที่นี้",
  emptySearchLabel: "ไม่พบบิลที่ตรงกับคำค้นหาในช่วงวันที่นี้",
  footnote:
    "ตารางบิลใช้ server-side pagination/search จาก SML ตามช่วงวันที่ที่เลือก ส่วนรายการสินค้าในบิลดึงแบบ read-only เฉพาะบิลที่เลือก เพื่อให้รายงานช่วงใหญ่ยังโหลดเร็วและ trace ได้",
  lineEmptyLabel: "ไม่ระบุสินค้า",
  loadDetailError: "โหลดรายละเอียดบิลไม่สำเร็จ",
  loadDocumentsError: "โหลดรายการบิลไม่สำเร็จ",
  loadFailedBadge: "โหลดบิลไม่สำเร็จ",
  loadingDocumentsLabel: "กำลังโหลดบิล",
  notFoundMessage:
    "ไม่พบบิลนี้ในช่วงวันที่ของรายงานล่าสุด อาจมีการรันรายงานใหม่แล้ว",
  partyFallback: "ไม่ระบุลูกค้า",
  partyHeader: "ลูกค้า",
  searchLabel: "ค้นหาบิลจาก SML",
  searchPlaceholder: "เลขบิล, ลูกค้า, วันที่, ยอดขาย",
  summaryDetailTotalLabel: "รายละเอียดยอด",
  summaryPrefix: "บิล",
  title: "รายละเอียดบิล/สินค้า",
  viewButtonLabel: "ดูรายการ",
};

const purchaseDrilldownCopy: DocumentDrilldownCopy = {
  amountHeader: "ยอดซื้อเอกสารนี้",
  description:
    "เลือกเอกสารซื้อเพื่อตรวจสินค้า ผู้จำหน่าย และยอดตั้งหนี้ รายการจะโหลดจาก SML เฉพาะตอนกดดู",
  detailReadyText: "ระบบพร้อมโหลดสินค้าในเอกสารซื้อจาก SML เมื่อเปิดเอกสารนี้",
  documentHeader: "เอกสารซื้อ",
  documentNoun: "เอกสาร",
  emptyDetailLabel: "เอกสารนี้ไม่มีรายการสินค้าในช่วงข้อมูลล่าสุด",
  emptyListLabel: "ไม่มีเอกสารซื้อ/ตั้งหนี้ในช่วงวันที่นี้",
  emptySearchLabel: "ไม่พบเอกสารซื้อที่ตรงกับคำค้นหาในช่วงวันที่นี้",
  footnote:
    "ตารางเอกสารซื้อใช้ server-side pagination/search จาก SML ตามช่วงวันที่ที่เลือก ส่วนรายการสินค้าโหลดแบบ read-only เฉพาะเอกสารที่เลือก",
  lineEmptyLabel: "ไม่ระบุสินค้า",
  loadDetailError: "โหลดรายละเอียดเอกสารซื้อไม่สำเร็จ",
  loadDocumentsError: "โหลดรายการเอกสารซื้อไม่สำเร็จ",
  loadFailedBadge: "โหลดเอกสารซื้อไม่สำเร็จ",
  loadingDocumentsLabel: "กำลังโหลดเอกสาร",
  notFoundMessage:
    "ไม่พบเอกสารซื้อนี้ในช่วงวันที่ที่เลือก อาจมีการรันรายงานใหม่แล้ว",
  partyFallback: "ไม่ระบุผู้จำหน่าย",
  partyHeader: "ผู้จำหน่าย",
  searchLabel: "ค้นหาเอกสารซื้อจาก SML",
  searchPlaceholder: "เลขเอกสาร, ผู้จำหน่าย, วันที่, ยอดซื้อ",
  summaryDetailTotalLabel: "ยอดรวมสินค้า",
  summaryPrefix: "เอกสาร",
  title: "รายละเอียดเอกสารซื้อ/สินค้า",
  viewButtonLabel: "ดูสินค้า",
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
          <p className="mt-3 text-xs leading-5 text-warning-700">
            กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดสิทธิ์ร้านก่อนกลับมาอ่านรายงาน
          </p>
        </div>
      </CustomerShell>
    );
  }

  if (state.status === "error") {
    return (
      <CustomerShell title="โหลดข้อมูลไม่สำเร็จ">
        <div className="mx-auto mt-10 max-w-xl rounded-xl border border-error-200 bg-error-50 p-6 text-center text-error-700">
          <Badge color="error">โหลดรายงานไม่สำเร็จ</Badge>
          <h1 className="mt-4 text-2xl font-semibold text-gray-900">
            ยังเปิด Dashboard ไม่ได้
          </h1>
          <p className="mt-2 text-sm leading-6">{state.message}</p>
          <p className="mt-3 text-xs leading-5">
            ลองรีเฟรชอีกครั้ง หากยังไม่สำเร็จให้แจ้งผู้ดูแลเพื่อตรวจ datasource หรือรอบรายงานล่าสุด
          </p>
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
          <p className="mt-3 text-xs leading-5 text-gray-500">
            ตรวจว่าลิงก์อยู่ในรูปแบบ `/app/ชื่อร้าน` และเป็นลิงก์ล่าสุดจากผู้ดูแล
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
          <p className="mt-3 text-xs leading-5 text-gray-500">
            ผู้ดูแลต้องเชื่อม SML และรันรายงานแรกก่อน Dashboard จะแสดงข้อมูลได้
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
  const financialBreakdown = useMemo(
    () => getFinancialBreakdown(snapshot),
    [snapshot],
  );
  const periodLabel =
    snapshot.params.date_from === snapshot.params.date_to
      ? formatThaiDate(snapshot.params.date_from)
      : `${formatThaiDate(snapshot.params.date_from)} ถึง ${formatThaiDate(snapshot.params.date_to)}`;
  const branchItems = snapshot.branch_sales.slice(0, 5).map((branch) => ({
    label: formatBranchDisplay(branch),
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
  const [purchaseState, setPurchaseState] = useState<PurchasePanelState>({
    status: "loading",
  });
  const [businessDigestState, setBusinessDigestState] =
    useState<BusinessDigestState>({ status: "loading" });
  const purchaseSnapshot =
    purchaseState.status === "ready" ? purchaseState.snapshot : null;

  useEffect(() => {
    const controller = new AbortController();
    async function loadPurchaseReport() {
      setPurchaseState({ status: "loading" });
      try {
        const params = new URLSearchParams({
          date_from: snapshot.params.date_from,
          date_to: snapshot.params.date_to,
        });
        const response = await fetch(
          `${API_BASE_URL}/api/app/${encodeURIComponent(
            session.tenant_slug,
          )}/reports/purchase_goods_payables?${params.toString()}`,
          { signal: controller.signal },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          data?: PurchaseGoodsPayablesSnapshot;
          error?: string;
        };
        if (!response.ok || !payload.data) {
          throw new Error(payload.error || "โหลดรายงานซื้อ/ตั้งหนี้ไม่สำเร็จ");
        }
        setPurchaseState({ status: "ready", snapshot: payload.data });
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") {
          return;
        }
        setPurchaseState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดรายงานซื้อ/ตั้งหนี้ไม่สำเร็จ",
        });
      }
    }

    void loadPurchaseReport();
    return () => controller.abort();
  }, [
    session.tenant_slug,
    snapshot.params.date_from,
    snapshot.params.date_to,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadBusinessDigest() {
      setBusinessDigestState({ status: "loading" });
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/app/${encodeURIComponent(
            session.tenant_slug,
          )}/business-digest?${new URLSearchParams({
            status: "open",
            limit: "5",
          }).toString()}`,
          { signal: controller.signal },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          data?: BusinessSignalRecord[];
          error?: string;
        };
        if (!response.ok || !payload.data) {
          throw new Error(payload.error || "โหลดเรื่องที่ควรจัดการไม่สำเร็จ");
        }
        setBusinessDigestState(
          payload.data.length
            ? { status: "ready", signals: payload.data }
            : { status: "empty" },
        );
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") {
          return;
        }
        setBusinessDigestState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดเรื่องที่ควรจัดการไม่สำเร็จ",
        });
      }
    }

    void loadBusinessDigest();
    return () => controller.abort();
  }, [session.tenant_slug]);

  return (
    <CustomerShell tenant={session.tenant} title="รายงานร้านค้า">
      <CustomerExecutiveCockpit
        periodLabel={periodLabel}
        purchaseState={purchaseState}
        salesSnapshot={snapshot}
        tenant={session.tenant}
        topBranchLabel={topBranch ? formatBranchDisplay(topBranch) : null}
        topProductLabel={topProduct?.item_name ?? null}
        trust={trust}
      />

      <CustomerBusinessDigest state={businessDigestState} />

      <section className="overflow-hidden rounded-xl border border-[#E4E7EC] bg-white shadow-sm">
        <div className="border-b border-[#EAECF0] px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold leading-[18px] text-[#2563EB]">
                รายงานหลัก
              </p>
              <h1 className="mt-3 text-[24px] font-semibold leading-8 text-[#101828] sm:text-[28px] sm:leading-9">
                รายงานขายสินค้าและบริการ
              </h1>
              <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
                {session.tenant.name} · วันที่ข้อมูล {periodLabel} · อัปเดต{" "}
                {formatDateTime(snapshot.generated_at)}
              </p>
            </div>
            <button
              className="inline-flex h-10 w-fit items-center justify-center rounded-lg border border-[#D0D5DD] bg-white px-4 text-[14px] font-semibold leading-[22px] text-[#344054] hover:bg-[#F9FAFB]"
              onClick={onRefresh}
              type="button"
            >
              รีเฟรช
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1.2fr)_380px]">
          <div className="px-4 py-4 sm:px-5">
            <p className="text-[12px] font-medium leading-[18px] text-[#667085]">
              ยอดขายสุทธิ
            </p>
            <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="text-[28px] font-semibold leading-9 tracking-normal text-[#101828] sm:text-[32px] sm:leading-10">
                {formatCurrency(snapshot.summary.total_sales)}
              </p>
              <p className="pb-1 text-[18px] font-semibold leading-7 text-[#344054]">
                บาท
              </p>
            </div>
            <div className="mt-4 grid overflow-hidden rounded-lg border border-[#EAECF0] sm:grid-cols-3">
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
                    ? formatBranchDisplay(topBranch)
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

          <aside className="border-t border-[#EAECF0] bg-[#F9FAFB] px-4 py-4 sm:px-5 lg:border-l lg:border-t-0">
            <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
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

      <CustomerPurchaseSummary
        state={purchaseState}
        tenantSlug={session.tenant_slug}
      />

      {purchaseState.status === "ready" ? (
        <CustomerDetailDrilldown
          copy={purchaseDrilldownCopy}
          params={purchaseState.snapshot.params}
          reportPath="purchase_goods_payables"
          summaryDocumentCount={purchaseState.snapshot.summary.document_count}
          tenantSlug={session.tenant_slug}
        />
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <CustomerDetailDrilldown
          copy={salesDrilldownCopy}
          params={snapshot.params}
          reportPath="sales_goods_services"
          snapshot={snapshot}
          tenantSlug={session.tenant_slug}
        />

        <aside className="min-w-0 space-y-4">
          <InfoPanel title="ความหมายยอดขาย">
            <FinancialBreakdownRows breakdown={financialBreakdown} />
          </InfoPanel>

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

      {purchaseSnapshot ? (
        <details className="rounded-xl border border-[#E4E7EC] bg-white px-4 py-3 text-[12px] leading-[18px] text-[#667085]">
          <summary className="cursor-pointer select-none font-semibold text-[#344054]">
            ภาพรวมยอดซื้อจากรายงานล่าสุด
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <DetailItem
              label="ยอดซื้อ/ตั้งหนี้"
              value={`${formatCurrency(purchaseSnapshot.summary.total_purchase)} บาท`}
            />
            <DetailItem
              label="เอกสารซื้อ"
              value={`${formatNumber(purchaseSnapshot.summary.document_count)} ใบ`}
            />
            <DetailItem
              label="จำนวนซื้อรวม"
              value={formatNumber(purchaseSnapshot.summary.total_qty)}
            />
          </div>
        </details>
      ) : null}

      <details className="rounded-xl border border-[#E4E7EC] bg-white px-4 py-3 text-[12px] leading-[18px] text-[#667085]">
        <summary className="cursor-pointer select-none font-semibold text-[#344054]">
          รายละเอียดแหล่งข้อมูล
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <DetailItem label="ร้านค้า" value={session.tenant.name} />
          <DetailItem label="ช่วงวันที่" value={periodLabel} />
          <DetailItem
            label="แหล่งข้อมูล"
            value={
              snapshot.source === "sample_snapshot"
                ? "ข้อมูลตัวอย่าง"
                : "ข้อมูลจาก SML"
            }
          />
          <DetailItem label="รอบประมวลผล" value={snapshot.run_id} />
          <DetailItem
            label="Demo Mode"
            value={
              session.tenant.featureFlags?.demo_mode_enabled
                ? "เปิด, ข้อมูลต้องติดป้ายตัวอย่าง"
                : "ปิด"
            }
          />
        </div>
        <p className="mt-3">
          หน้านี้เป็น read-only และอ่านเฉพาะช่วงรายงานของร้านนี้เท่านั้น
          ลูกค้าไม่สามารถแก้ config, datasource, LINE OA หรือสิทธิ์จากหน้านี้ได้
        </p>
      </details>
    </CustomerShell>
  );
}

function CustomerExecutiveCockpit({
  periodLabel,
  purchaseState,
  salesSnapshot,
  tenant,
  topBranchLabel,
  topProductLabel,
  trust,
}: {
  periodLabel: string;
  purchaseState: PurchasePanelState;
  salesSnapshot: SalesGoodsServicesSnapshot;
  tenant: Tenant;
  topBranchLabel: string | null;
  topProductLabel: string | null;
  trust: ReturnType<typeof getTrustStatus>;
}) {
  const purchaseSnapshot =
    purchaseState.status === "ready" ? purchaseState.snapshot : null;
  const purchaseLabel =
    purchaseState.status === "loading"
      ? "กำลังโหลด"
      : purchaseState.status === "error"
        ? "ยังไม่พร้อม"
        : purchaseSnapshot
          ? `${formatCurrency(purchaseSnapshot.summary.total_purchase)} บาท`
          : "ยังไม่มีข้อมูล";
  const netMovement = purchaseSnapshot
    ? salesSnapshot.summary.total_sales - purchaseSnapshot.summary.total_purchase
    : null;
  const netMovementTone =
    netMovement === null ? "neutral" : netMovement >= 0 ? "success" : "warning";
  const watchItems = [
    `${formatCurrency(salesSnapshot.summary.total_sales)} บาท จาก ${formatNumber(
      salesSnapshot.summary.document_count,
    )} บิลขาย`,
    purchaseSnapshot
      ? `${formatCurrency(purchaseSnapshot.summary.total_purchase)} บาท จาก ${formatNumber(
          purchaseSnapshot.summary.document_count,
        )} เอกสารซื้อ`
      : purchaseState.status === "error"
        ? "รายงานซื้อยังไม่พร้อม ตรวจการเปิดสิทธิ์หรือ datasource"
        : "กำลังเตรียมรายงานซื้อ/ตั้งหนี้",
    topBranchLabel
      ? `ยอดขายหลักมาจาก ${topBranchLabel}`
      : "ยังไม่มีข้อมูลสาขาหลักในช่วงนี้",
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-[#E4E7EC] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="border-b border-[#EAECF0] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold leading-[18px] text-[#2563EB]">
              Dashboard ผู้บริหาร
            </p>
            <h1 className="mt-1 text-[24px] font-semibold leading-8 text-[#101828] sm:text-[28px] sm:leading-9">
              ภาพรวมร้านค้า
            </h1>
            <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
              {tenant.name} · ช่วงข้อมูล {periodLabel} · อัปเดต{" "}
              {formatDateTime(salesSnapshot.generated_at)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {tenant.featureFlags?.demo_mode_enabled ? (
              <StatusPill tone="warning">Demo Mode</StatusPill>
            ) : null}
            <StatusPill tone={trust.color === "warning" ? "warning" : "success"}>
              {trust.label}
            </StatusPill>
            <StatusPill tone="neutral">
              {salesSnapshot.source === "sample_snapshot"
                ? "ข้อมูลตัวอย่าง"
                : "ข้อมูลจาก SML"}
            </StatusPill>
            <StatusPill tone="neutral">อ่านอย่างเดียว</StatusPill>
            <StatusPill tone="neutral">เฉพาะร้านนี้</StatusPill>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 border-b border-[#EAECF0] lg:grid-cols-4">
        <ExecutiveMetricBlock
          label="ยอดขายสุทธิ"
          meta={`${formatNumber(salesSnapshot.summary.document_count)} บิลขาย`}
          value={`${formatCurrency(salesSnapshot.summary.total_sales)} บาท`}
        />
        <ExecutiveMetricBlock
          label="ยอดซื้อ/ตั้งหนี้"
          meta={
            purchaseSnapshot
              ? `${formatNumber(purchaseSnapshot.summary.document_count)} เอกสารซื้อ`
              : "รอข้อมูลรายงานซื้อ"
          }
          value={purchaseLabel}
        />
        <ExecutiveMetricBlock
          label="ส่วนต่างขาย-ซื้อ"
          meta={
            netMovement === null
              ? "จะคำนวณเมื่อรายงานซื้อพร้อม"
              : netMovement >= 0
                ? "ยอดขายมากกว่ายอดซื้อ"
                : "ยอดซื้อมากกว่ายอดขาย"
          }
          tone={netMovementTone}
          value={netMovement === null ? "-" : `${formatCurrency(netMovement)} บาท`}
        />
        <ExecutiveMetricBlock
          label="สัญญาณหลัก"
          meta={topProductLabel ?? "ยังไม่มีสินค้าหลักในช่วงนี้"}
          value={topBranchLabel ?? "ยังไม่มีสาขาหลัก"}
        />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="px-4 py-4 sm:px-5">
          <p className="text-[12px] font-semibold leading-[18px] text-[#2563EB]">
            สิ่งที่ควรดูตอนนี้
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {watchItems.map((item, index) => (
              <li
                className="flex min-w-0 gap-2 rounded-lg border border-[#EAECF0] bg-[#FCFCFD] px-3 py-2 text-[13px] leading-5"
                key={item}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-[11px] font-semibold text-white">
                  {index + 1}
                </span>
                <span className="min-w-0 text-[#344054]">{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-[#EAECF0] bg-[#F9FAFB] px-4 py-4 sm:px-5 lg:border-l lg:border-t-0">
          <p className="text-[12px] font-semibold leading-[18px] text-[#667085]">
            สรุปสำหรับตัดสินใจ
          </p>
          <p className="mt-2 text-[14px] leading-[22px] text-[#344054]">
            ยอดขายหลักมาจาก{" "}
            <span className="font-semibold text-[#101828]">
              {topBranchLabel ?? "ยังไม่มีข้อมูลสาขา"}
            </span>
            {topProductLabel ? (
              <>
                {" "}
                และสินค้าหลักคือ{" "}
                <span className="font-semibold text-[#101828]">
                  {topProductLabel}
                </span>
              </>
            ) : null}
          </p>
        </div>
      </div>
    </section>
  );
}

function CustomerBusinessDigest({
  state,
}: {
  state: BusinessDigestState;
}) {
  if (state.status === "loading") {
    return (
      <section className="rounded-xl border border-[#E4E7EC] bg-white px-4 py-4 shadow-sm sm:px-5">
        <div className="h-4 w-40 rounded bg-[#F2F4F7]" />
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {["a", "b", "c"].map((item) => (
            <div className="h-20 rounded-lg bg-[#F9FAFB]" key={item} />
          ))}
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-[13px] leading-5 text-warning-700 sm:px-5">
        ยังโหลดเรื่องที่ควรจัดการไม่ได้: {state.message}
      </section>
    );
  }

  if (state.status === "empty") {
    return (
      <section className="rounded-xl border border-[#D1FADF] bg-[#ECFDF3] px-4 py-4 shadow-sm sm:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[12px] font-semibold leading-[18px] text-[#027A48]">
              เรื่องที่ควรจัดการวันนี้
            </p>
            <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
              ยังไม่พบเรื่องเร่งด่วนจากรายงานล่าสุด
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-[#475467]">
              ระบบจะขึ้นเตือนเมื่อพบยอดขายหาย กำไรผิดปกติ หรือข้อมูล SML ที่ควรตรวจ
            </p>
          </div>
          <StatusPill tone="success">ปกติ</StatusPill>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[#FEDF89] bg-[#FFFAEB] px-4 py-4 shadow-sm sm:px-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[12px] font-semibold leading-[18px] text-[#B54708]">
            เรื่องที่ควรจัดการวันนี้
          </p>
          <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
            ระบบพบ {formatNumber(state.signals.length)} เรื่องจากรายงานล่าสุด
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[#475467]">
            แต่ละเรื่องผูกกับรายงาน SML ต้นทางและมีเหตุผลว่าควรตรวจอะไรต่อ
          </p>
        </div>
        <StatusPill
          tone={
            state.signals.some((signal) => signal.severity === "critical")
              ? "warning"
              : "neutral"
          }
        >
          ตรวจตามลำดับ
        </StatusPill>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {state.signals.slice(0, 3).map((signal) => (
          <article
            className="min-w-0 rounded-lg border border-[#FEDF89] bg-white p-3"
            key={signal.id}
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <h3 className="min-w-0 break-words text-[14px] font-semibold leading-5 text-[#101828]">
                {signal.title}
              </h3>
              <StatusPill
                tone={signal.severity === "critical" ? "warning" : "neutral"}
              >
                {formatBusinessSignalSeverity(signal.severity)}
              </StatusPill>
            </div>
            <p className="mt-2 break-words text-[13px] leading-5 text-[#344054]">
              {signal.insight}
            </p>
            <p className="mt-2 break-words text-[12px] font-semibold leading-5 text-[#B54708]">
              ควรตรวจ: {signal.recommended_action}
            </p>
            <p className="mt-2 text-[12px] leading-5 text-[#667085]">
              มาจาก {formatCustomerReportLabel(signal.source_report_key)}
              {signal.amount_impact !== null
                ? ` · ${formatCurrency(signal.amount_impact)} บาท`
                : ""}
            </p>
            <div className="mt-3 rounded-md border border-[#EAECF0] bg-[#F9FAFB] p-2">
              <p className="text-[12px] font-semibold leading-5 text-[#344054]">
                ทำไมระบบแจ้งเรื่องนี้
              </p>
              <p className="mt-1 break-words text-[12px] leading-5 text-[#475467]">
                {formatBusinessSignalEvidence(signal)}
              </p>
              <p className="mt-1 break-all text-[11px] leading-4 text-[#667085]">
                Source: {formatCustomerReportLabel(signal.source_report_key)} · run{" "}
                {signal.source_run_id}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ExecutiveMetricBlock({
  label,
  meta,
  tone = "neutral",
  value,
}: {
  label: string;
  meta: string;
  tone?: "neutral" | "success" | "warning";
  value: string;
}) {
  const valueClass =
    tone === "success"
      ? "text-[#027A48]"
      : tone === "warning"
        ? "text-[#B54708]"
        : "text-[#101828]";

  return (
    <div className="min-w-0 border-r border-t border-[#EAECF0] px-4 py-4 [&:nth-child(-n+2)]:border-t-0 lg:border-t-0">
      <p className="text-[12px] font-medium leading-[18px] text-[#667085]">
        {label}
      </p>
      <p
        className={`mt-1 truncate text-[22px] font-semibold leading-8 tracking-normal sm:text-[28px] sm:leading-9 ${valueClass}`}
        title={value}
      >
        {value}
      </p>
      <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-[#667085]">
        {meta}
      </p>
    </div>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "neutral" | "success" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]"
      : tone === "warning"
        ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
        : "border-[#D0D5DD] bg-[#F9FAFB] text-[#475467]";

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold leading-[18px] ${toneClass}`}
    >
      {children}
    </span>
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
    <section className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
            เลือกช่วงรายงาน
          </h2>
          <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
            เลือกช่วงวันที่เพื่อดูรายงานย้อนหลัง ระบบอ่านข้อมูลจาก approved SQL แบบ read-only
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickRanges.map((item) => (
            <button
              className="inline-flex h-9 items-center justify-center rounded-lg border border-[#D0D5DD] bg-white px-3 text-[12px] font-semibold leading-[18px] text-[#344054] shadow-sm hover:bg-[#F9FAFB]"
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
              className="inline-flex h-9 items-center justify-center rounded-lg border border-[#D0D5DD] bg-white px-3 text-[12px] font-semibold leading-[18px] text-[#344054] shadow-sm hover:bg-[#F9FAFB]"
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

      <div className="mt-3 flex flex-col gap-1 text-[12px] leading-[18px] text-[#667085] sm:flex-row sm:items-center sm:justify-between">
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

function CustomerPurchaseSummary({
  state,
  tenantSlug,
}: {
  state: PurchasePanelState;
  tenantSlug: string;
}) {
  if (state.status === "loading") {
    return (
      <section className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm sm:p-5">
        <div className="h-5 w-48 rounded bg-gray-100" />
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {["purchase", "docs", "lines", "supplier"].map((item) => (
            <div className="h-20 rounded-lg bg-gray-100" key={item} />
          ))}
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="rounded-xl border border-[#FEDF89] bg-[#FFFAEB] p-4 sm:p-5">
        <Badge color="warning">รายงานซื้อยังไม่พร้อม</Badge>
        <p className="mt-2 text-[14px] leading-[22px] text-[#475467]">
          {state.message}
        </p>
      </section>
    );
  }

  const snapshot = state.snapshot;
  const topSupplier = snapshot.top_suppliers[0] ?? null;
  const topProduct = snapshot.top_products[0] ?? null;
  const maxProductTotal = topProduct?.sum_amount ?? 0;

  return (
    <section className="overflow-hidden rounded-xl border border-[#E4E7EC] bg-white shadow-sm">
      <div className="border-b border-[#EAECF0] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold leading-[18px] text-[#2563EB]">
              รายงานเสริม
            </p>
            <h2 className="mt-3 text-[24px] font-semibold leading-8 text-[#101828]">
              รายงานซื้อ/ตั้งหนี้
            </h2>
            <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
              ช่วงข้อมูล {formatThaiDate(snapshot.params.date_from)} ถึง{" "}
              {formatThaiDate(snapshot.params.date_to)} · ใช้ยอดหัวเอกสาร SML
              เป็นยอดซื้อหลัก
            </p>
          </div>
          <a
            className="inline-flex h-10 w-fit items-center justify-center rounded-lg border border-[#D0D5DD] bg-white px-4 text-[14px] font-semibold leading-[22px] text-[#344054] hover:bg-[#F9FAFB]"
            href={`/app/${tenantSlug}`}
          >
            อ่านอย่างเดียว
          </a>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="px-4 py-4 sm:px-5">
          <p className="text-[12px] font-medium leading-[18px] text-[#667085]">
            ยอดซื้อ/ตั้งหนี้
          </p>
          <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
            <p className="text-[28px] font-semibold leading-9 tracking-normal text-[#101828] sm:text-[32px] sm:leading-10">
              {formatCurrency(snapshot.summary.total_purchase)}
            </p>
            <p className="pb-1 text-[18px] font-semibold leading-7 text-[#344054]">
              บาท
            </p>
          </div>
          <div className="mt-4 grid overflow-hidden rounded-lg border border-[#EAECF0] sm:grid-cols-3">
            <Kpi
              label="เอกสารซื้อ"
              value={`${formatNumber(snapshot.summary.document_count)} ใบ`}
            />
            <Kpi
              label="รายการสินค้า"
              value={`${formatNumber(snapshot.summary.line_count)} รายการ`}
            />
            <Kpi
              label="จำนวนซื้อรวม"
              value={formatNumber(snapshot.summary.total_qty)}
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <MiniSummary
              label="ผู้จำหน่ายหลัก"
              value={topSupplier?.supplier_name ?? "ไม่มีข้อมูล"}
              detail={
                topSupplier
                  ? `${formatCurrency(topSupplier.total_amount)} บาท`
                  : "ยังไม่มีเอกสารซื้อในช่วงนี้"
              }
            />
            <MiniSummary
              label="สินค้าที่ซื้อสูงสุด"
              value={topProduct?.item_name ?? "ไม่มีข้อมูล"}
              detail={
                topProduct
                  ? `${formatCurrency(topProduct.sum_amount)} บาท`
                  : "ยังไม่มีสินค้าในช่วงนี้"
              }
            />
          </div>
        </div>

        <aside className="border-t border-[#EAECF0] bg-[#F9FAFB] px-4 py-4 sm:px-5 lg:border-l lg:border-t-0">
          <h3 className="text-[18px] font-semibold leading-7 text-[#101828]">
            สิ่งที่ควรดู
          </h3>
          <div className="mt-3 space-y-3">
            <RankPanel
              emptyLabel="ไม่มีข้อมูลผู้จำหน่ายในช่วงวันที่นี้"
              items={snapshot.top_suppliers.slice(0, 5).map((supplier) => ({
                label: supplier.supplier_name,
                value: `${formatCurrency(supplier.total_amount)} บาท`,
                meta: `${formatNumber(supplier.document_count)} เอกสาร`,
                share: formatShare(
                  supplier.total_amount,
                  snapshot.summary.total_purchase,
                  "ยอดซื้อ",
                ),
              }))}
              title="ผู้จำหน่ายหลัก"
            />
            <RankPanel
              emptyLabel="ไม่มีข้อมูลสินค้าในช่วงวันที่นี้"
              items={snapshot.top_products.slice(0, 5).map((product) => ({
                label: product.item_name,
                value: `${formatCurrency(product.sum_amount)} บาท`,
                meta: `${formatNumber(product.qty)} หน่วย · ${formatNumber(
                  product.line_count,
                )} รายการ`,
                share:
                  maxProductTotal > 0
                    ? formatShare(
                        product.sum_amount,
                        snapshot.summary.total_purchase,
                        "ยอดซื้อ",
                      )
                    : null,
              }))}
              title="สินค้าที่ซื้อสูงสุด"
            />
          </div>
        </aside>
      </div>
    </section>
  );
}

function CustomerDetailDrilldown({
  copy,
  params,
  reportPath,
  snapshot,
  summaryDocumentCount,
  tenantSlug,
}: {
  copy: DocumentDrilldownCopy;
  params: SalesGoodsServicesParams;
  reportPath: ReportKey;
  snapshot?: SalesGoodsServicesSnapshot;
  summaryDocumentCount?: number;
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
  const searchInputId = `${reportPath}-document-search`;
  const totalDocumentCount =
    summaryDocumentCount ?? snapshot?.summary.document_count ?? 0;
  const totalItems = documentPage?.pagination.total_items ?? totalDocumentCount;
  const activeSearch = documentPage?.pagination.search ?? (searchTerm || null);

  useEffect(() => {
    setExpandedDocNo(null);
    setDetailsByDoc({});
    setDraftSearch("");
    setSearchTerm("");
    setCurrentPage(1);
  }, [params.date_from, params.date_to, reportPath, snapshot?.run_id]);

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
          )}/reports/${reportPath}/documents?${pageParams.toString()}`,
          { signal: controller.signal },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          data?: SalesDocumentPage;
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error(payload.error || copy.loadDocumentsError);
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
                  : copy.loadDocumentsError,
          });
      }
    }

    void loadDocumentPage();
    return () => controller.abort();
  }, [
    copy.loadDocumentsError,
    currentPage,
    params.date_from,
    params.date_to,
    reportPath,
    searchTerm,
    tenantSlug,
  ]);

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
          )}/reports/${reportPath}/document-detail?${detailParams.toString()}`,
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
              message: payload.error || copy.notFoundMessage,
            },
          }));
          return;
        }

        if (!response.ok || !payload.data) {
          throw new Error(payload.error || copy.loadDetailError);
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
                : copy.loadDetailError,
          },
        }));
      }
    },
    [
      copy.loadDetailError,
      copy.notFoundMessage,
      params.date_from,
      params.date_to,
      reportPath,
      tenantSlug,
    ],
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
    <section className="min-w-0 overflow-hidden rounded-xl border border-[#E4E7EC] bg-white shadow-sm">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div>
          <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
            {copy.title}
          </h2>
          <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
            {copy.description}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <Badge color="light">
            {documentPageState.status === "loading"
              ? copy.loadingDocumentsLabel
              : `${formatNumber(totalItems)} ${copy.documentNoun}${activeSearch ? "ที่ค้นพบ" : ""}`}
          </Badge>
          <p className="text-[12px] leading-[18px] text-[#667085]">
            รายงานนี้มีทั้งหมด {formatNumber(totalDocumentCount)}{" "}
            {copy.documentNoun}
          </p>
        </div>
      </div>

      <div className="border-t border-[#EAECF0] px-4 py-4 sm:px-5">
        <form
          className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            applySearch();
          }}
        >
          <div className="max-w-xl">
            <Label htmlFor={searchInputId} className="mb-2">
              {copy.searchLabel}
            </Label>
            <Input
              id={searchInputId}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder={copy.searchPlaceholder}
              type="text"
              value={draftSearch}
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Button className="h-11 w-full sm:w-auto" size="sm">
              ค้นหา
            </Button>
            {draftSearch || searchTerm ? (
              <button
                className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-[#D0D5DD] bg-white px-3 text-[14px] font-semibold leading-[22px] text-[#344054] shadow-sm hover:bg-[#F9FAFB] sm:w-auto"
                onClick={clearSearch}
                type="button"
              >
                ล้าง
              </button>
            ) : null}
          </div>
        </form>
        {activeSearch ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] leading-[18px] text-[#667085]">
            <span>กำลังค้นหา:</span>
            <span className="inline-flex max-w-full items-center rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-1 font-medium text-[#1D4ED8]">
              {activeSearch}
            </span>
          </div>
        ) : null}
      </div>

      <div className="border-t border-[#EAECF0]">
        {documentPageState.status === "loading" ? (
          <DocumentTableLoading />
        ) : documentPageState.status === "error" ? (
          <div className="px-5 py-8 text-center">
            <Badge color="error">{copy.loadFailedBadge}</Badge>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              {documentPageState.message}
            </p>
          </div>
        ) : documents.length ? (
          <>
            <div className="divide-y divide-gray-100 md:hidden">
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
                  <div
                    className={
                      isExpanded
                        ? "bg-[#EFF6FF]/50 px-4 py-3"
                        : "bg-white px-4 py-3 dark:bg-transparent"
                    }
                    key={`${document.doc_date}-${document.doc_no}`}
                  >
                      <DocumentMobileCard
                      copy={copy}
                      document={document}
                      isExpanded={isExpanded}
                      lineCount={cachedLineCount}
                      onToggle={() => toggleDocument(document.doc_no)}
                      state={detailState}
                    />
                    {isExpanded ? (
                      <div className="mt-3">
                        <DocumentDetailResult copy={copy} state={detailState} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="hidden md:block">
                <Table>
                  <TableHeader className="border-b border-[#EAECF0]">
                    <TableRow>
                      <TableCell
                        className="px-5 py-3 text-start text-[12px] font-medium leading-[18px] text-[#667085]"
                        isHeader
                      >
	                        {copy.documentHeader}
                      </TableCell>
                      <TableCell
                        className="px-5 py-3 text-start text-[12px] font-medium leading-[18px] text-[#667085]"
                        isHeader
                      >
	                        {copy.partyHeader}
                      </TableCell>
                      <TableCell
                        className="px-5 py-3 text-start text-[12px] font-medium leading-[18px] text-[#667085]"
                        isHeader
                      >
                        สาขา
                      </TableCell>
                      <TableCell
                        className="px-5 py-3 text-right text-[12px] font-medium leading-[18px] text-[#667085]"
                        isHeader
                      >
	                        {copy.amountHeader}
                      </TableCell>
                      <TableCell
                        className="px-5 py-3 text-right text-[12px] font-medium leading-[18px] text-[#667085]"
                        isHeader
                      >
                        รายการ
                      </TableCell>
                      <TableCell
                        className="px-5 py-3 text-right text-[12px] font-medium leading-[18px] text-[#667085]"
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
                            {formatDocumentBranchDisplay(document)}
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
	                                  : copy.viewButtonLabel}
                            </button>
                          </TableCell>
                        </TableRow>
                        {isExpanded ? (
                          <TableRow className="bg-gray-50/80 dark:bg-white/[0.02]">
                            <TableCell className="px-5 py-4" colSpan={6}>
	                              <DocumentDetailResult copy={copy} state={detailState} />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-gray-500">
            {searchTerm
              ? copy.emptySearchLabel
              : copy.emptyListLabel}
          </div>
        )}
      </div>

      {documentPage && documentPage.pagination.total_pages > 1 ? (
        <div className="flex flex-col gap-3 border-t border-gray-100 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-500">
            หน้า {formatNumber(documentPage.pagination.page)} จาก{" "}
            {formatNumber(documentPage.pagination.total_pages)} · แสดง{" "}
            {formatNumber(documents.length)} จาก{" "}
            {formatNumber(documentPage.pagination.total_items)} {copy.documentNoun}
          </p>
          <div className="max-w-full overflow-x-auto pb-1">
            <Pagination
              currentPage={documentPage.pagination.page}
              nextLabel="ถัดไป"
              onPageChange={setCurrentPage}
              previousLabel="ก่อนหน้า"
              totalPages={documentPage.pagination.total_pages}
            />
          </div>
        </div>
      ) : null}

      <p className="border-t border-gray-100 px-5 py-3 text-xs leading-5 text-gray-500 dark:border-gray-800">
        {copy.footnote}
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

type PurchasePanelState =
  | { status: "loading" }
  | { status: "ready"; snapshot: PurchaseGoodsPayablesSnapshot }
  | { status: "error"; message: string };

function DocumentTableLoading() {
  return (
    <div>
      <div className="space-y-3 px-4 py-4 md:hidden">
        {["card-1", "card-2", "card-3"].map((row) => (
          <div
            className="rounded-xl border border-gray-100 bg-white p-4"
            key={row}
          >
            <div className="h-4 w-32 rounded bg-gray-100" />
            <div className="mt-3 h-3 w-48 rounded bg-gray-100" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="h-12 rounded-lg bg-gray-100" />
              <div className="h-12 rounded-lg bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden md:block">
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

function DocumentMobileCard({
  copy,
  document,
  isExpanded,
  lineCount,
  onToggle,
  state,
}: {
  copy: DocumentDrilldownCopy;
  document: SalesDocumentListItem;
  isExpanded: boolean;
  lineCount: number;
  onToggle: () => void;
  state: DocumentDetailState;
}) {
  const isLoading =
    state.status === "loading" && state.docNo === document.doc_no;

  return (
    <button
      aria-expanded={isExpanded}
      className="block w-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-theme-xs transition hover:border-brand-200 hover:bg-brand-50/20 dark:border-gray-800 dark:bg-white/[0.03]"
      onClick={onToggle}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-gray-900 dark:text-white">
            {document.doc_no}
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {formatThaiDate(document.doc_date)}
            {document.doc_time ? ` · ${document.doc_time}` : ""}
          </p>
        </div>
        <Badge color={isExpanded ? "primary" : "light"} size="sm">
          {isLoading ? "กำลังโหลด" : isExpanded ? "เปิดอยู่" : copy.viewButtonLabel}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
          <p className="text-xs text-gray-500">{copy.amountHeader}</p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            {formatCurrency(document.total_amount)} บาท
          </p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
          <p className="text-xs text-gray-500">จำนวนรายการ</p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            {formatNumber(lineCount)} รายการ
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-sm text-gray-600 dark:text-gray-400">
        <p className="truncate">
          {copy.partyHeader}:{" "}
          {document.cust_name || document.cust_code || copy.partyFallback}
        </p>
        <p>
          สาขา: {formatDocumentBranchDisplay(document)}{" "}
          <span className="text-xs text-gray-400">(รหัสจาก SML)</span>
        </p>
      </div>
    </button>
  );
}

function DocumentDetailResult({
  copy,
  state,
}: {
  copy: DocumentDrilldownCopy;
  state: DocumentDetailState;
}) {
  if (state.status === "idle") {
    return (
      <p className="rounded-lg border border-gray-100 bg-white p-3 text-sm leading-6 text-gray-500">
        {copy.detailReadyText}
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
          เปิดรายละเอียด {state.docNo} ไม่สำเร็จ
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
      <DocumentSummaryCard copy={copy} document={document} lines={lines} />
      {lines.length ? (
        <div className="grid gap-3 p-3 lg:grid-cols-2">
          {lines.map((line, index) => (
            <DocumentLineCard
              key={`${line.doc_no}-${line.line_number ?? index}-${line.item_code ?? "item-card"}`}
              emptyLabel={copy.lineEmptyLabel}
              line={line}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-500">
          {copy.emptyDetailLabel}
        </p>
      )}
    </div>
  );
}

function DocumentSummaryCard({
  copy,
  document,
  lines,
}: {
  copy: DocumentDrilldownCopy;
  document: SalesHeaderRow;
  lines: SalesDetailRow[];
}) {
  const detailTotal = lines.reduce((sum, line) => sum + line.sum_amount, 0);

  return (
    <div className="border-b border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-transparent">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {copy.summaryPrefix} {document.doc_no}
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            {formatThaiDate(document.doc_date)} ·{" "}
            {document.cust_name || document.cust_code || copy.partyFallback}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-sm font-semibold text-gray-900">
            {formatCurrency(document.total_amount)} บาท
          </p>
          <p className="text-xs text-gray-500">
            {formatNumber(lines.length)} รายการ · {copy.summaryDetailTotalLabel}{" "}
            {formatCurrency(detailTotal)} บาท
          </p>
        </div>
      </div>
    </div>
  );
}

function DocumentLineCard({
  emptyLabel,
  line,
}: {
  emptyLabel: string;
  line: SalesDetailRow;
}) {
  const unitLabel = line.unit_name || line.unit_code || "-";
  const discountLabel =
    line.discount || line.discount_amount
      ? `${line.discount || ""}${line.discount ? " · " : ""}${formatCurrency(
          line.discount_amount,
        )}`
      : "-";

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-6 text-gray-900 dark:text-white">
            {line.item_name || line.item_code || emptyLabel}
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {line.item_code || "-"} · {formatBranchLabel(line.branch_code)}
          </p>
        </div>
        <p className="shrink-0 text-right text-sm font-semibold text-gray-900 dark:text-white">
          {formatCurrency(line.sum_amount)} บาท
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-500">
        <p>
          จำนวน:{" "}
          <span className="font-medium text-gray-800 dark:text-gray-200">
            {formatNumber(line.qty)} {unitLabel}
          </span>
        </p>
        <p>
          ราคา:{" "}
          <span className="font-medium text-gray-800 dark:text-gray-200">
            {formatCurrency(line.price)}
          </span>
        </p>
        <p className="col-span-2">
          ส่วนลด:{" "}
          <span className="font-medium text-gray-800 dark:text-gray-200">
            {discountLabel}
          </span>
        </p>
        <p className="col-span-2 truncate">
          Barcode:{" "}
          <span className="font-medium text-gray-800 dark:text-gray-200">
            {line.barcode || "-"}
          </span>
        </p>
      </div>
    </div>
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
    <main className="min-h-screen bg-[#F6F7F9] text-[#101828]">
      <div className="border-b border-[#E4E7EC] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div>
            <p className="text-[12px] font-semibold leading-[18px] text-[#2563EB]">
              AI Business
            </p>
            <h1 className="text-[18px] font-semibold leading-7">{title}</h1>
          </div>
          {tenant ? (
            <div className="text-right">
              <p className="text-[14px] font-semibold leading-[22px]">
                {tenant.name}
              </p>
              <p className="text-[12px] leading-[18px] text-[#667085]">
                อ่านรายงานอย่างเดียว
              </p>
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
    <div className="border-b border-[#EAECF0] bg-[#F9FAFB] p-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="text-[12px] font-medium leading-[18px] text-[#667085]">
        {label}
      </p>
      <p className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
        {value}
      </p>
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
    <div className="min-w-0 rounded-lg border border-[#EAECF0] bg-[#F9FAFB] p-3">
      <p className="text-[12px] font-medium leading-[18px] text-[#667085]">
        {label}
      </p>
      <p className="mt-1 truncate text-[14px] font-semibold leading-[22px] text-[#101828]">
        {value}
      </p>
      <p className="mt-1 text-[12px] leading-[18px] text-[#667085]">
        {detail}
      </p>
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
    <div className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-1 text-[12px] leading-[18px] text-[#667085]">
          {subtitle}
        </p>
      ) : null}
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function FinancialBreakdownRows({
  breakdown,
}: {
  breakdown: SalesFinancialBreakdown;
}) {
  const discountMeta =
    breakdown.discount_percent !== null && breakdown.total_discount > 0
      ? `${formatNumber(breakdown.discount_percent)}% ของยอดก่อนส่วนลด`
      : breakdown.document_count_with_discount > 0
        ? `${formatNumber(breakdown.document_count_with_discount)} บิลมีส่วนลด`
        : "ไม่มีส่วนลดในช่วงนี้";
  const vatMeta =
    breakdown.vat_rate !== null
      ? `VAT ${formatNumber(breakdown.vat_rate)}% จาก SML`
      : "อัตรา VAT หลายแบบหรือไม่ระบุ";

  return (
    <div className="space-y-2">
      <FinancialBreakdownRow
        label="ยอดก่อนส่วนลด"
        value={`${formatCurrency(breakdown.gross_sales)} บาท`}
      />
      <FinancialBreakdownRow
        label="ส่วนลดรวม"
        meta={discountMeta}
        tone={breakdown.total_discount > 0 ? "warning" : "neutral"}
        value={`${formatCurrency(breakdown.total_discount)} บาท`}
      />
      <FinancialBreakdownRow
        label="ยอดก่อน VAT"
        meta="คำนวณจากยอดขายสุทธิหัก VAT"
        value={`${formatCurrency(breakdown.before_vat_amount)} บาท`}
      />
      <FinancialBreakdownRow
        label="VAT"
        meta={vatMeta}
        value={`${formatCurrency(breakdown.vat_amount)} บาท`}
      />
      <FinancialBreakdownRow
        label="ยอดขายสุทธิ"
        tone="strong"
        value={`${formatCurrency(breakdown.net_sales)} บาท`}
      />
      <p className="pt-1 text-xs leading-5 text-gray-500">
        ยอดขายสุทธิใช้หัวบิล SML เป็นตัวเลขหลัก ส่วนรายละเอียดสินค้าใช้ช่วยอธิบายสินค้าและจำนวน
      </p>
    </div>
  );
}

function FinancialBreakdownRow({
  label,
  meta,
  tone = "neutral",
  value,
}: {
  label: string;
  meta?: string;
  tone?: "neutral" | "warning" | "strong";
  value: string;
}) {
  const valueClass =
    tone === "strong"
      ? "text-gray-900"
      : tone === "warning"
        ? "text-orange-700"
        : "text-gray-800";

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        {meta ? <p className="mt-0.5 text-xs text-gray-400">{meta}</p> : null}
      </div>
      <p className={`shrink-0 text-sm font-semibold ${valueClass}`}>{value}</p>
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

function getFinancialBreakdown(
  snapshot: SalesGoodsServicesSnapshot,
): SalesFinancialBreakdown {
  if (snapshot.financial_breakdown) {
    return snapshot.financial_breakdown;
  }

  const documents = snapshot.documents ?? [];
  const grossSales = roundMoney(
    documents.reduce((sum, row) => sum + safeNumber(row.total_value), 0),
  );
  const totalDiscount = roundMoney(
    documents.reduce((sum, row) => sum + safeNumber(row.total_discount), 0),
  );
  const rawBeforeVatAmount = roundMoney(
    documents.reduce((sum, row) => sum + safeNumber(row.total_except_vat), 0),
  );
  const vatAmount = roundMoney(
    documents.reduce((sum, row) => sum + safeNumber(row.total_vat_value), 0),
  );
  const derivedBeforeVatAmount = roundMoney(
    snapshot.summary.total_sales - vatAmount,
  );
  const rawBeforeVatReconciles =
    Math.abs(
      roundMoney(rawBeforeVatAmount + vatAmount - snapshot.summary.total_sales),
    ) <= 0.05;
  const beforeVatAmount =
    rawBeforeVatAmount > 0 && rawBeforeVatReconciles
      ? rawBeforeVatAmount
      : derivedBeforeVatAmount;
  const vatRates = [
    ...new Set(
      documents
        .map((row) => safeNumber(row.vat_rate))
        .filter((rate) => Number.isFinite(rate))
        .map((rate) => roundQty(rate)),
    ),
  ];

  return {
    gross_sales: grossSales || snapshot.summary.total_sales,
    total_discount: totalDiscount,
    after_discount_amount: roundMoney(grossSales - totalDiscount),
    before_vat_amount: beforeVatAmount,
    vat_amount: vatAmount,
    net_sales: snapshot.summary.total_sales,
    discount_percent:
      grossSales > 0 ? roundQty((totalDiscount / grossSales) * 100) : null,
    vat_rate: vatRates.length === 1 ? vatRates[0] : null,
    document_count_with_discount: documents.filter(
      (row) => safeNumber(row.total_discount) > 0,
    ).length,
  };
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
        ? `${formatBranchDisplay(topBranch)} ทำยอด ${formatCurrency(
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
  return formatSmlBranchLabel(value);
}

function formatBranchDisplay(branch: {
  branch_code: string;
  branch_label?: string;
}) {
  return branch.branch_label ?? formatBranchLabel(branch.branch_code);
}

function formatDocumentBranchDisplay(document: {
  resolved_branch_code: string;
  resolved_branch_label?: string;
}) {
  return (
    document.resolved_branch_label ??
    formatBranchLabel(document.resolved_branch_code)
  );
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

function formatBusinessSignalSeverity(
  severity: BusinessSignalRecord["severity"],
) {
  if (severity === "critical") {
    return "ควรตรวจทันที";
  }
  if (severity === "warning") {
    return "มีข้อสังเกต";
  }
  return "ข้อมูลประกอบ";
}

function formatBusinessSignalEvidence(signal: BusinessSignalRecord) {
  const evidence = signal.evidence_json ?? {};
  if (
    signal.signal_key.includes("missing_branch") &&
    typeof evidence.total_amount === "number"
  ) {
    return `พบยอดขายที่ยังไม่ผูกสาขา ${formatCurrency(
      evidence.total_amount,
    )} บาท จึงควรตรวจการบันทึกสาขาใน SML`;
  }
  if (
    signal.signal_key.includes("supplier_concentration") &&
    typeof evidence.concentration_percent === "number"
  ) {
    return `ผู้จำหน่ายรายเดียวคิดเป็น ${evidence.concentration_percent}% ของยอดซื้อรวม จึงควรตรวจว่าเป็นรายการปกติหรือความเสี่ยง`;
  }
  if (
    signal.signal_key.includes("low_margin") &&
    typeof evidence.gross_margin_percent === "number"
  ) {
    return `Margin จาก snapshot อยู่ที่ ${evidence.gross_margin_percent}% ต่ำกว่าเกณฑ์ของร้าน`;
  }
  if (signal.signal_key.includes("negative")) {
    return "พบยอดหรือรายการที่กำไรขั้นต้นติดลบ ระบบจึงแนะนำให้ตรวจราคาขาย ต้นทุน และเอกสารคืนสินค้า";
  }
  if (signal.category === "data_quality") {
    return "ระบบพบข้อสังเกตด้านคุณภาพข้อมูล จึงควรตรวจรายละเอียดก่อนใช้ตัดสินใจ";
  }
  return "ระบบสร้างจาก report snapshot ล่าสุดและผูกกับ run ต้นทางเพื่อให้ตรวจสอบย้อนหลังได้";
}

function formatCustomerReportLabel(reportKey: ReportKey) {
  const labels: Record<ReportKey, string> = {
    sales_goods_services: "รายงานขาย",
    purchase_goods_payables: "รายงานซื้อ/ตั้งหนี้",
    gross_profit_by_product: "รายงานกำไรสินค้า",
    gross_profit_by_ar_customer: "รายงานกำไรลูกหนี้",
    stock_balance: "รายงานสต็อกคงเหลือ",
    stock_reorder: "รายงานสินค้าถึงจุดสั่งซื้อ",
  };
  return labels[reportKey];
}

function safeNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQty(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function formatShare(value: number, total: number, denominatorLabel = "ยอดขาย") {
  if (total <= 0) {
    return null;
  }

  return `${new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format((value / total) * 100)}% ของ${denominatorLabel}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 3,
  }).format(value);
}
