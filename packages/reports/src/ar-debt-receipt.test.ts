import { describe, expect, it } from "vitest";
import {
  buildArDebtReceiptQuery,
  renderArDebtReceiptLinePreview,
  summarizeArDebtReceipt,
  validateArDebtReceiptParams,
} from "./ar-debt-receipt.js";

describe("AR debt receipt report", () => {
  it("validates period params through the shared report params schema", () => {
    expect(
      validateArDebtReceiptParams({
        date_from: "2026-06-08",
        date_to: "2026-06-08",
      }),
    ).toEqual({ date_from: "2026-06-08", date_to: "2026-06-08" });

    expect(() =>
      validateArDebtReceiptParams({
        date_from: "2026-06-09",
        date_to: "2026-06-08",
      }),
    ).toThrow();
  });

  it("builds a parameterized deterministic SML query", () => {
    const query = buildArDebtReceiptQuery({
      date_from: "2026-06-01",
      date_to: "2026-06-08",
    });

    expect(query.values).toEqual(["2026-06-01", "2026-06-08"]);
    expect(query.text).toContain("with billing_dates as");
    expect(query.text).toContain("min(d.billing_date) as billing_date");
    expect(query.text).toContain("left join payment_splits p");
    expect(query.text).toContain("left join ar_customer c");
    expect(query.text).toContain("a.doc_date between $1::date and $2::date");
    expect(query.text).toContain("p.tranfer_amount");
    expect(query.text).toContain("as transfer_amount");
    expect(query.text).not.toContain("limit 1");
    expect(query.text).not.toContain("2026-06-08");
  });

  it("summarizes receipts, customers, payment splits, and warnings", () => {
    const snapshot = summarizeArDebtReceipt({
      tenant_id: "tenant_demo_remote",
      run_id: "run_receipt",
      params: { date_from: "2026-06-08", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [
        receiptRow({
          doc_no: "RE001",
          cust_code: "C001",
          cust_name: "ลูกค้า A",
          cash_amount: 200,
          transfer_amount: 800,
          total_net_value: 1000,
          payment_split_missing: false,
        }),
        receiptRow({
          doc_no: "RE002",
          cust_code: "C001",
          cust_name: "ลูกค้า A",
          cash_amount: 0,
          transfer_amount: 0,
          total_net_value: 500,
          payment_split_missing: true,
        }),
        receiptRow({
          doc_no: "RE003",
          cust_code: "C002",
          cust_name: "ลูกค้า B",
          cash_amount: 100,
          transfer_amount: 500,
          total_net_value: 700,
          payment_split_missing: false,
        }),
      ],
    });

    expect(snapshot.report_key).toBe("ar_debt_receipt");
    expect(snapshot.quality_status).toBe("reconciled_with_warning");
    expect(snapshot.source_basis).toBe("ar_debt_receipt_doc_date");
    expect(snapshot.summary).toMatchObject({
      receipt_count: 3,
      customer_count: 2,
      total_received_amount: 2200,
      cash_amount: 300,
      transfer_amount: 1300,
      unmatched_payment_count: 2,
      top_customer_name: "ลูกค้า A",
    });
    expect(snapshot.top_customers[0]).toMatchObject({
      cust_code: "C001",
      receipt_count: 2,
      total_received_amount: 1500,
      unmatched_payment_count: 1,
    });
    expect(snapshot.top_receipts[0]).toMatchObject({
      doc_no: "RE001",
      total_received_amount: 1000,
      payment_status: "matched",
    });
    expect(snapshot.top_receipts[1]).toMatchObject({
      doc_no: "RE003",
      payment_status: "mismatched_payment_split",
      payment_difference_amount: 100,
    });
    expect(snapshot.data_quality_notes[0]).toContain("2 ใบ");
  });

  it("normalizes blank values and the SML tranfer_amount field typo", () => {
    const snapshot = summarizeArDebtReceipt({
      tenant_id: "tenant_demo_remote",
      run_id: "run_receipt_typo",
      params: { date_from: "2026-06-08", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [
        {
          doc_date: "2026-06-08",
          doc_no: "RE004",
          billing_date: "",
          cust_code: "C003",
          cust_name: "",
          cash_amount: "",
          tranfer_amount: "123.45",
          total_net_value: "123.45",
          payment_split_missing: false,
        },
      ],
    });

    expect(snapshot.top_receipts[0]).toMatchObject({
      billing_date: null,
      cash_amount: 0,
      transfer_amount: 123.45,
      total_received_amount: 123.45,
      payment_status: "matched",
    });
  });

  it("renders LINE preview with receipt-date copy and no technical fields", () => {
    const snapshot = summarizeArDebtReceipt({
      tenant_id: "tenant_demo_remote",
      run_id: "run_receipt_line",
      params: { date_from: "2026-06-08", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [
        receiptRow({
          cust_code: "C001",
          cust_name: "ลูกค้า A",
          total_net_value: 1200,
          cash_amount: 200,
          transfer_amount: 1000,
        }),
      ],
    });
    const preview = renderArDebtReceiptLinePreview({
      snapshot,
      dashboardUrl: "https://example.com/command-center/brief?token=signed",
      tenantName: "กระบี่",
    });
    const userVisiblePayload = JSON.stringify({
      text: preview.text,
      lines: preview.lines,
      altText: preview.flex_message?.altText,
      header: (preview.flex_message?.contents as { header?: unknown } | undefined)
        ?.header,
      body: (preview.flex_message?.contents as { body?: unknown } | undefined)
        ?.body,
    });

    expect(preview.report_key).toBe("ar_debt_receipt");
    expect(preview.line_message_type).toBe("flex");
    expect(preview.text).toContain("รายงานรับชำระหนี้");
    expect(preview.text).toContain(
      "ข้อมูล: ข้อมูลวันที่รับชำระ 08/06/2026 จาก SML",
    );
    expect(preview.text).toContain(
      "รายงานนี้อิงวันที่เอกสารรับชำระ ไม่ตัดตามเวลาแจ้งเตือน",
    );
    expect(userVisiblePayload).not.toContain("trans_flag");
    expect(userVisiblePayload).not.toContain("ap_ar_trans");
    expect(userVisiblePayload).not.toContain("cb_trans");
    expect(userVisiblePayload).not.toContain("tranfer_amount");
    expect(userVisiblePayload).not.toContain("token=signed");
    expect(JSON.stringify(preview.flex_message)).toContain("เปิดรายละเอียด");
  });

  it("keeps LINE altText in a LINE-safe length", () => {
    const snapshot = summarizeArDebtReceipt({
      tenant_id: "tenant_demo_remote",
      run_id: "run_receipt_alt",
      params: { date_from: "2026-06-08", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [
        receiptRow({
          cust_name: "ลูกค้าที่มีชื่อยาวมาก".repeat(20),
          total_net_value: 999999999,
        }),
      ],
    });

    const preview = renderArDebtReceiptLinePreview({
      snapshot,
      dashboardUrl: "https://example.com/brief",
      tenantName: "ร้านทดสอบที่มีชื่อยาวมาก".repeat(20),
    });

    expect(preview.flex_message?.altText.length ?? 0).toBeLessThanOrEqual(300);
  });
});

function receiptRow(overrides: Record<string, unknown> = {}) {
  return {
    doc_date: "2026-06-08",
    doc_no: "RE001",
    billing_date: "2026-06-08",
    cust_code: "C001",
    cust_name: "ลูกค้า A",
    cash_amount: 0,
    transfer_amount: 0,
    total_net_value: 0,
    payment_split_missing: false,
    ...overrides,
  };
}
