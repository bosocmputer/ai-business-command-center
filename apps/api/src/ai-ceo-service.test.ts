import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AiAdvisorItemRecord,
  AiAdvisorRunRecord,
  AiUsageLedgerRecord,
  BusinessSignalRecord,
  OpenRouterModelCatalogRecord,
  ReportKey,
  ReportSnapshot,
  Tenant,
  TenantAiProfileRecord,
  TenantAiPromptVersionRecord,
} from "@ai-bcc/shared";
import { createSampleSnapshot } from "./sample-data.js";
import {
  buildAiCeoLinePreview,
  buildAiCeoUnavailableLinePreview,
  defaultTenantAiProfile,
  runAiCeoDryRun,
  syncOpenRouterModelCatalog,
} from "./ai-ceo-service.js";
import type { SystemStore } from "./system-store.js";

const tenant: Tenant = {
  id: "tenant_demo_remote",
  name: "Demo Store",
  databaseName: "demo",
  description: "construction materials",
  datasourceConfigured: true,
  status: "active",
  planCode: "business",
  suspendedReason: null,
  currentPeriodEnd: null,
  billingCycle: null,
};

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

describe("AI CEO service", () => {
  it("merges OpenRouter model pricing into the curated allowlist", async () => {
    const store = createFakeStore();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "qwen/qwen3.7-max",
            name: "Qwen Max Remote",
            context_length: 123456,
            pricing: {
              prompt: "0.000001",
              completion: "0.000002",
            },
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const models = await syncOpenRouterModelCatalog({ store, fetchImpl });
    const qwen = models.find((model) => model.model_id === "qwen/qwen3.7-max");

    expect(qwen?.display_name).toBe("Qwen Max Remote");
    expect(qwen?.context_length).toBe(123456);
    expect(qwen?.price_input_per_m).toBe(1);
    expect(qwen?.price_output_per_m).toBe(2);
    expect(store.modelCatalog.length).toBe(10);
  });

  it("runs a dry-run, stores the advisor response, item, and usage ledger", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const store = createFakeStore();
    const now = new Date().toISOString();
    const prompt: TenantAiPromptVersionRecord = {
      id: "prompt_1",
      tenant_id: tenant.id,
      version: 1,
      prompt_text:
        "คุณคือ AI CEO ของร้านนี้ ให้วิเคราะห์จากรายงานที่อนุมัติแล้วเท่านั้น และตอบเป็น JSON ที่ระบบกำหนด",
      created_by: "owner",
      created_at: now,
      archived_at: null,
    };
    store.promptVersions.push(prompt);
    store.profile = {
      ...defaultTenantAiProfile({ tenant, now, activePromptVersionId: prompt.id }),
      selected_model_id: "qwen/qwen3.7-max",
      ai_enabled: true,
    };

    const result = await runAiCeoDryRun({
      store,
      tenant,
      request: { scheduled_date: "2026-06-30" },
      actorId: "owner",
      requester: async () => ({
        ok: true,
        providerStatus: 200,
        latencyMs: 42,
        content: JSON.stringify({
          summary: "ยอดขายดี แต่มีรายการขายที่ควรตรวจ",
          confidence: 0.82,
          caveats: [],
          top_actions: [
            {
              title: "ตรวจยอดขายผิดปกติ",
              reason: "พบสัญญาณจากรายงานขาย",
              recommended_action: "เปิดรายงานขายแล้วตรวจ 5 อันดับแรก",
              severity: "warning",
              confidence: 0.8,
              source_report_keys: ["sales_goods_services"],
              source_run_ids: ["sample_demo_remote"],
            },
          ],
        }),
        inputTokens: 1000,
        outputTokens: 500,
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.run.status).toBe("success");
    expect(result.items).toHaveLength(1);
    expect(store.runs.at(-1)?.response_json?.summary).toContain("ยอดขายดี");
    expect(store.items.at(-1)?.title).toBe("ตรวจยอดขายผิดปกติ");
    expect(store.usageLedger.at(-1)?.input_tokens).toBe(1000);

    const preview = buildAiCeoLinePreview({
      tenant,
      run: result.run,
      items: result.items,
    });
    expect(preview?.line_message_type).toBe("text");
    expect(preview?.run_id).toBe("sample_demo_remote");
    expect(preview?.text).toContain("สรุปวันนี้");
    expect(preview?.text).toContain("อ้างอิงจากรายงานรอบนี้ 1 รายงาน");
    expect(preview?.text).toContain("ควรทำก่อน");
    expect(preview?.text).toContain("ตรวจยอดขายผิดปกติ");
    expect(preview?.flex_message).toBeUndefined();
    expect(JSON.stringify(preview)).not.toContain("api_key");
  });

  it("limits scheduled AI CEO context to the current notification report snapshots", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const store = createFakeStore();
    const now = new Date().toISOString();
    store.profile = {
      ...defaultTenantAiProfile({ tenant, now }),
      selected_model_id: "qwen/qwen3.7-max",
      ai_enabled: true,
    };
    const salesSnapshot = createScopedSnapshot({
      reportKey: "sales_goods_services",
      runId: "run_sales_current",
    });
    const cashSnapshot = createScopedSnapshot({
      reportKey: "cash_bank_receipts",
      runId: "run_cash_current",
    });
    let capturedContext: Record<string, unknown> | null = null;

    const result = await runAiCeoDryRun({
      store,
      tenant,
      request: { scheduled_date: "2026-06-30" },
      actorId: "owner",
      triggerType: "scheduled",
      sourceReportKeys: ["sales_goods_services", "cash_bank_receipts"],
      sourceSnapshots: [salesSnapshot, cashSnapshot],
      requester: async ({ context }) => {
        capturedContext = context;
        return {
          ok: true,
          providerStatus: 200,
          latencyMs: 42,
          content: JSON.stringify({
            summary:
              "\u{1F4CA} ใช้ยอดขายและ cash_bank_receipts จากรอบแจ้งเตือนนี้เท่านั้น",
            confidence: 0.82,
            caveats: [],
            top_actions: [
              {
                title: "ตรวจเงินรับจาก cash_bank_receipts",
                reason: "พบยอดรับเงินที่ควรตรวจ",
                recommended_action: "เปิด cash_bank_receipts ของรอบนี้",
                severity: "warning",
                confidence: 0.8,
                source_report_keys: [
                  "cash_bank_receipts",
                  "gross_profit_by_product",
                ],
                source_run_ids: ["run_cash_current", "run_gross_profit_old"],
              },
            ],
          }),
          inputTokens: 1000,
          outputTokens: 500,
        };
      },
    });

    const context = capturedContext as unknown as {
      data_scope?: { mode?: string; available_report_keys?: string[]; rules?: string[] };
      output_contract?: { cashflow_style?: string };
      reports?: Array<{ report_key: string; run_id: string }>;
    };
    expect(result.ok).toBe(true);
    expect(context.data_scope?.mode).toBe("notification_run");
    expect(context.data_scope?.available_report_keys).toEqual([
      "sales_goods_services",
      "cash_bank_receipts",
    ]);
    expect(context.reports?.map((report) => report.run_id)).toEqual([
      "run_sales_current",
      "run_cash_current",
    ]);
    expect(context.output_contract?.cashflow_style).toContain("เงินสดสุทธิ");
    expect(context.data_scope?.rules?.join(" ")).toContain("ลูกหนี้การค้า");
    expect(result.run.source_report_keys).toEqual([
      "sales_goods_services",
      "cash_bank_receipts",
    ]);
    expect(result.response?.top_actions[0]?.source_report_keys).toEqual([
      "cash_bank_receipts",
    ]);
    expect(result.response?.top_actions[0]?.source_run_ids).toEqual([
      "run_cash_current",
    ]);
    expect(result.response?.summary).not.toContain("cash_bank_receipts");
    expect(result.response?.summary).not.toContain("\u{1F4CA}");
    expect(result.response?.summary).toContain("รายงานรับเงิน");
    expect(result.response?.top_actions[0]?.title).not.toContain(
      "cash_bank_receipts",
    );
    expect(result.response?.top_actions[0]?.recommended_action).toContain(
      "รายงานรับเงิน",
    );
    expect(result.response?.caveats.join(" ")).toContain(
      "ระบบตัดหลักฐานที่อยู่นอกชุดรายงานรอบนี้ออก",
    );
  });

  it("sanitizes production LINE advice for package scope and customer-safe wording", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const store = createFakeStore();
    const now = new Date().toISOString();
    store.profile = {
      ...defaultTenantAiProfile({ tenant, now }),
      selected_model_id: "qwen/qwen3.7-max",
      ai_enabled: true,
    };

    const result = await runAiCeoDryRun({
      store,
      tenant,
      request: { scheduled_date: "2026-06-30" },
      actorId: "owner",
      triggerType: "scheduled",
      sourceReportKeys: [
        "sales_goods_services",
        "purchase_goods_payables",
        "cash_bank_receipts",
        "cash_bank_payments",
      ],
      sourceSnapshots: [
        createScopedSnapshot({
          reportKey: "sales_goods_services",
          runId: "run_sales_current",
          summary: {
            total_sales: 132_690,
            document_count: 21,
            line_count: 24,
            total_qty: 75.5,
            top_product_name: "สินค้า A",
          },
        }),
        createScopedSnapshot({
          reportKey: "purchase_goods_payables",
          runId: "run_purchase_current",
        }),
        createScopedSnapshot({
          reportKey: "cash_bank_receipts",
          runId: "run_receipts_current",
          summary: {
            total_amount: 22_500,
          },
        }),
        createScopedSnapshot({
          reportKey: "cash_bank_payments",
          runId: "run_payments_current",
          summary: {
            total_amount: 739_953.7,
          },
        }),
      ],
      requester: async () => ({
        ok: true,
        providerStatus: 200,
        latencyMs: 42,
        content: JSON.stringify({
          summary:
            "\u{1F4CA} เงินสดสุทธิ -717,453.70 บาท จาก cash_bank_payments จ่ายออกสูงมาก",
          confidence: 0.82,
          caveats: [],
          top_actions: [
            {
              title: "ตรวจ cash_bank_payments",
              reason: "ยอดจ่ายออกสูงมาก",
              recommended_action: "เทียบเอกสาร cash_bank_payments กับเจ้าหนี้",
              severity: "warning",
              confidence: 0.8,
              source_report_keys: ["cash_bank_payments"],
              source_run_ids: ["run_payments_current"],
            },
            {
              title: "ติดตามลูกหนี้การค้า",
              reason: "ยอดขายสูงกว่ารับเงิน",
              recommended_action: "ดึงรายงานลูกหนี้ค้างชำระ (ถ้ามี)",
              severity: "warning",
              confidence: 0.7,
              source_report_keys: ["cash_bank_receipts"],
              source_run_ids: ["run_receipts_current"],
            },
            {
              title: "เร่งสั่งซื้อสินค้าขาดสต็อก",
              reason: "ควรเติมสต็อก",
              recommended_action: "เปิด stock_balance แล้วสร้างใบสั่งซื้อ",
              severity: "warning",
              confidence: 0.7,
              source_report_keys: ["sales_goods_services"],
              source_run_ids: ["run_sales_current"],
            },
          ],
        }),
        inputTokens: 1000,
        outputTokens: 500,
      }),
    });

    expect(result.ok).toBe(true);
    const rendered = buildAiCeoLinePreview({
      tenant,
      run: result.run,
      items: result.items,
    });
    const customerFacingText = [
      result.response?.summary,
      ...(result.response?.caveats ?? []),
      ...(result.response?.top_actions.flatMap((action) => [
        action.title,
        action.reason,
        action.recommended_action,
      ]) ?? []),
    ].join("\n");
    expect(customerFacingText).not.toContain("cash_bank_payments");
    expect(customerFacingText).not.toContain("stock_balance");
    expect(customerFacingText).not.toContain("\u{1F4CA}");
    expect(customerFacingText).not.toContain("ลูกหนี้การค้า");
    expect(customerFacingText).not.toContain("รายงานลูกหนี้ค้างชำระ");
    expect(result.response?.summary).toContain("รายงานจ่ายเงิน");
    expect(result.response?.summary).toContain("ยอดจ่ายออกสูง ควรตรวจเอกสารประกอบ");
    expect(result.response?.top_actions).toHaveLength(2);
    expect(result.response?.top_actions.map((action) => action.title)).not.toContain(
      "เร่งสั่งซื้อสินค้าขาดสต็อก",
    );
    expect(result.response?.caveats.join(" ")).toContain(
      "เงินสดสุทธิเป็นยอดตามเอกสารรับ/จ่าย",
    );
    expect(rendered?.text).not.toContain("cash_bank_payments");
    expect(rendered?.text).not.toContain("\u{1F4CA}");
  });

  it("parses fenced OpenRouter JSON and can render an AI CEO fallback card", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const store = createFakeStore();
    const now = new Date().toISOString();
    store.profile = {
      ...defaultTenantAiProfile({ tenant, now }),
      selected_model_id: "qwen/qwen3.7-max",
      ai_enabled: true,
    };

    const result = await runAiCeoDryRun({
      store,
      tenant,
      request: { scheduled_date: "2026-06-30" },
      actorId: "owner",
      requester: async () => ({
        ok: true,
        providerStatus: 200,
        latencyMs: 42,
        content: [
          "```json",
          JSON.stringify({
            summary: "ควรดูยอดขายและเงินรับวันนี้",
            confidence: 82,
            caveats: "ควรตรวจข้อมูลบางส่วนซ้ำ",
            actions: [
              {
                title: "ตรวจยอดขาย",
                reason: "พบยอดที่ควรตรวจสอบจากรายงานขาย",
                action: "เปิดรายงานขายแล้วตรวจรายการที่ผิดปกติ",
                severity: "medium",
                confidence: 75,
                source_report_key: "sales_goods_services",
                source_run_id: "sample_demo_remote",
              },
            ],
          }),
          "```",
        ].join("\n"),
        inputTokens: 1000,
        outputTokens: 500,
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.response?.confidence).toBe(0.82);
    expect(result.response?.caveats).toEqual(["ควรตรวจข้อมูลบางส่วนซ้ำ"]);
    expect(result.items[0]?.recommended_action).toContain("รายงานขาย");
    expect(result.items[0]?.severity).toBe("info");

    const fallback = buildAiCeoUnavailableLinePreview({
      tenant,
      run: result.run,
      fallbackReportRunId: "run_cash_1",
      safeErrorMessage: "OpenRouter ส่งคำตอบกลับมาในรูปแบบที่ระบบอ่านไม่ได้",
    });
    expect(fallback.line_message_type).toBe("text");
    expect(fallback.run_id).toBe("run_cash_1");
    expect(fallback.text).toContain("วันนี้ AI CEO ยังสรุปไม่ได้");
    expect(fallback.flex_message).toBeUndefined();
  });
});

function createFakeStore() {
  const snapshot = createSampleSnapshot(tenant.id);
  const state = {
    profile: null as TenantAiProfileRecord | null,
    promptVersions: [] as TenantAiPromptVersionRecord[],
    modelCatalog: [] as OpenRouterModelCatalogRecord[],
    runs: [] as AiAdvisorRunRecord[],
    items: [] as AiAdvisorItemRecord[],
    usageLedger: [] as AiUsageLedgerRecord[],
  };
  const store = {
    ...state,
    kind: "local-json",
    getTenantAiProfile: async () => state.profile,
    upsertTenantAiProfile: async (profile: TenantAiProfileRecord) => {
      state.profile = profile;
      store.profile = profile;
      return profile;
    },
    listTenantAiPromptVersions: async () => [...state.promptVersions],
    upsertTenantAiPromptVersion: async (prompt: TenantAiPromptVersionRecord) => {
      state.promptVersions.push(prompt);
      store.promptVersions = state.promptVersions;
      return prompt;
    },
    listOpenRouterModelCatalog: async () => [...state.modelCatalog],
    upsertOpenRouterModelCatalog: async (models: OpenRouterModelCatalogRecord[]) => {
      state.modelCatalog = models;
      store.modelCatalog = models;
      return models;
    },
    getSecretRecord: async () => null,
    listAiAdvisorRuns: async () => [...state.runs],
    upsertAiAdvisorRun: async (run: AiAdvisorRunRecord) => {
      const index = state.runs.findIndex((item) => item.id === run.id);
      if (index >= 0) {
        state.runs[index] = run;
      } else {
        state.runs.push(run);
      }
      store.runs = state.runs;
      return run;
    },
    upsertAiAdvisorItems: async (items: AiAdvisorItemRecord[]) => {
      state.items.push(...items);
      store.items = state.items;
      return items;
    },
    listAiAdvisorItems: async () => [...state.items],
    upsertAiUsageLedger: async (entry: AiUsageLedgerRecord) => {
      state.usageLedger.push(entry);
      store.usageLedger = state.usageLedger;
      return entry;
    },
    listAiUsageLedger: async () => [...state.usageLedger],
    pruneAiCeoHistory: async () => ({
      advisor_runs_deleted: 0,
      advisor_items_deleted: 0,
      usage_ledger_deleted: 0,
      metric_snapshots_deleted: 0,
    }),
    getLatestSnapshot: async (_tenantId: string, reportKey?: ReportKey) =>
      !reportKey || reportKey === snapshot.report_key ? snapshot : null,
    listBusinessSignals: async () => [] as BusinessSignalRecord[],
    listMetricSnapshots: async () => [],
  } as unknown as SystemStore & typeof state;
  return store;
}

function createScopedSnapshot(input: {
  reportKey: ReportKey;
  runId: string;
  summary?: unknown;
}): ReportSnapshot {
  const snapshot = createSampleSnapshot(tenant.id);
  return {
    ...snapshot,
    report_key: input.reportKey,
    run_id: input.runId,
    summary: input.summary ?? snapshot.summary,
    generated_at: "2026-06-30T03:00:00.000Z",
    params: {
      date_from: "2026-06-30",
      date_to: "2026-06-30",
    },
  } as unknown as ReportSnapshot;
}
