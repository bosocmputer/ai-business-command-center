import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BANGKOK_TIME_ZONE,
  buildNotificationIdempotencyKey,
  deriveNotificationPeriodRange,
  deriveMorningBriefDateRange,
  getDueNotificationRuleTimes,
  getNextNotificationRunAt,
  getZonedDateTimeParts,
  allowedLineActionSchema,
  lineSendRequestSchema,
  lineAccessProfileKeySchema,
  tenantReportRolePermissionsPayloadSchema,
  type LineDeliveryRecord,
  type BusinessSignalRecord,
  type LineChannelRecord,
  type LineAccessProfileKey,
  type LineRecipientRecord,
  type LineSendMode,
  type GrossProfitByArCustomerSnapshot,
  type GrossProfitByProductSnapshot,
  morningBriefRequestSchema,
  notificationPeriodPresetSchema,
  notificationRulePayloadSchema,
  planCodeSchema,
  getReportCatalogEntry,
  reportKeySchema,
  type NotificationRuleRecord,
  type NotificationRuleRunRecord,
  type PurchaseGoodsPayablesSnapshot,
  type ReportKey,
  type ReportLinePreview,
  type ReportSnapshot,
  type ReportRunRecord,
  type SalesGoodsServicesSnapshot,
  type SalesGoodsServicesParams,
  type StockBalanceSnapshot,
  type StockReorderSnapshot,
  isoDateSchema,
  localTimeSchema,
  salesGoodsServicesParamsSchema,
  tenantIdSchema,
  tenantStatusSchema,
  type Tenant,
  type TenantId,
  type TenantReportRolePermissionRecord,
  type UserRecord,
  businessSignalStatusSchema,
  businessSignalThresholdsSchema,
  notificationDigestModeSchema,
  notificationPeriodStrategySchema,
  tenantFeatureFlagsSchema,
} from "@ai-bcc/shared";
import {
  getApiConfig,
  getTenantDefinition,
  getTenantSlug,
  listTenants,
  type DatasourceConfig,
  type JavaWsDatasourceConfig,
  type LineChannelConfig,
  readDatasourceConfig,
  resolveTenantIdFromSlug,
} from "./config.js";
import {
  countPurchaseGoodsPayablesPdfRows,
  countSalesGoodsServicesPdfRows,
  fetchSalesGoodsServicesDocumentDetail,
  fetchSalesGoodsServicesDocumentPage,
  fetchSalesGoodsServicesPdfRows,
  fetchPurchaseGoodsPayablesDocumentDetail,
  fetchPurchaseGoodsPayablesDocumentPage,
  fetchPurchaseGoodsPayablesPdfRows,
  runGrossProfitByArCustomerReport,
  runGrossProfitByProductReport,
  runPurchaseGoodsPayablesReport,
  runSalesGoodsServicesReport,
  runStockBalanceReport,
  runStockReorderReport,
  testDatasourceConnection,
  toSafeDatasourceErrorMessage,
  toSafeErrorMessage,
} from "./report-runner.js";
import {
  REPORT_PDF_LAYOUT_VERSION,
  buildReportPdf,
  buildReportPdfCacheKey,
  cleanupReportPdfCache,
  closeReportPdfBrowser,
  readCachedReportPdf,
  validateReportPdfLimits,
} from "./report-pdf-export.js";
import { decryptSecret, encryptSecret } from "./secret-vault.js";
import {
  buildBusinessSignalDigestPreview,
  buildBusinessSignalsForSnapshots,
  buildReportFailureBusinessSignal,
  selectBusinessSignalDigestIssues,
  renderGrossProfitLinePreview,
  renderPurchaseGoodsPayablesLinePreview,
  renderSalesGoodsServicesLinePreview,
} from "@ai-bcc/reports";
import { createSystemStore, type SecretRecord } from "./system-store.js";
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
import {
  OWNER_AUTH_COOKIE,
  verifyOwnerSessionCookie,
} from "./owner-session-auth.js";
import {
  applyLineAccessProfileDefaults,
  buildAssignedLineTarget,
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
import {
  readEffectiveSystemRuntimeConfig,
  readSystemRuntimeConfigStatus,
  saveSystemRuntimeConfig,
} from "./system-runtime-config.js";
import { listJavaWsDatabases } from "./sml-javaws-client.js";
import {
  createReportRuntimeRegistry,
  getReportRuntimeEntry,
  renderReportLinePreview,
  runReportRuntimeEntry,
} from "./report-registry.js";

const app = Fastify({
  logger: {
    level: "info",
    redact: [
      "req.url",
      "req.headers.authorization",
      "*.password",
    ],
  },
});

await app.register(cors, {
  origin: true,
});

await app.register(cookie);

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
const lineAccessProfileKeys: LineAccessProfileKey[] = [
  "executive",
  "sales_manager",
  "operations",
  "staff",
];
const reportRuntimeRegistry = createReportRuntimeRegistry({
  runSalesGoodsServicesReport: runAndPersistSalesGoodsServicesReport,
  runPurchaseGoodsPayablesReport: runAndPersistPurchaseGoodsPayablesReport,
  runGrossProfitReport: runAndPersistGrossProfitReport,
  runStockBalanceReport: runAndPersistStockBalanceReport,
  runStockReorderReport: runAndPersistStockReorderReport,
});

await systemStore.initialize({
  tenants: listTenants(),
  reportDefinitions: reportDefinitionSeeds,
});
await backfillTenantReportRolePermissions();
cleanupReportPdfCache().catch((error) => {
  app.log.warn({ error }, "pdf cache cleanup failed");
});

const signedViewerPdfInflightByCacheKey = new Map<
  string,
  Promise<SignedViewerPdfPrepareResult>
>();

app.get("/health", async () => ({
  ok: true,
  service: "ai-business-command-center-api",
  system_store: systemStore.kind,
  time: new Date().toISOString(),
}));

app.post("/api/auth/owner/login", async (request, reply) => {
  const body = ownerLoginSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "กรุณากรอก username และ password",
      details: body.error.flatten().fieldErrors,
    });
  }

  const dbResult = await verifyOwnerAdminPassword({
    username: body.data.username,
    password: body.data.password,
  });
  if (dbResult.ok) {
    return {
      ok: true,
      subject: dbResult.user.id,
      display_name: dbResult.user.display_name,
      source: "database",
    };
  }

  const dbAdminConfigured = await hasConfiguredOwnerAdmin();
  if (dbAdminConfigured) {
    return reply.status(401).send({
      error: "username หรือ password ไม่ถูกต้อง",
    });
  }

  const envUsername = process.env.OWNER_ADMIN_USERNAME?.trim();
  const envPassword = process.env.OWNER_ADMIN_PASSWORD;
  if (envUsername && envPassword) {
    if (body.data.username === envUsername && body.data.password === envPassword) {
      return {
        ok: true,
        subject: envUsername,
        display_name: "Owner Admin",
        source: "bootstrap_env",
      };
    }

    return reply.status(401).send({
      error: "username หรือ password ไม่ถูกต้อง",
    });
  }

  return reply.status(428).send({
    error:
      "ยังไม่มีบัญชีผู้ดูแลในระบบ กรุณาสร้างบัญชี owner admin คนแรกก่อนเข้าสู่ระบบ",
  });
});

app.post("/api/auth/owner/bootstrap-admin", async (request, reply) => {
  const dbAdminConfigured = await hasConfiguredOwnerAdmin();
  if (dbAdminConfigured) {
    return reply.status(409).send({
      error: "มีบัญชี owner admin ในระบบแล้ว กรุณาเข้าสู่ระบบหรือเปลี่ยนรหัสผ่านจากหน้า Settings",
    });
  }
  if (!readSecretEncryptionSecret()) {
    return reply.status(503).send({
      error:
        "ยังไม่มี encryption key ใน bootstrap config จึงยังสร้างบัญชี owner admin ใน DB ไม่ได้",
    });
  }

  const body = ownerAdminCreateSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid owner admin request",
      details: body.error.flatten().fieldErrors,
    });
  }

  const user = await createOwnerAdminUser({
    username: body.data.username,
    password: body.data.password,
    displayName: body.data.display_name,
  });

  await systemStore.appendAuditLog({
    tenant_id: null,
    actor_id: user.id,
    action: "owner_admin_bootstrapped",
    target_type: "owner_admin",
    target_id: user.id,
    metadata_json: { source: "database" },
  });

  return reply.status(201).send({
    ok: true,
    subject: user.id,
    display_name: user.display_name,
    source: "database",
  });
});

app.get("/api/tenants", async () => ({
  data: await systemStore.listTenants(),
}));

app.get("/api/owner/tenants", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const query = ownerTenantsQuerySchema.safeParse(request.query ?? {});
  if (!query.success) {
    return reply.status(400).send({
      error: "Invalid tenants query",
      details: query.error.flatten().fieldErrors,
    });
  }

  const search = query.data.search?.toLowerCase();
  const tenants = (await systemStore.listTenants()).filter((tenant) => {
    if (query.data.status && tenant.status !== query.data.status) {
      return false;
    }
    if (!search) {
      return true;
    }
    return (
      tenant.name.toLowerCase().includes(search) ||
      tenant.id.toLowerCase().includes(search) ||
      tenant.databaseName.toLowerCase().includes(search)
    );
  });
  const summaries = (await Promise.all(
    tenants.map(async (tenant) => buildOwnerTenantSummary(tenant.id)),
  )).filter((summary): summary is NonNullable<typeof summary> =>
    Boolean(summary),
  );

  return { data: summaries };
});

app.get("/api/owner/admin-users", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const users = (await systemStore.listUsers()).filter(
    (user) => user.role === "owner_admin",
  );
  const data = await Promise.all(
    users.map(async (user) => ({
      id: user.id,
      username: user.email,
      display_name: user.display_name,
      enabled: user.enabled,
      password_configured: Boolean(await readOwnerAdminPasswordHash(user.id)),
      created_at: user.created_at,
      updated_at: user.updated_at,
    })),
  );

  return { data };
});

app.post("/api/owner/admin-users", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }
  if (!readSecretEncryptionSecret()) {
    return reply.status(503).send({
      error:
        "ยังไม่มี encryption key ใน bootstrap config จึงยังสร้างบัญชี owner admin ใน DB ไม่ได้",
    });
  }

  const body = ownerAdminCreateSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid owner admin request",
      details: body.error.flatten().fieldErrors,
    });
  }

  const user = await createOwnerAdminUser({
    username: body.data.username,
    password: body.data.password,
    displayName: body.data.display_name,
  });
  await systemStore.appendAuditLog({
    tenant_id: null,
    actor_id: adminAuth.subject,
    action: "owner_admin_created",
    target_type: "owner_admin",
    target_id: user.id,
    metadata_json: { username: user.email },
  });

  return reply.status(201).send({
    data: {
      id: user.id,
      username: user.email,
      display_name: user.display_name,
      enabled: user.enabled,
      password_configured: true,
      created_at: user.created_at,
      updated_at: user.updated_at,
    },
  });
});

app.patch("/api/owner/admin-users/:id/password", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }
  if (!readSecretEncryptionSecret()) {
    return reply.status(503).send({
      error:
        "ยังไม่มี encryption key ใน bootstrap config จึงยังเปลี่ยนรหัสผ่านใน DB ไม่ได้",
    });
  }

  const params = ownerAdminUserParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.status(400).send({ error: "Invalid owner admin id" });
  }
  const body = ownerAdminPasswordPatchSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid owner admin password request",
      details: body.error.flatten().fieldErrors,
    });
  }

  const user = (await systemStore.listUsers()).find(
    (item) => item.id === params.data.id && item.role === "owner_admin",
  );
  if (!user) {
    return reply.status(404).send({ error: "Owner admin user not found." });
  }

  await saveOwnerAdminPasswordHash(user.id, hashOwnerPassword(body.data.password));
  await systemStore.upsertUser({
    ...user,
    updated_at: new Date().toISOString(),
  });
  await systemStore.appendAuditLog({
    tenant_id: null,
    actor_id: adminAuth.subject,
    action: "owner_admin_password_updated",
    target_type: "owner_admin",
    target_id: user.id,
    metadata_json: {},
  });

  return { data: { id: user.id, password_configured: true } };
});

app.get("/api/owner/sml-connections", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const tenants = await systemStore.listTenants();
  const summaries = await Promise.all(
    tenants.map(async (tenant) => {
      const [summary, datasource] = await Promise.all([
        buildOwnerTenantSummary(tenant.id),
        readDatasourceConfigStatus({
          store: systemStore,
          tenantId: tenant.id,
          envConfig: readDatasourceConfig(tenant.id),
        }),
      ]);

      if (!summary) {
        return null;
      }

      return {
        ...summary,
        datasource,
        last_test: null,
      };
    }),
  );

  return {
    data: summaries.filter((summary): summary is NonNullable<typeof summary> =>
      Boolean(summary),
    ),
  };
});

app.get("/api/owner/store-setup", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const query = z
    .object({ tenant_id: tenantIdSchema.optional() })
    .safeParse(request.query ?? {});
  if (!query.success) {
    return reply.status(400).send({
      error: "Invalid store setup query",
      details: query.error.flatten().fieldErrors,
    });
  }

  const tenants = await systemStore.listTenants();
  const selectedTenantId = query.data.tenant_id ?? tenants[0]?.id;
  const [summaries, selectedDetail] = await Promise.all([
    Promise.all(tenants.map((tenant) => buildOwnerTenantSummary(tenant.id))),
    selectedTenantId ? buildOwnerStoreSetupDetail(selectedTenantId) : null,
  ]);

  return {
    data: {
      tenants: summaries.filter(
        (summary): summary is NonNullable<typeof summary> => Boolean(summary),
      ),
      selected_tenant_id: selectedTenantId ?? null,
      selected: selectedDetail,
    },
  };
});

app.get("/api/owner/setup-status", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const query = z
    .object({ tenant_id: tenantIdSchema.optional() })
    .safeParse(request.query ?? {});
  if (!query.success) {
    return reply.status(400).send({
      error: "Invalid setup status query",
      details: query.error.flatten().fieldErrors,
    });
  }

  const tenants = await systemStore.listTenants();
  const selectedTenantId = query.data.tenant_id ?? tenants[0]?.id;
  const [summaries, selectedDetail, systemConfig, operations] =
    await Promise.all([
      Promise.all(tenants.map((tenant) => buildOwnerTenantSummary(tenant.id))),
      selectedTenantId ? buildOwnerStoreSetupDetail(selectedTenantId) : null,
      readSystemRuntimeConfigStatus(systemStore),
      buildOperationsStatus({ includeAuditLogs: false }),
    ]);

  return {
    data: {
      tenants: summaries.filter(
        (summary): summary is NonNullable<typeof summary> => Boolean(summary),
      ),
      selected_tenant_id: selectedTenantId ?? null,
      selected: selectedDetail,
      system_config: systemConfig,
      operations,
    },
  };
});

app.get("/api/owner/tenants/:tenantId/business-signals", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const routeParams = tenantParamsSchema.safeParse(request.params);
  if (!routeParams.success) {
    return reply.status(400).send({ error: "Invalid tenant_id" });
  }

  const query = businessSignalsQuerySchema.safeParse(request.query ?? {});
  if (!query.success) {
    return reply.status(400).send({
      error: "Invalid business signal query",
      details: query.error.flatten().fieldErrors,
    });
  }

  const tenant = await getTenantOrNull(routeParams.data.tenantId);
  if (!tenant) {
    return reply.status(404).send({ error: "Tenant not found." });
  }

  const signals = await systemStore.listBusinessSignals({
    tenantId: tenant.id,
    status: query.data.status,
    limit: query.data.limit,
  });

  return {
    data: signals,
    tenant,
    feature_flags: tenant.featureFlags ?? tenantFeatureFlagsSchema.parse({}),
  };
});

app.patch(
  "/api/owner/tenants/:tenantId/business-signals/:signalId",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = tenantParamsSchema
      .extend({ signalId: z.string().trim().min(1).max(220) })
      .safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid business signal route" });
    }

    const body = businessSignalStatusUpdateSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid business signal update",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenant = await getTenantOrNull(routeParams.data.tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }

    const current = (
      await systemStore.listBusinessSignals({
        tenantId: tenant.id,
        limit: 1000,
      })
    ).find((signal) => signal.id === routeParams.data.signalId);
    if (!current) {
      return reply.status(404).send({ error: "Business signal not found." });
    }

    const updated = await systemStore.updateBusinessSignalStatus({
      tenantId: tenant.id,
      signalId: current.id,
      status: body.data.status,
      updatedAt: new Date().toISOString(),
    });
    if (!updated) {
      return reply.status(404).send({ error: "Business signal not found." });
    }

    await systemStore.appendAuditLog({
      tenant_id: tenant.id,
      actor_id: adminAuth.subject,
      action: "business_signal_status_updated",
      target_type: "business_signal",
      target_id: updated.id,
      metadata_json: {
        before_status: current.status,
        after_status: updated.status,
        signal_key: updated.signal_key,
        severity: updated.severity,
        category: updated.category,
        source_report_key: updated.source_report_key,
        source_run_id: updated.source_run_id,
      },
    });

    return { data: updated };
  },
);

app.get("/api/owner/notification-rules", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const query = notificationRulesQuerySchema.safeParse(request.query ?? {});
  if (!query.success) {
    return reply.status(400).send({
      error: "Invalid notification rules query",
      details: query.error.flatten().fieldErrors,
    });
  }

  const [rules, recentRuns] = await Promise.all([
    systemStore.listNotificationRules(query.data.tenant_id),
    systemStore.listNotificationRuleRuns({
      tenantId: query.data.tenant_id,
      limit: 80,
    }),
  ]);

  return {
    data: rules.map(toOwnerNotificationRule),
    runs: recentRuns,
  };
});

app.post("/api/owner/notification-rules", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const body = notificationRulePayloadSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid notification rule",
      details: body.error.flatten().fieldErrors,
    });
  }

  const validation = await validateNotificationRulePayload(body.data);
  if (!validation.ok) {
    return reply.status(422).send({
      error: validation.error,
      details: validation.details,
    });
  }

  const now = new Date().toISOString();
  const rule = await systemStore.upsertNotificationRule({
    ...body.data,
    id: `notification_rule_${body.data.tenant_id}_${Date.now()}`,
    schedule: normalizeNotificationSchedulePayload(body.data.schedule),
    report_keys: uniqueReportKeys(body.data.report_keys),
    target_ids: uniqueStrings(body.data.target_ids),
    message_packaging: "digest",
    digest_mode: body.data.digest_mode,
    retry_policy: { max_attempts: 2, retry_delay_minutes: 3 },
    last_run_at: null,
    last_run_status: null,
    last_safe_error_message: null,
    created_at: now,
    updated_at: now,
  });

  await systemStore.appendAuditLog({
    tenant_id: rule.tenant_id,
    actor_id: null,
    action: "notification_rule_created",
    target_type: "notification_rule",
    target_id: rule.id,
    metadata_json: notificationRuleAuditMetadata(rule),
  });

  return reply.status(201).send({ data: toOwnerNotificationRule(rule) });
});

app.get("/api/owner/notification-rules/:id", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const params = notificationRuleParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.status(400).send({ error: "Invalid notification rule id" });
  }

  const rule = await systemStore.getNotificationRule(params.data.id);
  if (!rule) {
    return reply.status(404).send({ error: "Notification rule not found." });
  }

  return { data: toOwnerNotificationRule(rule) };
});

app.patch("/api/owner/notification-rules/:id", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const params = notificationRuleParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.status(400).send({ error: "Invalid notification rule id" });
  }

  const existing = await systemStore.getNotificationRule(params.data.id);
  if (!existing) {
    return reply.status(404).send({ error: "Notification rule not found." });
  }

  const body = notificationRulePatchSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid notification rule update",
      details: body.error.flatten().fieldErrors,
    });
  }

  const candidate = {
    tenant_id: existing.tenant_id,
    name: body.data.name ?? existing.name,
    enabled: body.data.enabled ?? existing.enabled,
    timezone: body.data.timezone ?? existing.timezone,
    period_preset: body.data.period_preset ?? existing.period_preset,
    period_strategy: body.data.period_strategy ?? existing.period_strategy,
    schedule: body.data.schedule ?? existing.schedule,
    report_keys: body.data.report_keys ?? existing.report_keys,
    target_ids: body.data.target_ids ?? existing.target_ids,
    digest_mode: body.data.digest_mode ?? existing.digest_mode,
  };
  const validation = await validateNotificationRulePayload(candidate);
  if (!validation.ok) {
    return reply.status(422).send({
      error: validation.error,
      details: validation.details,
    });
  }

  const updated = await systemStore.upsertNotificationRule({
    ...existing,
    ...candidate,
    schedule: normalizeNotificationSchedulePayload(candidate.schedule),
    report_keys: uniqueReportKeys(candidate.report_keys),
    target_ids: uniqueStrings(candidate.target_ids),
    period_strategy: candidate.period_strategy,
    digest_mode: candidate.digest_mode,
    updated_at: new Date().toISOString(),
  });

  await systemStore.appendAuditLog({
    tenant_id: updated.tenant_id,
    actor_id: null,
    action: "notification_rule_updated",
    target_type: "notification_rule",
    target_id: updated.id,
    metadata_json: notificationRuleAuditMetadata(updated),
  });

  return { data: toOwnerNotificationRule(updated) };
});

app.get("/api/owner/notification-rules/:id/runs", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const params = notificationRuleParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.status(400).send({ error: "Invalid notification rule id" });
  }

  const rule = await systemStore.getNotificationRule(params.data.id);
  if (!rule) {
    return reply.status(404).send({ error: "Notification rule not found." });
  }

  return {
    data: await systemStore.listNotificationRuleRuns({
      ruleId: rule.id,
      limit: 50,
    }),
  };
});

app.post(
  "/api/owner/notification-rules/:id/test-run",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const params = notificationRuleParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid notification rule id" });
    }

    const body = notificationRuleExecuteSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid notification test run request",
        details: body.error.flatten().fieldErrors,
      });
    }

    const rule = await systemStore.getNotificationRule(params.data.id);
    if (!rule) {
      return reply.status(404).send({ error: "Notification rule not found." });
    }

    const result = await executeNotificationRule({
      rule,
      mode: body.data.mode ?? "dry_run",
      force: true,
      now: new Date(),
      source: "manual_test",
    });

    return result.ok
      ? { data: result }
      : reply.status(result.statusCode).send({ error: result.error, data: result });
  },
);

app.post(
  "/api/owner/notification-rules/:id/run-now",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const params = notificationRuleParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid notification rule id" });
    }

    const body = notificationRuleExecuteSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid notification run-now request",
        details: body.error.flatten().fieldErrors,
      });
    }

    const rule = await systemStore.getNotificationRule(params.data.id);
    if (!rule) {
      return reply.status(404).send({ error: "Notification rule not found." });
    }

    const result = await executeNotificationRule({
      rule,
      mode: body.data.mode ?? "send",
      force: true,
      now: new Date(),
      source: "manual_run_now",
    });

    return result.ok
      ? { data: result }
      : reply.status(result.statusCode).send({ error: result.error, data: result });
  },
);

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
    featureFlags: tenantFeatureFlagsSchema.parse({}),
    businessSignalThresholds: businessSignalThresholdsSchema.parse({}),
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

  if (body.data.status === "cancelled") {
    return reply.status(400).send({
      error:
        "การยกเลิกร้านต้องใช้ปุ่มยกเลิกร้านและพิมพ์ชื่อร้านเพื่อยืนยัน",
    });
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
    featureFlags: {
      ...tenantFeatureFlagsSchema.parse(current.featureFlags ?? {}),
      ...(body.data.feature_flags ?? {}),
    },
    businessSignalThresholds: businessSignalThresholdsSchema.parse({
      ...businessSignalThresholdsSchema.parse(
        current.businessSignalThresholds ?? {},
      ),
      ...(body.data.business_signal_thresholds ?? {}),
    }),
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
    actor_id: adminAuth.subject,
    action: tenantUpdateAuditAction(current.status, updated.status),
    target_type: "tenant",
    target_id: updated.id,
    metadata_json: {
      before: tenantAuditSnapshot(current),
      after: tenantAuditSnapshot(updated),
      datasource_configured: updated.datasourceConfigured,
    },
  });

  return { data: await buildOwnerTenantSummary(updated.id) };
});

app.get("/api/owner/tenants/:tenantId/delete-impact", async (request, reply) => {
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
    return reply.status(404).send({ error: "Tenant not found" });
  }

  return { data: await buildTenantDeleteImpact(tenant) };
});

app.delete("/api/owner/tenants/:tenantId", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const routeParams = tenantParamsSchema.safeParse(request.params);
  if (!routeParams.success) {
    return reply.status(400).send({ error: "Invalid tenant_id" });
  }

  const body = ownerTenantDeleteSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid tenant delete request",
      details: body.error.flatten().fieldErrors,
    });
  }

  const tenant = await getTenantOrNull(routeParams.data.tenantId);
  if (!tenant) {
    return reply.status(404).send({ error: "Tenant not found" });
  }

  if (body.data.confirm_name.trim() !== tenant.name.trim()) {
    return reply.status(400).send({
      error: "ชื่อร้านที่พิมพ์ไม่ตรง กรุณาพิมพ์ชื่อร้านให้ตรงก่อนยกเลิก",
    });
  }

  const impact = await buildTenantDeleteImpact(tenant);
  if (!impact.can_cancel) {
    return reply.status(409).send({
      error:
        "ยังยกเลิกร้านไม่ได้ เพราะมีงานแจ้งเตือนกำลังทำงาน กรุณารอให้จบก่อน",
      data: impact,
    });
  }

  const result = await systemStore.cancelTenant({
    tenantId: tenant.id,
    reason: body.data.reason,
    cancelledAt: new Date().toISOString(),
  });
  if (!result.tenant) {
    return reply.status(404).send({ error: "Tenant not found" });
  }

  if (!result.alreadyCancelled || result.disabledNotificationRuleCount > 0) {
    await systemStore.appendAuditLog({
      tenant_id: tenant.id,
      actor_id: adminAuth.subject,
      action: result.alreadyCancelled
        ? "owner_tenant_cancelled_cleanup"
        : "owner_tenant_cancelled",
      target_type: "tenant",
      target_id: tenant.id,
      metadata_json: {
        before: tenantAuditSnapshot(tenant),
        after: tenantAuditSnapshot(result.tenant),
        reason: body.data.reason ?? null,
        disabled_notification_rules: result.disabledNotificationRuleCount,
        impact,
      },
    });
  }

  return {
    data: {
      tenant: await buildOwnerTenantSummary(result.tenant.id),
      impact: await buildTenantDeleteImpact(result.tenant),
      disabled_notification_rules: result.disabledNotificationRuleCount,
      already_cancelled: result.alreadyCancelled,
    },
  };
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
          "Secret key is not configured. Add secret_key in the bootstrap config file before saving secrets.",
      });
    }

    const status = await saveTenantDatasourceConfig({
      store: systemStore,
      config: {
        tenantId: tenant.id,
        ...body.data,
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
        kind: body.data.kind,
        base_url: body.data.baseUrl,
        webapp_path: body.data.webappPath,
        database: body.data.database,
        auth_configured:
          body.data.auth.mode === "none" ||
          (body.data.auth.mode === "basic"
            ? Boolean(body.data.auth.password)
            : Boolean(body.data.auth.token)),
      },
    });

    return { data: status };
  },
);

app.post(
  "/api/owner/tenants/:tenantId/datasource/javaws/databases",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = tenantParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const body = javaWsDatabaseDiscoverySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid JavaWS database discovery request",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenant = await getTenantOrNull(routeParams.data.tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }

    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    try {
      const databases = await listJavaWsDatabases(body.data, 15000);
      const payload = {
        ok: true,
        checked_at: checkedAt,
        mode: "sml_javaws" as const,
        latency_ms: Date.now() - startedAt,
        config_file_name: body.data.configFileName,
        databases,
        safe_error_message: databases.length
          ? null
          : "JavaWS connected, but no database rows were returned for this config file.",
      };

      await systemStore.appendAuditLog({
        tenant_id: tenant.id,
        actor_id: null,
        action: "datasource_javaws_database_discovery_succeeded",
        target_type: "datasource",
        target_id: tenant.id,
        metadata_json: {
          base_url: body.data.baseUrl,
          webapp_path: body.data.webappPath,
          endpoint: body.data.endpoint,
          config_file_name: body.data.configFileName,
          database_count: databases.length,
          latency_ms: payload.latency_ms,
        },
      });

      return { data: payload };
    } catch (error) {
      const payload = {
        ok: false,
        checked_at: checkedAt,
        mode: "sml_javaws" as const,
        latency_ms: Date.now() - startedAt,
        config_file_name: body.data.configFileName,
        databases: [],
        safe_error_message: toSafeDatasourceErrorMessage(error),
      };

      await systemStore.appendAuditLog({
        tenant_id: tenant.id,
        actor_id: null,
        action: "datasource_javaws_database_discovery_failed",
        target_type: "datasource",
        target_id: tenant.id,
        metadata_json: {
          base_url: body.data.baseUrl,
          webapp_path: body.data.webappPath,
          endpoint: body.data.endpoint,
          config_file_name: body.data.configFileName,
          latency_ms: payload.latency_ms,
          safe_error_message: payload.safe_error_message,
        },
      });

      return reply.status(502).send({ data: payload });
    }
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
    scope: body.data.scope,
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
      scope: saved.scope ?? "tenant",
      enabled: saved.enabled,
      token_configured: saved.channel_access_token_configured,
      secret_configured: saved.channel_secret_configured,
    },
  });

  return { data: saved };
});

app.patch("/api/owner/line-channels/:id", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const routeParams = lineChannelParamsSchema.safeParse(request.params);
  if (!routeParams.success) {
    return reply.status(400).send({ error: "Invalid LINE channel id" });
  }

  const body = lineChannelPatchSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid LINE channel update request",
      details: body.error.flatten().fieldErrors,
    });
  }

  const channels = await systemStore.listLineChannels();
  const channel = channels.find((item) => item.id === routeParams.data.id);
  if (!channel || channel.source === "env") {
    return reply.status(404).send({ error: "LINE channel not found." });
  }

  const updated = await systemStore.upsertLineChannel({
    ...channel,
    display_name: body.data.display_name ?? channel.display_name,
    scope: body.data.scope ?? channel.scope ?? "tenant",
    enabled: body.data.enabled ?? channel.enabled,
    updated_at: new Date().toISOString(),
  });

  await systemStore.appendAuditLog({
    tenant_id: updated.tenant_id,
    actor_id: null,
    action: "line_channel_updated",
    target_type: "line_channel",
    target_id: updated.id,
    metadata_json: {
      display_name: updated.display_name,
      scope: updated.scope ?? "tenant",
      enabled: updated.enabled,
      token_configured: updated.channel_access_token_configured,
      secret_configured: updated.channel_secret_configured,
    },
  });

  return { data: updated };
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

app.get("/api/owner/line-recipients", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  return {
    data: await listOwnerLineRecipients(),
  };
});

app.get("/api/owner/report-permissions", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const query = reportPermissionsQuerySchema.safeParse(request.query);
  if (!query.success) {
    return reply.status(400).send({ error: "Invalid report permissions query" });
  }

  const tenants = await systemStore.listTenants();
  const tenantId = query.data.tenant_id ?? tenants[0]?.id ?? null;
  if (!tenantId) {
    return {
      data: {
        tenants: [],
        selected_tenant_id: null,
        reports: buildReportPermissionCatalog(),
        roles: [],
        permissions: [],
        matrix: {},
        target_counts: {},
        impacted_notification_plans: [],
      },
    };
  }

  const tenant = tenants.find((item) => item.id === tenantId);
  if (!tenant) {
    return reply.status(404).send({ error: "Tenant not found." });
  }

  return {
    data: await buildTenantReportPermissionsResponse(tenantId, tenants),
  };
});

app.put(
  "/api/owner/tenants/:tenantId/report-permissions",
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

    const body = tenantReportRolePermissionsPayloadSchema.safeParse(
      request.body ?? {},
    );
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid report permission request",
        details: body.error.flatten().fieldErrors,
      });
    }

    const candidate = await buildCandidateTenantReportRolePermissions({
      tenantId: tenant.id,
      updates: body.data.permissions,
    });
    const impactedPlans = await findImpactedNotificationPlans({
      tenantId: tenant.id,
      permissions: candidate,
    });
    if (impactedPlans.length) {
      return reply.status(422).send({
        error:
          "ไม่สามารถบันทึกสิทธิ์นี้ได้ เพราะมีแผนแจ้งเตือนที่เปิดใช้งานอยู่และผู้รับจะไม่มีสิทธิ์รายงาน",
        impacted_notification_plans: impactedPlans,
      });
    }

    const before = await ensureTenantReportRolePermissions(tenant.id);
    const saved = await systemStore.saveTenantReportRolePermissions({
      tenantId: tenant.id,
      permissions: candidate,
    });

    await systemStore.appendAuditLog({
      tenant_id: tenant.id,
      actor_id: null,
      action: "tenant_report_role_permissions_updated",
      target_type: "tenant",
      target_id: tenant.id,
      metadata_json: {
        before: summarizeReportRolePermissions(before),
        after: summarizeReportRolePermissions(saved.permissions),
        updated_line_targets: saved.updatedTargetCount,
      },
    });

    const tenants = await systemStore.listTenants();
    return {
      data: {
        ...(await buildTenantReportPermissionsResponse(tenant.id, tenants)),
        updated_line_targets: saved.updatedTargetCount,
      },
    };
  },
);

app.post(
  "/api/owner/tenants/:tenantId/line-target-assignments",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = tenantParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const body = lineTargetAssignmentCreateSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid LINE target assignment request",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenant = await getTenantOrNull(routeParams.data.tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }

    const sourceTarget = await getMutableLineTarget(body.data.source_target_id);
    if (!sourceTarget) {
      return reply.status(404).send({
        error: "ไม่พบผู้รับ LINE ต้นทาง หรือผู้รับนี้ไม่สามารถเลือกเข้าร้านได้",
      });
    }

    const channels = await systemStore.listLineChannels();
    const lineChannel = channels.find(
      (channel) => channel.id === body.data.line_channel_id,
    );
    if (!lineChannel || !lineChannel.enabled) {
      return reply.status(404).send({
        error: "ไม่พบ LINE OA ที่เลือก หรือ LINE OA นี้ถูกปิดใช้งาน",
      });
    }

    const channelValidation = validateLineChannelAssignment({
      tenantId: tenant.id,
      sourceTarget,
      lineChannel,
    });
    if (!channelValidation.ok) {
      return reply.status(422).send({ error: channelValidation.error });
    }

    const existing = await systemStore.getLineTargetByHash({
      tenantId: tenant.id,
      targetIdHash: sourceTarget.target_id_hash,
    });
    const now = new Date().toISOString();
    const allowedReportKeys = await getAllowedReportKeysForTenantRole(
      tenant.id,
      body.data.access_profile_key,
    );
    const candidate = buildAssignedLineTarget({
      tenantId: tenant.id,
      sourceTarget,
      lineChannelId: lineChannel.id,
      profileKey: body.data.access_profile_key,
      allowedReportKeys,
    });
    const assigned = await systemStore.upsertLineTarget({
      ...candidate,
      id: existing?.id ?? candidate.id,
      display_name: existing?.display_name ?? candidate.display_name,
      recipient_count_estimate:
        existing?.recipient_count_estimate ?? candidate.recipient_count_estimate,
      last_delivery_at: existing?.last_delivery_at ?? null,
      created_at: existing?.created_at ?? candidate.created_at,
      updated_at: now,
    });

    await systemStore.appendAuditLog({
      tenant_id: tenant.id,
      actor_id: null,
      action: existing ? "line_target_assignment_updated" : "line_target_assigned",
      target_type: "line_target",
      target_id: assigned.id,
      metadata_json: {
        source_target_id: sourceTarget.id,
        target_id_masked: assigned.target_id_masked,
        target_id_hash: assigned.target_id_hash,
        line_channel_id: assigned.line_channel_id,
        line_channel_scope: lineChannel.scope ?? "tenant",
        access_profile_key: assigned.access_profile_key,
        allowed_report_keys: assigned.allowed_report_keys,
        allowed_actions: assigned.allowed_actions,
      },
    });

    return reply.status(existing ? 200 : 201).send({
      data: toSafeLineTargetRecord(assigned),
    });
  },
);

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

app.get("/api/app/:tenantSlug/business-digest", async (request, reply) => {
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

  const query = businessSignalsQuerySchema.safeParse(request.query ?? {});
  if (!query.success) {
    return reply.status(400).send({
      error: "Invalid business digest query",
      details: query.error.flatten().fieldErrors,
    });
  }

  const signals = await systemStore.listBusinessSignals({
    tenantId: session.tenant.id,
    status: query.data.status,
    limit: query.data.limit,
  });

  return {
    data: signals,
    tenant: session.tenant,
    tenant_slug: session.tenantSlug,
    summary: {
      open: signals.filter((signal) => signal.status === "open").length,
      critical: signals.filter((signal) => signal.severity === "critical").length,
      warning: signals.filter((signal) => signal.severity === "warning").length,
    },
  };
});

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
        error: "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้",
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

    const params = toReportParams({
      date_from: query.data.date_from,
      date_to: query.data.date_to,
      time_from: query.data.time_from,
      time_to: query.data.time_to,
    });
    const rangeError = validateCustomerReportRange(params);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const datasource = await resolveTenantDatasourceConfig(session.tenant.id);
    if (!datasource) {
      return reply.status(400).send({
        error: "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้",
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
        ? toReportParams({
            date_from: query.data.date_from,
            date_to: query.data.date_to,
            time_from: query.data.time_from,
            time_to: query.data.time_to,
          })
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
        error: "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้",
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
        error: "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้",
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

    const params = toReportParams({
      date_from: query.data.date_from,
      date_to: query.data.date_to,
      time_from: query.data.time_from,
      time_to: query.data.time_to,
    });
    const rangeError = validateCustomerReportRange(params);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const datasource = await resolveTenantDatasourceConfig(session.tenant.id);
    if (!datasource) {
      return reply.status(400).send({
        error: "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้",
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
    const params = toReportParams({
      date_from: query.data.date_from,
      date_to: query.data.date_to,
      time_from: query.data.time_from,
      time_to: query.data.time_to,
    });
    const rangeError = validateCustomerReportRange(params);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const datasource = await resolveTenantDatasourceConfig(session.tenant.id);
    if (!datasource) {
      return reply.status(400).send({
        error: "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้",
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
  const bodyCandidate =
    request.body &&
    typeof request.body === "object" &&
    Object.keys(request.body as Record<string, unknown>).length
      ? datasourceConfigUpdateSchema.safeParse(request.body)
      : null;
  if (bodyCandidate && !bodyCandidate.success) {
    return reply.status(400).send({
      error: "Invalid datasource test request",
      details: bodyCandidate.error.flatten().fieldErrors,
    });
  }

  const datasource =
    bodyCandidate?.success
      ? bodyCandidate.data
      : await resolveTenantDatasourceConfig(tenantId);
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
        safe_error_message:
          "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้",
      },
    });

    return reply.status(424).send({
      data: {
        ok: false,
        checked_at: checkedAt,
        mode: "sml_javaws",
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
        safe_error_message:
          "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้ กรุณาไปที่เชื่อม SML แล้วกรอก Tomcat URL, port, SMLConfig และ database",
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
      mode: result.mode,
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

app.get("/api/owner/system/config", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  return {
    data: await readSystemRuntimeConfigStatus(systemStore),
  };
});

app.put("/api/owner/system/config", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const body = systemConfigUpdateSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid system config request",
      details: body.error.flatten().fieldErrors,
    });
  }
  if (!readSecretEncryptionSecret()) {
    return reply.status(503).send({
      error:
        "Secret key is not configured. Add secret_key in the bootstrap config file before saving system config.",
    });
  }

  const status = await saveSystemRuntimeConfig({
    store: systemStore,
    config: body.data,
  });
  await systemStore.appendAuditLog({
    tenant_id: null,
    actor_id: null,
    action: "system_config_updated",
    target_type: "system_config",
    target_id: "runtime_config",
    metadata_json: {
      source: status.source,
      app_base_url_configured: Boolean(status.app_base_url),
      public_api_base_url_configured: Boolean(status.public_api_base_url),
      report_viewer_signing_secret_configured:
        status.report_viewer_signing_secret_configured,
      report_viewer_link_ttl_hours: status.report_viewer_link_ttl_hours,
      morning_brief_enabled: status.morning_brief_enabled,
      morning_brief_tenant_ids: status.morning_brief_tenant_ids,
      worker_heartbeat_token_configured:
        status.worker_heartbeat_token_configured,
      backup_configured: status.backup_configured,
    },
  });

  return { data: status };
});

app.post("/api/worker/heartbeat", async (request, reply) => {
  const runtimeConfig = await readEffectiveSystemRuntimeConfig(systemStore);
  const expectedToken = runtimeConfig.worker_heartbeat_token?.trim();
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

app.post("/api/worker/notification-rules/tick", async (request, reply) => {
  const workerAuth = await requireWorkerToken(request);
  if (!workerAuth.ok) {
    return reply.status(workerAuth.statusCode).send({ error: workerAuth.error });
  }

  const body = notificationRuleTickSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid notification rule worker tick",
      details: body.error.flatten().fieldErrors,
    });
  }

  const now = body.data.now ? new Date(body.data.now) : new Date();
  const mode = body.data.mode ?? "send";
  const limit = body.data.limit ?? 20;
  const processed = [];
  const skipped = [];
  const rules = (await systemStore.listNotificationRules())
    .filter((rule) => rule.enabled)
    .slice(0, 500);
  const catchUpMinutes = body.data.catch_up_minutes ?? 15;

  ruleLoop: for (const rule of rules) {
    if (processed.length >= limit) {
      break;
    }

    const dueTimes = getDueNotificationRuleTimes({
      rule,
      now,
      catchUpMinutes,
    });
    if (!dueTimes.length) {
      continue;
    }

    for (const due of dueTimes) {
      if (processed.length >= limit) {
        break ruleLoop;
      }

      const idempotencyKey = buildNotificationIdempotencyKey({
        ruleId: rule.id,
        scheduledLocalDate: due.date,
        scheduledLocalTime: due.time,
      });
      const existing = await systemStore.getNotificationRuleRunByKey(
        idempotencyKey,
      );
      if (existing) {
        skipped.push({
          rule_id: rule.id,
          scheduled_local_date: due.date,
          scheduled_local_time: due.time,
          reason: "duplicate_minute",
          status: existing.status,
        });
        continue;
      }

      const result = await executeNotificationRule({
        rule,
        mode,
        force: false,
        now,
        scheduledLocalDate: due.date,
        scheduledLocalTime: due.time,
        source: "worker_due",
      });
      processed.push(result);
    }
  }

  const failedRuns = (
    await systemStore.listNotificationRuleRuns({ limit: 100 })
  ).filter(
    (run) =>
      run.status === "failed" &&
      run.next_retry_at &&
      new Date(run.next_retry_at).getTime() <= now.getTime(),
  );

  for (const failedRun of failedRuns) {
    if (processed.length >= limit) {
      break;
    }

    const rule = await systemStore.getNotificationRule(failedRun.rule_id);
    if (!rule || !rule.enabled) {
      continue;
    }
    if (failedRun.attempt >= rule.retry_policy.max_attempts) {
      continue;
    }

    const retryKey = buildNotificationIdempotencyKey({
      ruleId: rule.id,
      scheduledLocalDate: failedRun.scheduled_local_date,
      scheduledLocalTime: failedRun.scheduled_local_time,
      attempt: failedRun.attempt + 1,
    });
    const existingRetry = await systemStore.getNotificationRuleRunByKey(retryKey);
    if (existingRetry) {
      skipped.push({
        rule_id: rule.id,
        reason: "duplicate_retry",
        status: existingRetry.status,
      });
      continue;
    }

    const result = await executeNotificationRule({
      rule,
      mode,
      force: false,
      now,
      scheduledLocalDate: failedRun.scheduled_local_date,
      scheduledLocalTime: failedRun.scheduled_local_time,
      attempt: failedRun.attempt + 1,
      source: "worker_retry",
    });
    processed.push(result);
  }

  return {
    data: {
      processed,
      skipped,
      checked_rules: rules.length,
      checked_at: now.toISOString(),
      mode,
    },
  };
});

app.post("/api/line/webhook", async (request, reply) => {
  const rawBody = (request as FastifyRequestWithRawBody).rawBody ?? "";
  const signature = request.headers["x-line-signature"];
  const signatureValue = Array.isArray(signature) ? signature[0] : signature;

  let webhookTenantId: TenantId | null = null;
  let webhookLineChannelId: string | null = null;
  let signatureVerified = false;

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

  if (!signatureVerified) {
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
  const query = lineWebhookEventsQuerySchema.safeParse(request.query);
  if (!query.success) {
    return reply.status(400).send({ error: "Invalid query" });
  }

  const events = await systemStore.listLineWebhookEvents(
    Number(query.data.limit ?? 10),
  );

  return {
    data: events.map(sanitizeLineWebhookEvent),
    reveal: false,
    debug_token_configured: false,
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
    ...(await applyTenantRolePermissionDefaults(target, profileKey)),
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

  if (body.data.allowed_report_keys) {
    return reply.status(400).send({
      error:
        "กรุณาแก้สิทธิ์รายงานจากเมนู สิทธิ์รายงาน ไม่รองรับการแก้สิทธิ์รายคนใน v1",
    });
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
    updated = await applyTenantRolePermissionDefaults(
      updated,
      body.data.access_profile_key,
    );
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

  // Always run fresh yesterday report — never use getLatestSnapshot (stale / wrong date range)
  const yesterdayParams = deriveMorningBriefDateRange({
    period: "yesterday",
    timeZone: "Asia/Bangkok",
  });
  const yesterdayPurchaseParams = derivePurchaseMorningBriefDateRange();

  let salesSnapshot: SalesGoodsServicesSnapshot | null = null;
  let purchaseSnapshot: PurchaseGoodsPayablesSnapshot | null = null;

  if (salesPermission.allowed) {
    const salesRunResult = await runAndPersistSalesGoodsServicesReport({
      tenantId: target.tenant_id,
      params: yesterdayParams,
      requestAction: "line_target_test_send_report_run",
    });
    if (!salesRunResult.ok) {
      await systemStore.appendAuditLog({
        tenant_id: target.tenant_id,
        actor_id: null,
        action: "line_target_test_failed",
        target_type: "line_target",
        target_id: target.id,
        metadata_json: {
          step: "sales_report_run",
          error: salesRunResult.error,
          target_id_masked: target.target_id_masked,
        },
      });
      return reply.status(salesRunResult.statusCode).send({
        error: salesRunResult.error,
        run: salesRunResult.runRecord,
      });
    }
    salesSnapshot = salesRunResult.snapshot;
  }

  if (purchasePermission.allowed) {
    const purchaseRunResult = await runAndPersistPurchaseGoodsPayablesReport({
      tenantId: target.tenant_id,
      params: yesterdayPurchaseParams,
      requestAction: "line_target_test_send_purchase_report_run",
    });
    // Graceful degrade: purchase failure does not block the send
    if (purchaseRunResult.ok) {
      purchaseSnapshot = purchaseRunResult.snapshot;
    } else {
      await systemStore.appendAuditLog({
        tenant_id: target.tenant_id,
        actor_id: null,
        action: "line_target_test_purchase_run_failed",
        target_type: "line_target",
        target_id: target.id,
        metadata_json: {
          step: "purchase_report_run",
          error: purchaseRunResult.error,
          target_id_masked: target.target_id_masked,
        },
      });
    }
  }

  if (!salesSnapshot && !purchaseSnapshot) {
    return reply.status(424).send({
      error: "ไม่สามารถดึงข้อมูลรายงานได้ กรุณาตรวจสอบการเชื่อมต่อ SML หรือ datasource ของ tenant",
    });
  }

  const openSalesViewerPermission = canAccessLineReport({
    tenantId: target.tenant_id,
    target,
    reportKey: "sales_goods_services",
    action: "open_signed_viewer",
  });
  const salesViewerUrl =
    openSalesViewerPermission.allowed && salesSnapshot?.report_key === "sales_goods_services"
      ? await buildReportViewerUrl(salesSnapshot)
      : null;
  const salesPreview =
    salesSnapshot?.report_key === "sales_goods_services"
      ? renderSalesGoodsServicesLinePreview({
          snapshot: salesSnapshot,
          dashboardUrl: salesViewerUrl,
          tenantName: getTenantDefinition(target.tenant_id)?.name,
        })
      : null;
  const openPurchaseViewerPermission = canAccessLineReport({
    tenantId: target.tenant_id,
    target,
    reportKey: "purchase_goods_payables",
    action: "open_signed_viewer",
  });
  const purchaseViewerUrl =
    openPurchaseViewerPermission.allowed && purchaseSnapshot?.report_key === "purchase_goods_payables"
      ? await buildReportViewerUrl(purchaseSnapshot)
      : null;
  const purchasePreview =
    purchaseSnapshot?.report_key === "purchase_goods_payables"
      ? renderPurchaseGoodsPayablesLinePreview({
          snapshot: purchaseSnapshot,
          dashboardUrl: purchaseViewerUrl,
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

    const signingSecret = await readReportViewerSigningSecret();
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

    const tokenHash = createHash("sha256").update(query.data.token).digest("hex");
    const cookieSessionId = (request.cookies as Record<string, string | undefined>)["vt_session"] ?? null;
    const tokenAccess = await systemStore.accessViewerToken(tokenHash, cookieSessionId);
    if (!tokenAccess.ok) {
      const errorMessage =
        tokenAccess.reason === "expired"
          ? "Report viewer link has expired."
          : "Invalid report viewer link.";
      return reply.status(403).send({ error: errorMessage });
    }
    if (tokenAccess.newSessionId) {
      void reply.setCookie("vt_session", tokenAccess.newSessionId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: await readReportViewerLinkTtlSeconds(),
      });
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

    const signingSecret = await readReportViewerSigningSecret();
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

    const tokenHash = createHash("sha256").update(query.data.token).digest("hex");
    const cookieSessionId = (request.cookies as Record<string, string | undefined>)["vt_session"] ?? null;
    const tokenAccess = await systemStore.accessViewerToken(tokenHash, cookieSessionId);
    if (!tokenAccess.ok) {
      const errorMessage =
        tokenAccess.reason === "expired"
          ? "Report viewer link has expired."
          : "Invalid report viewer link.";
      return reply.status(403).send({ error: errorMessage });
    }
    if (tokenAccess.newSessionId) {
      void reply.setCookie("vt_session", tokenAccess.newSessionId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: await readReportViewerLinkTtlSeconds(),
      });
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

app.get(
  "/api/reports/:tenantId/:reportKey/snapshots/:runId",
  async (request, reply) => {
    const params = signedReportSnapshotParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid report viewer link." });
    }

    const query = signedSnapshotQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid report viewer link." });
    }

    const signingSecret = await readReportViewerSigningSecret();
    if (!signingSecret) {
      return reply.status(503).send({
        error: "Report viewer signing is not configured.",
      });
    }

    const verification = verifyReportViewerToken({
      token: query.data.token,
      secret: signingSecret,
      tenantId: params.data.tenantId,
      reportKey: params.data.reportKey,
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

    const tokenHash = createHash("sha256").update(query.data.token).digest("hex");
    const cookieSessionId =
      (request.cookies as Record<string, string | undefined>)["vt_session"] ??
      null;
    const tokenAccess = await systemStore.accessViewerToken(
      tokenHash,
      cookieSessionId,
    );
    if (!tokenAccess.ok) {
      const errorMessage =
        tokenAccess.reason === "expired"
          ? "Report viewer link has expired."
          : "Invalid report viewer link.";
      return reply.status(403).send({ error: errorMessage });
    }
    if (tokenAccess.newSessionId) {
      void reply.setCookie("vt_session", tokenAccess.newSessionId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: await readReportViewerLinkTtlSeconds(),
      });
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
      params.data.reportKey,
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

    const runResult = await runAndPersistReportByKey({
      tenantId: access.tenantId,
      reportKey: access.reportKey,
      params: body.data,
      requestAction: `viewer_${access.reportKey}_run_requested`,
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
    if (!isDocumentDetailReportKey(access.reportKey)) {
      return reply.status(400).send({
        error:
          "รายงานนี้ยังไม่มีรายละเอียดเอกสารใน dashboard กรุณาดูตารางสรุปในรายงาน",
      });
    }

    const query = viewerDocumentsQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        error: "Invalid document page request.",
        details: query.error.flatten().fieldErrors,
      });
    }

    const snapshot = await systemStore.getSnapshotByRunId(
      access.tenantId,
      access.runId,
      access.reportKey,
    );
    if (!snapshot || !isClassicReportSnapshot(snapshot)) {
      return reply.status(404).send({ error: "Snapshot not found" });
    }
    const params = snapshot.params;
    const rangeError = validateViewerReportRange(params);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const datasource = await resolveTenantDatasourceConfig(access.tenantId);
    if (!datasource) {
      return reply.status(400).send({
        error: "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้",
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
    if (!isDocumentDetailReportKey(access.reportKey)) {
      return reply.status(400).send({
        error:
          "รายงานนี้ยังไม่มีรายละเอียดเอกสารใน dashboard กรุณาดูตารางสรุปในรายงาน",
      });
    }

    const query = viewerDocumentDetailQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        error: "Invalid document detail request.",
        details: query.error.flatten().fieldErrors,
      });
    }

    const snapshot = await systemStore.getSnapshotByRunId(
      access.tenantId,
      access.runId,
      access.reportKey,
    );
    if (!snapshot || !isClassicReportSnapshot(snapshot)) {
      return reply.status(404).send({ error: "Snapshot not found" });
    }
    const params = snapshot.params;
    const rangeError = validateViewerReportRange(params);
    if (rangeError) {
      return reply.status(400).send({ error: rangeError });
    }

    const datasource = await resolveTenantDatasourceConfig(access.tenantId);
    if (!datasource) {
      return reply.status(400).send({
        error: "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้",
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
  "/api/reports/:tenantId/:reportKey/pdf/prepare",
  async (request, reply) => {
    const prepared = await prepareSignedViewerPdfRequest(request, reply);
    if (!prepared.ok) {
      return prepared.response;
    }

    return {
      data: {
        ready: true,
        filename: prepared.result.filename,
        cache_hit: prepared.result.cacheHit,
        document_count: prepared.result.documentCount,
        detail_row_count: prepared.result.detailRowCount,
        pdf_bytes: prepared.result.pdf.length,
        layout_version: REPORT_PDF_LAYOUT_VERSION,
      },
    };
  },
);

app.get(
  "/api/reports/:tenantId/:reportKey/pdf",
  async (request, reply) => {
    const prepared = await prepareSignedViewerPdfRequest(request, reply);
    if (!prepared.ok) {
      return prepared.response;
    }

    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${prepared.result.filename}"`)
      .header("cache-control", "no-store, no-cache, must-revalidate, private")
      .header("pragma", "no-cache")
      .header("expires", "0")
      .header("content-length", String(prepared.result.pdf.length))
      .send(prepared.result.pdf);
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
        dashboardUrl: await buildReportViewerUrl(snapshot),
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
        dashboardUrl: await buildReportViewerUrl(snapshot),
        tenantName: getTenantDefinition(params.data.tenantId)?.name,
      }),
    };
  },
);

app.get(
  "/api/reports/:tenantId/:reportKey/latest",
  async (request, reply) => {
    const params = signedViewerParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid report params" });
    }

    const snapshot = await systemStore.getLatestSnapshot(
      params.data.tenantId,
      params.data.reportKey,
    );
    if (!snapshot) {
      return reply.status(404).send({ error: "Snapshot not found" });
    }

    return { data: snapshot };
  },
);

app.get(
  "/api/reports/:tenantId/:reportKey/line-preview",
  async (request, reply) => {
    const params = signedViewerParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid report params" });
    }

    const snapshot = await systemStore.getLatestSnapshot(
      params.data.tenantId,
      params.data.reportKey,
    );
    if (!snapshot) {
      return reply.status(404).send({ error: "Snapshot not found" });
    }

    const runtimeEntry = getReportRuntimeEntry(
      reportRuntimeRegistry,
      snapshot.report_key,
    );
    const dashboardUrl = runtimeEntry?.supportsSignedViewer
      ? await buildReportViewerUrl(snapshot)
      : null;
    const preview = renderReportLinePreview(reportRuntimeRegistry, {
      snapshot,
      dashboardUrl,
      tenantName: getTenantDefinition(params.data.tenantId)?.name,
    });
    if (!preview) {
      return reply.status(500).send({
        error: "Report preview renderer is not configured.",
      });
    }

    return { data: preview };
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
      dashboardUrl: await buildReportViewerUrl(snapshot),
      tenantName: getTenantDefinition(tenantId)?.name,
    });
    const defaultTarget = (await listEffectiveLineTargets(tenantId)).find(
      (target) =>
        target.approved &&
        target.enabled &&
        target.allowed_actions.includes("receive_morning_brief"),
    );
    const lineConfig = defaultTarget
      ? await buildLineChannelConfigForTarget(defaultTarget)
      : null;
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
    let preview: ReportLinePreview = renderSalesGoodsServicesLinePreview({
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
      const salesViewerUrl2 =
        openSalesViewerPermission.allowed
          ? await buildReportViewerUrl(runResult.snapshot)
          : null;
      const salesPreview = receiveSalesPermission.allowed
        ? renderSalesGoodsServicesLinePreview({
            snapshot: runResult.snapshot,
            dashboardUrl: salesViewerUrl2,
            tenantName: getTenantDefinition(tenantId)?.name,
          })
        : null;
      const openPurchaseViewerPermission = canAccessLineReport({
        tenantId,
        target,
        reportKey: "purchase_goods_payables",
        action: "open_signed_viewer",
      });
      const purchaseViewerUrl2 =
        openPurchaseViewerPermission.allowed && purchaseSnapshot
          ? await buildReportViewerUrl(purchaseSnapshot)
          : null;
      const purchasePreview =
        purchaseSnapshot && receivePurchasePermission.allowed
          ? renderPurchaseGoodsPayablesLinePreview({
              snapshot: purchaseSnapshot,
              dashboardUrl: purchaseViewerUrl2,
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

app.post(
  "/api/reports/:tenantId/:reportKey/run",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = signedViewerParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid report params" });
    }

    const body = salesGoodsServicesParamsSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid report params",
        details: body.error.flatten().fieldErrors,
      });
    }

    const runResult = await runAndPersistReportByKey({
      tenantId: routeParams.data.tenantId,
      reportKey: routeParams.data.reportKey,
      params: body.data,
      requestAction: "report_run_requested",
    });

    if (runResult.ok) {
      return { data: runResult.snapshot, run: runResult.runRecord };
    }

    if (runResult.statusCode === 500) {
      request.log.error(
        {
          safe_error_message: runResult.runRecord.safe_error_message,
          report_key: routeParams.data.reportKey,
        },
        "report run failed",
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
      "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้ กรุณาเชื่อม SML และทดสอบให้ผ่านก่อนรันรายงาน";
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
      "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้ กรุณาเชื่อม SML และทดสอบให้ผ่านก่อนรันรายงาน";
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

async function runAndPersistGrossProfitReport(input: {
  tenantId: TenantId;
  reportKey: Extract<
    ReportKey,
    "gross_profit_by_product" | "gross_profit_by_ar_customer"
  >;
  params: SalesGoodsServicesParams;
  requestAction: string;
}): Promise<
  | {
      ok: true;
      snapshot: GrossProfitByProductSnapshot | GrossProfitByArCustomerSnapshot;
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
    id: createRunId(
      input.tenantId,
      input.reportKey === "gross_profit_by_product"
        ? "gross_profit_product"
        : "gross_profit_ar",
    ),
    tenant_id: input.tenantId,
    report_key: input.reportKey,
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
      report_key: input.reportKey,
      params: input.params,
      contains_cost_data: true,
    },
  });

  if (!datasource) {
    runRecord.status = "failed";
    runRecord.finished_at = new Date().toISOString();
    runRecord.safe_error_message =
      "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้ กรุณาเชื่อม SML และทดสอบให้ผ่านก่อนรันรายงาน";
    await systemStore.upsertRun(runRecord);
    return {
      ok: false,
      statusCode: 424,
      error: runRecord.safe_error_message,
      runRecord,
    };
  }

  try {
    const snapshot =
      input.reportKey === "gross_profit_by_product"
        ? await runGrossProfitByProductReport({
            tenant_id: input.tenantId,
            run_id: runRecord.id,
            params: input.params,
            datasource,
          })
        : await runGrossProfitByArCustomerReport({
            tenant_id: input.tenantId,
            run_id: runRecord.id,
            params: input.params,
            datasource,
          });

    runRecord.status = "success";
    runRecord.finished_at = new Date().toISOString();
    runRecord.row_count = snapshot.summary.row_count;
    await systemStore.upsertRun(runRecord);
    await systemStore.saveSnapshot(snapshot);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
      actor_id: null,
      action: "gross_profit_report_run_succeeded",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: input.reportKey,
        row_count: runRecord.row_count,
        quality_status: snapshot.quality_status,
        contains_cost_data: true,
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
      action: "gross_profit_report_run_failed",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: input.reportKey,
        safe_error_message: runRecord.safe_error_message,
        contains_cost_data: true,
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

async function runAndPersistStockBalanceReport(input: {
  tenantId: TenantId;
  params: SalesGoodsServicesParams;
  requestAction: string;
}): Promise<
  | {
      ok: true;
      snapshot: StockBalanceSnapshot;
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
    id: createRunId(input.tenantId, "stock_balance"),
    tenant_id: input.tenantId,
    report_key: "stock_balance",
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
      report_key: "stock_balance",
      params: input.params,
      contains_cost_data: true,
    },
  });

  if (!datasource) {
    runRecord.status = "failed";
    runRecord.finished_at = new Date().toISOString();
    runRecord.safe_error_message =
      "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้ กรุณาเชื่อม SML และทดสอบให้ผ่านก่อนรันรายงาน";
    await systemStore.upsertRun(runRecord);
    return {
      ok: false,
      statusCode: 424,
      error: runRecord.safe_error_message,
      runRecord,
    };
  }

  try {
    const snapshot = await runStockBalanceReport({
      tenant_id: input.tenantId,
      run_id: runRecord.id,
      params: input.params,
      datasource,
    });

    runRecord.status = "success";
    runRecord.finished_at = new Date().toISOString();
    runRecord.row_count = snapshot.summary.sku_count;
    await systemStore.upsertRun(runRecord);
    await systemStore.saveSnapshot(snapshot);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
      actor_id: null,
      action: "stock_balance_report_run_succeeded",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: "stock_balance",
        row_count: runRecord.row_count,
        quality_status: snapshot.quality_status,
        contains_cost_data: true,
      },
    });

    return { ok: true, snapshot, runRecord };
  } catch (error) {
    runRecord.status = "failed";
    runRecord.finished_at = new Date().toISOString();
    runRecord.safe_error_message = toSafeStockBalanceErrorMessage(error);
    await systemStore.upsertRun(runRecord);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
      actor_id: null,
      action: "stock_balance_report_run_failed",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: "stock_balance",
        safe_error_message: runRecord.safe_error_message,
        contains_cost_data: true,
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

function toSafeStockBalanceErrorMessage(error: unknown) {
  if (
    error instanceof Error &&
    /timeout|timed out|canceling statement/i.test(error.message)
  ) {
    return "รายงานสต็อกคงเหลือใช้เวลานานเกินไป กรุณาลองช่วงวันที่สั้นลงหรือตรวจประสิทธิภาพ query";
  }
  return toSafeErrorMessage(error);
}

async function runAndPersistStockReorderReport(input: {
  tenantId: TenantId;
  params: SalesGoodsServicesParams;
  requestAction: string;
}): Promise<
  | {
      ok: true;
      snapshot: StockReorderSnapshot;
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
    id: createRunId(input.tenantId, "stock_reorder"),
    tenant_id: input.tenantId,
    report_key: "stock_reorder",
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
      report_key: "stock_reorder",
      params: input.params,
      source_basis: "latest_inventory_balance",
    },
  });

  if (!datasource) {
    runRecord.status = "failed";
    runRecord.finished_at = new Date().toISOString();
    runRecord.safe_error_message =
      "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้ กรุณาเชื่อม SML และทดสอบให้ผ่านก่อนรันรายงาน";
    await systemStore.upsertRun(runRecord);
    return {
      ok: false,
      statusCode: 424,
      error: runRecord.safe_error_message,
      runRecord,
    };
  }

  try {
    const snapshot = await runStockReorderReport({
      tenant_id: input.tenantId,
      run_id: runRecord.id,
      params: input.params,
      datasource,
    });

    runRecord.status = "success";
    runRecord.finished_at = new Date().toISOString();
    runRecord.row_count = snapshot.summary.reorder_count;
    await systemStore.upsertRun(runRecord);
    await systemStore.saveSnapshot(snapshot);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
      actor_id: null,
      action: "stock_reorder_report_run_succeeded",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: "stock_reorder",
        row_count: runRecord.row_count,
        quality_status: snapshot.quality_status,
        source_basis: snapshot.source_basis,
      },
    });

    return { ok: true, snapshot, runRecord };
  } catch (error) {
    runRecord.status = "failed";
    runRecord.finished_at = new Date().toISOString();
    runRecord.safe_error_message = toSafeStockReorderErrorMessage(error);
    await systemStore.upsertRun(runRecord);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
      actor_id: null,
      action: "stock_reorder_report_run_failed",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: "stock_reorder",
        safe_error_message: runRecord.safe_error_message,
        source_basis: "latest_inventory_balance",
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

function toSafeStockReorderErrorMessage(error: unknown) {
  if (
    error instanceof Error &&
    /timeout|timed out|canceling statement/i.test(error.message)
  ) {
    return "รายงานสินค้าถึงจุดสั่งซื้อใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้งหรือตรวจประสิทธิภาพ query";
  }
  return toSafeErrorMessage(error);
}

async function buildSalesComparison(input: {
  tenantId: TenantId;
  runId: string;
  params: SalesGoodsServicesParams;
  datasource: JavaWsDatasourceConfig;
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

function buildDashboardUrl(baseUrl: string | null) {
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl.replace(/\/$/, "")}/command-center`;
}

async function buildOperationsStatus(input: { includeAuditLogs: boolean }) {
  const runtimeConfig = await readEffectiveSystemRuntimeConfig(systemStore);
  const runtimeStatus = await readSystemRuntimeConfigStatus(systemStore);
  const latestHeartbeat = await systemStore.getLatestWorkerHeartbeat(
    "notification_rule_worker",
  );
  const tenants = await systemStore.listTenants();
  const auditLogs = input.includeAuditLogs
    ? await systemStore.listAuditLogs(30)
    : [];
  const auditLogsForMetrics = input.includeAuditLogs
    ? auditLogs
    : await systemStore.listAuditLogs(200);
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
          ),
        line_target_masked:
          lineTargets.find((target) => target.enabled && target.approved)
            ?.target_id_masked ?? null,
      };
    }),
  );
  const tenantOpenSignals = (
    await Promise.all(
      tenants.map((tenant) =>
        systemStore.listBusinessSignals({
          tenantId: tenant.id,
          status: "open",
          limit: 100,
        }),
      ),
    )
  ).flat();

  return {
    api: {
      ok: true,
      service: "ai-business-command-center-api",
      system_store: systemStore.kind,
      time: new Date().toISOString(),
    },
    dashboard: {
      app_base_url_configured: Boolean(runtimeConfig.app_base_url),
      dashboard_url: buildDashboardUrl(runtimeConfig.app_base_url),
      public_api_base_url_configured: Boolean(runtimeConfig.public_api_base_url),
    },
    scheduler: {
      enabled: true,
      tenant_ids: [],
      time: "DB notification rules",
      timezone: "per rule",
      mode: "send" as const,
      force: false,
    },
    worker: {
      heartbeat_configured: Boolean(runtimeConfig.worker_heartbeat_token),
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
      configured: runtimeConfig.backup_configured,
      last_backup_at: runtimeConfig.system_last_backup_at,
      recommendation:
        "ก่อน production ควรตั้ง cron pg_dump, เก็บไฟล์นอกเครื่อง และทดสอบ restore รายสัปดาห์",
    },
    signal_metrics: {
      open: tenantOpenSignals.length,
      critical_open: tenantOpenSignals.filter(
        (signal) => signal.severity === "critical",
      ).length,
      generated_recent: auditLogsForMetrics.filter(
        (log) => log.action === "business_signal_generated",
      ).length,
      digest_sent_recent: auditLogsForMetrics.filter(
        (log) => log.action === "business_signal_digest_sent",
      ).length,
      skipped_permission_recent: auditLogsForMetrics.filter(
        (log) => log.action === "business_signal_skipped_permission",
      ).length,
      lifecycle_updates_recent: auditLogsForMetrics.filter(
        (log) => log.action === "business_signal_status_updated",
      ).length,
    },
    audit_logs: auditLogs,
    tenants: tenantHealth,
    system_config: runtimeStatus,
  };
}

async function buildReportViewerUrl(snapshot: ReportSnapshot) {
  const runtimeConfig = await readEffectiveSystemRuntimeConfig(systemStore);
  const baseUrl = runtimeConfig.app_base_url;
  const signingSecret = runtimeConfig.report_viewer_signing_secret?.trim();
  if (!baseUrl || !signingSecret || signingSecret.length < 32) {
    return null;
  }

  const expiresAt = new Date(
    Date.now() + runtimeConfig.report_viewer_link_ttl_hours * 60 * 60 * 1000,
  );
  const token = createReportViewerToken({
    secret: signingSecret,
    tenantId: snapshot.tenant_id,
    reportKey: snapshot.report_key,
    runId: snapshot.run_id,
    expiresAt,
  });

  const tokenHash = createHash("sha256").update(token).digest("hex");
  try {
    await systemStore.createViewerToken({
      tokenHash,
      tenantId: snapshot.tenant_id,
      runId: snapshot.run_id,
      expiresAt,
    });
  } catch (err) {
    app.log.warn({ err }, "Failed to register viewer token in DB — URL will be non-OTT");
  }

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
  const allPreviewsHaveFlex = flexBubbles.length === previews.length;
  const flexMessage =
    allPreviewsHaveFlex && flexBubbles.length > 1
      ? {
          type: "flex" as const,
          altText: "AI Business Morning Brief: รายงานขายและรายงานซื้อ",
          contents: {
            type: "carousel",
            contents: flexBubbles,
          },
        }
      : allPreviewsHaveFlex
        ? primaryPreview.flex_message
        : undefined;

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

function buildNotificationDigestPreview(
  previews: ReportLinePreview[],
): ReportLinePreview {
  const primaryPreview = previews[0];
  if (!primaryPreview) {
    throw new Error("At least one report preview is required.");
  }

  const flexBubbles = previews
    .map((preview) => preview.flex_message?.contents)
    .filter((contents): contents is Record<string, unknown> => Boolean(contents));
  const allPreviewsHaveFlex = flexBubbles.length === previews.length;
  const flexMessage =
    allPreviewsHaveFlex && flexBubbles.length > 1
      ? {
          type: "flex" as const,
          altText: "AI Business: สรุปรายงานจาก SML",
          contents: {
            type: "carousel",
            contents: flexBubbles,
          },
        }
      : allPreviewsHaveFlex
        ? primaryPreview.flex_message
        : undefined;

  return {
    ...primaryPreview,
    line_message_type: flexMessage ? "flex" : "text",
    title: previews.length > 1 ? "AI Business SML Digest" : primaryPreview.title,
    text: previews.map((preview) => preview.text).join("\n\n---\n\n"),
    lines: previews.flatMap((preview, index) =>
      index === 0 ? preview.lines : ["", "---", "", ...preview.lines],
    ),
    flex_message: flexMessage,
    warnings: previews.flatMap((preview) => preview.warnings),
  } as ReportLinePreview;
}

function getTenantFeatureFlags(tenant: Tenant) {
  return tenantFeatureFlagsSchema.parse(tenant.featureFlags ?? {});
}

function isBusinessSignalsEnabled(tenant: Tenant) {
  return getTenantFeatureFlags(tenant).business_signals_enabled;
}

function isLineActionDigestV2Enabled(tenant: Tenant) {
  return getTenantFeatureFlags(tenant).line_action_digest_v2_enabled;
}

function getBusinessSignalThresholdsForTenant(tenant: Tenant) {
  const thresholds = businessSignalThresholdsSchema.parse(
    tenant.businessSignalThresholds ?? {},
  );
  return {
    lowGrossMarginPercent: thresholds.low_gross_margin_percent,
    salesDropPercent: thresholds.sales_drop_percent,
    salesDropAmount: thresholds.sales_drop_amount,
    purchaseConcentrationPercent: thresholds.purchase_concentration_percent,
    missingBranchAmount: thresholds.missing_branch_amount,
    negativeGrossProfitAmount: thresholds.negative_gross_profit_amount,
    noSalesEnabled: thresholds.no_sales_enabled,
  };
}

async function persistBusinessSignals(
  signals: BusinessSignalRecord[],
  context: {
    source: string;
    notificationRuleId?: string;
  },
) {
  if (!signals.length) {
    return [];
  }

  const saved = await systemStore.upsertBusinessSignals(signals);
  for (const signal of saved) {
    await systemStore.appendAuditLog({
      tenant_id: signal.tenant_id,
      actor_id: null,
      action: "business_signal_generated",
      target_type: "business_signal",
      target_id: signal.id,
      metadata_json: {
        source: context.source,
        notification_rule_id: context.notificationRuleId ?? null,
        signal_key: signal.signal_key,
        category: signal.category,
        severity: signal.severity,
        source_report_key: signal.source_report_key,
        source_run_id: signal.source_run_id,
        period_from: signal.period_from,
        period_to: signal.period_to,
        amount_impact: signal.amount_impact,
        rule_version: signal.rule_version,
      },
    });
  }

  return saved;
}

function countUnknownDocTimeInSnapshot(snapshot: ReportSnapshot) {
  if (
    snapshot.report_key === "sales_goods_services" ||
    snapshot.report_key === "purchase_goods_payables"
  ) {
    return snapshot.documents.filter((document) => !document.doc_time).length;
  }

  return 0;
}

async function executeNotificationRule(input: {
  rule: NotificationRuleRecord;
  mode: LineSendMode;
  force: boolean;
  now: Date;
  scheduledLocalDate?: string;
  scheduledLocalTime?: string;
  attempt?: number;
  source: "worker_due" | "worker_retry" | "manual_test" | "manual_run_now";
}): Promise<
  | {
      ok: true;
      status: "sent" | "processed" | "skipped";
      run: NotificationRuleRunRecord;
      deliveries: LineDeliveryRecord[];
      report_run_ids: string[];
      mode: LineSendMode;
    }
  | {
      ok: false;
      statusCode: 403 | 424 | 500;
      error: string;
      run: NotificationRuleRunRecord;
      deliveries: LineDeliveryRecord[];
      report_run_ids: string[];
      mode: LineSendMode;
    }
> {
  const tenant = await getTenantOrNull(input.rule.tenant_id);
  const zoned =
    input.scheduledLocalDate && input.scheduledLocalTime
      ? {
          date: input.scheduledLocalDate,
          time: input.scheduledLocalTime,
          isoWeekday: 1,
        }
      : getZonedDateTimeParts({
          now: input.now,
          timeZone: input.rule.timezone || BANGKOK_TIME_ZONE,
        });
  const params = deriveNotificationPeriodRange({
    periodPreset: input.rule.period_preset,
    periodStrategy: input.rule.period_strategy,
    scheduledLocalDate: zoned.date,
    scheduledLocalTime: zoned.time,
    now: input.now,
    timeZone: input.rule.timezone,
  });
  const attempt = input.attempt ?? 1;
  const baseIdempotencyKey = buildNotificationIdempotencyKey({
    ruleId: input.rule.id,
    scheduledLocalDate: zoned.date,
    scheduledLocalTime: zoned.time,
    attempt,
  });
  const idempotencyKey = input.force
    ? `${baseIdempotencyKey}:manual:${Date.now()}`
    : baseIdempotencyKey;
  const nowIso = new Date().toISOString();
  let run: NotificationRuleRunRecord = {
    id: `notification_run_${input.rule.id}_${Date.now()}_${attempt}`,
    rule_id: input.rule.id,
    tenant_id: input.rule.tenant_id,
    scheduled_local_date: zoned.date,
    scheduled_local_time: zoned.time,
    timezone: input.rule.timezone || BANGKOK_TIME_ZONE,
    period_from: params.date_from,
    period_to: params.date_to,
    period_from_time: params.time_from ?? null,
    period_to_time: params.time_to ?? null,
    period_strategy: input.rule.period_strategy,
    unknown_doc_time_count: 0,
    status: "running",
    attempt,
    idempotency_key: idempotencyKey,
    report_run_ids: [],
    delivery_ids: [],
    safe_error_message: null,
    started_at: nowIso,
    finished_at: null,
    next_retry_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const existingRun = input.force
    ? null
    : await systemStore.getNotificationRuleRunByKey(idempotencyKey);
  if (existingRun && existingRun.status !== "failed") {
    return {
      ok: true,
      status: "skipped",
      run: existingRun,
      deliveries: [],
      report_run_ids: existingRun.report_run_ids,
      mode: input.mode,
    };
  }

  run = await systemStore.upsertNotificationRuleRun(run);

  const finishRun = async (update: {
    status: NotificationRuleRunRecord["status"];
    safeErrorMessage?: string | null;
    reportRunIds?: string[];
    deliveryIds?: string[];
    nextRetryAt?: string | null;
  }) => {
    const finishedAt = new Date().toISOString();
    run = await systemStore.upsertNotificationRuleRun({
      ...run,
      status: update.status,
      safe_error_message: update.safeErrorMessage ?? null,
      report_run_ids: update.reportRunIds ?? run.report_run_ids,
      delivery_ids: update.deliveryIds ?? run.delivery_ids,
      finished_at: finishedAt,
      next_retry_at: update.nextRetryAt ?? null,
      updated_at: finishedAt,
    });
    await systemStore.upsertNotificationRule({
      ...input.rule,
      last_run_at: finishedAt,
      last_run_status: update.status,
      last_safe_error_message: update.safeErrorMessage ?? null,
      updated_at: finishedAt,
    });
    return run;
  };

  const failRun = async (
    safeErrorMessage: string,
    statusCode: 403 | 424 | 500,
    reportRunIds: string[] = run.report_run_ids,
    deliveryIds: string[] = run.delivery_ids,
  ) => {
    const nextRetryAt =
      input.mode === "send" && attempt < input.rule.retry_policy.max_attempts
        ? new Date(
            Date.now() + input.rule.retry_policy.retry_delay_minutes * 60_000,
          ).toISOString()
        : null;
    await finishRun({
      status: "failed",
      safeErrorMessage,
      reportRunIds,
      deliveryIds,
      nextRetryAt,
    });
    await systemStore.appendAuditLog({
      tenant_id: input.rule.tenant_id,
      actor_id: null,
      action: "notification_rule_run_failed",
      target_type: "notification_rule",
      target_id: input.rule.id,
      metadata_json: {
        source: input.source,
        mode: input.mode,
        attempt,
        idempotency_key: idempotencyKey,
        period_strategy: input.rule.period_strategy,
        period_from: params.date_from,
        period_to: params.date_to,
        period_from_time: params.time_from ?? null,
        period_to_time: params.time_to ?? null,
        unknown_doc_time_count: run.unknown_doc_time_count,
        safe_error_message: safeErrorMessage,
        next_retry_at: nextRetryAt,
      },
    });
    return {
      ok: false as const,
      statusCode,
      error: safeErrorMessage,
      run,
      deliveries: [] as LineDeliveryRecord[],
      report_run_ids: reportRunIds,
      mode: input.mode,
    };
  };

  if (!tenant) {
    return failRun("ไม่พบร้านค้าที่ผูกกับกฎแจ้งเตือนนี้", 424);
  }

  const access = tenantAccessStatus(tenant);
  if (!access.enabled) {
    return failRun(access.message, 403);
  }

  const validation = await validateNotificationRulePayload({
    tenant_id: input.rule.tenant_id,
    name: input.rule.name,
    enabled: true,
    timezone: input.rule.timezone,
    period_preset: input.rule.period_preset,
    period_strategy: input.rule.period_strategy,
    schedule: input.rule.schedule,
    report_keys: input.rule.report_keys,
    target_ids: input.rule.target_ids,
  });
  if (!validation.ok) {
    return failRun(validation.error, 424);
  }

  const reportRunIds: string[] = [];
  const snapshots: ReportSnapshot[] = [];
  const businessSignalsEnabled = isBusinessSignalsEnabled(tenant);
  for (const reportKey of input.rule.report_keys) {
    const result = await runAndPersistReportByKey({
      tenantId: input.rule.tenant_id,
      reportKey,
      params,
      requestAction: "notification_rule_report_run_requested",
    });
    reportRunIds.push(result.runRecord.id);
    if (!result.ok) {
      if (businessSignalsEnabled) {
        await persistBusinessSignals(
          [
            buildReportFailureBusinessSignal({
              tenant_id: input.rule.tenant_id,
              report_key: reportKey,
              run_id: result.runRecord.id,
              period_from: params.date_from,
              period_to: params.date_to,
              safe_error_message: result.error,
            }),
          ],
          {
            source: input.source,
            notificationRuleId: input.rule.id,
          },
        );
      }
      return failRun(result.error, result.statusCode, reportRunIds);
    }
    snapshots.push(result.snapshot);
  }
  run = {
    ...run,
    unknown_doc_time_count: snapshots.reduce(
      (total, snapshot) => total + countUnknownDocTimeInSnapshot(snapshot),
      0,
    ),
  };

  const businessSignals = businessSignalsEnabled
    ? await persistBusinessSignals(
        buildBusinessSignalsForSnapshots({
          snapshots,
          thresholds: getBusinessSignalThresholdsForTenant(tenant),
        }),
        {
          source: input.source,
          notificationRuleId: input.rule.id,
        },
      )
    : [];
  const lineActionDigestV2Enabled = isLineActionDigestV2Enabled(tenant);

  const deliveries: LineDeliveryRecord[] = [];
  const deliveryTargetHashes = new Set<string>();
  for (const targetId of input.rule.target_ids) {
    const target = await getEffectiveLineTargetById(targetId);
    if (!target) {
      return failRun(
        "ปลายทาง LINE ในกฎนี้หายไป กรุณาเลือกปลายทางใหม่แล้วบันทึกอีกครั้ง",
        424,
        reportRunIds,
        deliveries.map((delivery) => delivery.id),
      );
    }

    if (deliveryTargetHashes.has(target.target_id_hash)) {
      await systemStore.appendAuditLog({
        tenant_id: input.rule.tenant_id,
        actor_id: null,
        action: "notification_rule_duplicate_target_skipped",
        target_type: "line_target",
        target_id: target.id,
        metadata_json: {
          notification_rule_id: input.rule.id,
          target_id_hash: target.target_id_hash,
          target_id_masked: target.target_id_masked,
          source: input.source,
          mode: input.mode,
        },
      });
      continue;
    }
    deliveryTargetHashes.add(target.target_id_hash);

    const allowedSignals = businessSignals.filter((signal) =>
      canAccessLineReport({
        tenantId: input.rule.tenant_id,
        target,
        reportKey: signal.source_report_key,
        action: "receive_morning_brief",
      }).allowed,
    );
    const skippedSignalCount = businessSignals.length - allowedSignals.length;
    if (skippedSignalCount > 0) {
      await systemStore.appendAuditLog({
        tenant_id: input.rule.tenant_id,
        actor_id: null,
        action: "business_signal_skipped_permission",
        target_type: "line_target",
        target_id: target.id,
        metadata_json: {
          notification_rule_id: input.rule.id,
          skipped_signal_count: skippedSignalCount,
          source: input.source,
          mode: input.mode,
          target_id_hash: target.target_id_hash,
          target_id_masked: target.target_id_masked,
        },
      });
    }

    const shouldUseActionDigest =
      input.rule.digest_mode === "action_only" && lineActionDigestV2Enabled;
    const dashboardUrls: Partial<Record<ReportKey, string | null>> = {};
    const reportPreviewCache = new Map<ReportKey, ReportLinePreview>();
    const buildPreviewForSnapshot = async (snapshot: ReportSnapshot) => {
      const cached = reportPreviewCache.get(snapshot.report_key);
      if (cached) {
        return cached;
      }
      const reportPreview = await buildNotificationReportPreview({
        tenant,
        target,
        snapshot,
      });
      reportPreviewCache.set(snapshot.report_key, reportPreview);
      dashboardUrls[snapshot.report_key] = reportPreview.dashboard_url ?? null;
      return reportPreview;
    };
    const actionDigestSelection =
      shouldUseActionDigest && allowedSignals.length
        ? selectBusinessSignalDigestIssues(allowedSignals, {
            limit: 2,
            thresholds: getBusinessSignalThresholdsForTenant(tenant),
          })
        : null;
    const actionDigestSignals =
      actionDigestSelection?.issues.flatMap((issue) => issue.signals) ?? [];
    if (actionDigestSelection?.issues.length) {
      const selectedReportKeys = new Set(
        actionDigestSelection.issues.flatMap((issue) => issue.source_report_keys),
      );
      for (const snapshot of snapshots) {
        if (selectedReportKeys.has(snapshot.report_key)) {
          await buildPreviewForSnapshot(snapshot);
        }
      }
    }
    const actionDigestPreview = actionDigestSelection?.issues.length
      ? buildBusinessSignalDigestPreview({
          tenantName: tenant.name,
          signals: actionDigestSignals,
          digestSelection: actionDigestSelection,
          dashboardUrls,
        })
      : null;
    const fallbackPreviews = actionDigestPreview
      ? []
      : await Promise.all(
          snapshots.map((snapshot) => buildPreviewForSnapshot(snapshot)),
        );
    const preview =
      actionDigestPreview ?? buildNotificationDigestPreview(fallbackPreviews);
    const digestIssueAuditMapping =
      actionDigestSelection?.issues.map((issue) => ({
        issue_key: issue.issue_key,
        raw_signal_ids: issue.raw_signal_ids,
        raw_signal_keys: issue.raw_signal_keys,
      })) ?? [];
    const deliveryKey = [
      "notification_rule",
      input.rule.id,
      zoned.date,
      zoned.time,
      target.target_id_hash.slice(0, 16),
    ].join(":");
    if (input.mode === "send" && !input.force) {
      const existingDelivery = await systemStore.findSuccessfulLineDeliveryByKey({
        tenantId: input.rule.tenant_id,
        deliveryKey,
      });
      if (existingDelivery) {
        deliveries.push(existingDelivery);
        continue;
      }
    }

    const delivery = await sendLineBrief({
      tenantId: input.rule.tenant_id,
      mode: input.mode,
      preview,
      config: await buildLineChannelConfigForTarget(target),
      deliveryKey,
      deliveryType: "notification_rule",
      periodFrom: params.date_from,
      periodTo: params.date_to,
    });
    deliveries.push(delivery);
    await systemStore.saveLineDelivery(delivery);
    if (delivery.sent_at) {
      await markLineTargetDelivered(target, delivery.sent_at);
    }
    await systemStore.appendAuditLog({
      tenant_id: input.rule.tenant_id,
      actor_id: null,
      action:
        delivery.status === "success"
          ? "notification_rule_sent"
          : delivery.status === "dry_run"
          ? "notification_rule_dry_run"
          : delivery.status === "skipped"
          ? "notification_rule_skipped_unconfigured"
          : "notification_rule_send_failed",
      target_type: "line_delivery",
      target_id: delivery.id,
      metadata_json: {
        notification_rule_id: input.rule.id,
        report_run_ids: reportRunIds,
        delivery_key: deliveryKey,
        mode: input.mode,
        source: input.source,
        attempt,
        target_id_masked: delivery.target_id_masked,
        target_id_hash: target.target_id_hash,
        safe_error_message: delivery.safe_error_message,
        digest_mode: input.rule.digest_mode,
        action_digest_requested: shouldUseActionDigest,
        digest_issue_count: actionDigestSelection?.issues.length ?? 0,
        digest_issue_keys:
          actionDigestSelection?.issues.map((issue) => issue.issue_key) ?? [],
        digest_issues: digestIssueAuditMapping,
        business_signal_ids: actionDigestSignals.map((signal) => signal.id),
        business_signal_keys: actionDigestSignals.map(
          (signal) => signal.signal_key,
        ),
      },
    });
    if (
      actionDigestSignals.length &&
      (delivery.status === "success" || delivery.status === "dry_run")
    ) {
      await systemStore.appendAuditLog({
        tenant_id: input.rule.tenant_id,
        actor_id: null,
        action:
          delivery.status === "success"
            ? "business_signal_digest_sent"
            : "business_signal_digest_dry_run",
        target_type: "line_delivery",
        target_id: delivery.id,
        metadata_json: {
          notification_rule_id: input.rule.id,
          delivery_key: deliveryKey,
          mode: input.mode,
          source: input.source,
          target_id_hash: target.target_id_hash,
          target_id_masked: delivery.target_id_masked,
          digest_issue_count: actionDigestSelection?.issues.length ?? 0,
          digest_issue_keys:
            actionDigestSelection?.issues.map((issue) => issue.issue_key) ?? [],
          digest_issues: digestIssueAuditMapping,
          business_signal_ids: actionDigestSignals.map((signal) => signal.id),
          business_signal_keys: actionDigestSignals.map(
            (signal) => signal.signal_key,
          ),
        },
      });
    }
  }

  const failedDelivery = deliveries.find(
    (delivery) => delivery.status === "failed",
  );
  if (failedDelivery) {
    await finishRun({
      status: "failed",
      safeErrorMessage:
        failedDelivery.safe_error_message ?? "ส่ง LINE ไม่สำเร็จ",
      reportRunIds,
      deliveryIds: deliveries.map((delivery) => delivery.id),
      nextRetryAt:
        input.mode === "send" && attempt < input.rule.retry_policy.max_attempts
          ? new Date(
              Date.now() +
                input.rule.retry_policy.retry_delay_minutes * 60_000,
            ).toISOString()
          : null,
    });
    return {
      ok: false,
      statusCode: 500,
      error: run.safe_error_message ?? "ส่ง LINE ไม่สำเร็จ",
      run,
      deliveries,
      report_run_ids: reportRunIds,
      mode: input.mode,
    };
  }

  await finishRun({
    status: deliveries.length ? "success" : "skipped",
    safeErrorMessage: deliveries.length ? null : "ไม่มีปลายทาง LINE ในกฎนี้",
    reportRunIds,
    deliveryIds: deliveries.map((delivery) => delivery.id),
  });

  await systemStore.appendAuditLog({
    tenant_id: input.rule.tenant_id,
    actor_id: null,
    action: "notification_rule_run_completed",
    target_type: "notification_rule",
    target_id: input.rule.id,
    metadata_json: {
      source: input.source,
      mode: input.mode,
      attempt,
      idempotency_key: idempotencyKey,
      period_strategy: input.rule.period_strategy,
      period_from: params.date_from,
      period_to: params.date_to,
      period_from_time: params.time_from ?? null,
      period_to_time: params.time_to ?? null,
      unknown_doc_time_count: run.unknown_doc_time_count,
      report_run_ids: reportRunIds,
      delivery_ids: deliveries.map((delivery) => delivery.id),
      delivery_statuses: deliveries.map((delivery) => delivery.status),
    },
  });

  const successfulDelivery = deliveries.find(
    (delivery) => delivery.status === "success",
  );
  return {
    ok: true,
    status: successfulDelivery ? "sent" : deliveries.length ? "processed" : "skipped",
    run,
    deliveries,
    report_run_ids: reportRunIds,
    mode: input.mode,
  };
}

async function runAndPersistReportByKey(input: {
  tenantId: TenantId;
  reportKey: ReportKey;
  params: SalesGoodsServicesParams;
  requestAction: string;
}): Promise<
  | {
      ok: true;
      snapshot: ReportSnapshot;
      runRecord: ReportRunRecord;
    }
  | {
      ok: false;
      statusCode: 424 | 500;
      error: string;
      runRecord: ReportRunRecord;
    }
> {
  const result = await runReportRuntimeEntry(
    reportRuntimeRegistry,
    input.reportKey,
    input,
  );
  if (result) {
    return result;
  }

  return persistMissingReportRuntime(input);
}

async function persistMissingReportRuntime(input: {
  tenantId: TenantId;
  reportKey: ReportKey;
  params: SalesGoodsServicesParams;
  requestAction: string;
}): Promise<{
  ok: false;
  statusCode: 500;
  error: string;
  runRecord: ReportRunRecord;
}> {
  const now = new Date().toISOString();
  const safeErrorMessage =
    "รายงานนี้ยังไม่ได้ตั้งค่าตัวประมวลผล กรุณาติดต่อผู้ดูแลระบบ";
  const runRecord: ReportRunRecord = {
    id: createRunId(input.tenantId, input.reportKey),
    tenant_id: input.tenantId,
    report_key: input.reportKey,
    params: input.params,
    status: "failed",
    started_at: now,
    finished_at: now,
    row_count: 0,
    safe_error_message: safeErrorMessage,
  };

  await systemStore.upsertRun(runRecord);
  await systemStore.appendAuditLog({
    tenant_id: input.tenantId,
    actor_id: null,
    action: "report_runtime_missing",
    target_type: "report_run",
    target_id: runRecord.id,
    metadata_json: {
      report_key: input.reportKey,
      request_action: input.requestAction,
    },
  });

  return {
    ok: false,
    statusCode: 500,
    error: safeErrorMessage,
    runRecord,
  };
}

async function buildNotificationReportPreview(input: {
  tenant: { id: TenantId; name: string };
  target: StoredLineTargetRecord;
  snapshot: ReportSnapshot;
}) {
  const openViewerPermission = canAccessLineReport({
    tenantId: input.tenant.id,
    target: input.target,
    reportKey: input.snapshot.report_key,
    action: "open_signed_viewer",
  });
  const runtimeEntry = getReportRuntimeEntry(
    reportRuntimeRegistry,
    input.snapshot.report_key,
  );
  const supportsSignedViewer = runtimeEntry?.supportsSignedViewer ?? false;
  const dashboardUrl = openViewerPermission.allowed && supportsSignedViewer
    ? await buildReportViewerUrl(input.snapshot)
    : null;

  const preview = renderReportLinePreview(reportRuntimeRegistry, {
    snapshot: input.snapshot,
    dashboardUrl,
    tenantName: input.tenant.name,
  });
  if (!preview) {
    throw new Error(`Missing LINE preview renderer for ${input.snapshot.report_key}`);
  }
  return preview;
}

async function validateNotificationRulePayload(input: {
  tenant_id: TenantId;
  name: string;
  enabled: boolean;
  timezone: string;
  period_preset: NotificationRuleRecord["period_preset"];
  period_strategy: NotificationRuleRecord["period_strategy"];
  schedule: NotificationRuleRecord["schedule"];
  report_keys: ReportKey[];
  target_ids: string[];
}): Promise<
  | { ok: true; details: [] }
  | {
      ok: false;
      error: string;
      details: Array<{
        target_id?: string;
        report_key?: ReportKey;
        reason: string;
        message: string;
      }>;
    }
> {
  const tenant = await getTenantOrNull(input.tenant_id);
  if (!tenant) {
    return {
      ok: false,
      error: "ไม่พบร้านค้าที่เลือก",
      details: [{ reason: "tenant_not_found", message: "ไม่พบร้านค้าที่เลือก" }],
    };
  }

  const details: Array<{
    target_id?: string;
    report_key?: ReportKey;
    reason: string;
    message: string;
  }> = [];
  if (input.enabled) {
    const access = tenantAccessStatus(tenant);
    if (!access.enabled) {
      details.push({
        reason: "tenant_not_active",
        message:
          tenant.status === "cancelled"
            ? "ร้านนี้ถูกยกเลิกแล้ว กรุณาเปิดใช้งานร้านก่อนเปิดแผนแจ้งเตือน"
            : "ร้านนี้ถูกระงับ กรุณาเปิดใช้งานร้านก่อนเปิดแผนแจ้งเตือน",
      });
    }

    const datasource = await resolveTenantDatasourceConfig(input.tenant_id);
    if (!datasource) {
      details.push({
        reason: "sml_javaws_not_ready",
        message:
          "ยังไม่ได้ตั้งค่า SML JavaWS หรือยังไม่ได้ย้ายร้านนี้เป็น JavaWS",
      });
    }
    if (!input.schedule.some((entry) => entry.weekdays.length && entry.times.length)) {
      details.push({
        reason: "schedule_missing",
        message: "กรุณาเลือกวันและเวลาอย่างน้อย 1 รอบก่อนเปิดใช้งาน",
      });
    }
    if (!uniqueStrings(input.target_ids).length) {
      details.push({
        reason: "line_target_missing",
        message: "กรุณาเลือกผู้รับ LINE อย่างน้อย 1 รายก่อนเปิดใช้งาน",
      });
    }

  }

  for (const targetId of uniqueStrings(input.target_ids)) {
    const target = await getEffectiveLineTargetById(targetId);
    if (!target) {
      details.push({
        target_id: targetId,
        reason: "target_not_found",
        message: "ไม่พบปลายทาง LINE นี้",
      });
      continue;
    }
    if (target.tenant_id !== input.tenant_id) {
      details.push({
        target_id: targetId,
        reason: "tenant_mismatch",
        message: "ปลายทาง LINE ไม่ได้อยู่ในร้านนี้",
      });
      continue;
    }

    for (const reportKey of uniqueReportKeys(input.report_keys)) {
      const permission = canAccessLineReport({
        tenantId: input.tenant_id,
        target,
        reportKey,
        action: "receive_morning_brief",
      });
      if (!permission.allowed) {
        details.push({
          target_id: targetId,
          report_key: reportKey,
          reason: permission.reason,
          message: permission.message,
        });
      }
    }
  }

  if (details.length) {
    return {
      ok: false,
      error:
        input.enabled
          ? "แผนแจ้งเตือนยังเปิดใช้งานไม่ได้ กรุณาแก้รายการที่ต้องทำก่อน"
          : "ปลายทาง LINE บางรายการยังไม่มีสิทธิ์รับรายงานที่เลือก กรุณาอนุมัติหรือปรับสิทธิ์ก่อนบันทึก",
      details,
    };
  }

  return { ok: true, details: [] };
}

function toOwnerNotificationRule(rule: NotificationRuleRecord) {
  return {
    ...rule,
    next_run: getNextNotificationRunAt({ rule }),
  };
}

function notificationRuleAuditMetadata(rule: NotificationRuleRecord) {
  return {
    tenant_id: rule.tenant_id,
    enabled: rule.enabled,
    timezone: rule.timezone,
    period_preset: rule.period_preset,
    period_strategy: rule.period_strategy,
    schedule: rule.schedule,
    report_keys: rule.report_keys,
    target_ids_count: rule.target_ids.length,
    message_packaging: rule.message_packaging,
    digest_mode: rule.digest_mode,
  };
}

function tenantAuditSnapshot(tenant: Tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    plan_code: tenant.planCode,
    description: tenant.description,
    feature_flags: getTenantFeatureFlags(tenant),
    business_signal_thresholds: businessSignalThresholdsSchema.parse(
      tenant.businessSignalThresholds ?? {},
    ),
    current_period_end: tenant.currentPeriodEnd,
    suspended_reason: tenant.suspendedReason,
  };
}

function tenantUpdateAuditAction(
  before: Tenant["status"],
  after: Tenant["status"],
) {
  if (before === after) {
    return "owner_tenant_updated";
  }
  if (after === "suspended") {
    return "owner_tenant_suspended";
  }
  if (before === "cancelled") {
    return "owner_tenant_reactivated";
  }
  if (before === "suspended") {
    return "owner_tenant_reactivated";
  }
  return "owner_tenant_status_changed";
}

async function buildTenantDeleteImpact(tenant: Tenant) {
  const [
    notificationRules,
    notificationRuns,
    lineTargets,
    lineChannels,
    reportRuns,
    latestSnapshot,
    lineDeliveries,
  ] = await Promise.all([
    systemStore.listNotificationRules(tenant.id),
    systemStore.listNotificationRuleRuns({ tenantId: tenant.id, limit: 100 }),
    systemStore.listLineTargets(tenant.id),
    listEffectiveLineChannels(tenant.id),
    systemStore.listRuns(tenant.id),
    systemStore.getLatestSnapshot(tenant.id),
    systemStore.listLineDeliveries(tenant.id),
  ]);

  const runningRuns = notificationRuns.filter((run) => run.status === "running");
  const blockers = runningRuns.length
    ? [
        {
          reason: "notification_run_running",
          message: "มีแผนแจ้งเตือนกำลังทำงานอยู่ กรุณารอให้จบก่อนยกเลิกร้าน",
          count: runningRuns.length,
        },
      ]
    : [];
  const tenantSlug = getTenantSlug(tenant.id);

  return {
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    tenant_status: tenant.status,
    dashboard_path: tenantSlug ? `/app/${tenantSlug}` : null,
    notification_rules_total: notificationRules.length,
    notification_rules_enabled: notificationRules.filter((rule) => rule.enabled)
      .length,
    notification_rule_runs_recent: notificationRuns.length,
    notification_rule_runs_running: runningRuns.length,
    line_targets_total: lineTargets.length,
    line_targets_enabled: lineTargets.filter((target) => target.enabled).length,
    line_channels_total: lineChannels.length,
    report_runs_recent: reportRuns.length,
    latest_report_run_at:
      reportRuns[0]?.finished_at ?? reportRuns[0]?.started_at ?? null,
    latest_snapshot_at: latestSnapshot?.generated_at ?? null,
    latest_line_delivery_at:
      lineDeliveries[0]?.sent_at ?? lineDeliveries[0]?.created_at ?? null,
    can_cancel: blockers.length === 0,
    blockers,
  };
}

function normalizeNotificationSchedulePayload(
  schedule: NotificationRuleRecord["schedule"],
) {
  return schedule.map((entry) => ({
    weekdays: [...new Set(entry.weekdays)].sort((a, b) => a - b),
    times: [...new Set(entry.times)].sort(),
  }));
}

function uniqueReportKeys(reportKeys: ReportKey[]) {
  return [...new Set(reportKeys)];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildReportPermissionCatalog() {
  return reportDefinitionSeeds.map((definition) => ({
    report_key: definition.report_key,
    label: getReportCatalogEntry(definition.report_key).permissionLabel,
    description: getReportCatalogEntry(definition.report_key)
      .permissionDescription,
    sensitive: getReportCatalogEntry(definition.report_key).sensitive,
  }));
}

function isGrossProfitReportKey(reportKey: ReportKey) {
  return getReportCatalogEntry(reportKey).category === "gross_profit";
}

function isDocumentDetailReportKey(
  reportKey: ReportKey,
): reportKey is Extract<
  ReportKey,
  "sales_goods_services" | "purchase_goods_payables"
> {
  const category = getReportCatalogEntry(reportKey).category;
  return category === "sales" || category === "purchase";
}

function isSignedViewerPdfSnapshot(
  snapshot: ReportSnapshot,
): snapshot is SignedViewerPdfSnapshot {
  return (
    snapshot.report_key === "sales_goods_services" ||
    snapshot.report_key === "purchase_goods_payables"
  );
}

function isClassicReportSnapshot(
  snapshot: ReportSnapshot,
): snapshot is SalesGoodsServicesSnapshot | PurchaseGoodsPayablesSnapshot {
  return isSignedViewerPdfSnapshot(snapshot);
}

function buildDefaultTenantReportRolePermission(input: {
  tenantId: TenantId;
  profileKey: LineAccessProfileKey;
  updatedAt?: string;
}): TenantReportRolePermissionRecord {
  return {
    tenant_id: input.tenantId,
    access_profile_key: input.profileKey,
    allowed_report_keys: [
      ...lineAccessProfileDefaults[input.profileKey].allowed_report_keys,
    ],
    updated_at: input.updatedAt ?? new Date().toISOString(),
  };
}

async function ensureTenantReportRolePermissions(tenantId: TenantId) {
  const existing = await systemStore.listTenantReportRolePermissions(tenantId);
  const byRole = new Map(
    existing.map((permission) => [
      permission.access_profile_key,
      permission,
    ]),
  );
  let changed = existing.length < lineAccessProfileKeys.length;
  const merged = lineAccessProfileKeys.map((profileKey) => {
    const existingPermission = byRole.get(profileKey);
    if (!existingPermission) {
      return buildDefaultTenantReportRolePermission({ tenantId, profileKey });
    }

    const normalizedReportKeys = uniqueReportKeys(
      existingPermission.allowed_report_keys,
    );
    const upgradedReportKeys = shouldUpgradeLegacyDefaultReportKeys({
      profileKey,
      currentReportKeys: normalizedReportKeys,
    })
      ? [...lineAccessProfileDefaults[profileKey].allowed_report_keys]
      : normalizedReportKeys;
    if (!sameReportKeySet(normalizedReportKeys, upgradedReportKeys)) {
      changed = true;
    }

    return {
      ...existingPermission,
      allowed_report_keys: upgradedReportKeys,
    };
  });

  if (changed) {
    return (
      await systemStore.saveTenantReportRolePermissions({
        tenantId,
        permissions: merged,
      })
    ).permissions;
  }

  return merged;
}

function shouldUpgradeLegacyDefaultReportKeys(input: {
  profileKey: LineAccessProfileKey;
  currentReportKeys: ReportKey[];
}) {
  const legacyDefaults: Record<LineAccessProfileKey, ReportKey[][]> = {
    executive: [
      ["sales_goods_services", "purchase_goods_payables"],
      [
        "sales_goods_services",
        "purchase_goods_payables",
        "gross_profit_by_product",
        "gross_profit_by_ar_customer",
      ],
      [
        "sales_goods_services",
        "purchase_goods_payables",
        "gross_profit_by_product",
        "gross_profit_by_ar_customer",
        "stock_balance",
      ],
    ],
    sales_manager: [["sales_goods_services"]],
    operations: [["purchase_goods_payables"]],
    staff: [[]],
  };
  return legacyDefaults[input.profileKey].some((defaultReportKeys) =>
    sameReportKeySet(input.currentReportKeys, defaultReportKeys),
  );
}

function sameReportKeySet(left: ReportKey[], right: ReportKey[]) {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((reportKey) => rightSet.has(reportKey));
}

async function backfillTenantReportRolePermissions() {
  const tenants = await systemStore.listTenants();
  for (const tenant of tenants) {
    await ensureTenantReportRolePermissions(tenant.id);
  }
}

async function getAllowedReportKeysForTenantRole(
  tenantId: TenantId,
  profileKey: LineAccessProfileKey,
) {
  const permissions = await ensureTenantReportRolePermissions(tenantId);
  return (
    permissions.find((permission) => permission.access_profile_key === profileKey)
      ?.allowed_report_keys ?? []
  );
}

async function applyTenantRolePermissionDefaults(
  target: StoredLineTargetRecord,
  profileKey: LineAccessProfileKey,
) {
  return applyLineAccessProfileDefaults(
    target,
    profileKey,
    await getAllowedReportKeysForTenantRole(target.tenant_id, profileKey),
  );
}

async function buildCandidateTenantReportRolePermissions(input: {
  tenantId: TenantId;
  updates: Array<{
    access_profile_key: LineAccessProfileKey;
    allowed_report_keys: ReportKey[];
  }>;
}) {
  const current = await ensureTenantReportRolePermissions(input.tenantId);
  const updateByRole = new Map(
    input.updates.map((update) => [
      update.access_profile_key,
      uniqueReportKeys(update.allowed_report_keys),
    ]),
  );
  const now = new Date().toISOString();
  return lineAccessProfileKeys.map((profileKey) => {
    const existing =
      current.find((permission) => permission.access_profile_key === profileKey) ??
      buildDefaultTenantReportRolePermission({
        tenantId: input.tenantId,
        profileKey,
      });
    return {
      ...existing,
      allowed_report_keys:
        updateByRole.get(profileKey) ?? existing.allowed_report_keys,
      updated_at: now,
    };
  });
}

function buildPermissionMatrix(
  permissions: TenantReportRolePermissionRecord[],
) {
  return Object.fromEntries(
    permissions.map((permission) => [
      permission.access_profile_key,
      permission.allowed_report_keys,
    ]),
  );
}

function summarizeReportRolePermissions(
  permissions: TenantReportRolePermissionRecord[],
) {
  return Object.fromEntries(
    permissions.map((permission) => [
      permission.access_profile_key,
      permission.allowed_report_keys,
    ]),
  );
}

async function findImpactedNotificationPlans(input: {
  tenantId: TenantId;
  permissions: TenantReportRolePermissionRecord[];
}) {
  const matrix = buildPermissionMatrix(input.permissions);
  const [rules, targets] = await Promise.all([
    systemStore.listNotificationRules(input.tenantId),
    systemStore.listLineTargets(input.tenantId),
  ]);
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const impacts: Array<{
    rule_id: string;
    rule_name: string;
    target_id: string;
    target_display_name: string;
    access_profile_key: LineAccessProfileKey;
    report_key: ReportKey;
    report_label: string;
  }> = [];

  for (const rule of rules.filter((item) => item.enabled)) {
    for (const targetId of rule.target_ids) {
      const target = targetsById.get(targetId);
      if (!target) {
        continue;
      }
      const allowedReportKeys = matrix[target.access_profile_key] ?? [];
      for (const reportKey of rule.report_keys) {
        if (!allowedReportKeys.includes(reportKey)) {
          impacts.push({
            rule_id: rule.id,
            rule_name: rule.name,
            target_id: target.id,
            target_display_name: target.display_name,
            access_profile_key: target.access_profile_key,
            report_key: reportKey,
            report_label: getReportCatalogEntry(reportKey).permissionLabel,
          });
        }
      }
    }
  }

  return impacts;
}

async function buildTenantReportPermissionsResponse(
  tenantId: TenantId,
  tenants: Awaited<ReturnType<typeof systemStore.listTenants>>,
) {
  const permissions = await ensureTenantReportRolePermissions(tenantId);
  const [targets, impactedNotificationPlans] = await Promise.all([
    systemStore.listLineTargets(tenantId),
    findImpactedNotificationPlans({
      tenantId,
      permissions,
    }),
  ]);
  const targetCounts = Object.fromEntries(
    lineAccessProfileKeys.map((profileKey) => [
      profileKey,
      targets.filter((target) => target.access_profile_key === profileKey).length,
    ]),
  );

  return {
    tenants: tenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
    })),
    selected_tenant_id: tenantId,
    reports: buildReportPermissionCatalog(),
    roles: lineAccessProfileKeys.map((profileKey) => ({
      access_profile_key: profileKey,
      label: lineAccessProfileDefaults[profileKey].label,
      target_count: targetCounts[profileKey] ?? 0,
    })),
    permissions,
    matrix: buildPermissionMatrix(permissions),
    target_counts: targetCounts,
    impacted_notification_plans: impactedNotificationPlans,
  };
}

async function buildOwnerTenantSummary(tenantId: TenantId) {
  const tenants = await systemStore.listTenants();
  const tenant = tenants.find((item) => item.id === tenantId);
  if (!tenant) {
    return null;
  }

  const [
    snapshot,
    runs,
    deliveries,
    lineTargets,
    lineChannels,
    users,
    notificationRules,
    notificationRuns,
    businessSignals,
    datasource,
  ] =
    await Promise.all([
      systemStore.getLatestSnapshot(tenantId),
      systemStore.listRuns(tenantId),
      systemStore.listLineDeliveries(tenantId),
      systemStore.listLineTargets(tenantId),
      listEffectiveLineChannels(tenantId),
      systemStore.listUsers(tenantId),
      systemStore.listNotificationRules(tenantId),
      systemStore.listNotificationRuleRuns({ tenantId, limit: 20 }),
      systemStore.listBusinessSignals({ tenantId, status: "open", limit: 20 }),
      readDatasourceConfigStatus({
        store: systemStore,
        tenantId,
        envConfig: readDatasourceConfig(tenantId),
      }),
    ]);
  const latestRun = runs[0] ?? null;
  const latestDelivery = deliveries[0] ?? null;
  const criticalSignals = businessSignals.filter(
    (signal) => signal.severity === "critical",
  );
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
      datasource_configured: datasource.kind === "sml_javaws",
      line_channels: lineChannels.length,
      line_targets_total: lineTargets.length,
      line_targets_enabled: enabledTargets.length,
      users: users.filter((user) => user.enabled).length,
      latest_report_run_at: latestRun?.finished_at ?? latestRun?.started_at ?? null,
      latest_report_status: latestRun?.status ?? null,
      latest_snapshot_at: snapshot?.generated_at ?? null,
      latest_line_delivery_at: latestDelivery?.sent_at ?? latestDelivery?.created_at ?? null,
      latest_line_delivery_status: latestDelivery?.status ?? null,
      notification_rules_total: notificationRules.length,
      notification_rules_enabled: notificationRules.filter((rule) => rule.enabled).length,
      latest_notification_run_at:
        notificationRuns[0]?.finished_at ??
        notificationRuns[0]?.started_at ??
        null,
      latest_notification_run_status: notificationRuns[0]?.status ?? null,
      latest_notification_run_error:
        notificationRuns[0]?.safe_error_message ?? null,
      open_business_signals: businessSignals.length,
      critical_business_signals: criticalSignals.length,
      latest_business_signal_at: businessSignals[0]?.updated_at ?? null,
    },
  };
}

async function buildOwnerStoreSetupDetail(tenantId: TenantId) {
  const summary = await buildOwnerTenantSummary(tenantId);
  if (!summary) {
    return null;
  }

  const [
    datasource,
    lineChannels,
    lineTargets,
    notificationRules,
    runs,
    businessSignals,
  ] =
    await Promise.all([
      readDatasourceConfigStatus({
        store: systemStore,
        tenantId,
        envConfig: readDatasourceConfig(tenantId),
      }),
      listEffectiveLineChannels(tenantId),
      enrichLineTargetDisplayNames(await listEffectiveLineTargets(tenantId)),
      systemStore.listNotificationRules(tenantId),
      systemStore.listRuns(tenantId),
      systemStore.listBusinessSignals({ tenantId, status: "open", limit: 10 }),
    ]);
  const safeTargets = lineTargets.map(toSafeLineTargetRecord);
  const checks = buildStoreSetupReadinessChecks({
    summary,
    datasource,
    lineChannels,
    lineTargets: safeTargets,
    notificationRules,
    runs,
  });

  return {
    summary,
    datasource,
    line_channels: lineChannels,
    line_targets: safeTargets,
    notification_rules: notificationRules.map(toOwnerNotificationRule),
    business_signals: businessSignals,
    readiness: {
      ready: checks.every((check) => check.ok),
      completed: checks.filter((check) => check.ok).length,
      total: checks.length,
      next_action: checks.find((check) => !check.ok) ?? null,
      checks,
    },
  };
}

function buildStoreSetupReadinessChecks(input: {
  summary: NonNullable<Awaited<ReturnType<typeof buildOwnerTenantSummary>>>;
  datasource: Awaited<ReturnType<typeof readDatasourceConfigStatus>>;
  lineChannels: LineChannelRecord[];
  lineTargets: ReturnType<typeof toSafeLineTargetRecord>[];
  notificationRules: NotificationRuleRecord[];
  runs: ReportRunRecord[];
}) {
  const hasSuccessfulReportRun = (reportKey: ReportKey) =>
    input.runs.some((run) => run.report_key === reportKey && run.status === "success");
  const enabledTargets = input.lineTargets.filter(
    (target) =>
      target.approved &&
      target.enabled &&
      target.allowed_actions.includes("receive_morning_brief"),
  );

  return [
    {
      key: "store_active",
      ok: input.summary.access.enabled,
      label: "เปิดใช้งานร้าน",
      detail: input.summary.access.message,
      href: "/owner/tenants",
    },
    {
      key: "sml_javaws",
      ok: input.datasource.kind === "sml_javaws",
      label: "เชื่อม SML ผ่าน JavaWS",
      detail:
        input.datasource.kind === "sml_javaws"
          ? `${input.datasource.base_url ?? "Tomcat"} · ${input.datasource.database ?? "database"}`
          : "กรอก Tomcat URL, port, SMLConfig และ database",
      href: `/owner/sml-connections?tenant=${encodeURIComponent(
        input.summary.tenant.id,
      )}`,
    },
    {
      key: "report_test",
      ok:
        hasSuccessfulReportRun("sales_goods_services") ||
        hasSuccessfulReportRun("purchase_goods_payables"),
      label: "ทดสอบรายงานสำเร็จ",
      detail: "รันอย่างน้อยหนึ่งรายงานให้สำเร็จก่อนเปิดแผนแจ้งเตือน",
      href: "/owner/reports",
    },
    {
      key: "line_channel",
      ok: input.lineChannels.some((channel) => channel.enabled),
      label: "มี LINE OA",
      detail: input.lineChannels.length
        ? `${input.lineChannels.length} LINE OA ใช้งานได้`
        : "ใช้ LINE OA กลางหรือเพิ่ม LINE OA ของร้าน",
      href: "/owner/line",
    },
    {
      key: "line_target",
      ok: enabledTargets.length > 0,
      label: "มีผู้รับแจ้งเตือน",
      detail: `${enabledTargets.length}/${input.lineTargets.length} ผู้รับเปิดรับรายงาน`,
      href: "/owner/line",
    },
    {
      key: "notification_plan",
      ok: input.notificationRules.some((rule) => rule.enabled),
      label: "มีแผนแจ้งเตือนที่เปิดใช้งาน",
      detail: input.notificationRules.length
        ? "มี draft แล้ว เปิดใช้งานเมื่อ readiness ผ่าน"
        : "กำหนดรายงาน ผู้รับ วัน และเวลา",
      href: `/owner/notifications?tenant=${encodeURIComponent(
        input.summary.tenant.id,
      )}`,
    },
  ];
}

const SHARED_LINE_TARGET_ID_PREFIX = "line_target_shared__";

async function listOwnerLineRecipients(): Promise<LineRecipientRecord[]> {
  const [targets, channels, tenants] = await Promise.all([
    systemStore.listLineTargets(),
    systemStore.listLineChannels(),
    systemStore.listTenants(),
  ]);
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const tenantNameById = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
  const targetsByHash = new Map<string, StoredLineTargetRecord[]>();

  for (const target of targets) {
    if (target.source === "env_fallback" || isSharedLineTargetId(target.id)) {
      continue;
    }
    targetsByHash.set(target.target_id_hash, [
      ...(targetsByHash.get(target.target_id_hash) ?? []),
      target,
    ]);
  }

  return [...targetsByHash.entries()]
    .map(([targetIdHash, groupedTargets]) => {
      const sourceTarget = groupedTargets.reduce((best, candidate) =>
        lineRecipientSourceScore(candidate, channelById) >
        lineRecipientSourceScore(best, channelById)
          ? candidate
          : best,
      );
      const channel = sourceTarget.line_channel_id
        ? channelById.get(sourceTarget.line_channel_id) ?? null
        : null;
      const assignedTenantIds = [
        ...new Set(groupedTargets.map((target) => target.tenant_id)),
      ].sort();

      return {
        id: `line_recipient_${targetIdHash.slice(0, 16)}`,
        source_target_id: sourceTarget.id,
        source_tenant_id: sourceTarget.tenant_id,
        source_tenant_name:
          tenantNameById.get(sourceTarget.tenant_id) ?? sourceTarget.tenant_id,
        display_name: sourceTarget.display_name,
        target_type: sourceTarget.target_type,
        target_id_masked: sourceTarget.target_id_masked,
        target_id_hash: targetIdHash,
        line_channel_id: sourceTarget.line_channel_id,
        line_channel_display_name: channel?.display_name ?? null,
        line_channel_scope: channel?.scope ?? null,
        line_channel_token_configured:
          channel?.channel_access_token_configured ?? false,
        assigned_tenant_ids: assignedTenantIds,
        assignment_count: assignedTenantIds.length,
        source: sourceTarget.source,
        last_delivery_at: sourceTarget.last_delivery_at,
        created_at: sourceTarget.created_at,
        updated_at: sourceTarget.updated_at,
      } satisfies LineRecipientRecord;
    })
    .sort((left, right) =>
      right.updated_at.localeCompare(left.updated_at) ||
      left.display_name.localeCompare(right.display_name),
    );
}

function lineRecipientSourceScore(
  target: StoredLineTargetRecord,
  channelById: Map<string, LineChannelRecord>,
) {
  const channel = target.line_channel_id
    ? channelById.get(target.line_channel_id)
    : null;
  return [
    channel ? 100 : 0,
    channel?.scope === "owner_shared" ? 40 : 0,
    target.approved ? 20 : 0,
    target.enabled ? 10 : 0,
    target.source === "webhook" ? 5 : 0,
    Date.parse(target.updated_at) / 1_000_000_000,
  ].reduce((total, item) => total + item, 0);
}

function validateLineChannelAssignment(input: {
  tenantId: TenantId;
  sourceTarget: StoredLineTargetRecord;
  lineChannel: LineChannelRecord;
}):
  | { ok: true }
  | {
      ok: false;
      error: string;
    } {
  const channelScope = input.lineChannel.scope ?? "tenant";
  if (
    input.sourceTarget.line_channel_id &&
    input.sourceTarget.line_channel_id !== input.lineChannel.id
  ) {
    return {
      ok: false,
      error:
        "ผู้รับ LINE นี้ถูกค้นพบจาก LINE OA อื่น กรุณาเลือก LINE OA เดิมของผู้รับคนนี้",
    };
  }

  if (channelScope === "owner_shared") {
    return { ok: true };
  }

  if (input.lineChannel.tenant_id !== input.tenantId) {
    return {
      ok: false,
      error: "LINE OA ร้านเองต้องเป็น LINE OA ของร้านที่กำลังตั้งค่าเท่านั้น",
    };
  }

  if (
    !input.sourceTarget.line_channel_id &&
    input.sourceTarget.tenant_id !== input.tenantId
  ) {
    return {
      ok: false,
      error:
        "ผู้รับนี้ยังไม่รู้ว่ามาจาก LINE OA ใด ถ้าจะใช้ข้ามร้านต้องเลือก LINE OA กลาง",
    };
  }

  return { ok: true };
}

async function listEffectiveLineChannels(tenantId?: TenantId) {
  const storedChannels = await systemStore.listLineChannels();
  const scopedStoredChannels = tenantId
    ? storedChannels.filter(
        (channel) =>
          channel.tenant_id === tenantId || channel.scope === "owner_shared",
      )
    : storedChannels;
  return uniqueLineChannels(scopedStoredChannels);
}

function uniqueLineChannels(channels: LineChannelRecord[]) {
  const seen = new Set<string>();
  return channels.filter((channel) => {
    if (seen.has(channel.id)) {
      return false;
    }
    seen.add(channel.id);
    return true;
  });
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
  const config = storedConfig ?? readDatasourceConfig(tenantId);
  return isJavaWsDatasourceConfig(config) ? config : null;
}

function isJavaWsDatasourceConfig(
  config: DatasourceConfig | null,
): config is JavaWsDatasourceConfig {
  return config?.kind === "sml_javaws";
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
  return systemStore.listLineTargets(tenantId);
}

async function listOwnerSharedLineTargetsForTenant(input: {
  tenantId: TenantId;
  existingTargets: StoredLineTargetRecord[];
}) {
  const sharedChannels = await listOwnerSharedLineChannels();
  if (!sharedChannels.length) {
    return [];
  }

  const canonicalTargets = await systemStore.listLineTargets();
  const sharedTargets: StoredLineTargetRecord[] = [];
  const existingHashes = new Set(
    input.existingTargets.map((target) => target.target_id_hash),
  );

  for (const target of canonicalTargets) {
    if (target.tenant_id === input.tenantId) {
      continue;
    }
    if (existingHashes.has(target.target_id_hash)) {
      continue;
    }

    const sharedChannelId = resolveOwnerSharedLineChannelId(
      target,
      sharedChannels,
    );
    if (!sharedChannelId) {
      continue;
    }

    const sharedTarget = buildOwnerSharedLineTargetForTenant({
      tenantId: input.tenantId,
      sourceTarget: target,
      lineChannelId: sharedChannelId,
    });
    sharedTargets.push(sharedTarget);
    existingHashes.add(sharedTarget.target_id_hash);
  }

  return sharedTargets;
}

async function listOwnerSharedLineChannels() {
  return (await systemStore.listLineChannels()).filter(
    (channel) => channel.enabled && channel.scope === "owner_shared",
  );
}

function resolveOwnerSharedLineChannelId(
  target: StoredLineTargetRecord,
  sharedChannels: LineChannelRecord[],
) {
  if (
    target.line_channel_id &&
    sharedChannels.some((channel) => channel.id === target.line_channel_id)
  ) {
    return target.line_channel_id;
  }

  const legacyEnvChannel = sharedChannels.find(
    (channel) => channel.source === "env" && channel.tenant_id === target.tenant_id,
  );
  if (!target.line_channel_id && legacyEnvChannel) {
    return legacyEnvChannel.id;
  }

  return null;
}

function buildSharedLineTargetId(input: {
  tenantId: TenantId;
  sourceTarget: StoredLineTargetRecord;
}) {
  return `${SHARED_LINE_TARGET_ID_PREFIX}${input.tenantId}__${input.sourceTarget.target_id_hash.slice(
    0,
    16,
  )}`;
}

function parseSharedLineTargetId(id: string) {
  if (!id.startsWith(SHARED_LINE_TARGET_ID_PREFIX)) {
    return null;
  }

  const rest = id.slice(SHARED_LINE_TARGET_ID_PREFIX.length);
  const separatorIndex = rest.lastIndexOf("__");
  if (separatorIndex <= 0) {
    return null;
  }

  const tenantId = rest.slice(0, separatorIndex);
  const hashPrefix = rest.slice(separatorIndex + 2);
  const parsedTenant = tenantIdSchema.safeParse(tenantId);
  if (!parsedTenant.success || !/^[a-f0-9]{16}$/i.test(hashPrefix)) {
    return null;
  }

  return {
    tenantId: parsedTenant.data,
    hashPrefix: hashPrefix.toLowerCase(),
  };
}

function isSharedLineTargetId(id: string) {
  return Boolean(parseSharedLineTargetId(id));
}

function buildOwnerSharedLineTargetForTenant(input: {
  tenantId: TenantId;
  sourceTarget: StoredLineTargetRecord;
  lineChannelId: string;
}): StoredLineTargetRecord {
  return {
    ...input.sourceTarget,
    id: buildSharedLineTargetId({
      tenantId: input.tenantId,
      sourceTarget: input.sourceTarget,
    }),
    tenant_id: input.tenantId,
    line_channel_id: input.lineChannelId,
  };
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

    if (target.source !== "env_fallback" && !isSharedLineTargetId(target.id)) {
      await systemStore.upsertLineTarget(updatedTarget);
    }
  }

  return enrichedTargets;
}

async function getEffectiveLineTargetById(id: string) {
  const sharedTarget = parseSharedLineTargetId(id);
  if (sharedTarget) {
    const tenant = await getTenantOrNull(sharedTarget.tenantId);
    if (!tenant) {
      return null;
    }

    const sharedChannels = await listOwnerSharedLineChannels();
    const sourceTargets = await systemStore.listLineTargets();
    for (const sourceTarget of sourceTargets) {
      if (!sourceTarget.target_id_hash.startsWith(sharedTarget.hashPrefix)) {
        continue;
      }

      const sharedChannelId = resolveOwnerSharedLineChannelId(
        sourceTarget,
        sharedChannels,
      );
      if (!sharedChannelId || sourceTarget.tenant_id === sharedTarget.tenantId) {
        continue;
      }

      return buildOwnerSharedLineTargetForTenant({
        tenantId: sharedTarget.tenantId,
        sourceTarget,
        lineChannelId: sharedChannelId,
      });
    }

    return null;
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

  return null;
}

async function markLineTargetDelivered(
  target: StoredLineTargetRecord,
  sentAt: string,
) {
  if (target.source === "env_fallback") {
    return;
  }
  if (isSharedLineTargetId(target.id)) {
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

function requireAdminMutation(request: FastifyRequest) {
  return verifyOwnerSessionCookie({
    cookieValue: request.cookies[OWNER_AUTH_COOKIE],
  });
}

const OWNER_ADMIN_PASSWORD_SCOPE = "system";
const OWNER_ADMIN_PASSWORD_SECRET_KEY = "password_hash";
const OWNER_ADMIN_PASSWORD_KEY_ID = "bootstrap:secret_key";

async function hasConfiguredOwnerAdmin() {
  const ownerAdmins = (await systemStore.listUsers()).filter(
    (user) => user.role === "owner_admin" && user.enabled,
  );
  for (const user of ownerAdmins) {
    if (await readOwnerAdminPasswordHash(user.id)) {
      return true;
    }
  }
  return false;
}

async function verifyOwnerAdminPassword(input: {
  username: string;
  password: string;
}) {
  const username = input.username.trim().toLowerCase();
  const ownerAdmins = (await systemStore.listUsers()).filter(
    (user) =>
      user.role === "owner_admin" &&
      user.enabled &&
      (user.email.toLowerCase() === username || user.id.toLowerCase() === username),
  );

  for (const user of ownerAdmins) {
    const passwordHash = await readOwnerAdminPasswordHash(user.id);
    if (passwordHash && verifyPasswordHash(input.password, passwordHash)) {
      return { ok: true as const, user };
    }
  }

  return { ok: false as const };
}

async function createOwnerAdminUser(input: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<UserRecord> {
  const now = new Date().toISOString();
  const username = input.username.trim().toLowerCase();
  const user: UserRecord = {
    id: `owner_admin_${createHash("sha256")
      .update(username)
      .digest("hex")
      .slice(0, 16)}`,
    email: username,
    display_name: input.displayName?.trim() || username,
    role: "owner_admin",
    tenant_id: null,
    enabled: true,
    created_at: now,
    updated_at: now,
  };

  const saved = await systemStore.upsertUser(user);
  await saveOwnerAdminPasswordHash(saved.id, hashOwnerPassword(input.password));
  return saved;
}

async function readOwnerAdminPasswordHash(userId: string) {
  const encryptionSecret = readSecretEncryptionSecret();
  if (!encryptionSecret) {
    return null;
  }
  const secret = await systemStore.getSecretRecord(ownerAdminPasswordSecretId(userId));
  if (!secret) {
    return null;
  }

  return decryptSecret({
    envelope: secret.encrypted_value,
    encryptionSecret,
    aad: ownerAdminPasswordAad(userId),
  });
}

async function saveOwnerAdminPasswordHash(userId: string, passwordHash: string) {
  const encryptionSecret = readSecretEncryptionSecret();
  if (!encryptionSecret) {
    throw new Error("AI_BCC_SECRET_KEY is not configured.");
  }
  const now = new Date().toISOString();
  const existing = await systemStore.getSecretRecord(
    ownerAdminPasswordSecretId(userId),
  );
  const record: SecretRecord = {
    id: ownerAdminPasswordSecretId(userId),
    tenant_id: null,
    scope: OWNER_ADMIN_PASSWORD_SCOPE,
    secret_key: ownerAdminPasswordSecretKey(userId),
    encrypted_value: encryptSecret({
      plaintext: passwordHash,
      encryptionSecret,
      keyId: OWNER_ADMIN_PASSWORD_KEY_ID,
      aad: ownerAdminPasswordAad(userId),
    }),
    encryption_key_id: OWNER_ADMIN_PASSWORD_KEY_ID,
    metadata_json: { owner_admin_user_id: userId },
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await systemStore.upsertSecretRecord(record);
}

function ownerAdminPasswordSecretId(userId: string) {
  return `secret_owner_admin_password_${userId}`;
}

function ownerAdminPasswordSecretKey(userId: string) {
  return `${OWNER_ADMIN_PASSWORD_SECRET_KEY}:${userId}`;
}

function ownerAdminPasswordAad(userId: string) {
  return `owner-admin-password:${userId}`;
}

function hashOwnerPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:v1:${salt}:${hash}`;
}

function verifyPasswordHash(password: string, storedHash: string) {
  const [algorithm, version, salt, expectedHash] = storedHash.split(":");
  if (algorithm !== "scrypt" || version !== "v1" || !salt || !expectedHash) {
    return false;
  }
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "base64url");
  return (
    actual.length === expected.length && timingSafeEqual(actual, expected)
  );
}

async function requireWorkerToken(request: {
  headers: Record<string, string | string[] | undefined>;
}) {
  const runtimeConfig = await readEffectiveSystemRuntimeConfig(systemStore);
  const expectedToken = runtimeConfig.worker_heartbeat_token?.trim();
  if (!expectedToken) {
    return {
      ok: false as const,
      statusCode: 503,
      error: "Worker token is not configured.",
    };
  }

  const headerToken = request.headers["x-ai-bcc-worker-token"];
  const token = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  if (token !== expectedToken) {
    app.log.warn("worker request rejected because token is invalid");
    return {
      ok: false as const,
      statusCode: 401,
      error: "Invalid worker token.",
    };
  }

  return { ok: true as const };
}

async function readReportViewerSigningSecret() {
  const runtimeConfig = await readEffectiveSystemRuntimeConfig(systemStore);
  const secret = runtimeConfig.report_viewer_signing_secret?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

async function readReportViewerLinkTtlSeconds() {
  const runtimeConfig = await readEffectiveSystemRuntimeConfig(systemStore);
  const hours = runtimeConfig.report_viewer_link_ttl_hours;
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
    date_from: yesterday,
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

function toReportParams(input: {
  date_from: string;
  date_to: string;
  time_from?: string | null;
  time_to?: string | null;
}): SalesGoodsServicesParams {
  return salesGoodsServicesParamsSchema.parse({
    date_from: input.date_from,
    date_to: input.date_to,
    time_from: input.time_from ?? undefined,
    time_to: input.time_to ?? undefined,
  });
}

type SignedViewerPdfAccess = {
  tenantId: TenantId;
  reportKey: Extract<
    ReportKey,
    "sales_goods_services" | "purchase_goods_payables"
  >;
  runId: string;
};

type SignedViewerPdfSnapshot =
  | SalesGoodsServicesSnapshot
  | PurchaseGoodsPayablesSnapshot;

type SignedViewerPdfPrepared = {
  ok: true;
  pdf: Buffer;
  filename: string;
  cacheHit: boolean;
  documentCount: number;
  detailRowCount: number;
  cachePath: string;
  durationMs: number;
};

type SignedViewerPdfPrepareResult =
  | SignedViewerPdfPrepared
  | { ok: false; statusCode: number; error: string };

async function prepareSignedViewerPdfRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<
  | { ok: true; result: SignedViewerPdfPrepared }
  | { ok: false; response: FastifyReply }
> {
  const access = await verifySignedViewerRequest({
    params: request.params,
    queryOrBody: request.query,
    reply,
  });
  if (!access.ok) {
    return { ok: false, response: access.response };
  }
  const runtimeEntry = getReportRuntimeEntry(reportRuntimeRegistry, access.reportKey);
  if (!runtimeEntry?.supportsPdf || !isDocumentDetailReportKey(access.reportKey)) {
    return {
      ok: false,
      response: reply.status(400).send({
        error: "รายงานนี้ยังไม่รองรับการดาวน์โหลด PDF",
      }),
    };
  }
  const pdfAccess: SignedViewerPdfAccess = {
    tenantId: access.tenantId,
    reportKey: access.reportKey,
    runId: access.runId,
  };

  const query = viewerPdfQuerySchema.safeParse(request.query ?? {});
  if (!query.success) {
    return {
      ok: false,
      response: reply.status(400).send({
        error: "Invalid PDF export request.",
        details: query.error.flatten().fieldErrors,
      }),
    };
  }

  const requestedParams = toReportParams({
    date_from: query.data.date_from,
    date_to: query.data.date_to,
    time_from: query.data.time_from,
    time_to: query.data.time_to,
  });
  const rangeError = validateViewerReportRange(requestedParams);
  if (rangeError) {
    return {
      ok: false,
      response: reply.status(400).send({ error: rangeError }),
    };
  }

  const snapshot = await systemStore.getSnapshotByRunId(
    pdfAccess.tenantId,
    pdfAccess.runId,
    pdfAccess.reportKey,
  );
  if (!snapshot) {
    return {
      ok: false,
      response: reply.status(404).send({ error: "Snapshot not found" }),
    };
  }
  if (!isSignedViewerPdfSnapshot(snapshot)) {
    return {
      ok: false,
      response: reply.status(400).send({
        error: "รายงานนี้ยังไม่รองรับการดาวน์โหลด PDF",
      }),
    };
  }
  const params = snapshot.params;

  try {
    const prepared = await prepareSignedViewerPdf({
      access: pdfAccess,
      params,
      snapshot,
      request,
    });
    if (!prepared.ok) {
      return {
        ok: false,
        response: reply.status(prepared.statusCode).send({
          error: prepared.error,
        }),
      };
    }

    return { ok: true, result: prepared };
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
      "signed viewer pdf prepare failed",
    );
    return {
      ok: false,
      response: reply.status(500).send({ error: toSafeErrorMessage(error) }),
    };
  }
}

async function prepareSignedViewerPdf(input: {
  access: SignedViewerPdfAccess;
  params: SalesGoodsServicesParams;
  snapshot: SignedViewerPdfSnapshot;
  request: FastifyRequest;
}): Promise<SignedViewerPdfPrepareResult> {
  const startedAt = Date.now();
  const tenantSlug = getTenantSlug(input.access.tenantId);
  const cacheIdentity = {
    tenantId: input.access.tenantId,
    reportKey: input.access.reportKey,
    runId: input.access.runId,
    dateFrom: input.params.date_from,
    dateTo: input.params.date_to,
    timeFrom: input.params.time_from,
    timeTo: input.params.time_to,
  };
  const cacheKey = buildReportPdfCacheKey(cacheIdentity);
  const cachedPdf = await readCachedReportPdf({
    tenantId: input.access.tenantId,
    tenantSlug,
    reportKey: input.access.reportKey,
    runId: input.access.runId,
    dateFrom: input.params.date_from,
    dateTo: input.params.date_to,
    timeFrom: input.params.time_from,
    timeTo: input.params.time_to,
  });
  if (cachedPdf) {
    const durationMs = Date.now() - startedAt;
    input.request.log.info(
      {
        tenant_id: input.access.tenantId,
        report_key: input.access.reportKey,
        run_id: input.access.runId,
        date_from: input.params.date_from,
        date_to: input.params.date_to,
        document_count: input.snapshot.summary.document_count,
        detail_row_count: input.snapshot.summary.line_count,
        cache_hit: true,
        pdf_bytes: cachedPdf.pdf.length,
        duration_ms: durationMs,
      },
      "signed viewer pdf prepare completed",
    );
    return {
      ok: true,
      pdf: cachedPdf.pdf,
      filename: cachedPdf.filename,
      cacheHit: true,
      documentCount: input.snapshot.summary.document_count,
      detailRowCount: input.snapshot.summary.line_count,
      cachePath: cachedPdf.cachePath,
      durationMs,
    };
  }

  const inflight = signedViewerPdfInflightByCacheKey.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const preparePromise = prepareSignedViewerPdfCacheMiss({
    ...input,
    tenantSlug,
    startedAt,
  });
  signedViewerPdfInflightByCacheKey.set(cacheKey, preparePromise);
  try {
    return await preparePromise;
  } finally {
    if (signedViewerPdfInflightByCacheKey.get(cacheKey) === preparePromise) {
      signedViewerPdfInflightByCacheKey.delete(cacheKey);
    }
  }
}

async function prepareSignedViewerPdfCacheMiss(input: {
  access: SignedViewerPdfAccess;
  params: SalesGoodsServicesParams;
  snapshot: SignedViewerPdfSnapshot;
  request: FastifyRequest;
  tenantSlug?: string | null;
  startedAt: number;
}): Promise<SignedViewerPdfPrepareResult> {
  const cachedPdf = await readCachedReportPdf({
    tenantId: input.access.tenantId,
    tenantSlug: input.tenantSlug,
    reportKey: input.access.reportKey,
    runId: input.access.runId,
    dateFrom: input.params.date_from,
    dateTo: input.params.date_to,
    timeFrom: input.params.time_from,
    timeTo: input.params.time_to,
  });
  if (cachedPdf) {
    return {
      ok: true,
      pdf: cachedPdf.pdf,
      filename: cachedPdf.filename,
      cacheHit: true,
      documentCount: input.snapshot.summary.document_count,
      detailRowCount: input.snapshot.summary.line_count,
      cachePath: cachedPdf.cachePath,
      durationMs: Date.now() - input.startedAt,
    };
  }

  const datasource = await resolveTenantDatasourceConfig(input.access.tenantId);
  if (!datasource) {
    return {
      ok: false,
      statusCode: 400,
      error: "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้",
    };
  }

  const preflight =
    input.access.reportKey === "purchase_goods_payables"
      ? await countPurchaseGoodsPayablesPdfRows({
          params: input.params,
          datasource,
        })
      : await countSalesGoodsServicesPdfRows({
          params: input.params,
          datasource,
        });
  const preflightLimit = validateReportPdfLimits(preflight);
  if (!preflightLimit.ok) {
    input.request.log.info(
      {
        tenant_id: input.access.tenantId,
        report_key: input.access.reportKey,
        run_id: input.access.runId,
        date_from: input.params.date_from,
        date_to: input.params.date_to,
        document_count: preflight.documentCount,
        detail_row_count: preflight.detailRowCount,
        duration_ms: Date.now() - input.startedAt,
      },
      "signed viewer pdf prepare rejected by preflight limit",
    );
    return {
      ok: false,
      statusCode: preflightLimit.statusCode,
      error: preflightLimit.error,
    };
  }

  const rows =
    input.access.reportKey === "purchase_goods_payables"
      ? await fetchPurchaseGoodsPayablesPdfRows({
          tenant_id: input.access.tenantId,
          params: input.params,
          datasource,
        })
      : await fetchSalesGoodsServicesPdfRows({
          tenant_id: input.access.tenantId,
          params: input.params,
          datasource,
        });
  const actualCounts = {
    documentCount: rows.documents.length,
    detailRowCount: rows.lines.length,
  };
  const actualLimit = validateReportPdfLimits(actualCounts);
  if (!actualLimit.ok) {
    return {
      ok: false,
      statusCode: actualLimit.statusCode,
      error: actualLimit.error,
    };
  }

  const pdf = await buildReportPdf({
    tenantName: getTenantDefinition(input.access.tenantId)?.name,
    tenantSlug: input.tenantSlug,
    snapshot: input.snapshot,
    rows,
    tokenRunId: input.access.runId,
    params: input.params,
  });
  const durationMs = Date.now() - input.startedAt;
  input.request.log.info(
    {
      tenant_id: input.access.tenantId,
      report_key: input.access.reportKey,
      run_id: input.access.runId,
      date_from: input.params.date_from,
      date_to: input.params.date_to,
      document_count: actualCounts.documentCount,
      detail_row_count: actualCounts.detailRowCount,
      cache_hit: pdf.cacheHit,
      pdf_bytes: pdf.pdf.length,
      duration_ms: durationMs,
    },
    "signed viewer pdf prepare completed",
  );

  return {
    ok: true,
    pdf: pdf.pdf,
    filename: pdf.filename,
    cacheHit: pdf.cacheHit,
    documentCount: actualCounts.documentCount,
    detailRowCount: actualCounts.detailRowCount,
    cachePath: pdf.cachePath,
    durationMs,
  };
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

  const signingSecret = await readReportViewerSigningSecret();
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

const reportPermissionsQuerySchema = z.object({
  tenant_id: tenantIdSchema.optional(),
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

const signedReportSnapshotParamsSchema = signedSnapshotParamsSchema.extend({
  reportKey: reportKeySchema,
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
  time_from: localTimeSchema.optional(),
  time_to: localTimeSchema.optional(),
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
      time_from: value.time_from,
      time_to: value.time_to,
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
  time_from: localTimeSchema.optional(),
  time_to: localTimeSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  page_size: z.coerce.number().int().min(5).max(50).optional().default(10),
  search: z.string().trim().max(120).optional().default(""),
}).superRefine((value, ctx) => {
  const parsed = salesGoodsServicesParamsSchema.safeParse({
    date_from: value.date_from,
    date_to: value.date_to,
    time_from: value.time_from,
    time_to: value.time_to,
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
  time_from: localTimeSchema.optional(),
  time_to: localTimeSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  page_size: z.coerce.number().int().min(5).max(50).optional().default(10),
  search: z.string().trim().max(120).optional().default(""),
});

const viewerDocumentsQuerySchema = viewerDocumentsBaseSchema.superRefine(
  (value, ctx) => {
    const parsed = salesGoodsServicesParamsSchema.safeParse({
      date_from: value.date_from,
      date_to: value.date_to,
      time_from: value.time_from,
      time_to: value.time_to,
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
      time_from: value.time_from,
      time_to: value.time_to,
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
    time_from: localTimeSchema.optional(),
    time_to: localTimeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const parsed = salesGoodsServicesParamsSchema.safeParse({
      date_from: value.date_from,
      date_to: value.date_to,
      time_from: value.time_from,
      time_to: value.time_to,
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

const notificationRulesQuerySchema = z.object({
  tenant_id: tenantIdSchema.optional(),
});

const notificationRuleParamsSchema = z.object({
  id: z.string().trim().min(1).max(180),
});

const notificationRulePatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  enabled: z.boolean().optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  period_preset: notificationPeriodPresetSchema.optional(),
  period_strategy: notificationPeriodStrategySchema.optional(),
  digest_mode: notificationDigestModeSchema.optional(),
  schedule: z
    .array(
      z.object({
        weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7),
        times: z.array(localTimeSchema).min(1).max(12),
      }),
    )
    .min(1)
    .max(7)
    .optional(),
  report_keys: z.array(reportKeySchema).min(1).max(6).optional(),
  target_ids: z.array(z.string().trim().min(1).max(180)).max(50).optional(),
});

const notificationRuleExecuteSchema = z.object({
  mode: z.enum(["dry_run", "send"]).optional(),
});

const notificationRuleTickSchema = z.object({
  mode: z.enum(["dry_run", "send"]).optional(),
  now: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  catch_up_minutes: z.coerce.number().int().min(0).max(60).optional(),
});

const ownerTenantsQuerySchema = z.object({
  status: tenantStatusSchema.optional(),
  search: z.string().trim().max(120).optional(),
});

const businessSignalsQuerySchema = z.object({
  status: z
    .enum(["open", "acknowledged", "resolved", "dismissed"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
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
  feature_flags: tenantFeatureFlagsSchema.partial().optional(),
  business_signal_thresholds: businessSignalThresholdsSchema.partial().optional(),
  current_period_end: z.string().datetime().nullable().optional(),
  suspended_reason: z.string().trim().max(500).nullable().optional(),
});

const businessSignalStatusUpdateSchema = z.object({
  status: businessSignalStatusSchema,
});

const ownerTenantDeleteSchema = z.object({
  confirm_name: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
});

const lineChannelCreateSchema = z.object({
  tenant_id: tenantIdSchema,
  display_name: z.string().trim().min(2).max(120),
  scope: z.enum(["tenant", "owner_shared"]).optional().default("tenant"),
  channel_access_token_configured: z.boolean().optional().default(false),
  channel_secret_configured: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
});

const lineChannelPatchSchema = z
  .object({
    display_name: z.string().trim().min(2).max(120).optional(),
    scope: z.enum(["tenant", "owner_shared"]).optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.display_name === undefined &&
      value.scope === undefined &&
      value.enabled === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one LINE channel field must be provided",
        path: ["display_name"],
      });
    }
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

const javaWsAuthSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({
    mode: z.literal("basic"),
    username: z.string().trim().min(1).max(120),
    password: z.string().min(1).max(1024),
  }),
  z.object({
    mode: z.literal("bearer"),
    token: z.string().min(1).max(4096),
  }),
]);

const javaWsDatasourceConfigUpdateSchema = z.object({
  kind: z.literal("sml_javaws"),
  baseUrl: z.string().trim().url().max(500),
  webappPath: z.string().trim().min(1).max(120).default("/SMLJavaWebService"),
  endpoint: z.literal("DotNetFrameWork").default("DotNetFrameWork"),
  configFileName: z.string().trim().min(1).max(160),
  database: z.string().trim().min(1).max(120),
  queryMethod: z.literal("_queryCompress").default("_queryCompress"),
  auth: javaWsAuthSchema.default({ mode: "none" }),
});

const javaWsDatabaseDiscoverySchema = javaWsDatasourceConfigUpdateSchema
  .pick({
    baseUrl: true,
    webappPath: true,
    endpoint: true,
    configFileName: true,
    auth: true,
  })
  .extend({
    kind: z.literal("sml_javaws").optional(),
  });

const datasourceConfigUpdateSchema = javaWsDatasourceConfigUpdateSchema;

const nullableUrlString = z
  .string()
  .trim()
  .max(500)
  .transform((value) => value || null)
  .nullable();

const ownerLoginSchema = z.object({
  username: z.string().trim().min(1).max(160),
  password: z.string().min(1).max(2048),
});

const ownerAdminCreateSchema = z.object({
  username: z.string().trim().min(3).max(160),
  password: z.string().min(12).max(2048),
  display_name: z.string().trim().min(1).max(120).optional(),
});

const ownerAdminUserParamsSchema = z.object({
  id: z.string().trim().min(1).max(160),
});

const ownerAdminPasswordPatchSchema = z.object({
  password: z.string().min(12).max(2048),
});

const systemConfigUpdateSchema = z.object({
  app_base_url: nullableUrlString,
  public_api_base_url: nullableUrlString,
  report_viewer_signing_secret: z
    .string()
    .trim()
    .min(32)
    .max(2048)
    .optional()
    .nullable(),
  report_viewer_link_ttl_hours: z.coerce.number().int().min(1).max(2160).default(72),
  morning_brief_enabled: z.coerce.boolean(),
  morning_brief_tenant_ids: z.array(tenantIdSchema).min(1).max(50),
  morning_brief_time: z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/)
    .default("08:00"),
  morning_brief_timezone: z.string().trim().min(1).max(80).default("Asia/Bangkok"),
  morning_brief_mode: z.enum(["send", "dry_run"]).default("send"),
  morning_brief_force: z.coerce.boolean().default(false),
  worker_id: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .default("worker_notification_rules_1"),
  worker_heartbeat_token: z
    .string()
    .trim()
    .max(2048)
    .optional()
    .nullable(),
  backup_configured: z.coerce.boolean().default(false),
  system_last_backup_at: z.string().trim().max(80).nullable().default(null),
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

const lineTargetAssignmentCreateSchema = z.object({
  source_target_id: z.string().trim().min(1).max(180),
  line_channel_id: z.string().trim().min(1).max(180),
  access_profile_key: lineAccessProfileKeySchema.default("executive"),
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
