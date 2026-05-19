import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import {
  deriveMorningBriefDateRange,
  lineSendRequestSchema,
  morningBriefRequestSchema,
  type ReportRunRecord,
  type SalesGoodsServicesParams,
  salesGoodsServicesParamsSchema,
  tenantIdSchema,
  type TenantId,
} from "@ai-bcc/shared";
import {
  getApiConfig,
  getTenantDefinition,
  listTenants,
  readDatasourceConfig,
  readLineChannelConfig,
  readLineWebhookConfig,
} from "./config.js";
import {
  runSalesGoodsServicesReport,
  toSafeErrorMessage,
} from "./report-runner.js";
import { renderSalesGoodsServicesLinePreview } from "@ai-bcc/reports";
import { createSystemStore } from "./system-store.js";
import { sendLineBrief } from "./line-client.js";
import {
  normalizeLineWebhookEvents,
  sanitizeLineWebhookEvent,
  verifyLineSignature,
} from "./line-webhook.js";

const app = Fastify({
  logger: {
    level: "info",
    redact: ["req.headers.authorization", "*.password"],
  },
});

await app.register(cors, {
  origin: true,
});

app.removeContentTypeParser("application/json");
app.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (request, body, done) => {
    const rawBody = body.toString("utf8");
    (request as FastifyRequestWithRawBody).rawBody = rawBody;

    try {
      done(null, rawBody.trim() ? JSON.parse(rawBody) : {});
    } catch (error) {
      done(error as Error, undefined);
    }
  },
);

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

app.post("/api/line/webhook", async (request, reply) => {
  const webhookConfig = readLineWebhookConfig();
  if (!webhookConfig) {
    request.log.warn("LINE webhook rejected because LINE_CHANNEL_SECRET is missing");
    return reply.status(503).send({
      error: "LINE webhook is not configured.",
    });
  }

  const rawBody = (request as FastifyRequestWithRawBody).rawBody ?? "";
  const signature = request.headers["x-line-signature"];
  const signatureValue = Array.isArray(signature) ? signature[0] : signature;

  if (
    !verifyLineSignature({
      rawBody,
      channelSecret: webhookConfig.channelSecret,
      signature: signatureValue,
    })
  ) {
    request.log.warn("LINE webhook rejected because signature is invalid");
    return reply.status(401).send({ error: "Invalid LINE signature." });
  }

  const events = normalizeLineWebhookEvents(request.body as { events?: unknown[] });
  await systemStore.saveLineWebhookEvents(events);

  for (const event of events) {
    await systemStore.appendAuditLog({
      tenant_id: null,
      actor_id: event.user_id,
      action: "line_webhook_received",
      target_type: "line_webhook_event",
      target_id: event.id,
      metadata_json: {
        event_type: event.event_type,
        source_type: event.source_type,
        source_id_masked: event.source_id_masked,
        message_text: event.message_text,
      },
    });
  }

  return { ok: true, event_count: events.length };
});

app.get("/api/line/webhook-events/latest", async (request, reply) => {
  const webhookConfig = readLineWebhookConfig();
  const query = lineWebhookEventsQuerySchema.safeParse(request.query);
  if (!query.success) {
    return reply.status(400).send({ error: "Invalid query" });
  }

  const debugToken = request.headers["x-ai-bcc-debug-token"];
  const debugTokenValue = Array.isArray(debugToken) ? debugToken[0] : debugToken;
  const reveal =
    query.data.reveal === "1" &&
    Boolean(webhookConfig?.debugToken) &&
    debugTokenValue === webhookConfig?.debugToken;

  const events = await systemStore.listLineWebhookEvents(
    Number(query.data.limit ?? 10),
  );

  return {
    data: reveal ? events : events.map(sanitizeLineWebhookEvent),
    reveal,
    debug_token_configured: Boolean(webhookConfig?.debugToken),
  };
});

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
        tenantName: getTenantDefinition(params.data.tenantId)?.name,
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
      tenantName: getTenantDefinition(tenantId)?.name,
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
  "/api/reports/:tenantId/sales_goods_services/morning-brief/run-and-send",
  async (request, reply) => {
    const routeParams = tenantParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const body = morningBriefRequestSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid morning brief request",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenantId = routeParams.data.tenantId;
    const reportParams = deriveMorningBriefDateRange({
      period: body.data.period,
      timeZone: "Asia/Bangkok",
    });
    const deliveryKey = buildMorningBriefDeliveryKey(tenantId, reportParams);

    if (body.data.mode === "send" && !body.data.force) {
      const existingDelivery =
        await systemStore.findSuccessfulLineDeliveryByKey({
          tenantId,
          deliveryKey,
        });
      if (existingDelivery) {
        await systemStore.appendAuditLog({
          tenant_id: tenantId,
          actor_id: null,
          action: "morning_brief_skipped_duplicate",
          target_type: "line_delivery",
          target_id: existingDelivery.id,
          metadata_json: {
            report_key: "sales_goods_services",
            delivery_key: deliveryKey,
            period: reportParams,
            force: body.data.force,
          },
        });
        return {
          data: {
            status: "skipped",
            reason: "duplicate_success_delivery",
            delivery: existingDelivery,
            delivery_key: deliveryKey,
            params: reportParams,
          },
        };
      }
    }

    const runResult = await runAndPersistSalesGoodsServicesReport({
      tenantId,
      params: reportParams,
      requestAction: "morning_brief_report_run_requested",
    });

    if (!runResult.ok) {
      return reply.status(runResult.statusCode).send({
        error: runResult.error,
        run: runResult.runRecord,
      });
    }

    const preview = renderSalesGoodsServicesLinePreview({
      snapshot: runResult.snapshot,
      dashboardUrl: buildDashboardUrl(),
      tenantName: getTenantDefinition(tenantId)?.name,
    });
    const lineConfig = readLineChannelConfig(tenantId);
    const delivery = await sendLineBrief({
      tenantId,
      mode: body.data.mode,
      preview,
      config: lineConfig,
      deliveryKey,
      deliveryType: "morning_brief",
      periodFrom: reportParams.date_from,
      periodTo: reportParams.date_to,
    });

    await systemStore.saveLineDelivery(delivery);
    await systemStore.appendAuditLog({
      tenant_id: tenantId,
      actor_id: null,
      action:
        delivery.status === "success"
          ? "morning_brief_sent"
          : delivery.status === "dry_run"
          ? "morning_brief_dry_run"
          : delivery.status === "skipped"
          ? "morning_brief_skipped_unconfigured"
          : "morning_brief_send_failed",
      target_type: "line_delivery",
      target_id: delivery.id,
      metadata_json: {
        report_key: "sales_goods_services",
        report_run_id: runResult.snapshot.run_id,
        delivery_key: deliveryKey,
        period: reportParams,
        mode: body.data.mode,
        force: body.data.force,
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
        force: body.data.force,
        delivery_key: deliveryKey,
        params: reportParams,
        run: runResult.runRecord,
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
    const runResult = await runAndPersistSalesGoodsServicesReport({
      tenantId,
      params: body.data,
      requestAction: "report_run_requested",
    });

    if (runResult.ok) {
      return { data: runResult.snapshot, run: runResult.runRecord };
    }

    if (runResult.statusCode === 500) {
      request.log.error(
        { safe_error_message: runResult.runRecord.safe_error_message },
        "sales_goods_services run failed",
      );
    }

    return reply.status(runResult.statusCode).send({
      error: runResult.error,
      run: runResult.runRecord,
    });
  },
);

async function runAndPersistSalesGoodsServicesReport(input: {
  tenantId: TenantId;
  params: SalesGoodsServicesParams;
  requestAction: string;
}): Promise<
  | {
      ok: true;
      snapshot: Awaited<ReturnType<typeof runSalesGoodsServicesReport>>;
      runRecord: ReportRunRecord;
    }
  | {
      ok: false;
      statusCode: 424 | 500;
      error: string;
      runRecord: ReportRunRecord;
    }
> {
  const datasource = readDatasourceConfig(input.tenantId);
  const runRecord: ReportRunRecord = {
    id: createRunId(input.tenantId),
    tenant_id: input.tenantId,
    report_key: "sales_goods_services",
    params: input.params,
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    row_count: 0,
    safe_error_message: null,
  };

  await systemStore.upsertRun(runRecord);
  await systemStore.appendAuditLog({
    tenant_id: input.tenantId,
    actor_id: null,
    action: input.requestAction,
    target_type: "report_run",
    target_id: runRecord.id,
    metadata_json: {
      report_key: "sales_goods_services",
      params: input.params,
    },
  });

  if (!datasource) {
    runRecord.status = "failed";
    runRecord.finished_at = new Date().toISOString();
    runRecord.safe_error_message =
      "Datasource is not configured. Add tenant DB settings to .env.local.";
    await systemStore.upsertRun(runRecord);
    return {
      ok: false,
      statusCode: 424,
      error: runRecord.safe_error_message,
      runRecord,
    };
  }

  try {
    const snapshot = await runSalesGoodsServicesReport({
      tenant_id: input.tenantId,
      run_id: runRecord.id,
      params: input.params,
      datasource,
    });
    runRecord.status = "success";
    runRecord.finished_at = new Date().toISOString();
    runRecord.row_count =
      snapshot.summary.document_count + snapshot.summary.line_count;
    await systemStore.upsertRun(runRecord);
    await systemStore.saveSnapshot(snapshot);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
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

    return { ok: true, snapshot, runRecord };
  } catch (error) {
    runRecord.status = "failed";
    runRecord.finished_at = new Date().toISOString();
    runRecord.safe_error_message = toSafeErrorMessage(error);
    await systemStore.upsertRun(runRecord);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
      actor_id: null,
      action: "report_run_failed",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: "sales_goods_services",
        safe_error_message: runRecord.safe_error_message,
      },
    });
    return {
      ok: false,
      statusCode: 500,
      error: runRecord.safe_error_message,
      runRecord,
    };
  }
}

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

function buildMorningBriefDeliveryKey(
  tenantId: TenantId,
  params: SalesGoodsServicesParams,
) {
  return `${tenantId}:sales_goods_services:morning_brief:${params.date_from}:${params.date_to}`;
}

const tenantParamsSchema = z.object({
  tenantId: tenantIdSchema,
});

const lineWebhookEventsQuerySchema = z.object({
  reveal: z.enum(["0", "1"]).optional().default("0"),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

type FastifyRequestWithRawBody = {
  rawBody?: string;
};
