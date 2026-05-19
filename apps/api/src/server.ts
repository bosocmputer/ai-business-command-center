import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import {
  deriveMorningBriefDateRange,
  lineSendRequestSchema,
  morningBriefRequestSchema,
  type ReportRunRecord,
  type SalesGoodsServicesSnapshot,
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
  testDatasourceConnection,
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
import { reportDefinitionSeeds } from "./report-definitions.js";
import {
  createReportViewerToken,
  verifyReportViewerToken,
} from "./report-viewer-token.js";

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
  reportDefinitions: reportDefinitionSeeds,
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

app.post("/api/tenants/:tenantId/datasource/test", async (request, reply) => {
  const routeParams = tenantParamsSchema.safeParse(request.params);
  if (!routeParams.success) {
    return reply.status(400).send({ error: "Invalid tenant_id" });
  }

  const tenantId = routeParams.data.tenantId;
  const datasource = readDatasourceConfig(tenantId);
  if (!datasource) {
    const checkedAt = new Date().toISOString();
    await systemStore.appendAuditLog({
      tenant_id: tenantId,
      actor_id: null,
      action: "datasource_test_failed",
      target_type: "datasource",
      target_id: tenantId,
      metadata_json: {
        configured: false,
        checked_at: checkedAt,
        safe_error_message: "Datasource is not configured.",
      },
    });

    return reply.status(424).send({
      data: {
        ok: false,
        checked_at: checkedAt,
        latency_ms: 0,
        database_name: getTenantDefinition(tenantId)?.databaseName ?? null,
        user_name_masked: null,
        required_tables: {
          ic_trans: false,
          ic_trans_detail: false,
          ar_customer: false,
        },
        safe_error_message: "Datasource is not configured.",
      },
    });
  }

  const result = await testDatasourceConnection(datasource);
  await systemStore.appendAuditLog({
    tenant_id: tenantId,
    actor_id: null,
    action: result.ok ? "datasource_test_succeeded" : "datasource_test_failed",
    target_type: "datasource",
    target_id: tenantId,
    metadata_json: {
      configured: true,
      checked_at: result.checked_at,
      latency_ms: result.latency_ms,
      database_name: result.database_name,
      required_tables: result.required_tables,
      safe_error_message: result.safe_error_message,
    },
  });

  const response = { data: result };
  if (!result.ok) {
    return reply.status(502).send(response);
  }

  return response;
});

app.get("/api/operations/status", async () => {
  const latestHeartbeat = await systemStore.getLatestWorkerHeartbeat(
    "morning_brief_scheduler",
  );
  const heartbeatAgeSeconds = latestHeartbeat
    ? Math.floor((Date.now() - new Date(latestHeartbeat.checked_at).getTime()) / 1000)
    : null;
  const heartbeatFresh =
    heartbeatAgeSeconds !== null &&
    heartbeatAgeSeconds >= 0 &&
    heartbeatAgeSeconds <= 120;

  return {
    data: {
      api: {
        ok: true,
        service: "ai-business-command-center-api",
        system_store: systemStore.kind,
        time: new Date().toISOString(),
      },
      dashboard: {
        app_base_url_configured: Boolean(process.env.APP_BASE_URL?.trim()),
        dashboard_url: buildDashboardUrl(),
        public_api_base_url_configured: Boolean(
          process.env.NEXT_PUBLIC_API_BASE_URL?.trim(),
        ),
      },
      scheduler: {
        enabled: readBoolean(process.env.MORNING_BRIEF_ENABLED, true),
        tenant_ids: readSchedulerTenantIds(),
        time: process.env.MORNING_BRIEF_TIME || "08:00",
        timezone: process.env.MORNING_BRIEF_TIMEZONE || "Asia/Bangkok",
        mode: process.env.MORNING_BRIEF_MODE === "dry_run" ? "dry_run" : "send",
        force: readBoolean(process.env.MORNING_BRIEF_FORCE, false),
      },
      worker: {
        heartbeat_configured: Boolean(process.env.WORKER_HEARTBEAT_TOKEN?.trim()),
        latest_heartbeat: latestHeartbeat,
        age_seconds: heartbeatAgeSeconds,
        status: latestHeartbeat ? (heartbeatFresh ? latestHeartbeat.status : "stale") : "missing",
      },
      tenants: listTenants().map((tenant) => {
        const lineConfig = readLineChannelConfig(tenant.id);
        return {
          id: tenant.id,
          name: tenant.name,
          database_name: tenant.databaseName,
          datasource_configured: tenant.datasourceConfigured,
          line_configured: Boolean(lineConfig),
          line_target_masked: lineConfig ? maskIdentifier(lineConfig.targetId) : null,
        };
      }),
    },
  };
});

app.post("/api/worker/heartbeat", async (request, reply) => {
  const expectedToken = process.env.WORKER_HEARTBEAT_TOKEN?.trim();
  if (!expectedToken) {
    return reply.status(503).send({
      error: "Worker heartbeat token is not configured.",
    });
  }

  const headerToken = request.headers["x-ai-bcc-worker-token"];
  const token = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  if (token !== expectedToken) {
    request.log.warn("worker heartbeat rejected because token is invalid");
    return reply.status(401).send({ error: "Invalid worker token." });
  }

  const body = workerHeartbeatSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid worker heartbeat",
      details: body.error.flatten().fieldErrors,
    });
  }

  const heartbeat = await systemStore.saveWorkerHeartbeat({
    worker_id: body.data.worker_id,
    role: body.data.role,
    status: body.data.status,
    metadata_json: body.data.metadata_json,
    checked_at: body.data.checked_at ?? new Date().toISOString(),
  });

  return { data: heartbeat };
});

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
  "/api/reports/:tenantId/sales_goods_services/snapshots/:runId",
  async (request, reply) => {
    const params = signedSnapshotParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid report viewer link." });
    }

    const query = signedSnapshotQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid report viewer link." });
    }

    const signingSecret = readReportViewerSigningSecret();
    if (!signingSecret) {
      return reply.status(503).send({
        error: "Report viewer signing is not configured.",
      });
    }

    const verification = verifyReportViewerToken({
      token: query.data.token,
      secret: signingSecret,
      tenantId: params.data.tenantId,
      reportKey: "sales_goods_services",
      runId: params.data.runId,
    });
    if (!verification.ok) {
      const statusCode =
        verification.reason === "missing" || verification.reason === "malformed"
          ? 400
          : 403;
      const errorMessage =
        verification.reason === "expired"
          ? "Report viewer link has expired."
          : "Invalid report viewer link.";
      return reply.status(statusCode).send({ error: errorMessage });
    }

    const snapshot = await systemStore.getSnapshotByRunId(
      params.data.tenantId,
      params.data.runId,
    );
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
        dashboardUrl: buildReportViewerUrl(snapshot),
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
      dashboardUrl: buildReportViewerUrl(snapshot),
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
      dashboardUrl: buildReportViewerUrl(runResult.snapshot),
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

function buildReportViewerUrl(snapshot: SalesGoodsServicesSnapshot) {
  const baseUrl = process.env.APP_BASE_URL?.trim();
  const signingSecret = readReportViewerSigningSecret();
  if (!baseUrl || !signingSecret) {
    return null;
  }

  const token = createReportViewerToken({
    secret: signingSecret,
    tenantId: snapshot.tenant_id,
    reportKey: snapshot.report_key,
    runId: snapshot.run_id,
    expiresAt: new Date(Date.now() + readReportViewerLinkTtlSeconds() * 1000),
  });
  try {
    const url = new URL("/command-center/brief", baseUrl.replace(/\/$/, ""));
    url.searchParams.set("tenant_id", snapshot.tenant_id);
    url.searchParams.set("run_id", snapshot.run_id);
    url.searchParams.set("token", token);
    return url.toString();
  } catch {
    return null;
  }
}

function readReportViewerSigningSecret() {
  const secret = process.env.REPORT_VIEWER_SIGNING_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function readReportViewerLinkTtlSeconds() {
  const rawHours = Number(process.env.REPORT_VIEWER_LINK_TTL_HOURS ?? 720);
  const hours = Number.isFinite(rawHours) ? rawHours : 720;
  return Math.max(1, Math.min(hours, 2160)) * 60 * 60;
}

function buildMorningBriefDeliveryKey(
  tenantId: TenantId,
  params: SalesGoodsServicesParams,
) {
  return `${tenantId}:sales_goods_services:morning_brief:${params.date_from}:${params.date_to}`;
}

function readSchedulerTenantIds() {
  const raw = process.env.MORNING_BRIEF_TENANT_IDS?.trim() || "tenant_demo_remote";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function maskIdentifier(value: string) {
  if (value.length <= 8) {
    return "********";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

const tenantParamsSchema = z.object({
  tenantId: tenantIdSchema,
});

const signedSnapshotParamsSchema = z.object({
  tenantId: tenantIdSchema,
  runId: z.string().min(1).max(180),
});

const signedSnapshotQuerySchema = z.object({
  token: z.string().min(1).max(4096),
});

const lineWebhookEventsQuerySchema = z.object({
  reveal: z.enum(["0", "1"]).optional().default("0"),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

const workerHeartbeatSchema = z.object({
  worker_id: z.string().min(1).max(80),
  role: z.string().min(1).max(80),
  status: z.enum(["ok", "warning", "error"]).default("ok"),
  metadata_json: z.record(z.string(), z.unknown()).optional().default({}),
  checked_at: z.string().datetime().optional(),
});

type FastifyRequestWithRawBody = {
  rawBody?: string;
};
