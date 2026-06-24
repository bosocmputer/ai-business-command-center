import { describe, expect, it } from "vitest";
import {
  buildCashBankPaymentsQuery,
  buildCashBankReceiptsQuery,
  renderCashBankLinePreview,
  summarizeCashBankPayments,
  summarizeCashBankReceipts,
  validateCashBankParams,
} from "./cash-bank.js";

describe("cash bank reports", () => {
  it("validates period params through the shared report params schema", () => {
    expect(
      validateCashBankParams({
        date_from: "2026-06-24",
        date_to: "2026-06-24",
      }),
    ).toEqual({ date_from: "2026-06-24", date_to: "2026-06-24" });

    expect(() =>
      validateCashBankParams({
        date_from: "2026-06-25",
        date_to: "2026-06-24",
      }),
    ).toThrow();
  });

  it("builds the receipt query with the locked SML filters and params", () => {
    const query = buildCashBankReceiptsQuery({
      date_from: "2026-06-01",
      date_to: "2026-06-24",
    });

    expect(query.values).toEqual(["2026-06-01", "2026-06-24"]);
    expect(query.text).toContain("with filtered_cb as");
    expect(query.text).toContain("cb.pay_type = 1");
    expect(query.text).toContain("cb.status = 0");
    expect(query.text).toContain("cb.trans_flag not in (144)");
    expect(query.text).toContain("cb.trans_flag in (19, 239)");
    expect(query.text).toContain("from ap_ar_trans a");
    expect(query.text).toContain("from ic_trans i");
    expect(query.text).toContain("coalesce(cb.tranfer_amount, 0) as transfer_amount");
    expect(query.text).not.toContain("2026-06-24");
  });

  it("builds the payment query with card charge included and no last_status filter", () => {
    const query = buildCashBankPaymentsQuery({
      date_from: "2026-06-24",
      date_to: "2026-06-24",
    });

    expect(query.values).toEqual(["2026-06-24", "2026-06-24"]);
    expect(query.text).toContain("cb.pay_type = 2");
    expect(query.text).toContain("cb.status = 0");
    expect(query.text).toContain(
      "coalesce(cb.card_amount, 0) + coalesce(cb.total_credit_charge, 0) as card_amount",
    );
    expect(query.text).toContain("coalesce(cb.petty_cash_amount, 0)");
    expect(query.text).not.toContain("last_status");
    expect(query.text).not.toContain("2026-06-24");
  });

  it("summarizes receipt channels and keeps signed unallocated amounts", () => {
    const snapshot = summarizeCashBankReceipts({
      tenant_id: "tenant_demo_remote",
      run_id: "run_cash_receipt",
      params: { date_from: "2026-06-24", date_to: "2026-06-24" },
      generated_at: "2026-06-24T05:00:00.000Z",
      source: "sml_javaws",
      rows: [
        cashBankRow({
          doc_no: "CA001",
          trans_flag_code: 44,
          trans_flag_label: "ขาย",
          cash_amount: 100,
          transfer_amount: undefined,
          tranfer_amount: "200.25",
          total_amount: 300.25,
        }),
        cashBankRow({
          doc_no: "RC001",
          trans_flag_code: 239,
          trans_flag_label: "รับชำระหนี้",
          cash_amount: null,
          transfer_amount: 0,
          total_amount: 50,
        }),
        cashBankRow({
          doc_no: "RC002",
          trans_flag_code: 239,
          trans_flag_label: "รับชำระหนี้",
          cash_amount: 80,
          transfer_amount: 50,
          total_amount: 100,
        }),
      ],
    });

    expect(snapshot.report_key).toBe("cash_bank_receipts");
    expect(snapshot.quality_status).toBe("reconciled_with_warning");
    expect(snapshot.summary).toMatchObject({
      document_count: 3,
      total_amount: 450.25,
      cash_amount: 180,
      transfer_amount: 250.25,
      channel_total_amount: 430.25,
      unallocated_amount: 20,
      mismatch_document_count: 2,
    });
    expect(snapshot.channel_summary.find((row) => row.channel_key === "unallocated"))
      .toMatchObject({
        amount: 20,
        document_count: 2,
      });
    expect(snapshot.mismatch_documents.map((row) => row.doc_no)).toEqual([
      "RC001",
      "RC002",
    ]);
    expect(snapshot.mismatch_documents[1]).toMatchObject({
      unallocated_amount: -30,
      channel_status: "channel_over_total",
    });
    expect(snapshot.data_quality_notes[0]).toContain("2 ใบ");
  });

  it("summarizes payments with card charges and petty cash", () => {
    const snapshot = summarizeCashBankPayments({
      tenant_id: "tenant_demo_remote",
      run_id: "run_cash_payment",
      params: { date_from: "2026-06-24", date_to: "2026-06-24" },
      generated_at: "2026-06-24T05:00:00.000Z",
      source: "sml_javaws",
      rows: [
        cashBankRow({
          doc_no: "PAY001",
          trans_flag_code: 19,
          trans_flag_label: "จ่ายชำระหนี้",
          card_amount: 100,
          petty_cash_amount: 20,
          total_amount: 120,
        }),
      ],
    });

    expect(snapshot.report_key).toBe("cash_bank_payments");
    expect(snapshot.quality_status).toBe("valid");
    expect(snapshot.summary).toMatchObject({
      document_count: 1,
      card_amount: 100,
      petty_cash_amount: 20,
      total_amount: 120,
      unallocated_amount: 0,
      mismatch_document_count: 0,
    });
    expect(snapshot.channel_summary.find((row) => row.channel_key === "petty_cash"))
      .toMatchObject({
        amount: 20,
        document_count: 1,
      });
  });

  it("renders LINE preview with channel warnings and no technical field names", () => {
    const snapshot = summarizeCashBankReceipts({
      tenant_id: "tenant_demo_remote",
      run_id: "run_cash_line",
      params: { date_from: "2026-06-24", date_to: "2026-06-24" },
      generated_at: "2026-06-24T05:00:00.000Z",
      source: "sml_javaws",
      rows: [
        cashBankRow({
          cash_amount: 0,
          transfer_amount: 0,
          total_amount: 500,
        }),
      ],
    });
    const preview = renderCashBankLinePreview({
      snapshot,
      dashboardUrl: "https://example.com/brief?token=signed",
      tenantName: "Sea and Hill",
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

    expect(preview.report_key).toBe("cash_bank_receipts");
    expect(preview.line_message_type).toBe("flex");
    expect(preview.text).toContain("รายงานรับเงิน");
    expect(preview.text).toContain("ไม่ระบุช่องทาง: 500.00 บาท");
    expect(JSON.stringify(preview.flex_message)).toContain("ควรตรวจช่องทาง");
    expect(userVisiblePayload).not.toContain("cb_trans");
    expect(userVisiblePayload).not.toContain("tranfer_amount");
    expect(userVisiblePayload).not.toContain("trans_flag_code");
    expect(userVisiblePayload).not.toContain("token=signed");
  });
});

function cashBankRow(overrides: Record<string, unknown> = {}) {
  return {
    doc_date: "2026-06-24",
    doc_no: "CB001",
    doc_time: "08:00",
    trans_flag_code: 44,
    trans_flag_label: "ขาย",
    ap_ar_code: "AR-001",
    ap_ar_name: "ลูกค้า A (AR-001)",
    cash_amount: 0,
    card_amount: 0,
    chq_amount: 0,
    transfer_amount: 0,
    total_income_amount: 0,
    coupon_amount: 0,
    petty_cash_amount: 0,
    total_amount: 0,
    ...overrides,
  };
}
