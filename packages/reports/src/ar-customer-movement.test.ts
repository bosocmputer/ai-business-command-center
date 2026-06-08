import { describe, expect, it } from "vitest";
import {
  buildArCustomerMovementQuery,
  renderArCustomerMovementLinePreview,
  summarizeArCustomerMovement,
  validateArCustomerMovementParams,
} from "./ar-customer-movement.js";

describe("AR customer movement report", () => {
  it("validates the shared date range contract while using date_to as as-of date", () => {
    expect(() =>
      validateArCustomerMovementParams({
        date_from: "2026-06-08",
        date_to: "2026-06-01",
      }),
    ).toThrow("date_from");
  });

  it("builds parameterized as-of AR movement SQL without scalar customer lookup", () => {
    const query = buildArCustomerMovementQuery({
      date_from: "2026-06-01",
      date_to: "2026-06-08",
      time_from: "00:00",
      time_to: "18:30",
    });

    expect(query.text).toContain("with ar_docs as");
    expect(query.text).toContain("t.doc_date <= $1::date");
    expect(query.text).toContain("left join ar_customer c");
    expect(query.text).toContain("from ap_ar_trans t");
    expect(query.text).toContain("from as_trans t");
    expect(query.text).not.toMatch(/\(\s*select\s+name_1\s+from\s+ar_customer/i);
    expect(query.text).not.toContain("2026-06-08");
    expect(query.text).not.toContain("$2");
    expect(query.values).toEqual(["2026-06-08"]);
  });

  it("summarizes movement types and net movement from SML doc_sort", () => {
    const snapshot = summarizeArCustomerMovement({
      tenant_id: "tenant_demo_remote",
      run_id: "run_ar_movement_sample",
      params: {
        date_from: "2026-06-08",
        date_to: "2026-06-08",
        time_from: "00:00",
        time_to: "18:30",
      },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [
        movementRow({
          cust_code: "C001",
          cust_name: "ลูกค้า A",
          doc_sort: 1,
          doc_no: "IV-001",
          amount: 1000,
        }),
        movementRow({
          cust_code: "C001",
          cust_name: "ลูกค้า A",
          doc_sort: 2,
          doc_no: "CN-001",
          amount: 250,
        }),
        movementRow({
          cust_code: "C002",
          cust_name: "ลูกค้า B",
          doc_sort: 3,
          doc_no: "RC-001",
          amount: 300,
        }),
      ],
    });

    expect(snapshot.report_key).toBe("ar_customer_movement");
    expect(snapshot.source_basis).toBe("ar_movement_as_of_date");
    expect(snapshot.summary).toMatchObject({
      document_count: 3,
      customer_count: 2,
      ar_increase_amount: 1000,
      ar_decrease_amount: 250,
      receipt_amount: 300,
      net_movement_amount: 450,
      top_customer_name: "ลูกค้า A",
    });
    expect(snapshot.top_customers[0]).toMatchObject({
      cust_code: "C001",
      document_count: 2,
      net_movement_amount: 750,
    });
    expect(snapshot.top_documents[0]).toMatchObject({
      doc_no: "IV-001",
      movement_type: "ar_increase",
    });
  });

  it("normalizes blank and null numeric values to zero", () => {
    const snapshot = summarizeArCustomerMovement({
      tenant_id: "seaandhill_demo",
      run_id: "run_ar_blank",
      params: { date_from: "2026-06-08", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [
        {
          roworder: "",
          doc_sort: null,
          cust_code: "C-BLANK",
          cust_name: "Blank Customer",
          doc_type: "",
          doc_date: "2026-06-08",
          doc_no: "DOC-BLANK",
          tax_doc_no: null,
          doc_ref: undefined,
          credit_day: "not-a-number",
          amount: "",
        },
      ],
    });

    expect(snapshot.summary.document_count).toBe(1);
    expect(snapshot.summary.net_movement_amount).toBe(0);
    expect(snapshot.top_documents[0]).toMatchObject({
      roworder: null,
      doc_sort: 0,
      movement_type: "ar_increase",
      doc_type: 0,
      credit_day: 0,
      amount: 0,
    });
  });

  it("renders LINE preview with as-of copy and without technical fields", () => {
    const snapshot = summarizeArCustomerMovement({
      tenant_id: "tenant_demo_remote",
      run_id: "run_ar_line",
      params: {
        date_from: "2026-06-08",
        date_to: "2026-06-08",
        time_from: "00:00",
        time_to: "18:30",
      },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [
        movementRow({
          cust_code: "C001",
          cust_name: "ลูกค้า A",
          doc_sort: 1,
          amount: 1200,
        }),
      ],
    });
    const preview = renderArCustomerMovementLinePreview({
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

    expect(preview.report_key).toBe("ar_customer_movement");
    expect(preview.line_message_type).toBe("flex");
    expect(preview.text).toContain("รายงานเคลื่อนไหวลูกหนี้");
    expect(preview.text).toContain("ข้อมูล: ข้อมูลถึงวันที่ 08/06/2026 จาก SML");
    expect(preview.text).not.toContain("คงค้าง");
    expect(preview.text).not.toContain("18:30");
    expect(preview.text).not.toContain("token=signed");
    expect(userVisiblePayload).not.toContain("trans_flag");
    expect(userVisiblePayload).not.toContain("ic_trans");
    expect(userVisiblePayload).not.toContain("ap_ar_trans");
    expect(userVisiblePayload).not.toContain("snapshot");
    expect(userVisiblePayload).not.toContain("token=signed");
    expect(JSON.stringify(preview.flex_message)).toContain("เปิดรายละเอียด");
  });

  it("keeps LINE altText in a LINE-safe length", () => {
    const snapshot = summarizeArCustomerMovement({
      tenant_id: "tenant_demo_remote",
      run_id: "run_ar_alt",
      params: { date_from: "2026-06-08", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [movementRow({ cust_code: "C001", amount: 100 })],
    });
    const preview = renderArCustomerMovementLinePreview({
      snapshot,
      dashboardUrl: "https://example.com/command-center/brief?token=signed",
      tenantName: "ร้านทดสอบชื่อยาวมาก".repeat(30),
    });

    expect(preview.flex_message?.altText.length).toBeLessThanOrEqual(300);
  });
});

function movementRow(input: {
  cust_code: string;
  cust_name?: string;
  doc_sort?: number;
  doc_no?: string;
  amount?: number;
}) {
  return {
    roworder: 1,
    doc_sort: input.doc_sort ?? 1,
    cust_code: input.cust_code,
    cust_name: input.cust_name ?? input.cust_code,
    doc_type: 44,
    doc_date: "2026-06-08",
    doc_no: input.doc_no ?? "DOC-001",
    tax_doc_no: "",
    doc_ref: "",
    credit_day: 30,
    amount: input.amount ?? 0,
  };
}
