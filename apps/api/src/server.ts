import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import {
  lineSendRequestSchema,
  type ReportRunRecord,
  salesGoodsServicesParamsSchema,
  tenantIdSchema,
} from "@ai-bcc/shared";
import {
  getApiConfig,
  listTenants,
  readDatasourceConfig,
  readLineChannelConfig,
} from "./config.js";
import {
  runSalesGoodsServicesReport,
  toSafeErrorMessage,
} from "./report-runner.js";
import { renderSalesGoodsServicesLinePreview } from "@ai-bcc/reports";
import { createSystemStore } from "./system-store.js";
import { sendLineBrief } from "./line-client.js";

const app = Fastify({
  logger: {
    level: "info",
    redact: ["req.headers.authorization", "*.password"],
  },
});

await app.register(cors, {
  origin: true,
});

const systemStore = createSystemStore();
await systemStore.initialize({
  tenants: listTenants(),
  reportDefinitions: [
    {
      report_key: "sales_goods_services",
      name: "Sales Goods and Services",
      version: "0.1.0",
      contract_json: {
        report_key: "sales_goods_services",
        params: ["date_from", "date_to"],
        financial_truth: "ic_trans.total_amount",
        detail_truth: "ic_trans_detail.sum_amount",
        branch_fallback: "detail.branch_code -> header.branch_code -> no_branch",
      },
    },
  ],
});

app.get("/health", async () => ({
  ok: true,
  service: "ai-business-command-center-api",
  system_store: systemStore.kind,
  time: new Date().toISOString(),
}));

app.get("/api/tenants", async () => ({
  data: listTenants(),
}));

app.get(
  "/api/reports/:tenantId/sales_goods_services/latest",
  async (request, reply) => {
    const params = tenantParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const snapshot = await systemStore.getLatestSnapshot(params.data.tenantId);
    if (!snapshot) {
      return reply.status(404).send({ error: "Snapshot not found" });
    }

    return { data: snapshot };
  },
);

app.get(
  "/api/reports/:tenantId/sales_goods_services/runs",
  async (request, reply) => {
    const params = tenantParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }
    return { data: await systemStore.listRuns(params.data.tenantId) };
  },
);

app.get(
  "/api/reports/:tenantId/sales_goods_services/line-preview",
  async (request, reply) => {
    const params = tenantParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const snapshot = await systemStore.getLatestSnapshot(params.data.tenantId);
    if (!snapshot) {
      return reply.status(404).send({ error: "Snapshot not found" });
    }

    return {
      data: renderSalesGoodsServicesLinePreview({
        snapshot,
        dashboardUrl: buildDashboardUrl(),
      }),
    };
  },
);

app.get(
  "/api/reports/:tenantId/sales_goods_services/line-deliveries",
  async (request, reply) => {
    const params = tenantParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    return { data: await systemStore.listLineDeliveries(params.data.tenantId) };
  },
);

app.post(
  "/api/reports/:tenantId/sales_goods_services/line-send-test",
  async (request, reply) => {
    const params = tenantParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const body = lineSendRequestSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid LINE send request",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenantId = params.data.tenantId;
    const snapshot = await systemStore.getLatestSnapshot(tenantId);
    if (!snapshot) {
      return reply.status(404).send({ error: "Snapshot not found" });
    }

    const preview = renderSalesGoodsServicesLinePreview({
      snapshot,
      dashboardUrl: buildDashboardUrl(),
    });
    const lineConfig = readLineChannelConfig(tenantId);
    const delivery = await sendLineBrief({
      tenantId,
      mode: body.data.mode,
      preview,
      config: lineConfig,
    });

    await systemStore.saveLineDelivery(delivery);
    await systemStore.appendAuditLog({
      tenant_id: tenantId,
      actor_id: null,
      action:
        delivery.status === "success"
          ? "line_brief_sent"
          : delivery.status === "dry_run"
          ? "line_brief_dry_run"
          : "line_brief_send_failed",
      target_type: "line_delivery",
      target_id: delivery.id,
      metadata_json: {
        report_key: "sales_goods_services",
        report_run_id: snapshot.run_id,
        status: delivery.status,
        mode: body.data.mode,
        configured: Boolean(lineConfig),
        target_id_masked: delivery.target_id_masked,
        safe_error_message: delivery.safe_error_message,
      },
    });

    const response = {
      data: {
        delivery,
        preview,
        configured: Boolean(lineConfig),
        mode: body.data.mode,
      },
    };

    if (delivery.status === "failed") {
      return reply.status(502).send(response);
    }

    return response;
  },
);

app.post(
  "/api/reports/:tenantId/sales_goods_services/run",
  async (request, reply) => {
    const routeParams = tenantParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const body = salesGoodsServicesParamsSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid report params",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenantId = routeParams.data.tenantId;
    const datasource = readDatasourceConfig(tenantId);
    const runRecord: ReportRunRecord = {
      id: createRunId(tenantId),
      tenant_id: tenantId,
      report_key: "sales_goods_services",
      params: body.data,
      status: "running",
      started_at: new Date().toISOString(),
      finished_at: null,
      row_count: 0,
      safe_error_message: null,
    };

    await systemStore.upsertRun(runRecord);
    await systemStore.appendAuditLog({
      tenant_id: tenantId,
      actor_id: null,
      action: "report_run_requested",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: "sales_goods_services",
        params: body.data,
      },
    });

    if (!datasource) {
      runRecord.status = "failed";
      runRecord.finished_at = new Date().toISOString();
      runRecord.safe_error_message =
        "Datasource is not configured. Add tenant DB settings to .env.local.";
      await systemStore.upsertRun(runRecord);
      return reply.status(424).send({
        error: runRecord.safe_error_message,
        run: runRecord,
      });
    }

    try {
      const snapshot = await runSalesGoodsServicesReport({
        tenant_id: tenantId,
        run_id: runRecord.id,
        params: body.data,
        datasource,
      });
      runRecord.status = "success";
      runRecord.finished_at = new Date().toISOString();
      runRecord.row_count =
        snapshot.summary.document_count + snapshot.summary.line_count;
      await systemStore.upsertRun(runRecord);
      await systemStore.saveSnapshot(snapshot);
      await systemStore.appendAuditLog({
        tenant_id: tenantId,
        actor_id: null,
        action: "report_run_succeeded",
        target_type: "report_run",
        target_id: runRecord.id,
        metadata_json: {
          report_key: "sales_goods_services",
          row_count: runRecord.row_count,
          quality_status: snapshot.quality_status,
        },
      });
      return { data: snapshot, run: runRecord };
    } catch (error) {
      request.log.error({ error }, "sales_goods_services run failed");
      runRecord.status = "failed";
      runRecord.finished_at = new Date().toISOString();
      runRecord.safe_error_message = toSafeErrorMessage(error);
      await systemStore.upsertRun(runRecord);
      await systemStore.appendAuditLog({
        tenant_id: tenantId,
        actor_id: null,
        action: "report_run_failed",
        target_type: "report_run",
        target_id: runRecord.id,
        metadata_json: {
          report_key: "sales_goods_services",
          safe_error_message: runRecord.safe_error_message,
        },
      });
      return reply.status(500).send({
        error: runRecord.safe_error_message,
        run: runRecord,
      });
    }
  },
);

app.get("/api/audit-logs", async () => ({
  data: await systemStore.listAuditLogs(50),
}));

const config = getApiConfig();
await app.listen({
  host: config.host,
  port: config.port,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await systemStore.close();
    process.exit(0);
  });
}

function createRunId(tenantId: string) {
  return `run_${tenantId}_${Date.now()}`;
}

function buildDashboardUrl() {
  const baseUrl = process.env.APP_BASE_URL?.trim();
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl.replace(/\/$/, "")}/command-center`;
}

const tenantParamsSchema = z.object({
  tenantId: tenantIdSchema,
});
