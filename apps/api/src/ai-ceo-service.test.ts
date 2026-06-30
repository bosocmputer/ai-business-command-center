import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AiAdvisorItemRecord,
  AiAdvisorRunRecord,
  AiUsageLedgerRecord,
  BusinessSignalRecord,
  OpenRouterModelCatalogRecord,
  ReportKey,
  Tenant,
  TenantAiProfileRecord,
  TenantAiPromptVersionRecord,
} from "@ai-bcc/shared";
import { createSampleSnapshot } from "./sample-data.js";
import {
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
          summary: "ยอดขายดี แต่มีรายการที่ควรตรวจ margin",
          confidence: 0.82,
          caveats: [],
          top_actions: [
            {
              title: "ตรวจสินค้ากำไรต่ำ",
              reason: "พบสัญญาณ margin ต่ำจากรายงาน",
              recommended_action: "เปิดรายงานกำไรสินค้าแล้วตรวจ 5 อันดับแรก",
              severity: "warning",
              confidence: 0.8,
              source_report_keys: ["sales_goods_services"],
              source_run_ids: ["run_1"],
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
    expect(store.items.at(-1)?.title).toBe("ตรวจสินค้ากำไรต่ำ");
    expect(store.usageLedger.at(-1)?.input_tokens).toBe(1000);
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
    getLatestSnapshot: async (_tenantId: string, reportKey?: ReportKey) =>
      !reportKey || reportKey === snapshot.report_key ? snapshot : null,
    listBusinessSignals: async () => [] as BusinessSignalRecord[],
    listMetricSnapshots: async () => [],
  } as unknown as SystemStore & typeof state;
  return store;
}
