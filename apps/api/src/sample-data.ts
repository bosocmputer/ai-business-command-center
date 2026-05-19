import {
  type SalesDetailRow,
  type SalesGoodsServicesParams,
  type SalesGoodsServicesSnapshot,
  type SalesHeaderRow,
  type TenantId,
} from "@ai-bcc/shared";
import { summarizeSalesGoodsServices } from "@ai-bcc/reports";

const defaultParams: SalesGoodsServicesParams = {
  date_from: "2026-05-10",
  date_to: "2026-05-19",
};

export function createSampleSnapshot(
  tenant_id: TenantId,
): SalesGoodsServicesSnapshot {
  if (tenant_id === "tenant_office_sml1_2026") {
    return summarizeSalesGoodsServices({
      tenant_id,
      run_id: "sample_office_sml1_2026",
      params: defaultParams,
      generated_at: "2026-05-19T01:00:00.000Z",
      source: "sample_snapshot",
      headers: createHeaders({
        count: 13,
        total: 3120.67,
        branch: "",
        prefix: "INV2605",
      }),
      details: createDetails({
        count: 13,
        total: 2916.51,
        branches: ["000", "001"],
        products: [
          ["HENNA001", "Henna Product"],
          ["CON-01020", "Consumer Goods"],
          ["BF00002", "Service Fee"],
        ],
      }),
    });
  }

  return summarizeSalesGoodsServices({
    tenant_id,
    run_id: "sample_demo_remote",
    params: defaultParams,
    generated_at: "2026-05-19T01:00:00.000Z",
    source: "sample_snapshot",
    headers: createHeaders({
      count: 68,
      total: 126148.78,
      branch: "0000",
      prefix: "INV-2605",
    }),
    details: createDetails({
      count: 139,
      total: 131760.9,
      branches: ["0000", ""],
      products: [
        ["01-0004", "สินค้า A"],
        ["01-0010", "สินค้า B"],
        ["02-0001", "บริการ C"],
      ],
    }),
  });
}

function createHeaders(input: {
  count: number;
  total: number;
  branch: string;
  prefix: string;
}): SalesHeaderRow[] {
  const base = Math.floor((input.total / input.count) * 100) / 100;
  return Array.from({ length: input.count }, (_, index) => {
    const isLast = index === input.count - 1;
    const total_amount = isLast
      ? roundMoney(input.total - base * (input.count - 1))
      : base;
    return {
      rownum: index,
      doc_date: "2026-05-12",
      doc_no: `${input.prefix}${String(index + 1).padStart(4, "0")}`,
      doc_time: "10:00",
      doc_ref: null,
      cust_code: "AR00001",
      cust_name: index % 2 === 0 ? "เงินสดปลีก" : "ลูกค้าออนไลน์",
      branch_code: input.branch,
      total_value: total_amount,
      total_discount: 0,
      total_except_discount: total_amount,
      total_except_vat: 0,
      vat_rate: 7,
      total_vat_value: 0,
      vat_type: "I",
      total_amount,
      cashier_code: "cashier",
    };
  });
}

function createDetails(input: {
  count: number;
  total: number;
  branches: string[];
  products: Array<[string, string]>;
}): SalesDetailRow[] {
  const base = Math.floor((input.total / input.count) * 100) / 100;
  return Array.from({ length: input.count }, (_, index) => {
    const product = input.products[index % input.products.length];
    const isLast = index === input.count - 1;
    const sum_amount = isLast
      ? roundMoney(input.total - base * (input.count - 1))
      : base;
    return {
      doc_date: "2026-05-12",
      doc_no: `SAMPLE-${String((index % 20) + 1).padStart(4, "0")}`,
      doc_time: "10:00",
      cust_code: "AR00001",
      cust_name: "เงินสดปลีก",
      branch_code: input.branches[index % input.branches.length],
      item_code: product[0],
      item_name: product[1],
      wh_code: "MAIN",
      shelf_code: "SH101",
      unit_code: "ชิ้น",
      qty: 1,
      price: sum_amount,
      discount: null,
      discount_amount: 0,
      sum_amount,
      vat_type: "I",
    };
  });
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
