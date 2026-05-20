import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import {
  deriveMorningBriefDateRange,
  allowedLineActionSchema,
  lineSendRequestSchema,
  lineAccessProfileKeySchema,
  type LineDeliveryRecord,
  morningBriefRequestSchema,
  reportKeySchema,
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
  readLineChannelCredentials,
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
import { fetchLineTargetDisplayName, sendLineBrief } from "./line-client.js";
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
import { verifyAdminToken } from "./admin-auth.js";
import {
  applyLineAccessProfileDefaults,
  buildEnvFallbackLineTarget,
  buildPendingWebhookLineTarget,
  canAccessLineReport,
  lineAccessProfileDefaults,
  toSafeLineTargetRecord,
  type StoredLineTargetRecord,
} from "./line-targets.js";

const app = Fastify({
  logger: {
    level: "info",
    redact: [
      "req.headers.authorization",
      "req.headers.x-ai-bcc-admin-token",
      "*.password",
    ],
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
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

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
        const lineCredentials = readLineChannelCredentials(tenant.id);
        const lineConfig = readLineChannelConfig(tenant.id);
        return {
          id: tenant.id,
          name: tenant.name,
          database_name: tenant.databaseName,
          datasource_configured: tenant.datasourceConfigured,
          line_configured: Boolean(lineCredentials),
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
  const discoveredTargets = await registerWebhookLineTargets(events);

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

  return {
    ok: true,
    event_count: events.length,
    discovered_target_count: discoveredTargets.length,
  };
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

app.get("/api/line-targets", async (request, reply) => {
  const query = lineTargetsQuerySchema.safeParse(request.query);
  if (!query.success) {
    return reply.status(400).send({ error: "Invalid query" });
  }

  const targets = await enrichLineTargetDisplayNames(
    await listEffectiveLineTargets(query.data.tenant_id),
  );

  return {
    data: targets.map(toSafeLineTargetRecord),
    profiles: lineAccessProfileDefaults,
  };
});

app.post("/api/line-targets/:id/approve", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const routeParams = lineTargetParamsSchema.safeParse(request.params);
  if (!routeParams.success) {
    return reply.status(400).send({ error: "Invalid LINE target id" });
  }

  const body = lineTargetApproveSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid LINE target approve request",
      details: body.error.flatten().fieldErrors,
    });
  }

  const target = await getMutableLineTarget(routeParams.data.id);
  if (!target) {
    return reply.status(404).send({ error: "LINE target not found" });
  }

  const profileKey = body.data.access_profile_key ?? target.access_profile_key;
  const updated = await systemStore.upsertLineTarget({
    ...applyLineAccessProfileDefaults(target, profileKey),
    display_name: body.data.display_name?.trim() || target.display_name,
    approved: true,
    enabled: body.data.enabled ?? true,
    updated_at: new Date().toISOString(),
  });

  await systemStore.appendAuditLog({
    tenant_id: updated.tenant_id,
    actor_id: null,
    action: "line_target_approved",
    target_type: "line_target",
    target_id: updated.id,
    metadata_json: {
      target_id_masked: updated.target_id_masked,
      target_id_hash: updated.target_id_hash,
      access_profile_key: updated.access_profile_key,
      enabled: updated.enabled,
    },
  });

  return { data: toSafeLineTargetRecord(updated) };
});

app.patch("/api/line-targets/:id", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const routeParams = lineTargetParamsSchema.safeParse(request.params);
  if (!routeParams.success) {
    return reply.status(400).send({ error: "Invalid LINE target id" });
  }

  const body = lineTargetPatchSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid LINE target update request",
      details: body.error.flatten().fieldErrors,
    });
  }

  const target = await getMutableLineTarget(routeParams.data.id);
  if (!target) {
    return reply.status(404).send({ error: "LINE target not found" });
  }

  let updated: StoredLineTargetRecord = {
    ...target,
    display_name: body.data.display_name?.trim() || target.display_name,
    enabled: body.data.enabled ?? target.enabled,
    approved: body.data.approved ?? target.approved,
    updated_at: new Date().toISOString(),
  };

  if (body.data.access_profile_key) {
    updated = applyLineAccessProfileDefaults(
      updated,
      body.data.access_profile_key,
    );
  }

  if (body.data.allowed_report_keys) {
    updated.allowed_report_keys = body.data.allowed_report_keys;
  }
  if (body.data.allowed_actions) {
    updated.allowed_actions = body.data.allowed_actions;
  }

  updated = await systemStore.upsertLineTarget({
    ...updated,
    updated_at: new Date().toISOString(),
  });

  await systemStore.appendAuditLog({
    tenant_id: updated.tenant_id,
    actor_id: null,
    action: "line_target_updated",
    target_type: "line_target",
    target_id: updated.id,
    metadata_json: {
      target_id_masked: updated.target_id_masked,
      target_id_hash: updated.target_id_hash,
      access_profile_key: updated.access_profile_key,
      enabled: updated.enabled,
      approved: updated.approved,
      allowed_report_keys: updated.allowed_report_keys,
      allowed_actions: updated.allowed_actions,
    },
  });

  return { data: toSafeLineTargetRecord(updated) };
});

app.post("/api/line-targets/:id/test-send", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const routeParams = lineTargetParamsSchema.safeParse(request.params);
  if (!routeParams.success) {
    return reply.status(400).send({ error: "Invalid LINE target id" });
  }

  const body = lineSendRequestSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid LINE send request",
      details: body.error.flatten().fieldErrors,
    });
  }

  const target = await getEffectiveLineTargetById(routeParams.data.id);
  if (!target) {
    return reply.status(404).send({ error: "LINE target not found" });
  }

  const permission = canAccessLineReport({
    tenantId: target.tenant_id,
    target,
    reportKey: "sales_goods_services",
    action: "receive_morning_brief",
  });
  if (!permission.allowed) {
    await systemStore.appendAuditLog({
      tenant_id: target.tenant_id,
      actor_id: null,
      action: "line_target_test_denied",
      target_type: "line_target",
      target_id: target.id,
      metadata_json: {
        report_key: "sales_goods_services",
        reason: permission.reason,
        target_id_masked: target.target_id_masked,
      },
    });
    return reply.status(403).send({
      error: permission.message,
      reason: permission.reason,
    });
  }

  const snapshot = await systemStore.getLatestSnapshot(target.tenant_id);
  if (!snapshot) {
    return reply.status(404).send({ error: "Snapshot not found" });
  }

  const openViewerPermission = canAccessLineReport({
    tenantId: target.tenant_id,
    target,
    reportKey: "sales_goods_services",
    action: "open_signed_viewer",
  });
  const preview = renderSalesGoodsServicesLinePreview({
    snapshot,
    dashboardUrl: openViewerPermission.allowed
      ? buildReportViewerUrl(snapshot)
      : null,
    tenantName: getTenantDefinition(target.tenant_id)?.name,
  });
  const lineConfig = buildLineChannelConfigForTarget(target);
  const delivery = await sendLineBrief({
    tenantId: target.tenant_id,
    mode: body.data.mode,
    preview,
    config: lineConfig,
  });

  await systemStore.saveLineDelivery(delivery);
  if (delivery.sent_at) {
    await markLineTargetDelivered(target, delivery.sent_at);
  }
  await systemStore.appendAuditLog({
    tenant_id: target.tenant_id,
    actor_id: null,
    action:
      delivery.status === "success"
        ? "line_target_test_sent"
        : delivery.status === "dry_run"
        ? "line_target_test_dry_run"
        : "line_target_test_failed",
    target_type: "line_target",
    target_id: target.id,
    metadata_json: {
      report_key: "sales_goods_services",
      report_run_id: snapshot.run_id,
      status: delivery.status,
      target_id_masked: delivery.target_id_masked,
      safe_error_message: delivery.safe_error_message,
    },
  });

  const response = {
    data: {
      target: toSafeLineTargetRecord(target),
      delivery,
      preview,
      mode: body.data.mode,
    },
  };

  if (delivery.status === "failed") {
    return reply.status(502).send(response);
  }

  return response;
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
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

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
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

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
    const targets = await listEffectiveLineTargets(tenantId);

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

    const deliveries = [];
    let preview = renderSalesGoodsServicesLinePreview({
      snapshot: runResult.snapshot,
      dashboardUrl: null,
      tenantName: getTenantDefinition(tenantId)?.name,
    });

    for (const target of targets) {
      const deliveryKey = buildMorningBriefDeliveryKey(
        tenantId,
        reportParams,
        target.target_id_hash,
      );

      if (body.data.mode === "send" && !body.data.force) {
        const existingDelivery =
          await systemStore.findSuccessfulLineDeliveryByKey({
            tenantId,
            deliveryKey,
          });
        if (existingDelivery) {
          deliveries.push(existingDelivery);
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
              target_id_masked: target.target_id_masked,
              target_id_hash: target.target_id_hash,
            },
          });
          continue;
        }
      }

      const receivePermission = canAccessLineReport({
        tenantId,
        target,
        reportKey: "sales_goods_services",
        action: "receive_morning_brief",
      });
      if (!receivePermission.allowed) {
        const skippedDelivery = createSkippedLineDelivery({
          tenantId,
          snapshot: runResult.snapshot,
          target,
          deliveryKey,
          reportParams,
          safeErrorMessage: receivePermission.message,
        });
        deliveries.push(skippedDelivery);
        await systemStore.saveLineDelivery(skippedDelivery);
        await systemStore.appendAuditLog({
          tenant_id: tenantId,
          actor_id: null,
          action: "morning_brief_skipped_permission",
          target_type: "line_target",
          target_id: target.id,
          metadata_json: {
            report_key: "sales_goods_services",
            delivery_key: deliveryKey,
            reason: receivePermission.reason,
            period: reportParams,
            target_id_masked: target.target_id_masked,
            target_id_hash: target.target_id_hash,
          },
        });
        continue;
      }

      const openViewerPermission = canAccessLineReport({
        tenantId,
        target,
        reportKey: "sales_goods_services",
        action: "open_signed_viewer",
      });
      preview = renderSalesGoodsServicesLinePreview({
        snapshot: runResult.snapshot,
        dashboardUrl: openViewerPermission.allowed
          ? buildReportViewerUrl(runResult.snapshot)
          : null,
        tenantName: getTenantDefinition(tenantId)?.name,
      });
      const delivery = await sendLineBrief({
        tenantId,
        mode: body.data.mode,
        preview,
        config: buildLineChannelConfigForTarget(target),
        deliveryKey,
        deliveryType: "morning_brief",
        periodFrom: reportParams.date_from,
        periodTo: reportParams.date_to,
      });

      deliveries.push(delivery);
      await systemStore.saveLineDelivery(delivery);
      if (delivery.sent_at) {
        await markLineTargetDelivered(target, delivery.sent_at);
      }
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
          target_id_masked: delivery.target_id_masked,
          target_id_hash: target.target_id_hash,
          safe_error_message: delivery.safe_error_message,
        },
      });
    }

    if (!targets.length) {
      await systemStore.appendAuditLog({
        tenant_id: tenantId,
        actor_id: null,
        action: "morning_brief_skipped_no_line_targets",
        target_type: "tenant",
        target_id: tenantId,
        metadata_json: {
          report_key: "sales_goods_services",
          period: reportParams,
        },
      });
    }

    const failedDelivery = deliveries.find(
      (delivery) => delivery.status === "failed",
    );
    const successfulDelivery = deliveries.find(
      (delivery) => delivery.status === "success",
    );
    const firstDelivery = deliveries[0] ?? null;

    const response = {
      data: {
        status:
          deliveries.length === 0
            ? "skipped"
            : successfulDelivery
            ? "sent"
            : "processed",
        reason: deliveries.length === 0 ? "no_line_targets" : null,
        delivery: firstDelivery,
        deliveries,
        preview,
        configured: targets.length > 0,
        mode: body.data.mode,
        force: body.data.force,
        delivery_key: firstDelivery?.delivery_key ?? null,
        params: reportParams,
        run: runResult.runRecord,
      },
    };

    if (failedDelivery) {
      return reply.status(502).send(response);
    }

    return response;
  },
);

app.post(
  "/api/reports/:tenantId/sales_goods_services/run",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

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
      snapshot: SalesGoodsServicesSnapshot;
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
    snapshot.comparison = await buildSalesComparison({
      tenantId: input.tenantId,
      runId: runRecord.id,
      params: input.params,
      datasource,
      currentTotalSales: snapshot.summary.total_sales,
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

async function buildSalesComparison(input: {
  tenantId: TenantId;
  runId: string;
  params: SalesGoodsServicesParams;
  datasource: NonNullable<ReturnType<typeof readDatasourceConfig>>;
  currentTotalSales: number;
}): Promise<SalesGoodsServicesSnapshot["comparison"]> {
  if (input.params.date_from !== input.params.date_to) {
    return undefined;
  }

  const previousDay = addDays(input.params.date_from, -1);
  const sameWeekdayLastWeek = addDays(input.params.date_from, -7);
  const [previousDaySnapshot, sameWeekdaySnapshot] = await Promise.allSettled([
    runSalesGoodsServicesReport({
      tenant_id: input.tenantId,
      run_id: `${input.runId}_compare_previous_day`,
      params: { date_from: previousDay, date_to: previousDay },
      datasource: input.datasource,
    }),
    runSalesGoodsServicesReport({
      tenant_id: input.tenantId,
      run_id: `${input.runId}_compare_same_weekday_last_week`,
      params: {
        date_from: sameWeekdayLastWeek,
        date_to: sameWeekdayLastWeek,
      },
      datasource: input.datasource,
    }),
  ]);

  return {
    previous_day:
      previousDaySnapshot.status === "fulfilled"
        ? toComparisonPoint({
            label: "previous_day",
            snapshot: previousDaySnapshot.value,
            currentTotalSales: input.currentTotalSales,
          })
        : null,
    same_weekday_last_week:
      sameWeekdaySnapshot.status === "fulfilled"
        ? toComparisonPoint({
            label: "same_weekday_last_week",
            snapshot: sameWeekdaySnapshot.value,
            currentTotalSales: input.currentTotalSales,
          })
        : null,
  };
}

function toComparisonPoint(input: {
  label: "previous_day" | "same_weekday_last_week";
  snapshot: SalesGoodsServicesSnapshot;
  currentTotalSales: number;
}) {
  const referenceTotal = input.snapshot.summary.total_sales;
  const differenceAmount = roundMoney(input.currentTotalSales - referenceTotal);
  const differencePercent =
    referenceTotal === 0 ? null : roundPercent((differenceAmount / referenceTotal) * 100);

  return {
    label: input.label,
    date_from: input.snapshot.params.date_from,
    date_to: input.snapshot.params.date_to,
    total_sales: referenceTotal,
    document_count: input.snapshot.summary.document_count,
    difference_amount: differenceAmount,
    difference_percent: differencePercent,
    direction: resolveComparisonDirection(differenceAmount, referenceTotal),
  } satisfies NonNullable<SalesGoodsServicesSnapshot["comparison"]>["previous_day"];
}

function resolveComparisonDirection(differenceAmount: number, referenceTotal: number) {
  if (referenceTotal === 0) {
    return "no_reference" as const;
  }

  if (Math.abs(differenceAmount) < 0.01) {
    return "flat" as const;
  }

  return differenceAmount > 0 ? ("up" as const) : ("down" as const);
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

async function listEffectiveLineTargets(tenantId?: TenantId) {
  const storedTargets = await systemStore.listLineTargets(tenantId);
  const tenantIds = tenantId
    ? [tenantId]
    : listTenants().map((tenant) => tenant.id);
  const envFallbackTargets = isLineTargetEnvFallbackEnabled()
    ? tenantIds
        .map((id) => {
          const lineConfig = readLineChannelConfig(id);
          return lineConfig
            ? buildEnvFallbackLineTarget({ tenantId: id, config: lineConfig })
            : null;
        })
        .filter((target): target is StoredLineTargetRecord => Boolean(target))
    : [];

  const effectiveTargets = [...storedTargets];
  for (const envTarget of envFallbackTargets) {
    const storedDuplicate = storedTargets.find(
      (target) =>
        target.tenant_id === envTarget.tenant_id &&
        target.target_id_hash === envTarget.target_id_hash,
    );
    if (!storedDuplicate || !storedDuplicate.approved) {
      effectiveTargets.unshift(envTarget);
    }
  }

  return effectiveTargets;
}

async function enrichLineTargetDisplayNames(
  targets: StoredLineTargetRecord[],
) {
  const enrichedTargets: StoredLineTargetRecord[] = [];

  for (const target of targets) {
    const displayName = await fetchLineTargetDisplayName({
      config: buildLineChannelConfigForTarget(target),
      target,
    });

    if (!displayName || displayName === target.display_name) {
      enrichedTargets.push(target);
      continue;
    }

    const updatedTarget = {
      ...target,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    };
    enrichedTargets.push(updatedTarget);

    if (target.source !== "env_fallback") {
      await systemStore.upsertLineTarget(updatedTarget);
    }
  }

  return enrichedTargets;
}

async function getEffectiveLineTargetById(id: string) {
  if (id.startsWith("line_target_env_")) {
    if (!isLineTargetEnvFallbackEnabled()) {
      return null;
    }

    const tenantId = id.replace("line_target_env_", "");
    const parsed = tenantIdSchema.safeParse(tenantId);
    if (!parsed.success) {
      return null;
    }

    const lineConfig = readLineChannelConfig(parsed.data);
    return lineConfig
      ? buildEnvFallbackLineTarget({
          tenantId: parsed.data,
          config: lineConfig,
        })
      : null;
  }

  return systemStore.getLineTargetById(id);
}

async function getMutableLineTarget(id: string) {
  if (id.startsWith("line_target_env_")) {
    return null;
  }

  return systemStore.getLineTargetById(id);
}

async function registerWebhookLineTargets(events: ReturnType<typeof normalizeLineWebhookEvents>) {
  const tenantId = readWebhookDiscoveryTenantId();
  const discovered: StoredLineTargetRecord[] = [];
  const seenHashes = new Set<string>();

  for (const event of events) {
    const pendingTarget = buildPendingWebhookLineTarget({ tenantId, event });
    if (!pendingTarget || seenHashes.has(pendingTarget.target_id_hash)) {
      continue;
    }
    seenHashes.add(pendingTarget.target_id_hash);

    const existing = await systemStore.getLineTargetByHash({
      tenantId,
      targetIdHash: pendingTarget.target_id_hash,
    });
    if (existing) {
      continue;
    }

    const displayName = await fetchLineTargetDisplayName({
      config: buildLineChannelConfigForTarget(pendingTarget),
      target: pendingTarget,
    });
    const targetToSave = displayName
      ? {
          ...pendingTarget,
          display_name: displayName,
          updated_at: new Date().toISOString(),
        }
      : pendingTarget;
    const saved = await systemStore.upsertLineTarget(targetToSave);
    discovered.push(saved);
    await systemStore.appendAuditLog({
      tenant_id: tenantId,
      actor_id: event.user_id ? maskIdentifier(event.user_id) : null,
      action: "line_target_discovered",
      target_type: "line_target",
      target_id: saved.id,
      metadata_json: {
        event_type: event.event_type,
        source_type: event.source_type,
        target_id_masked: saved.target_id_masked,
        target_id_hash: saved.target_id_hash,
        approved: saved.approved,
        enabled: saved.enabled,
      },
    });
  }

  return discovered;
}

function buildLineChannelConfigForTarget(target: StoredLineTargetRecord) {
  const lineCredentials = readLineChannelCredentials(target.tenant_id);
  if (!lineCredentials) {
    return null;
  }

  return {
    ...lineCredentials,
    targetId: target.target_id,
    targetType: target.target_type,
  };
}

async function markLineTargetDelivered(
  target: StoredLineTargetRecord,
  sentAt: string,
) {
  if (target.source === "env_fallback") {
    return;
  }

  await systemStore.upsertLineTarget({
    ...target,
    last_delivery_at: sentAt,
    updated_at: new Date().toISOString(),
  });
}

function createSkippedLineDelivery(input: {
  tenantId: TenantId;
  snapshot: SalesGoodsServicesSnapshot;
  target: StoredLineTargetRecord;
  deliveryKey: string;
  reportParams: SalesGoodsServicesParams;
  safeErrorMessage: string;
}): LineDeliveryRecord {
  const now = new Date().toISOString();
  return {
    id: `line_${input.tenantId}_${Date.now()}_${input.target.target_id_hash.slice(
      0,
      8,
    )}`,
    tenant_id: input.tenantId,
    report_key: input.snapshot.report_key,
    report_run_id: input.snapshot.run_id,
    delivery_key: input.deliveryKey,
    delivery_type: "morning_brief",
    period_from: input.reportParams.date_from,
    period_to: input.reportParams.date_to,
    target_id_masked: input.target.target_id_masked,
    message_type: "text",
    status: "skipped",
    sent_at: null,
    provider_response_json: null,
    safe_error_message: input.safeErrorMessage,
    created_at: now,
  };
}

function requireAdminMutation(request: {
  headers: Record<string, string | string[] | undefined>;
}) {
  return verifyAdminToken({
    expectedToken: process.env.AI_BCC_ADMIN_TOKEN,
    headerValue: request.headers["x-ai-bcc-admin-token"],
  });
}

function readReportViewerSigningSecret() {
  const secret = process.env.REPORT_VIEWER_SIGNING_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function readReportViewerLinkTtlSeconds() {
  const rawHours = Number(process.env.REPORT_VIEWER_LINK_TTL_HOURS ?? 72);
  const hours = Number.isFinite(rawHours) ? rawHours : 72;
  return Math.max(1, Math.min(hours, 2160)) * 60 * 60;
}

function buildMorningBriefDeliveryKey(
  tenantId: TenantId,
  params: SalesGoodsServicesParams,
  targetIdHash?: string,
) {
  const base = `${tenantId}:sales_goods_services:morning_brief:${params.date_from}:${params.date_to}`;
  return targetIdHash ? `${base}:${targetIdHash.slice(0, 16)}` : base;
}

function readWebhookDiscoveryTenantId() {
  const parsed = tenantIdSchema.safeParse(process.env.LINE_DEFAULT_WEBHOOK_TENANT_ID);
  return parsed.success ? parsed.data : "tenant_demo_remote";
}

function isLineTargetEnvFallbackEnabled() {
  return readBoolean(process.env.LINE_TARGET_ENV_FALLBACK_ENABLED, false);
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

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
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

const lineTargetsQuerySchema = z.object({
  tenant_id: tenantIdSchema.optional(),
});

const lineTargetParamsSchema = z.object({
  id: z.string().min(1).max(160),
});

const lineTargetApproveSchema = z.object({
  access_profile_key: lineAccessProfileKeySchema.optional(),
  display_name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
});

const lineTargetPatchSchema = z.object({
  display_name: z.string().trim().min(1).max(120).optional(),
  access_profile_key: lineAccessProfileKeySchema.optional(),
  enabled: z.boolean().optional(),
  approved: z.boolean().optional(),
  allowed_report_keys: z.array(reportKeySchema).optional(),
  allowed_actions: z.array(allowedLineActionSchema).optional(),
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
