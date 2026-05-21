import { describe, expect, it } from "vitest";
import type { ReportSnapshot } from "@ai-bcc/shared";
import {
  REPORT_PDF_LAYOUT_VERSION,
  buildReportPdfCacheKey,
  buildReportPdfFilename,
  renderReportPdfHtml,
  validateReportPdfLimits,
} from "./report-pdf-export.js";
import type { ReportPdfRows } from "./report-runner.js";

describe("report PDF export", () => {
  it("uses the SML row v2 layout version for cache invalidation", () => {
    expect(REPORT_PDF_LAYOUT_VERSION).toBe("sml-row-v2");
  });

  it("builds a cache key bound to tenant, report, run, date range, and layout", () => {
    const base = {
      tenantId: "tenant_demo_remote",
      reportKey: "sales_goods_services" as const,
      runId: "run_demo_1",
      dateFrom: "2026-05-20",
      dateTo: "2026-05-20",
    };

    expect(buildReportPdfCacheKey(base)).toHaveLength(64);
    expect(buildReportPdfCacheKey(base)).not.toBe(
      buildReportPdfCacheKey({ ...base, runId: "run_demo_2" }),
    );
    expect(buildReportPdfCacheKey(base)).not.toBe(
      buildReportPdfCacheKey({
        ...base,
        layoutVersion: `${REPORT_PDF_LAYOUT_VERSION}_next`,
      }),
    );
    expect(buildReportPdfCacheKey(base)).not.toBe(
      buildReportPdfCacheKey({
        ...base,
        layoutVersion: "sml-row-v1",
      }),
    );
  });

  it("uses a safe English filename for download headers", () => {
    expect(
      buildReportPdfFilename({
        tenantId: "tenant_demo_remote",
        tenantSlug: "demo-shop",
        reportKey: "sales_goods_services",
        dateFrom: "2026-05-20",
        dateTo: "2026-05-20",
      }),
    ).toBe("DEMO-SHOP_sales_goods_services_2026-05-20.pdf");
  });

  it("rejects pilot ranges above document or detail row limits", () => {
    expect(
      validateReportPdfLimits({ documentCount: 301, detailRowCount: 10 }),
    ).toMatchObject({ ok: false, statusCode: 422 });
    expect(
      validateReportPdfLimits({ documentCount: 300, detailRowCount: 5001 }),
    ).toMatchObject({ ok: false, statusCode: 422 });
    expect(
      validateReportPdfLimits({ documentCount: 300, detailRowCount: 5000 }),
    ).toEqual({ ok: true });
  });

  it("escapes report data before rendering server-side PDF HTML", () => {
    const snapshot = buildSnapshot();
    const rows: ReportPdfRows = {
      tenant_id: "tenant_demo_remote",
      report_key: "sales_goods_services",
      params: snapshot.params,
      documents: [
        {
          rownum: 1,
          doc_date: "2026-05-20",
          doc_no: "SO-1",
          doc_time: "09:00:00",
          doc_ref: "<script>alert(1)</script>",
          cust_code: "C001",
          cust_name: "ACME <Limited>",
          branch_code: "00",
          total_value: 100,
          total_discount: 0,
          total_except_discount: 100,
          total_except_vat: 93.46,
          vat_rate: 7,
          total_vat_value: 6.54,
          vat_type: "I",
          total_amount: 100,
          cashier_code: "U1",
        },
      ],
      lines: [
        {
          doc_date: "2026-05-20",
          doc_no: "SO-1",
          doc_time: "09:00:00",
          cust_code: "C001",
          cust_name: "ACME <Limited>",
          branch_code: "00",
          item_code: "SKU-1",
          barcode: "8850000000001",
          item_name: "สินค้า <test>",
          wh_code: "WH",
          shelf_code: "A1",
          unit_code: "PCS",
          unit_name: "ชิ้น",
          qty: 1,
          price: 100,
          discount: null,
          discount_amount: 0,
          sum_amount: 100,
          vat_type: "I",
        },
      ],
    };

    const html = renderReportPdfHtml({
      tenantName: "Demo Shop",
      snapshot,
      rows,
      params: snapshot.params,
    });

    expect(html).toContain("ACME &lt;Limited&gt;");
    expect(html).toContain("สินค้า &lt;test&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("Barcode:");
    expect(html).not.toContain("8850000000001");
  });

  it("renders customer-facing SML v2 PDF HTML without debug metadata", () => {
    const snapshot = buildSnapshot();
    const html = renderReportPdfHtml({
      tenantName: "Demo Shop",
      snapshot,
      rows: {
        tenant_id: "tenant_demo_remote",
        report_key: "sales_goods_services",
        params: snapshot.params,
        documents: [],
        lines: [],
      },
      params: snapshot.params,
    });

    expect(html).toContain("Demo Shop");
    expect(html).toContain("รายงานขายสินค้าและบริการ");
    expect(html).not.toContain("Run ID");
    expect(html).not.toContain("Layout:");
    expect(html).not.toContain("Data source");
    expect(html).not.toContain("sml_postgres");
    expect(html).not.toContain("summary");
  });

  it("formats report dates as SML Buddhist dates instead of ISO dates", () => {
    const snapshot = {
      ...buildSnapshot(),
      params: {
        date_from: "2026-05-05",
        date_to: "2026-05-20",
      },
    };
    const rows: ReportPdfRows = {
      tenant_id: "tenant_demo_remote",
      report_key: "sales_goods_services",
      params: snapshot.params,
      documents: [
        {
          rownum: 1,
          doc_date: "2026-05-05",
          doc_no: "SO-1",
          doc_time: "09:00:00",
          doc_ref: null,
          cust_code: "C001",
          cust_name: "ACME",
          branch_code: "00",
          total_value: 100,
          total_discount: 0,
          total_except_discount: 100,
          total_except_vat: 93.46,
          vat_rate: 7,
          total_vat_value: 6.54,
          vat_type: "I",
          total_amount: 100,
          cashier_code: "U1",
        },
      ],
      lines: [],
    };

    const html = renderReportPdfHtml({
      tenantName: "Demo Shop",
      snapshot,
      rows,
      params: snapshot.params,
    });

    expect(html).toContain("จากวันที่ : 05/5/2569 ถึงวันที่ : 20/5/2569");
    expect(html).toContain("<td>05/5/2569</td>");
    expect(html).toContain('<td class="numeric">7.00</td>');
    expect(html).not.toContain(">2026-05-05<");
    expect(html).not.toContain("2026-05-05 ถึงวันที่");
  });

  it("renders detail rows without repeating document date or customer name", () => {
    const snapshot = buildSnapshot();
    const rows: ReportPdfRows = {
      tenant_id: "tenant_demo_remote",
      report_key: "sales_goods_services",
      params: snapshot.params,
      documents: [
        {
          rownum: 1,
          doc_date: "2026-05-20",
          doc_no: "SO-1",
          doc_time: "09:00:00",
          doc_ref: null,
          cust_code: "C001",
          cust_name: "ACME",
          branch_code: "00",
          total_value: 100,
          total_discount: 0,
          total_except_discount: 100,
          total_except_vat: 93.46,
          vat_rate: 7,
          total_vat_value: 6.54,
          vat_type: "I",
          total_amount: 100,
          cashier_code: "U1",
        },
      ],
      lines: [
        {
          doc_date: "2026-05-20",
          doc_no: "SO-1",
          doc_time: "09:00:00",
          cust_code: "C001",
          cust_name: "ACME",
          branch_code: "00",
          item_code: "SKU-1",
          barcode: "8850000000001",
          item_name: "สินค้า",
          wh_code: "WH",
          shelf_code: "A1",
          unit_code: "PCS",
          unit_name: "ชิ้น",
          qty: 1,
          price: 100,
          discount: null,
          discount_amount: 0,
          sum_amount: 100,
          vat_type: "I",
        },
      ],
    };

    const html = renderReportPdfHtml({
      tenantName: "Demo Shop",
      snapshot,
      rows,
      params: snapshot.params,
    });

    expect(html).toContain('<td class="item-code" colspan="2">SKU-1</td>');
    expect(html).toContain('<td class="item-name" colspan="3">สินค้า</td>');
    expect(html).toContain('<td class="numeric">1.00</td>');
    expect(html).not.toContain("<td>20/5/2569</td>\n    <td>ACME</td>");
    expect(html).not.toContain("รหัสสินค้า / Barcode");
    expect(html).not.toContain("Barcode:");
  });
});

function buildSnapshot(): ReportSnapshot {
  return {
    tenant_id: "tenant_demo_remote",
    report_key: "sales_goods_services",
    run_id: "run_demo_1",
    params: {
      date_from: "2026-05-20",
      date_to: "2026-05-20",
    },
    generated_at: "2026-05-20T02:00:00.000Z",
    source: "sml_postgres",
    quality_status: "valid",
    summary: {
      total_sales: 100,
      document_count: 1,
      line_count: 1,
      total_qty: 1,
      top_product_name: "สินค้า",
    },
    branch_sales: [],
    top_products: [],
    documents: [],
    lines: [],
    reconciliation: {
      header_total_amount: 100,
      detail_sum_amount: 100,
      difference_amount: 0,
      status: "valid",
      note: "ok",
    },
    line_template: {
      title: "Morning Brief",
      body: [],
    },
  };
}
