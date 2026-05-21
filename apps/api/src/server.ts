import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  deriveMorningBriefDateRange,
  allowedLineActionSchema,
  lineSendRequestSchema,
  lineAccessProfileKeySchema,
  type LineDeliveryRecord,
  type LineChannelRecord,
  morningBriefRequestSchema,
  planCodeSchema,
  reportKeySchema,
  type PurchaseGoodsPayablesSnapshot,
  type ReportKey,
  type ReportLinePreview,
  type ReportSnapshot,
  type ReportRunRecord,
  type SalesGoodsServicesSnapshot,
  type SalesGoodsServicesParams,
  isoDateSchema,
  salesGoodsServicesParamsSchema,
  tenantIdSchema,
  tenantStatusSchema,
  type TenantId,
} from "@ai-bcc/shared";
import {
  getApiConfig,
  getTenantDefinition,
  getTenantSlug,
  listTenants,
  type DatasourceConfig,
  type LineChannelConfig,
  readDatasourceConfig,
  readLineChannelCredentials,
  readLineChannelConfig,
  readLineWebhookConfig,
  resolveTenantIdFromSlug,
} from "./config.js";
import {
  fetchSalesGoodsServicesDocumentDetail,
  fetchSalesGoodsServicesDocumentPage,
  fetchSalesGoodsServicesPdfRows,
  fetchPurchaseGoodsPayablesDocumentDetail,
  fetchPurchaseGoodsPayablesDocumentPage,
  fetchPurchaseGoodsPayablesPdfRows,
  runPurchaseGoodsPayablesReport,
  runSalesGoodsServicesReport,
  testDatasourceConnection,
  toSafeErrorMessage,
} from "./report-runner.js";
import {
  buildReportPdf,
  cleanupReportPdfCache,
  closeReportPdfBrowser,
  readCachedReportPdf,
  validateReportPdfLimits,
} from "./report-pdf-export.js";
import {
  renderPurchaseGoodsPayablesLinePreview,
  renderSalesGoodsServicesLinePreview,
} from "@ai-bcc/reports";
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
import {
  findLineChannelForWebhookSignature,
  readDatasourceConfigStatus,
  readSecretEncryptionSecret,
  readStoredDatasourceConfig,
  readStoredLineChannelCredentials,
  saveLineChannelSecrets,
  saveTenantDatasourceConfig,
} from "./tenant-secret-config.js";

const app = Fastify({
  logger: {
    level: "info",
    redact: [
      "req.url",
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
cleanupReportPdfCache().catch((error) => {
  app.log.warn({ error }, "pdf cache cleanup failed");
});

app.get("/health", async () => ({
  ok: true,
  service: "ai-business-command-center-api",
  system_store: systemStore.kind,
  time: new Date().toISOString(),
}));

app.get("/api/tenants", async () => ({
  data: await systemStore.listTenants(),
}));

app.get("/api/owner/tenants", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const tenants = await systemStore.listTenants();
  const summaries = (await Promise.all(
    tenants.map(async (tenant) => buildOwnerTenantSummary(tenant.id)),
  )).filter((summary): summary is NonNullable<typeof summary> =>
    Boolean(summary),
  );

  return { data: summaries };
});

app.post("/api/owner/tenants", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const body = ownerTenantCreateSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid tenant create request",
      details: body.error.flatten().fieldErrors,
    });
  }

  const existingTenant = (await systemStore.listTenants()).find(
    (tenant) => tenant.id === body.data.tenant_id,
  );
  if (existingTenant) {
    return reply.status(409).send({ error: "Tenant already exists." });
  }

  const now = new Date().toISOString();
  const tenant = await systemStore.upsertTenant({
    id: body.data.tenant_id,
    name: body.data.name,
    databaseName: body.data.database_name ?? "",
    description: body.data.description ?? "",
    datasourceConfigured: false,
    status: body.data.status,
    planCode: body.data.plan_code,
    suspendedReason: null,
    currentPeriodEnd: body.data.current_period_end ?? null,
  });

  await systemStore.upsertUser({
    id: `user_${tenant.id}_viewer`,
    email: body.data.viewer_email ?? `viewer+${tenant.id}@ai-business.local`,
    display_name: `${tenant.name} Viewer`,
    role: "tenant_viewer",
    tenant_id: tenant.id,
    enabled: true,
    created_at: now,
    updated_at: now,
  });

  await systemStore.appendAuditLog({
    tenant_id: tenant.id,
    actor_id: null,
    action: "owner_tenant_created",
    target_type: "tenant",
    target_id: tenant.id,
    metadata_json: {
      plan_code: tenant.planCode,
      status: tenant.status,
    },
  });

  return { data: await buildOwnerTenantSummary(tenant.id) };
});

app.patch("/api/owner/tenants/:tenantId", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const routeParams = tenantParamsSchema.safeParse(request.params);
  if (!routeParams.success) {
    return reply.status(400).send({ error: "Invalid tenant_id" });
  }

  const body = ownerTenantPatchSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid tenant update request",
      details: body.error.flatten().fieldErrors,
    });
  }

  const current = (await systemStore.listTenants()).find(
    (tenant) => tenant.id === routeParams.data.tenantId,
  );
  if (!current) {
    return reply.status(404).send({ error: "Tenant not found" });
  }

  const updated = await systemStore.upsertTenant({
    ...current,
    name: body.data.name ?? current.name,
    databaseName: body.data.database_name ?? current.databaseName,
    description: body.data.description ?? current.description,
    datasourceConfigured:
      body.data.datasource_configured ?? current.datasourceConfigured,
    status: body.data.status ?? current.status,
    planCode: body.data.plan_code ?? current.planCode,
    suspendedReason:
      body.data.suspended_reason !== undefined
        ? body.data.suspended_reason
        : current.suspendedReason,
    currentPeriodEnd:
      body.data.current_period_end !== undefined
        ? body.data.current_period_end
        : current.currentPeriodEnd,
  });

  await systemStore.appendAuditLog({
    tenant_id: updated.id,
    actor_id: null,
    action: "owner_tenant_updated",
    target_type: "tenant",
    target_id: updated.id,
    metadata_json: {
      plan_code: updated.planCode,
      status: updated.status,
      datasource_configured: updated.datasourceConfigured,
    },
  });

  return { data: await buildOwnerTenantSummary(updated.id) };
});

app.get(
  "/api/owner/tenants/:tenantId/datasource/config",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = tenantParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const tenant = await getTenantOrNull(routeParams.data.tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }

    return {
      data: await readDatasourceConfigStatus({
        store: systemStore,
        tenantId: tenant.id,
        envConfig: readDatasourceConfig(tenant.id),
      }),
    };
  },
);

app.put(
  "/api/owner/tenants/:tenantId/datasource/config",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = tenantParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const body = datasourceConfigUpdateSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid datasource config request",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenant = await getTenantOrNull(routeParams.data.tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }

    if (!readSecretEncryptionSecret()) {
      return reply.status(503).send({
        error:
          "AI_BCC_SECRET_KEY is not configured. Set it on the server before saving secrets.",
      });
    }

    const status = await saveTenantDatasourceConfig({
      store: systemStore,
      config: {
        tenantId: tenant.id,
        host: body.data.host,
        port: body.data.port,
        database: body.data.database,
        user: body.data.user,
        password: body.data.password,
      },
    });

    await systemStore.upsertTenant({
      ...tenant,
      databaseName: body.data.database,
      datasourceConfigured: true,
    });
    await systemStore.appendAuditLog({
      tenant_id: tenant.id,
      actor_id: null,
      action: "datasource_config_updated",
      target_type: "datasource",
      target_id: tenant.id,
      metadata_json: {
        source: status.source,
        host: body.data.host,
        port: body.data.port,
        database: body.data.database,
        user: body.data.user,
        password_configured: true,
      },
    });

    return { data: status };
  },
);

app.get("/api/owner/line-channels", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const query = lineChannelsQuerySchema.safeParse(request.query);
  if (!query.success) {
    return reply.status(400).send({ error: "Invalid query" });
  }

  return {
    data: await listEffectiveLineChannels(query.data.tenant_id),
  };
});

app.post("/api/owner/line-channels", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const body = lineChannelCreateSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid LINE channel request",
      details: body.error.flatten().fieldErrors,
    });
  }

  const tenant = await getTenantOrNull(body.data.tenant_id);
  if (!tenant) {
    return reply.status(404).send({ error: "Tenant not found." });
  }

  const now = new Date().toISOString();
  const channel: LineChannelRecord = {
    id: `line_channel_${body.data.tenant_id}_${Date.now()}`,
    tenant_id: body.data.tenant_id,
    display_name: body.data.display_name,
    channel_type: "line_oa",
    channel_access_token_configured: Boolean(
      body.data.channel_access_token_configured,
    ),
    channel_secret_configured: Boolean(body.data.channel_secret_configured),
    enabled: body.data.enabled ?? true,
    source: "manual",
    created_at: now,
    updated_at: now,
  };

  const saved = await systemStore.upsertLineChannel(channel);
  await systemStore.appendAuditLog({
    tenant_id: saved.tenant_id,
    actor_id: null,
    action: "line_channel_created",
    target_type: "line_channel",
    target_id: saved.id,
    metadata_json: {
      display_name: saved.display_name,
      enabled: saved.enabled,
      token_configured: saved.channel_access_token_configured,
      secret_configured: saved.channel_secret_configured,
    },
  });

  return { data: saved };
});

app.put("/api/owner/line-channels/:id/secrets", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const routeParams = lineChannelParamsSchema.safeParse(request.params);
  if (!routeParams.success) {
    return reply.status(400).send({ error: "Invalid LINE channel id" });
  }

  const body = lineChannelSecretsUpdateSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid LINE channel secrets request",
      details: body.error.flatten().fieldErrors,
    });
  }

  if (!readSecretEncryptionSecret()) {
    return reply.status(503).send({
      error:
        "AI_BCC_SECRET_KEY is not configured. Set it on the server before saving secrets.",
    });
  }

  const channels = await systemStore.listLineChannels();
  const channel = channels.find((item) => item.id === routeParams.data.id);
  if (!channel || channel.source === "env") {
    return reply.status(404).send({ error: "LINE channel not found." });
  }

  const result = await saveLineChannelSecrets({
    store: systemStore,
    config: {
      tenantId: channel.tenant_id,
      lineChannelId: channel.id,
      channelAccessToken: body.data.channel_access_token,
      channelSecret: body.data.channel_secret,
    },
  });

  const updated = await systemStore.upsertLineChannel({
    ...channel,
    channel_access_token_configured:
      channel.channel_access_token_configured ||
      result.channel_access_token_configured,
    channel_secret_configured:
      channel.channel_secret_configured || result.channel_secret_configured,
    updated_at: new Date().toISOString(),
  });

  await systemStore.appendAuditLog({
    tenant_id: channel.tenant_id,
    actor_id: null,
    action: "line_channel_secrets_updated",
    target_type: "line_channel",
    target_id: channel.id,
    metadata_json: {
      token_configured: updated.channel_access_token_configured,
      secret_configured: updated.channel_secret_configured,
    },
  });

  return { data: updated };
});

app.post(
  "/api/owner/tenants/:tenantId/datasource/test",
  async (request, reply) => testTenantDatasource(request, reply),
);

app.post(
  "/api/owner/tenants/:tenantId/reports/sales_goods_services/validation-signoff",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = tenantParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const body = reportValidationSignoffSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid validation sign-off request",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenantId = routeParams.data.tenantId;
    const tenant = await getTenantOrNull(tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }

    const snapshot = await systemStore.getSnapshotByRunId(
      tenantId,
      body.data.run_id,
      "sales_goods_services",
    );
    if (!snapshot || snapshot.report_key !== "sales_goods_services") {
      return reply.status(404).send({ error: "Report snapshot not found." });
    }

    if (
      snapshot.params.date_from !== body.data.date_from ||
      snapshot.params.date_to !== body.data.date_to
    ) {
      return reply.status(409).send({
        error: "Sign-off period does not match the report snapshot.",
      });
    }

    const submittedSystemTotal = roundMoney(body.data.system_total);
    const systemTotal = roundMoney(snapshot.summary.total_sales);
    if (Math.abs(submittedSystemTotal - systemTotal) > 0.01) {
      return reply.status(409).send({
        error: "Submitted system total does not match the report snapshot.",
      });
    }

    const referenceTotal = roundMoney(body.data.reference_total);
    const differenceAmount = roundMoney(systemTotal - referenceTotal);
    const accepted = Math.abs(differenceAmount) <= 0.01;

    await systemStore.appendAuditLog({
      tenant_id: tenantId,
      actor_id: null,
      action: "report_validation_signed_off",
      target_type: "report_snapshot",
      target_id: snapshot.run_id,
      metadata_json: {
        report_key: "sales_goods_services",
        date_from: body.data.date_from,
        date_to: body.data.date_to,
        system_total: systemTotal,
        reference_total: referenceTotal,
        difference_amount: differenceAmount,
        accepted,
        signed_by: body.data.signed_by,
        note: body.data.note ?? null,
      },
    });

    return {
      data: {
        status: accepted ? "accepted" : "difference_found",
        accepted,
        difference_amount: differenceAmount,
      },
    };
  },
);

app.get("/api/app/:tenantSlug/session", async (request, reply) => {
  const session = await resolveCustomerSessionBySlug(request.params);
  if (!session.ok) {
    return reply.status(session.statusCode).send({ error: session.error });
  }

  return {
    data: {
      role: "tenant_viewer",
      tenant_slug: session.tenantSlug,
      tenant: session.tenant,
      access: tenantAccessStatus(session.tenant),
    },
  };
});

app.get("/api/app/session", async (_request, reply) =>
  reply.status(400).send({
    error:
      "Customer dashboard requires a shop link. Use /app/{tenant-slug} instead.",
  }),
);

app.get(
  "/api/app/:tenantSlug/reports/sales_goods_services/latest",
  async (request, reply) => {
    const session = await resolveCustomerSessionBySlug(request.params);
    if (!session.ok) {
      return reply.status(session.statusCode).send({ error: session.error });
    }

    const access = tenantAccessStatus(session.tenant);
    if (!access.enabled) {
      return reply.status(403).send({
        error: access.message,
        tenant_status: session.tenant.status,
      });
    }

    const snapshot = await systemStore.getLatestSnapshot(session.tenant.id);
    if (!snapshot) {
      return reply.status(404).send({ error: "Snapshot not found" });
    }

    return {
      data: snapshot,
      tenant: session.tenant,
      tenant_slug: session.tenantSlug,
    };
  },
);

app.get(
  "/api/app/:tenantSlug/reports/sales_goods_services",
  async (request, reply) => {
    const session = await resolveCustomerSessionBySlug(request.params);
    if (!session.ok) {
      return reply.status(session.statusCode).send({ error: session.error });
    }

    const access = tenantAccessStatus(session.tenant);
    if (!access.enabled) {
      return reply.status(403).send({
        error: access.message,
        tenant_status: session.tenant.status,
      });
    }

    const query = customerReportRangeQuerySchema.safeParse(
      request.query ?? {},
    );
    if (!query.success) {
      return reply.status(400).send({
        error: "Invalid report date range",
        details: query.error.flatten().fieldErrors,
      });
    }

    const rangeError = validateCustomerReportRange(query.data);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const datasource = await resolveTenantDatasourceConfig(session.tenant.id);
    if (!datasource) {
      return reply.status(400).send({
        error: "Datasource is not configured for this tenant.",
      });
    }

    try {
      const runId = createCustomerPreviewRunId(session.tenant.id);
      const snapshot = await runSalesGoodsServicesReport({
        tenant_id: session.tenant.id,
        run_id: runId,
        params: query.data,
        datasource,
      });
      snapshot.comparison = await buildSalesComparison({
        tenantId: session.tenant.id,
        runId,
        params: query.data,
        datasource,
        currentTotalSales: snapshot.summary.total_sales,
      });

      return {
        data: snapshot,
        tenant: session.tenant,
        tenant_slug: session.tenantSlug,
        mode: "ad_hoc",
      };
    } catch (error) {
      request.log.error({ error }, "customer report range fetch failed");
      return reply.status(500).send({
        error: toSafeErrorMessage(error),
      });
    }
  },
);

app.get(
  "/api/app/:tenantSlug/reports/sales_goods_services/documents",
  async (request, reply) => {
    const session = await resolveCustomerSessionBySlug(request.params);
    if (!session.ok) {
      return reply.status(session.statusCode).send({ error: session.error });
    }

    const access = tenantAccessStatus(session.tenant);
    if (!access.enabled) {
      return reply.status(403).send({
        error: access.message,
        tenant_status: session.tenant.status,
      });
    }

    const query = customerDocumentsPageQuerySchema.safeParse(
      request.query ?? {},
    );
    if (!query.success) {
      return reply.status(400).send({
        error: "Invalid document page request",
        details: query.error.flatten().fieldErrors,
      });
    }

    const params = {
      date_from: query.data.date_from,
      date_to: query.data.date_to,
    };
    const rangeError = validateCustomerReportRange(params);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const datasource = await resolveTenantDatasourceConfig(session.tenant.id);
    if (!datasource) {
      return reply.status(400).send({
        error: "Datasource is not configured for this tenant.",
      });
    }

    try {
      const page = await fetchSalesGoodsServicesDocumentPage({
        tenant_id: session.tenant.id,
        params,
        datasource,
        page: query.data.page,
        page_size: query.data.page_size,
        search: query.data.search,
      });

      return {
        data: page,
        tenant: session.tenant,
        tenant_slug: session.tenantSlug,
        mode: "documents",
      };
    } catch (error) {
      request.log.error({ error }, "customer document page fetch failed");
      return reply.status(500).send({
        error: toSafeErrorMessage(error),
      });
    }
  },
);

app.get(
  "/api/app/:tenantSlug/reports/sales_goods_services/document-detail",
  async (request, reply) => {
    const session = await resolveCustomerSessionBySlug(request.params);
    if (!session.ok) {
      return reply.status(session.statusCode).send({ error: session.error });
    }

    const access = tenantAccessStatus(session.tenant);
    if (!access.enabled) {
      return reply.status(403).send({
        error: access.message,
        tenant_status: session.tenant.status,
      });
    }

    const query = documentDetailQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        error: "Invalid document detail request",
        details: query.error.flatten().fieldErrors,
      });
    }

    const paramsFromQuery =
      query.data.date_from && query.data.date_to
        ? {
            date_from: query.data.date_from,
            date_to: query.data.date_to,
          }
        : null;
    const rangeError = paramsFromQuery
      ? validateCustomerReportRange(paramsFromQuery)
      : null;
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const snapshot = paramsFromQuery
      ? null
      : await systemStore.getLatestSnapshot(session.tenant.id);
    if (!paramsFromQuery && !snapshot) {
      return reply.status(404).send({ error: "Snapshot not found" });
    }
    const params = paramsFromQuery ?? snapshot!.params;

    const datasource = await resolveTenantDatasourceConfig(session.tenant.id);
    if (!datasource) {
      return reply.status(400).send({
        error: "Datasource is not configured for this tenant.",
      });
    }

    try {
      const detail = await fetchSalesGoodsServicesDocumentDetail({
        tenant_id: session.tenant.id,
        params,
        datasource,
        doc_no: query.data.doc_no,
      });

      if (!detail) {
        return reply.status(404).send({
          error: "Document not found in the latest report period.",
        });
      }

      return {
        data: detail,
        tenant: session.tenant,
        tenant_slug: session.tenantSlug,
        run_id: snapshot?.run_id ?? null,
      };
    } catch (error) {
      request.log.error({ error }, "customer document detail fetch failed");
      return reply.status(500).send({
        error: toSafeErrorMessage(error),
      });
    }
  },
);

app.get(
  "/api/app/:tenantSlug/reports/purchase_goods_payables/latest",
  async (request, reply) => {
    const session = await resolveCustomerSessionBySlug(request.params);
    if (!session.ok) {
      return reply.status(session.statusCode).send({ error: session.error });
    }

    const access = tenantAccessStatus(session.tenant);
    if (!access.enabled) {
      return reply.status(403).send({
        error: access.message,
        tenant_status: session.tenant.status,
      });
    }

    const snapshot = await systemStore.getLatestSnapshot(
      session.tenant.id,
      "purchase_goods_payables",
    );
    if (!snapshot) {
      return reply.status(404).send({ error: "Purchase snapshot not found" });
    }

    return {
      data: snapshot,
      tenant: session.tenant,
      tenant_slug: session.tenantSlug,
    };
  },
);

app.get(
  "/api/app/:tenantSlug/reports/purchase_goods_payables",
  async (request, reply) => {
    const session = await resolveCustomerSessionBySlug(request.params);
    if (!session.ok) {
      return reply.status(session.statusCode).send({ error: session.error });
    }

    const access = tenantAccessStatus(session.tenant);
    if (!access.enabled) {
      return reply.status(403).send({
        error: access.message,
        tenant_status: session.tenant.status,
      });
    }

    const query = customerReportRangeQuerySchema.safeParse(
      request.query ?? {},
    );
    if (!query.success) {
      return reply.status(400).send({
        error: "Invalid purchase report date range",
        details: query.error.flatten().fieldErrors,
      });
    }

    const rangeError = validateCustomerReportRange(query.data);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const datasource = await resolveTenantDatasourceConfig(session.tenant.id);
    if (!datasource) {
      return reply.status(400).send({
        error: "Datasource is not configured for this tenant.",
      });
    }

    try {
      const snapshot = await runPurchaseGoodsPayablesReport({
        tenant_id: session.tenant.id,
        run_id: createCustomerPreviewRunId(session.tenant.id),
        params: query.data,
        datasource,
      });

      return {
        data: snapshot,
        tenant: session.tenant,
        tenant_slug: session.tenantSlug,
        mode: "ad_hoc",
      };
    } catch (error) {
      request.log.error({ error }, "customer purchase report range fetch failed");
      return reply.status(500).send({
        error: toSafeErrorMessage(error),
      });
    }
  },
);

app.get(
  "/api/app/:tenantSlug/reports/purchase_goods_payables/documents",
  async (request, reply) => {
    const session = await resolveCustomerSessionBySlug(request.params);
    if (!session.ok) {
      return reply.status(session.statusCode).send({ error: session.error });
    }

    const access = tenantAccessStatus(session.tenant);
    if (!access.enabled) {
      return reply.status(403).send({
        error: access.message,
        tenant_status: session.tenant.status,
      });
    }

    const query = customerDocumentsPageQuerySchema.safeParse(
      request.query ?? {},
    );
    if (!query.success) {
      return reply.status(400).send({
        error: "Invalid purchase document page request",
        details: query.error.flatten().fieldErrors,
      });
    }

    const params = {
      date_from: query.data.date_from,
      date_to: query.data.date_to,
    };
    const rangeError = validateCustomerReportRange(params);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const datasource = await resolveTenantDatasourceConfig(session.tenant.id);
    if (!datasource) {
      return reply.status(400).send({
        error: "Datasource is not configured for this tenant.",
      });
    }

    try {
      const page = await fetchPurchaseGoodsPayablesDocumentPage({
        tenant_id: session.tenant.id,
        params,
        datasource,
        page: query.data.page,
        page_size: query.data.page_size,
        search: query.data.search,
      });

      return {
        data: page,
        tenant: session.tenant,
        tenant_slug: session.tenantSlug,
        mode: "documents",
      };
    } catch (error) {
      request.log.error({ error }, "customer purchase document page fetch failed");
      return reply.status(500).send({
        error: toSafeErrorMessage(error),
      });
    }
  },
);

app.get(
  "/api/app/:tenantSlug/reports/purchase_goods_payables/document-detail",
  async (request, reply) => {
    const session = await resolveCustomerSessionBySlug(request.params);
    if (!session.ok) {
      return reply.status(session.statusCode).send({ error: session.error });
    }

    const access = tenantAccessStatus(session.tenant);
    if (!access.enabled) {
      return reply.status(403).send({
        error: access.message,
        tenant_status: session.tenant.status,
      });
    }

    const query = documentDetailQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        error: "Invalid purchase document detail request",
        details: query.error.flatten().fieldErrors,
      });
    }

    if (!query.data.date_from || !query.data.date_to) {
      return reply.status(400).send({
        error: "date_from and date_to are required for purchase document detail.",
      });
    }
    const params = {
      date_from: query.data.date_from,
      date_to: query.data.date_to,
    };
    const rangeError = validateCustomerReportRange(params);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const datasource = await resolveTenantDatasourceConfig(session.tenant.id);
    if (!datasource) {
      return reply.status(400).send({
        error: "Datasource is not configured for this tenant.",
      });
    }

    try {
      const detail = await fetchPurchaseGoodsPayablesDocumentDetail({
        tenant_id: session.tenant.id,
        params,
        datasource,
        doc_no: query.data.doc_no,
      });

      if (!detail) {
        return reply.status(404).send({
          error: "Purchase document not found in the selected period.",
        });
      }

      return {
        data: detail,
        tenant: session.tenant,
        tenant_slug: session.tenantSlug,
      };
    } catch (error) {
      request.log.error({ error }, "customer purchase document detail fetch failed");
      return reply.status(500).send({
        error: toSafeErrorMessage(error),
      });
    }
  },
);

app.get("/api/app/reports/sales_goods_services/latest", async (_request, reply) =>
  reply.status(400).send({
    error:
      "Customer reports require a shop link. Use /api/app/{tenant-slug}/reports/sales_goods_services/latest.",
  }),
);

app.post("/api/tenants/:tenantId/datasource/test", async (request, reply) => {
  return testTenantDatasource(request, reply);
});

async function testTenantDatasource(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const routeParams = tenantParamsSchema.safeParse(request.params);
  if (!routeParams.success) {
    return reply.status(400).send({ error: "Invalid tenant_id" });
  }

  const tenantId = routeParams.data.tenantId;
  const datasource = await resolveTenantDatasourceConfig(tenantId);
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
          ap_supplier: false,
          erp_branch_list: false,
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
}

app.get("/api/operations/status", async () => ({
  data: await buildOperationsStatus({ includeAuditLogs: false }),
}));

app.get("/api/owner/operations/status", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  return {
    data: await buildOperationsStatus({ includeAuditLogs: true }),
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
  const rawBody = (request as FastifyRequestWithRawBody).rawBody ?? "";
  const signature = request.headers["x-line-signature"];
  const signatureValue = Array.isArray(signature) ? signature[0] : signature;
  const webhookConfig = readLineWebhookConfig();

  let webhookTenantId: TenantId | null = null;
  let webhookLineChannelId: string | null = null;
  let signatureVerified = false;

  if (webhookConfig) {
    signatureVerified = verifyLineSignature({
      rawBody,
      channelSecret: webhookConfig.channelSecret,
      signature: signatureValue,
    });
    webhookTenantId = signatureVerified ? readWebhookDiscoveryTenantId() : null;
  }

  if (!signatureVerified) {
    const storedMatch = await findLineChannelForWebhookSignature({
      store: systemStore,
      rawBody,
      signature: signatureValue,
      verify: verifyLineSignature,
    }).catch((error) => {
      request.log.warn(
        { safe_error_message: toSafeErrorMessage(error) },
        "LINE webhook stored secret verification failed",
      );
      return null;
    });
    if (storedMatch) {
      signatureVerified = true;
      webhookTenantId = storedMatch.channel.tenant_id;
      webhookLineChannelId = storedMatch.channel.id;
    }
  }

  if (!webhookConfig && !signatureVerified) {
    request.log.warn("LINE webhook rejected because no channel secret is configured");
    return reply.status(503).send({
      error: "LINE webhook is not configured.",
    });
  }

  if (!signatureVerified || !webhookTenantId) {
    request.log.warn("LINE webhook rejected because signature is invalid");
    return reply.status(401).send({ error: "Invalid LINE signature." });
  }

  const events = normalizeLineWebhookEvents(request.body as { events?: unknown[] });
  await systemStore.saveLineWebhookEvents(events);
  const discoveredTargets = await registerWebhookLineTargets(events, {
    tenantId: webhookTenantId,
    lineChannelId: webhookLineChannelId,
  });

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
        webhook_tenant_id: webhookTenantId,
        line_channel_id: webhookLineChannelId,
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
    recipient_count_estimate:
      body.data.recipient_count_estimate !== undefined
        ? body.data.recipient_count_estimate
        : target.recipient_count_estimate,
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
      recipient_count_estimate: updated.recipient_count_estimate,
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
    recipient_count_estimate:
      body.data.recipient_count_estimate !== undefined
        ? body.data.recipient_count_estimate
        : target.recipient_count_estimate,
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
      recipient_count_estimate: updated.recipient_count_estimate,
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

  const tenant = await getTenantOrNull(target.tenant_id);
  if (!tenant) {
    return reply.status(404).send({ error: "Tenant not found." });
  }
  const access = tenantAccessStatus(tenant);
  if (!access.enabled) {
    return reply.status(403).send({
      error: access.message,
      tenant_status: tenant.status,
    });
  }

  const salesPermission = canAccessLineReport({
    tenantId: target.tenant_id,
    target,
    reportKey: "sales_goods_services",
    action: "receive_morning_brief",
  });
  const purchasePermission = canAccessLineReport({
    tenantId: target.tenant_id,
    target,
    reportKey: "purchase_goods_payables",
    action: "receive_morning_brief",
  });
  if (!salesPermission.allowed && !purchasePermission.allowed) {
    await systemStore.appendAuditLog({
      tenant_id: target.tenant_id,
      actor_id: null,
      action: "line_target_test_denied",
      target_type: "line_target",
      target_id: target.id,
      metadata_json: {
        report_keys: ["sales_goods_services", "purchase_goods_payables"],
        reason: salesPermission.reason,
        target_id_masked: target.target_id_masked,
      },
    });
    return reply.status(403).send({
      error: salesPermission.message,
      reason: salesPermission.reason,
    });
  }

  const [salesSnapshot, purchaseSnapshot] = await Promise.all([
    salesPermission.allowed
      ? systemStore.getLatestSnapshot(
          target.tenant_id,
          "sales_goods_services",
        )
      : Promise.resolve(null),
    purchasePermission.allowed
      ? systemStore.getLatestSnapshot(
          target.tenant_id,
          "purchase_goods_payables",
        )
      : Promise.resolve(null),
  ]);

  if (
    (!salesSnapshot || salesSnapshot.report_key !== "sales_goods_services") &&
    (!purchaseSnapshot ||
      purchaseSnapshot.report_key !== "purchase_goods_payables")
  ) {
    return reply.status(404).send({ error: "Snapshot not found" });
  }

  const openSalesViewerPermission = canAccessLineReport({
    tenantId: target.tenant_id,
    target,
    reportKey: "sales_goods_services",
    action: "open_signed_viewer",
  });
  const salesPreview =
    salesSnapshot?.report_key === "sales_goods_services"
      ? renderSalesGoodsServicesLinePreview({
          snapshot: salesSnapshot,
          dashboardUrl: openSalesViewerPermission.allowed
            ? buildReportViewerUrl(salesSnapshot)
            : null,
          tenantName: getTenantDefinition(target.tenant_id)?.name,
        })
      : null;
  const openPurchaseViewerPermission = canAccessLineReport({
    tenantId: target.tenant_id,
    target,
    reportKey: "purchase_goods_payables",
    action: "open_signed_viewer",
  });
  const purchasePreview =
    purchaseSnapshot?.report_key === "purchase_goods_payables"
      ? renderPurchaseGoodsPayablesLinePreview({
          snapshot: purchaseSnapshot,
          dashboardUrl: openPurchaseViewerPermission.allowed
            ? buildReportViewerUrl(purchaseSnapshot)
            : null,
          tenantName: getTenantDefinition(target.tenant_id)?.name,
        })
      : null;
  const preview = buildMorningBriefCarouselPreview({
    salesPreview,
    purchasePreview,
  });
  const lineConfig = await buildLineChannelConfigForTarget(target);
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
      report_keys: [
        salesPreview ? "sales_goods_services" : null,
        purchasePreview ? "purchase_goods_payables" : null,
      ].filter(Boolean),
      report_run_ids: [
        salesSnapshot?.run_id ?? null,
        purchaseSnapshot?.run_id ?? null,
      ].filter(Boolean),
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

    const snapshot = await systemStore.getLatestSnapshot(
      params.data.tenantId,
      "sales_goods_services",
    );
    if (!snapshot || snapshot.report_key !== "sales_goods_services") {
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

    const tenant = await getTenantOrNull(params.data.tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }
    const access = tenantAccessStatus(tenant);
    if (!access.enabled) {
      return reply.status(403).send({
        error: access.message,
        tenant_status: tenant.status,
      });
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
  "/api/reports/:tenantId/purchase_goods_payables/snapshots/:runId",
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
      reportKey: "purchase_goods_payables",
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

    const tenant = await getTenantOrNull(params.data.tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }
    const access = tenantAccessStatus(tenant);
    if (!access.enabled) {
      return reply.status(403).send({
        error: access.message,
        tenant_status: tenant.status,
      });
    }

    const snapshot = await systemStore.getSnapshotByRunId(
      params.data.tenantId,
      params.data.runId,
      "purchase_goods_payables",
    );
    if (!snapshot) {
      return reply.status(404).send({ error: "Snapshot not found" });
    }

    return { data: snapshot };
  },
);

app.post(
  "/api/reports/:tenantId/:reportKey/viewer-run",
  async (request, reply) => {
    const access = await verifySignedViewerRequest({
      params: request.params,
      queryOrBody: request.body,
      reply,
    });
    if (!access.ok) {
      return access.response;
    }

    const body = viewerRunBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid report date range.",
        details: body.error.flatten().fieldErrors,
      });
    }

    const rangeError = validateViewerReportRange(body.data);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const runResult =
      access.reportKey === "purchase_goods_payables"
        ? await runAndPersistPurchaseGoodsPayablesReport({
            tenantId: access.tenantId,
            params: body.data,
            requestAction: "viewer_purchase_report_run_requested",
          })
        : await runAndPersistSalesGoodsServicesReport({
            tenantId: access.tenantId,
            params: body.data,
            requestAction: "viewer_sales_report_run_requested",
          });

    if (runResult.ok) {
      return { data: runResult.snapshot, run: runResult.runRecord };
    }

    return reply.status(runResult.statusCode).send({
      error: runResult.error,
      run: runResult.runRecord,
    });
  },
);

app.get(
  "/api/reports/:tenantId/:reportKey/viewer-documents",
  async (request, reply) => {
    const access = await verifySignedViewerRequest({
      params: request.params,
      queryOrBody: request.query,
      reply,
    });
    if (!access.ok) {
      return access.response;
    }

    const query = viewerDocumentsQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        error: "Invalid document page request.",
        details: query.error.flatten().fieldErrors,
      });
    }

    const params = {
      date_from: query.data.date_from,
      date_to: query.data.date_to,
    };
    const rangeError = validateViewerReportRange(params);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const datasource = await resolveTenantDatasourceConfig(access.tenantId);
    if (!datasource) {
      return reply.status(400).send({
        error: "Datasource is not configured for this tenant.",
      });
    }

    try {
      const page =
        access.reportKey === "purchase_goods_payables"
          ? await fetchPurchaseGoodsPayablesDocumentPage({
              tenant_id: access.tenantId,
              params,
              datasource,
              page: query.data.page,
              page_size: query.data.page_size,
              search: query.data.search,
            })
          : await fetchSalesGoodsServicesDocumentPage({
              tenant_id: access.tenantId,
              params,
              datasource,
              page: query.data.page,
              page_size: query.data.page_size,
              search: query.data.search,
            });

      return { data: page };
    } catch (error) {
      request.log.error(
        { error, report_key: access.reportKey },
        "signed viewer document page fetch failed",
      );
      return reply.status(500).send({ error: toSafeErrorMessage(error) });
    }
  },
);

app.get(
  "/api/reports/:tenantId/:reportKey/viewer-document-detail",
  async (request, reply) => {
    const access = await verifySignedViewerRequest({
      params: request.params,
      queryOrBody: request.query,
      reply,
    });
    if (!access.ok) {
      return access.response;
    }

    const query = viewerDocumentDetailQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        error: "Invalid document detail request.",
        details: query.error.flatten().fieldErrors,
      });
    }

    const params = {
      date_from: query.data.date_from,
      date_to: query.data.date_to,
    };
    const rangeError = validateViewerReportRange(params);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const datasource = await resolveTenantDatasourceConfig(access.tenantId);
    if (!datasource) {
      return reply.status(400).send({
        error: "Datasource is not configured for this tenant.",
      });
    }

    try {
      const detail =
        access.reportKey === "purchase_goods_payables"
          ? await fetchPurchaseGoodsPayablesDocumentDetail({
              tenant_id: access.tenantId,
              params,
              datasource,
              doc_no: query.data.doc_no,
            })
          : await fetchSalesGoodsServicesDocumentDetail({
              tenant_id: access.tenantId,
              params,
              datasource,
              doc_no: query.data.doc_no,
            });

      if (!detail) {
        return reply.status(404).send({
          error: "Document not found in the selected report period.",
        });
      }

      return { data: detail };
    } catch (error) {
      request.log.error(
        { error, report_key: access.reportKey },
        "signed viewer document detail fetch failed",
      );
      return reply.status(500).send({ error: toSafeErrorMessage(error) });
    }
  },
);

app.get(
  "/api/reports/:tenantId/:reportKey/pdf",
  async (request, reply) => {
    const access = await verifySignedViewerRequest({
      params: request.params,
      queryOrBody: request.query,
      reply,
    });
    if (!access.ok) {
      return access.response;
    }

    const query = viewerPdfQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        error: "Invalid PDF export request.",
        details: query.error.flatten().fieldErrors,
      });
    }

    const params = {
      date_from: query.data.date_from,
      date_to: query.data.date_to,
    };
    const rangeError = validateViewerReportRange(params);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const tenant = await getTenantOrNull(access.tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }
    const tenantAccess = tenantAccessStatus(tenant);
    if (!tenantAccess.enabled) {
      return reply.status(403).send({
        error: tenantAccess.message,
        tenant_status: tenant.status,
      });
    }

    const snapshot = await systemStore.getSnapshotByRunId(
      access.tenantId,
      access.runId,
      access.reportKey,
    );
    if (!snapshot) {
      return reply.status(404).send({ error: "Snapshot not found" });
    }

    const tenantSlug = getTenantSlug(access.tenantId);
    const cachedPdf = await readCachedReportPdf({
      tenantId: access.tenantId,
      tenantSlug,
      reportKey: access.reportKey,
      runId: access.runId,
      dateFrom: params.date_from,
      dateTo: params.date_to,
    });
    if (cachedPdf) {
      request.log.info(
        {
          tenant_id: access.tenantId,
          report_key: access.reportKey,
          run_id: access.runId,
          date_from: params.date_from,
          date_to: params.date_to,
          cache_hit: true,
        },
        "signed viewer pdf export cache hit",
      );
      return reply
        .header("content-type", "application/pdf")
        .header(
          "content-disposition",
          `attachment; filename="${cachedPdf.filename}"`,
        )
        .header("cache-control", "no-store, no-cache, must-revalidate, private")
        .header("pragma", "no-cache")
        .header("expires", "0")
        .header("content-length", String(cachedPdf.pdf.length))
        .send(cachedPdf.pdf);
    }

    const datasource = await resolveTenantDatasourceConfig(access.tenantId);
    if (!datasource) {
      return reply.status(400).send({
        error: "Datasource is not configured for this tenant.",
      });
    }

    try {
      const rows =
        access.reportKey === "purchase_goods_payables"
          ? await fetchPurchaseGoodsPayablesPdfRows({
              tenant_id: access.tenantId,
              params,
              datasource,
            })
          : await fetchSalesGoodsServicesPdfRows({
              tenant_id: access.tenantId,
              params,
              datasource,
            });
      const limit = validateReportPdfLimits({
        documentCount: rows.documents.length,
        detailRowCount: rows.lines.length,
      });
      if (!limit.ok) {
        return reply.status(limit.statusCode).send({ error: limit.error });
      }

      const pdf = await buildReportPdf({
        tenantName: getTenantDefinition(access.tenantId)?.name,
        tenantSlug,
        snapshot,
        rows,
        tokenRunId: access.runId,
        params,
      });
      request.log.info(
        {
          tenant_id: access.tenantId,
          report_key: access.reportKey,
          run_id: access.runId,
          date_from: params.date_from,
          date_to: params.date_to,
          document_count: rows.documents.length,
          detail_row_count: rows.lines.length,
          cache_hit: pdf.cacheHit,
        },
        "signed viewer pdf export completed",
      );

      return reply
        .header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="${pdf.filename}"`)
        .header("cache-control", "no-store, no-cache, must-revalidate, private")
        .header("pragma", "no-cache")
        .header("expires", "0")
        .header("content-length", String(pdf.pdf.length))
        .send(pdf.pdf);
    } catch (error) {
      request.log.error(
        {
          error,
          tenant_id: access.tenantId,
          report_key: access.reportKey,
          run_id: access.runId,
          date_from: params.date_from,
          date_to: params.date_to,
        },
        "signed viewer pdf export failed",
      );
      return reply.status(500).send({ error: toSafeErrorMessage(error) });
    }
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

    const snapshot = await systemStore.getLatestSnapshot(
      params.data.tenantId,
      "sales_goods_services",
    );
    if (!snapshot || snapshot.report_key !== "sales_goods_services") {
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

app.get(
  "/api/reports/:tenantId/purchase_goods_payables/latest",
  async (request, reply) => {
    const params = tenantParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const snapshot = await systemStore.getLatestSnapshot(
      params.data.tenantId,
      "purchase_goods_payables",
    );
    if (!snapshot) {
      return reply.status(404).send({ error: "Purchase snapshot not found" });
    }

    return { data: snapshot };
  },
);

app.get(
  "/api/reports/:tenantId/purchase_goods_payables/line-preview",
  async (request, reply) => {
    const params = tenantParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const snapshot = await systemStore.getLatestSnapshot(
      params.data.tenantId,
      "purchase_goods_payables",
    );
    if (!snapshot || snapshot.report_key !== "purchase_goods_payables") {
      return reply.status(404).send({ error: "Purchase snapshot not found" });
    }

    return {
      data: renderPurchaseGoodsPayablesLinePreview({
        snapshot,
        dashboardUrl: buildReportViewerUrl(snapshot),
        tenantName: getTenantDefinition(params.data.tenantId)?.name,
      }),
    };
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
    const tenant = await getTenantOrNull(tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }
    const access = tenantAccessStatus(tenant);
    if (!access.enabled) {
      return reply.status(403).send({
        error: access.message,
        tenant_status: tenant.status,
      });
    }

    const snapshot = await systemStore.getLatestSnapshot(
      tenantId,
      "sales_goods_services",
    );
    if (!snapshot || snapshot.report_key !== "sales_goods_services") {
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
    const tenant = await getTenantOrNull(tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }
    const access = tenantAccessStatus(tenant);
    if (!access.enabled) {
      await systemStore.appendAuditLog({
        tenant_id: tenantId,
        actor_id: null,
        action: "morning_brief_skipped_subscription",
        target_type: "tenant",
        target_id: tenantId,
        metadata_json: {
          status: tenant.status,
          reason: access.message,
        },
      });
      return reply.status(403).send({
        error: access.message,
        tenant_status: tenant.status,
      });
    }
    const reportParams = deriveMorningBriefDateRange({
      period: body.data.period,
      timeZone: "Asia/Bangkok",
    });
    const purchaseReportParams = derivePurchaseMorningBriefDateRange();
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

    const purchaseRunResult = await runAndPersistPurchaseGoodsPayablesReport({
      tenantId,
      params: purchaseReportParams,
      requestAction: "morning_brief_purchase_report_run_requested",
    });
    const purchaseSnapshot = purchaseRunResult.ok
      ? purchaseRunResult.snapshot
      : null;

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

      const receiveSalesPermission = canAccessLineReport({
        tenantId,
        target,
        reportKey: "sales_goods_services",
        action: "receive_morning_brief",
      });
      const receivePurchasePermission = canAccessLineReport({
        tenantId,
        target,
        reportKey: "purchase_goods_payables",
        action: "receive_morning_brief",
      });
      if (!receiveSalesPermission.allowed && !receivePurchasePermission.allowed) {
        const skippedDelivery = createSkippedLineDelivery({
          tenantId,
          snapshot: runResult.snapshot,
          target,
          deliveryKey,
          reportParams,
          safeErrorMessage: receiveSalesPermission.message,
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
              reason: receiveSalesPermission.reason,
              period: reportParams,
              target_id_masked: target.target_id_masked,
              target_id_hash: target.target_id_hash,
          },
        });
        continue;
      }

      const openSalesViewerPermission = canAccessLineReport({
        tenantId,
        target,
        reportKey: "sales_goods_services",
        action: "open_signed_viewer",
      });
      const salesPreview = receiveSalesPermission.allowed
        ? renderSalesGoodsServicesLinePreview({
            snapshot: runResult.snapshot,
            dashboardUrl: openSalesViewerPermission.allowed
              ? buildReportViewerUrl(runResult.snapshot)
              : null,
            tenantName: getTenantDefinition(tenantId)?.name,
          })
        : null;
      const openPurchaseViewerPermission = canAccessLineReport({
        tenantId,
        target,
        reportKey: "purchase_goods_payables",
        action: "open_signed_viewer",
      });
      const purchasePreview =
        purchaseSnapshot && receivePurchasePermission.allowed
          ? renderPurchaseGoodsPayablesLinePreview({
              snapshot: purchaseSnapshot,
              dashboardUrl: openPurchaseViewerPermission.allowed
                ? buildReportViewerUrl(purchaseSnapshot)
                : null,
              tenantName: getTenantDefinition(tenantId)?.name,
            })
          : null;
      preview = buildMorningBriefCarouselPreview({
        salesPreview,
        purchasePreview,
      });
      const delivery = await sendLineBrief({
        tenantId,
        mode: body.data.mode,
        preview,
        config: await buildLineChannelConfigForTarget(target),
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

app.post(
  "/api/reports/:tenantId/purchase_goods_payables/run",
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
        error: "Invalid purchase report params",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenantId = routeParams.data.tenantId;
    const runResult = await runAndPersistPurchaseGoodsPayablesReport({
      tenantId,
      params: body.data,
      requestAction: "purchase_report_run_requested",
    });

    if (runResult.ok) {
      return { data: runResult.snapshot, run: runResult.runRecord };
    }

    if (runResult.statusCode === 500) {
      request.log.error(
        { safe_error_message: runResult.runRecord.safe_error_message },
        "purchase_goods_payables run failed",
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
  const datasource = await resolveTenantDatasourceConfig(input.tenantId);
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

async function runAndPersistPurchaseGoodsPayablesReport(input: {
  tenantId: TenantId;
  params: SalesGoodsServicesParams;
  requestAction: string;
}): Promise<
  | {
      ok: true;
      snapshot: PurchaseGoodsPayablesSnapshot;
      runRecord: ReportRunRecord;
    }
  | {
      ok: false;
      statusCode: 424 | 500;
      error: string;
      runRecord: ReportRunRecord;
    }
> {
  const datasource = await resolveTenantDatasourceConfig(input.tenantId);
  const runRecord: ReportRunRecord = {
    id: createRunId(input.tenantId, "purchase"),
    tenant_id: input.tenantId,
    report_key: "purchase_goods_payables",
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
      report_key: "purchase_goods_payables",
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
    const snapshot = await runPurchaseGoodsPayablesReport({
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
      action: "purchase_report_run_succeeded",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: "purchase_goods_payables",
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
      action: "purchase_report_run_failed",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: "purchase_goods_payables",
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
  datasource: DatasourceConfig;
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
    await closeReportPdfBrowser();
    await systemStore.close();
    process.exit(0);
  });
}

function createRunId(tenantId: string, reportSlug = "sales") {
  return reportSlug === "sales"
    ? `run_${tenantId}_${Date.now()}`
    : `run_${tenantId}_${reportSlug}_${Date.now()}`;
}

function createCustomerPreviewRunId(tenantId: string) {
  return `preview_${tenantId}_${Date.now()}`;
}

function buildDashboardUrl() {
  const baseUrl = process.env.APP_BASE_URL?.trim();
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl.replace(/\/$/, "")}/command-center`;
}

async function buildOperationsStatus(input: { includeAuditLogs: boolean }) {
  const latestHeartbeat = await systemStore.getLatestWorkerHeartbeat(
    "morning_brief_scheduler",
  );
  const tenants = await systemStore.listTenants();
  const auditLogs = input.includeAuditLogs
    ? await systemStore.listAuditLogs(30)
    : [];
  const heartbeatAgeSeconds = latestHeartbeat
    ? Math.floor(
        (Date.now() - new Date(latestHeartbeat.checked_at).getTime()) / 1000,
      )
    : null;
  const heartbeatFresh =
    heartbeatAgeSeconds !== null &&
    heartbeatAgeSeconds >= 0 &&
    heartbeatAgeSeconds <= 120;
  const tenantHealth = await Promise.all(
    tenants.map(async (tenant) => {
      const lineChannels = await listEffectiveLineChannels(tenant.id);
      const lineTargets = await listEffectiveLineTargets(tenant.id);
      const envLineConfig = readLineChannelConfig(tenant.id);
      return {
        id: tenant.id,
        name: tenant.name,
        database_name: tenant.databaseName,
        status: tenant.status,
        plan_code: tenant.planCode,
        datasource_configured: tenant.datasourceConfigured,
        line_configured:
          lineChannels.some(
            (channel) =>
              channel.enabled && channel.channel_access_token_configured,
          ) || Boolean(envLineConfig),
        line_target_masked:
          lineTargets.find((target) => target.enabled && target.approved)
            ?.target_id_masked ??
          (envLineConfig ? maskIdentifier(envLineConfig.targetId) : null),
      };
    }),
  );

  return {
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
      status: latestHeartbeat
        ? heartbeatFresh
          ? latestHeartbeat.status
          : "stale"
        : "missing",
    },
    backup: {
      system_store: systemStore.kind,
      configured: readBoolean(process.env.SYSTEM_BACKUP_CONFIGURED, false),
      last_backup_at: process.env.SYSTEM_LAST_BACKUP_AT?.trim() || null,
      recommendation:
        "ก่อน production ควรตั้ง cron pg_dump, เก็บไฟล์นอกเครื่อง และทดสอบ restore รายสัปดาห์",
    },
    audit_logs: auditLogs,
    tenants: tenantHealth,
  };
}

function buildReportViewerUrl(snapshot: ReportSnapshot) {
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
    url.searchParams.set("report_key", snapshot.report_key);
    url.searchParams.set("run_id", snapshot.run_id);
    url.searchParams.set("token", token);
    url.searchParams.set("openExternalBrowser", "1");
    return url.toString();
  } catch {
    return null;
  }
}

function buildMorningBriefCarouselPreview(input: {
  salesPreview: ReportLinePreview | null;
  purchasePreview: ReportLinePreview | null;
}): ReportLinePreview {
  const previews = [input.salesPreview, input.purchasePreview].filter(
    (preview): preview is ReportLinePreview => Boolean(preview),
  );
  const primaryPreview = previews[0];
  if (!primaryPreview) {
    throw new Error("At least one report preview is required.");
  }
  const flexBubbles = previews
    .map((preview) => preview.flex_message?.contents)
    .filter((contents): contents is Record<string, unknown> => Boolean(contents));
  const flexMessage =
    flexBubbles.length === previews.length && flexBubbles.length > 1
      ? {
          type: "flex" as const,
          altText: "AI Business Morning Brief: รายงานขายและรายงานซื้อ",
          contents: {
            type: "carousel",
            contents: flexBubbles,
          },
        }
      : primaryPreview.flex_message;

  return {
    ...primaryPreview,
    line_message_type: flexMessage ? "flex" : "text",
    title: "AI Business Morning Brief",
    text: previews.map((preview) => preview.text).join("\n\n---\n\n"),
    lines: previews.flatMap((preview, index) =>
      index === 0 ? preview.lines : ["", "---", "", ...preview.lines],
    ),
    flex_message: flexMessage,
    warnings: previews.flatMap((preview) => preview.warnings),
  };
}

async function buildOwnerTenantSummary(tenantId: TenantId) {
  const tenants = await systemStore.listTenants();
  const tenant = tenants.find((item) => item.id === tenantId);
  if (!tenant) {
    return null;
  }

  const [snapshot, runs, deliveries, lineTargets, lineChannels, users] =
    await Promise.all([
      systemStore.getLatestSnapshot(tenantId),
      systemStore.listRuns(tenantId),
      systemStore.listLineDeliveries(tenantId),
      systemStore.listLineTargets(tenantId),
      listEffectiveLineChannels(tenantId),
      systemStore.listUsers(tenantId),
    ]);
  const latestRun = runs[0] ?? null;
  const latestDelivery = deliveries[0] ?? null;
  const enabledTargets = lineTargets.filter(
    (target) =>
      target.approved &&
      target.enabled &&
      target.allowed_actions.includes("receive_morning_brief"),
  );
  const access = tenantAccessStatus(tenant);
  const customerDashboardSlug = getTenantSlug(tenant.id);

  return {
    tenant,
    customer_dashboard_path: customerDashboardSlug
      ? `/app/${customerDashboardSlug}`
      : null,
    access,
    health: {
      datasource_configured: tenant.datasourceConfigured,
      line_channels: lineChannels.length,
      line_targets_total: lineTargets.length,
      line_targets_enabled: enabledTargets.length,
      users: users.filter((user) => user.enabled).length,
      latest_report_run_at: latestRun?.finished_at ?? latestRun?.started_at ?? null,
      latest_report_status: latestRun?.status ?? null,
      latest_snapshot_at: snapshot?.generated_at ?? null,
      latest_line_delivery_at: latestDelivery?.sent_at ?? latestDelivery?.created_at ?? null,
      latest_line_delivery_status: latestDelivery?.status ?? null,
    },
  };
}

async function listEffectiveLineChannels(tenantId?: TenantId) {
  const storedChannels = await systemStore.listLineChannels(tenantId);
  const tenantIds = tenantId
    ? [tenantId]
    : (await systemStore.listTenants()).map((tenant) => tenant.id);
  const envChannels = tenantIds
    .map((id) => buildEnvLineChannel(id))
    .filter((channel): channel is LineChannelRecord => Boolean(channel));

  return [
    ...storedChannels,
    ...envChannels.filter(
      (envChannel) =>
        !storedChannels.some(
          (stored) =>
            stored.tenant_id === envChannel.tenant_id &&
            stored.source === envChannel.source &&
            stored.display_name === envChannel.display_name,
        ),
    ),
  ];
}

function buildEnvLineChannel(tenantId: TenantId): LineChannelRecord | null {
  const credentials = readLineChannelCredentials(tenantId);
  if (!credentials) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: `line_channel_env_${tenantId}`,
    tenant_id: tenantId,
    display_name: "LINE OA จาก environment",
    channel_type: "line_oa",
    channel_access_token_configured: true,
    channel_secret_configured: Boolean(readLineWebhookConfig()),
    enabled: true,
    source: "env",
    created_at: now,
    updated_at: now,
  };
}

function tenantAccessStatus(tenant: { status: string }) {
  if (tenant.status === "suspended") {
    return {
      enabled: false,
      status: tenant.status,
      message: "บัญชีร้านค้านี้ถูกระงับ กรุณาติดต่อผู้ดูแลระบบ",
    };
  }

  if (tenant.status === "cancelled") {
    return {
      enabled: false,
      status: tenant.status,
      message: "บัญชีร้านค้านี้ถูกยกเลิก กรุณาติดต่อผู้ดูแลระบบ",
    };
  }

  if (tenant.status === "past_due") {
    return {
      enabled: true,
      status: tenant.status,
      message: "บัญชีนี้มียอดค้างชำระ แต่ยังอยู่ในช่วงผ่อนผัน",
    };
  }

  return {
    enabled: true,
    status: tenant.status,
    message: "บัญชีพร้อมใช้งาน",
  };
}

async function getTenantOrNull(tenantId: TenantId) {
  return (
    (await systemStore.listTenants()).find((tenant) => tenant.id === tenantId) ??
    null
  );
}

async function resolveTenantDatasourceConfig(tenantId: TenantId) {
  const storedConfig = await readStoredDatasourceConfig({
      store: systemStore,
      tenantId,
    }).catch(() => null);
  return storedConfig ?? readDatasourceConfig(tenantId);
}

async function resolveCustomerSessionBySlug(params: unknown) {
  const parsed = tenantSlugParamsSchema.safeParse(params);
  if (!parsed.success) {
    return {
      ok: false as const,
      statusCode: 404,
      error: "Customer dashboard link not found.",
    };
  }

  const tenantId = resolveTenantIdFromSlug(parsed.data.tenantSlug);
  if (!tenantId) {
    return {
      ok: false as const,
      statusCode: 404,
      error: "Customer dashboard link not found.",
    };
  }

  const tenant = await getTenantOrNull(tenantId);
  if (!tenant) {
    return {
      ok: false as const,
      statusCode: 404,
      error: "Customer tenant not found.",
    };
  }

  return {
    ok: true as const,
    tenant,
    tenantSlug: parsed.data.tenantSlug,
  };
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
      config: await buildLineChannelConfigForTarget(target),
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

async function registerWebhookLineTargets(
  events: ReturnType<typeof normalizeLineWebhookEvents>,
  input?: { tenantId?: TenantId; lineChannelId?: string | null },
) {
  const tenantId = input?.tenantId ?? readWebhookDiscoveryTenantId();
  const discovered: StoredLineTargetRecord[] = [];
  const seenHashes = new Set<string>();

  for (const event of events) {
    const pendingTarget = buildPendingWebhookLineTarget({
      tenantId,
      event,
      lineChannelId: input?.lineChannelId ?? null,
    });
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
      config: await buildLineChannelConfigForTarget(pendingTarget),
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

async function buildLineChannelConfigForTarget(
  target: StoredLineTargetRecord,
): Promise<LineChannelConfig | null> {
  const storedCredentials = await readStoredLineChannelCredentials({
    store: systemStore,
    tenantId: target.tenant_id,
    preferredLineChannelId: target.line_channel_id,
  }).catch(() => null);
  if (storedCredentials) {
    return {
      channelAccessToken: storedCredentials.channelAccessToken,
      targetId: target.target_id,
      targetType: target.target_type,
    };
  }

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
  const base = `${tenantId}:morning_brief:v2:${params.date_from}:${params.date_to}`;
  return targetIdHash ? `${base}:${targetIdHash.slice(0, 16)}` : base;
}

function derivePurchaseMorningBriefDateRange(input?: { now?: Date }) {
  const currentYmd = formatDateInBangkok(input?.now ?? new Date());
  const yesterday = addDays(currentYmd, -1);
  return {
    date_from: `${yesterday.slice(0, 8)}01`,
    date_to: yesterday,
  };
}

function formatDateInBangkok(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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

function validateCustomerReportRange(params: SalesGoodsServicesParams) {
  const start = Date.parse(`${params.date_from}T00:00:00.000Z`);
  const end = Date.parse(`${params.date_to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "Invalid report date range.";
  }

  const inclusiveDays = Math.floor((end - start) / 86_400_000) + 1;
  if (inclusiveDays > 31) {
    return "Customer report date range is limited to 31 days for this pilot.";
  }

  return null;
}

function validateViewerReportRange(params: SalesGoodsServicesParams) {
  const parsed = salesGoodsServicesParamsSchema.safeParse(params);
  if (!parsed.success) {
    return "Invalid report date range.";
  }

  const start = Date.parse(`${params.date_from}T00:00:00.000Z`);
  const end = Date.parse(`${params.date_to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "Invalid report date range.";
  }

  const inclusiveDays = Math.floor((end - start) / 86_400_000) + 1;
  if (inclusiveDays > 366) {
    return "Report viewer date range is limited to 366 days for this pilot.";
  }

  return null;
}

async function verifySignedViewerRequest(input: {
  params: unknown;
  queryOrBody: unknown;
  reply: FastifyReply;
}): Promise<
  | {
      ok: true;
      tenantId: TenantId;
      reportKey: ReportKey;
      runId: string;
    }
  | { ok: false; response: FastifyReply }
> {
  const params = signedViewerParamsSchema.safeParse(input.params);
  if (!params.success) {
    return {
      ok: false,
      response: input.reply
        .status(400)
        .send({ error: "Invalid report viewer link." }),
    };
  }

  const auth = signedViewerAuthSchema.safeParse(input.queryOrBody ?? {});
  if (!auth.success) {
    return {
      ok: false,
      response: input.reply
        .status(400)
        .send({ error: "Invalid report viewer link." }),
    };
  }

  const signingSecret = readReportViewerSigningSecret();
  if (!signingSecret) {
    return {
      ok: false,
      response: input.reply.status(503).send({
        error: "Report viewer signing is not configured.",
      }),
    };
  }

  const verification = verifyReportViewerToken({
    token: auth.data.token,
    secret: signingSecret,
    tenantId: params.data.tenantId,
    reportKey: params.data.reportKey,
    runId: auth.data.run_id,
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
    return {
      ok: false,
      response: input.reply.status(statusCode).send({ error: errorMessage }),
    };
  }

  const tenant = await getTenantOrNull(params.data.tenantId);
  if (!tenant) {
    return {
      ok: false,
      response: input.reply.status(404).send({ error: "Tenant not found." }),
    };
  }
  const access = tenantAccessStatus(tenant);
  if (!access.enabled) {
    return {
      ok: false,
      response: input.reply.status(403).send({
        error: access.message,
        tenant_status: tenant.status,
      }),
    };
  }

  return {
    ok: true,
    tenantId: params.data.tenantId,
    reportKey: params.data.reportKey,
    runId: auth.data.run_id,
  };
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

const tenantSlugParamsSchema = z.object({
  tenantSlug: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
});

const signedSnapshotParamsSchema = z.object({
  tenantId: tenantIdSchema,
  runId: z.string().min(1).max(180),
});

const signedSnapshotQuerySchema = z.object({
  token: z.string().min(1).max(4096),
});

const signedViewerParamsSchema = z.object({
  tenantId: tenantIdSchema,
  reportKey: reportKeySchema,
});

const signedViewerAuthSchema = z.object({
  token: z.string().min(1).max(4096),
  run_id: z.string().min(1).max(180),
});

const viewerRunBodySchema = signedViewerAuthSchema
  .extend({
    date_from: isoDateSchema,
    date_to: isoDateSchema,
  })
  .superRefine((value, ctx) => {
    const parsed = salesGoodsServicesParamsSchema.safeParse({
      date_from: value.date_from,
      date_to: value.date_to,
    });
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid date range",
        path: ["date_from"],
      });
    }
  });

const documentDetailQuerySchema = z.object({
  doc_no: z.string().trim().min(1).max(120),
  date_from: isoDateSchema.optional(),
  date_to: isoDateSchema.optional(),
}).superRefine((value, ctx) => {
  if (Boolean(value.date_from) !== Boolean(value.date_to)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "date_from and date_to must be provided together",
      path: value.date_from ? ["date_to"] : ["date_from"],
    });
  }

  if (value.date_from && value.date_to) {
    const parsed = salesGoodsServicesParamsSchema.safeParse({
      date_from: value.date_from,
      date_to: value.date_to,
    });
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid date range",
        path: ["date_from"],
      });
    }
  }
});

const customerReportRangeQuerySchema = salesGoodsServicesParamsSchema;

const customerDocumentsPageQuerySchema = z.object({
  date_from: isoDateSchema,
  date_to: isoDateSchema,
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  page_size: z.coerce.number().int().min(5).max(50).optional().default(10),
  search: z.string().trim().max(120).optional().default(""),
}).superRefine((value, ctx) => {
  const parsed = salesGoodsServicesParamsSchema.safeParse({
    date_from: value.date_from,
    date_to: value.date_to,
  });
  if (!parsed.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid date range",
      path: ["date_from"],
    });
  }
});

const viewerDocumentsBaseSchema = signedViewerAuthSchema.extend({
  date_from: isoDateSchema,
  date_to: isoDateSchema,
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  page_size: z.coerce.number().int().min(5).max(50).optional().default(10),
  search: z.string().trim().max(120).optional().default(""),
});

const viewerDocumentsQuerySchema = viewerDocumentsBaseSchema.superRefine(
  (value, ctx) => {
    const parsed = salesGoodsServicesParamsSchema.safeParse({
      date_from: value.date_from,
      date_to: value.date_to,
    });
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid date range",
        path: ["date_from"],
      });
    }
  },
);

const viewerDocumentDetailQuerySchema = viewerDocumentsBaseSchema
  .extend({
    doc_no: z.string().trim().min(1).max(120),
  })
  .superRefine((value, ctx) => {
    const parsed = salesGoodsServicesParamsSchema.safeParse({
      date_from: value.date_from,
      date_to: value.date_to,
    });
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid date range",
        path: ["date_from"],
      });
    }
  });

const viewerPdfQuerySchema = signedViewerAuthSchema
  .extend({
    date_from: isoDateSchema,
    date_to: isoDateSchema,
  })
  .superRefine((value, ctx) => {
    const parsed = salesGoodsServicesParamsSchema.safeParse({
      date_from: value.date_from,
      date_to: value.date_to,
    });
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid date range",
        path: ["date_from"],
      });
    }
  });

const lineWebhookEventsQuerySchema = z.object({
  reveal: z.enum(["0", "1"]).optional().default("0"),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

const lineTargetsQuerySchema = z.object({
  tenant_id: tenantIdSchema.optional(),
});

const lineChannelsQuerySchema = z.object({
  tenant_id: tenantIdSchema.optional(),
});

const ownerTenantCreateSchema = z.object({
  tenant_id: tenantIdSchema,
  name: z.string().trim().min(2).max(120),
  database_name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
  status: tenantStatusSchema.default("trial"),
  plan_code: planCodeSchema.default("starter"),
  current_period_end: z.string().datetime().nullable().optional(),
  viewer_email: z.string().email().optional(),
});

const ownerTenantPatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  database_name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
  datasource_configured: z.boolean().optional(),
  status: tenantStatusSchema.optional(),
  plan_code: planCodeSchema.optional(),
  current_period_end: z.string().datetime().nullable().optional(),
  suspended_reason: z.string().trim().max(500).nullable().optional(),
});

const lineChannelCreateSchema = z.object({
  tenant_id: tenantIdSchema,
  display_name: z.string().trim().min(2).max(120),
  channel_access_token_configured: z.boolean().optional().default(false),
  channel_secret_configured: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
});

const lineChannelParamsSchema = z.object({
  id: z.string().trim().min(1).max(180),
});

const lineChannelSecretsUpdateSchema = z
  .object({
    channel_access_token: z.string().trim().min(1).max(4096).optional(),
    channel_secret: z.string().trim().min(1).max(512).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.channel_access_token && !value.channel_secret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one LINE secret must be provided",
        path: ["channel_access_token"],
      });
    }
  });

const datasourceConfigUpdateSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().trim().min(1).max(120),
  user: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(1024),
});

const reportValidationSignoffSchema = z.object({
  run_id: z.string().trim().min(1).max(160),
  date_from: isoDateSchema,
  date_to: isoDateSchema,
  system_total: z.coerce.number().finite(),
  reference_total: z.coerce.number().finite(),
  signed_by: z.string().trim().min(2).max(120),
  note: z.string().trim().max(500).optional(),
});

const lineTargetParamsSchema = z.object({
  id: z.string().min(1).max(160),
});

const lineTargetApproveSchema = z.object({
  access_profile_key: lineAccessProfileKeySchema.optional(),
  display_name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  recipient_count_estimate: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .nullable()
    .optional(),
});

const lineTargetPatchSchema = z.object({
  display_name: z.string().trim().min(1).max(120).optional(),
  access_profile_key: lineAccessProfileKeySchema.optional(),
  enabled: z.boolean().optional(),
  approved: z.boolean().optional(),
  allowed_report_keys: z.array(reportKeySchema).optional(),
  allowed_actions: z.array(allowedLineActionSchema).optional(),
  recipient_count_estimate: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .nullable()
    .optional(),
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
