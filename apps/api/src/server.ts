import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BANGKOK_TIME_ZONE,
  buildNotificationIdempotencyKey,
  deriveNotificationPeriodRange,
  deriveMorningBriefDateRange,
  findSensitiveTenantNoteHints,
  getDueNotificationRuleTimes,
  getNextNotificationRunAt,
  getZonedDateTimeParts,
  allowedLineActionSchema,
  aiCeoAdvisorItemStatusSchema,
  aiCeoDryRunRequestSchema,
  aiCeoOpenRouterKeyUpdateSchema,
  aiCeoProfileUpdateSchema,
  lineSendRequestSchema,
  lineAccessProfileKeySchema,
  tenantReportRolePermissionsPayloadSchema,
  type LineDeliveryRecord,
  type BusinessSignalRecord,
  type LineChannelRecord,
  type LineAccessProfileKey,
  type LineRecipientRecord,
  type LineSendMode,
  type ArDebtReceiptSnapshot,
  type CashBankReportKey,
  type CashBankSnapshot,
  type GrossProfitByArCustomerSnapshot,
  type GrossProfitByProductSnapshot,
  type ArCustomerMovementSnapshot,
  morningBriefRequestSchema,
  notificationPeriodPresetSchema,
  notificationRulePayloadSchema,
  uniqueReportKeysInOrder,
  planCodeSchema,
  getReportCatalogEntry,
  reportKeyValues,
  reportKeySchema,
  type NotificationRuleRecord,
  type NotificationReportResult,
  type NotificationRuleRunRecord,
  type NotificationRunProgressStage,
  type PurchaseGoodsPayablesSnapshot,
  type ReportKey,
  type ReportLinePreview,
  type ReportSnapshot,
  type ReportRunChunkRecord,
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
  productBusinessSignalThresholds,
  productTenantFeatureFlags,
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
  runArDebtReceiptReport,
  runArCustomerMovementReport,
  runCashBankPaymentsReport,
  runCashBankReceiptsReport,
  runStockBalanceReport,
  runStockReorderReport,
  testDatasourceConnection,
  toSafeDatasourceErrorMessage,
  toSafeErrorMessage,
  withDatasourceClient,
  type SmlDatasourceClient,
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
  buildOperationalIncidentLinePreview,
  buildReportFailureBusinessSignal,
  buildArCustomerMovementCustomerCodePageQuery,
  buildArCustomerMovementQuery,
  buildStockBalanceItemCodePageQuery,
  buildStockBalanceQuery,
  classifyReportFailureKind,
  selectBusinessSignalDigestIssues,
  renderGrossProfitLinePreview,
  renderPurchaseGoodsPayablesLinePreview,
  renderSalesGoodsServicesLinePreview,
  summarizeArCustomerMovement,
  summarizeStockBalance,
  type ReportFailureKind,
} from "@ai-bcc/reports";
import {
  createSystemStore,
  type ExecutiveDashboardRunRecord,
  type SecretRecord,
} from "./system-store.js";
import { fetchLineTargetDisplayName, sendLineBrief, sendLineReply, sendLineTextPush } from "./line-client.js";
import {
  buildMorningBriefCarouselPreview,
  buildNotificationDigestPreview,
} from "./notification-flex-preview.js";
import {
  buildNotificationRuleDeliveryKey,
  buildNotificationRuleIncidentDeliveryKey,
} from "./notification-delivery-key.js";
import { selectDeliveryRetryReportResults } from "./notification-delivery-retry.js";
import {
  runNotificationOpsMonitor,
  type NotificationOpsMonitorConfig,
} from "./notification-ops-monitor.js";
import { shouldSendReportFailureIncidentNotice } from "./notification-incident.js";
import {
  normalizeLineWebhookEvents,
  sanitizeLineWebhookEvent,
  verifyLineSignature,
} from "./line-webhook.js";
import { reportDefinitionSeeds } from "./report-definitions.js";
import {
  createDashboardViewerToken,
  type DashboardViewerTokenPayload,
  createReportViewerToken,
  verifyDashboardViewerToken,
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
  hashLineTargetId,
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
  buildFlowAccountConnectionRecord,
  readFlowAccountConfigStatus,
  saveFlowAccountClientCredentials,
} from "./flowaccount-secret-config.js";
import {
  testStoredFlowAccountConnection,
  type FlowAccountStoredTestResult,
} from "./flowaccount-service.js";
import {
  AiCeoSafeError,
  defaultTenantAiProfile,
  readAiCeoSetupStatus,
  runAiCeoDryRun,
  saveAiCeoProfile,
  saveTenantOpenRouterApiKey,
  syncOpenRouterModelCatalog,
  updateAiAdvisorItemStatus,
} from "./ai-ceo-service.js";
import {
  readEffectiveSystemRuntimeConfig,
  readSystemRuntimeConfigStatus,
  saveSystemRuntimeConfig,
} from "./system-runtime-config.js";
import {
  extractJavaWsFailureDiagnostics,
  listJavaWsDatabases,
} from "./sml-javaws-client.js";
import {
  createReportRuntimeRegistry,
  getReportRuntimeEntry,
  renderReportLinePreview,
  runReportRuntimeEntry,
} from "./report-registry.js";
import {
  AR_CUSTOMER_MOVEMENT_TIMEOUT_REASON,
  STOCK_BALANCE_TIMEOUT_REASON,
  buildDegradedArCustomerMovementPreview,
  buildDegradedStockBalancePreview,
  findRecentArCustomerMovementTimeoutRun,
  findRecentStockBalanceTimeoutRun,
  isArCustomerMovementTimeoutMessage,
  isStockBalanceTimeoutMessage,
  resolveArCustomerMovementFallbackSnapshot,
  resolveStockBalanceFallbackSnapshot,
  type ArCustomerMovementFallbackSnapshot,
  type StockBalanceFallbackSnapshot,
} from "./heavy-report-resilience.js";
import {
  createHeavyReportCoalescer,
  sameReportParams,
} from "./heavy-report-coalescer.js";
import { buildTenantCreateDryRunPreview } from "./tenant-create-preview.js";
import {
  getReportExecutionPolicy,
} from "./report-execution-policy.js";
import {
  buildOperationalAlertDedupeKey,
  buildOperationalAlertMessage,
  loadTelegramUpdateChats,
  readTelegramOperationalAlertStatus,
  saveTelegramOperationalAlertToken,
  sendOperationalTelegramAlert,
  upsertTelegramOperationalAlertTarget,
} from "./operational-alerts.js";
import {
  countOwnerWorkbenchOpsWarnings,
  projectOwnerWorkbenchSelected,
  projectOwnerWorkbenchTenant,
  sanitizeWorkbenchDatasourceStatus,
  type OwnerWorkbenchLineSetupPayload,
  type OwnerWorkbenchNotificationSetupPayload,
  type OwnerWorkbenchPermissionSetupPayload,
  type OwnerWorkbenchPayload,
  type OwnerWorkbenchReportSetupPayload,
  type OwnerWorkbenchSmlSetupPayload,
  type OwnerWorkbenchCockpit,
} from "./owner-workbench.js";
import {
  computeOwnerCockpitHealthMatrixRow,
  computeOwnerCockpitNextAction,
  deriveProductionProofStrip,
  type CockpitJavaWsFailure,
  type CockpitOperationsInput,
  type CockpitTenantInput,
  type OwnerCockpitHealthMatrixRow,
  type OwnerCockpitNextAction,
  type OwnerCockpitProofStrip,
} from "./owner-cockpit.js";

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
  runArCustomerMovementReport: runAndPersistArCustomerMovementReport,
  runArDebtReceiptReport: runAndPersistArDebtReceiptReport,
  runCashBankReceiptsReport: (input) =>
    runAndPersistCashBankReport({
      ...input,
      reportKey: "cash_bank_receipts",
    }),
  runCashBankPaymentsReport: (input) =>
    runAndPersistCashBankReport({
      ...input,
      reportKey: "cash_bank_payments",
    }),
});
const notificationHeavyReportCoalescer =
  createHeavyReportCoalescer<Awaited<ReturnType<typeof runAndPersistReportByKey>>>();
const dashboardRunProcessorState = {
  running: false,
};
const chunkedReportRunProcessorState = {
  running: false,
};
const EXECUTIVE_DASHBOARD_QUEUE_BACKGROUND_LIMIT = 1;
const CHUNKED_HEAVY_REPORT_GLOBAL_CONCURRENCY = 2;
const CHUNKED_HEAVY_REPORT_STALE_MS = 15 * 60 * 1000;
const CHUNKED_HEAVY_REPORT_MAX_DURATION_MS = 10 * 60 * 1000;
const CHUNKED_HEAVY_STOCK_CHUNK_SIZE = 500;
const CHUNKED_HEAVY_AR_CHUNK_SIZE = 300;
const CHUNKED_HEAVY_MIN_SPLIT_UNITS = 50;
const CHUNKED_HEAVY_MAX_CHUNK_ATTEMPTS = 2;
const CHUNKED_HEAVY_NOTIFICATION_WAIT_MS =
  CHUNKED_HEAVY_REPORT_MAX_DURATION_MS + 90_000;
const CHUNKED_HEAVY_NOTIFICATION_POLL_MS = 1_000;
const NOTIFICATION_CHUNKED_WAIT_MS =
  readBoundedIntegerEnv("NOTIFICATION_CHUNKED_WAIT_MINUTES", 60, {
    min: 1,
    max: 240,
  }) *
  60 *
  1000;
const NOTIFICATION_STALE_GRACE_MS =
  readBoundedIntegerEnv("NOTIFICATION_STALE_GRACE_MINUTES", 5, {
    min: 1,
    max: 60,
  }) *
  60 *
  1000;
const NOTIFICATION_WAIT_POLL_MS =
  readBoundedIntegerEnv("NOTIFICATION_WAIT_POLL_SECONDS", 60, {
    min: 10,
    max: 600,
  }) * 1000;
const OPS_MONITOR_ENABLED = readBooleanEnv("OPS_MONITOR_ENABLED", true);
const OPS_MONITOR_POLL_MS =
  readBoundedIntegerEnv("OPS_MONITOR_POLL_SECONDS", 60, {
    min: 10,
    max: 3600,
  }) * 1000;
const NOTIFICATION_RUN_SLOW_WARNING_MS =
  readBoundedIntegerEnv("NOTIFICATION_RUN_SLOW_WARNING_MINUTES", 15, {
    min: 1,
    max: 240,
  }) *
  60 *
  1000;
const NOTIFICATION_RUN_SLOW_CRITICAL_MS =
  readBoundedIntegerEnv("NOTIFICATION_RUN_SLOW_CRITICAL_MINUTES", 30, {
    min: 1,
    max: 240,
  }) *
  60 *
  1000;
const WORKER_HEARTBEAT_STALE_MS =
  readBoundedIntegerEnv("WORKER_HEARTBEAT_STALE_MINUTES", 3, {
    min: 1,
    max: 60,
  }) *
  60 *
  1000;
const LINE_RETRY_GRACE_MS =
  readBoundedIntegerEnv("LINE_RETRY_GRACE_MINUTES", 2, {
    min: 0,
    max: 60,
  }) *
  60 *
  1000;
const DASHBOARD_TOKEN_TTL_HOURS = 24;
const DASHBOARD_TOKEN_LOOKBACK_DAYS = 31;
const DASHBOARD_TOKEN_MAX_DATE_WINDOW_DAYS = 31;
const DASHBOARD_TOKEN_RATE_LIMIT_COUNT = 5;
const DASHBOARD_TOKEN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

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

app.get(
  "/api/owner/tenants/:tenantId/store-setup",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = tenantParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const detail = await buildOwnerStoreSetupDetail(routeParams.data.tenantId);
    if (!detail) {
      return reply.status(404).send({ error: "Tenant not found." });
    }

    return { data: detail };
  },
);

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

app.get("/api/owner/workbench", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const query = z
    .object({ tenant_id: tenantIdSchema.optional() })
    .safeParse(request.query ?? {});
  if (!query.success) {
    return reply.status(400).send({
      error: "Invalid workbench query",
      details: query.error.flatten().fieldErrors,
    });
  }

  const tenants = await systemStore.listTenants();
  const selectedTenantId = resolveOwnerWorkbenchTenantId({
    requestedTenantId: query.data.tenant_id,
    tenants,
  });
  const [summaryResults, operations] = await Promise.all([
    Promise.all(tenants.map((tenant) => buildOwnerTenantSummary(tenant.id))),
    buildOperationsStatus({ includeAuditLogs: false }).catch(() => null),
  ]);
  const summaries = summaryResults.filter(
    (summary): summary is NonNullable<typeof summary> => Boolean(summary),
  );
  const workbenchTenants = summaries.map(projectOwnerWorkbenchTenant);
  const selectedSummary =
    summaries.find((summary) => summary.tenant.id === selectedTenantId) ?? null;
  const telegramStatus = operations?.operational_alerts?.telegram?.status ?? null;
  const opsCounts = countOwnerWorkbenchOpsWarnings({
    tenants: workbenchTenants,
    workerStatus: operations?.worker.status ?? null,
    telegramReady: telegramStatus
      ? Boolean(
          telegramStatus.configured &&
            telegramStatus.targets.some((target) => target.enabled),
        )
      : false,
  });

  const cockpit = await buildOwnerWorkbenchCockpit({ summaries, operations });

  return {
    data: {
      tenants: workbenchTenants,
      selected_tenant_id: selectedSummary?.tenant.id ?? null,
      selected: selectedSummary
        ? projectOwnerWorkbenchSelected(selectedSummary)
        : null,
      ops: {
        ...opsCounts,
        worker_status: operations?.worker.status ?? null,
        telegram_ready: telegramStatus
          ? Boolean(
              telegramStatus.configured &&
                telegramStatus.targets.some((target) => target.enabled),
            )
          : false,
      },
      cockpit,
    } satisfies OwnerWorkbenchPayload,
  };
});

type OwnerWorkbenchCockpitSummary = {
  tenant: { id: TenantId; name: string; status: string };
  access: { enabled: boolean; message: string };
  health: CockpitTenantInput["health"];
};

/**
 * Build the cross-tenant cockpit payload (next action + health matrix +
 * per-tenant proof strips) for the workbench. The summary list carries the
 * health/access fields; operations status carries the system-wide JavaWS
 * failure and heavy-run context. Per-tenant runs/deliveries are loaded here so
 * the proof strip reflects the last 7 days per tenant.
 */
async function buildOwnerWorkbenchCockpit(input: {
  summaries: OwnerWorkbenchCockpitSummary[];
  operations: Awaited<ReturnType<typeof buildOperationsStatus>> | null;
}): Promise<OwnerWorkbenchCockpit> {
  const { summaries, operations } = input;
  const activeTenantCount = summaries.filter(
    (summary) => summary.tenant.status !== "cancelled",
  ).length;

  const tenantInputs: CockpitTenantInput[] = summaries.map((summary) => ({
    tenant_id: summary.tenant.id,
    tenant_name: summary.tenant.name,
    status: summary.tenant.status,
    access_enabled: summary.access.enabled,
    access_message: summary.access.message,
    health: summary.health,
  }));

  const latestJavaWsFailure = operations?.report_health?.latest_javaws_failure;
  const cockpitOperations: CockpitOperationsInput = {
    worker: { status: operations?.worker.status ?? "ok" },
    telegram: operations?.operational_alerts?.telegram?.status
      ? {
          configured: operations.operational_alerts.telegram.status.configured,
          targets: operations.operational_alerts.telegram.status.targets.map(
            (target) => ({ enabled: target.enabled }),
          ),
        }
      : null,
    latest_javaws_failure: latestJavaWsFailure
      ? {
          id: latestJavaWsFailure.id,
          tenant_id: latestJavaWsFailure.tenant_id,
          report_key: latestJavaWsFailure.report_key,
          status: latestJavaWsFailure.status,
          finished_at: latestJavaWsFailure.finished_at,
          failure_kind: latestJavaWsFailure.failure_kind,
          failure_phase: latestJavaWsFailure.failure_phase,
          safe_error_message: latestJavaWsFailure.safe_error_message,
        }
      : null,
    heavy_report_runs:
      operations?.report_health?.heavy_report_runs.map((run) => ({
        id: run.id,
        tenant_id: run.tenant_id,
        report_key: run.report_key,
        status: run.status,
        started_at: run.started_at,
        finished_at: run.finished_at,
        duration_ms: run.duration_ms,
        row_count: run.row_count,
        failure_kind: run.failure_kind,
        failure_phase: run.failure_phase,
      })) ?? [],
  };

  const nextAction: OwnerCockpitNextAction = computeOwnerCockpitNextAction(
    tenantInputs,
    cockpitOperations,
  );
  const healthMatrix: OwnerCockpitHealthMatrixRow[] = tenantInputs.map(
    (tenant) =>
      computeOwnerCockpitHealthMatrixRow(
        tenant,
        cockpitOperations.latest_javaws_failure as CockpitJavaWsFailure | null,
      ),
  );

  const proofStrips = await Promise.all(
    tenantInputs
      .filter((tenant) => tenant.status !== "cancelled")
      .map(async (tenant) => {
        const eligible = tenantIsProofEligible(tenant);
        const [runs, deliveries] = await Promise.all([
          systemStore.listNotificationRuleRuns({
            tenantId: tenant.tenant_id,
            limit: 50,
          }),
          systemStore.listLineDeliveries(tenant.tenant_id),
        ]);
        return deriveProductionProofStrip({
          tenant_id: tenant.tenant_id,
          tenant_name: tenant.tenant_name,
          eligible,
          runs: runs.map((run) => ({
            tenant_id: run.tenant_id,
            status: run.status,
            source: run.source ?? null,
            mode: run.mode ?? null,
            started_at: run.started_at ?? null,
            finished_at: run.finished_at ?? null,
          })),
          deliveries: deliveries.map((delivery) => ({
            tenant_id: delivery.tenant_id,
            status: delivery.status,
            delivery_type: delivery.delivery_type ?? null,
            sent_at: delivery.sent_at ?? null,
            created_at: delivery.created_at ?? null,
          })),
        });
      }),
  );

  return {
    next_action: nextAction,
    health_matrix: healthMatrix,
    proof_strips: proofStrips,
    active_tenant_count: activeTenantCount,
  };
}

function tenantIsProofEligible(tenant: CockpitTenantInput): boolean {
  return (
    tenant.status === "active" &&
    tenant.health.datasource_configured &&
    tenant.health.line_targets_enabled > 0
  );
}

app.get(
  "/api/owner/tenants/:tenantId/sml-setup",
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

    const [datasource, runs] = await Promise.all([
      readDatasourceConfigStatus({
        store: systemStore,
        tenantId: tenant.id,
        envConfig: readDatasourceConfig(tenant.id),
      }),
      systemStore.listRuns(tenant.id, undefined, 1),
    ]);
    const latestRun = runs[0] ?? null;

    return {
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          status: tenant.status,
          databaseName: tenant.databaseName,
        },
        datasource: sanitizeWorkbenchDatasourceStatus(datasource),
        latest_test: null,
        latest_report_run: latestRun
          ? {
              id: latestRun.id,
              report_key: latestRun.report_key,
              status: latestRun.status,
              started_at: latestRun.started_at,
              finished_at: latestRun.finished_at,
              row_count: latestRun.row_count,
              safe_error_message: latestRun.safe_error_message,
              failure_kind: latestRun.failure_kind ?? null,
              failure_phase: latestRun.failure_phase ?? null,
            }
          : null,
      } satisfies OwnerWorkbenchSmlSetupPayload,
    };
  },
);

app.get(
  "/api/owner/tenants/:tenantId/line-setup",
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

    const [channels, targets] = await Promise.all([
      listEffectiveLineChannels(tenant.id),
      listEffectiveLineTargets(tenant.id),
    ]);
    const safeTargets = targets.map(toSafeLineTargetRecord);
    const siblingsByHash = new Map<string, string[]>();
    await Promise.all(
      targets.map(async (target) => {
        const siblings = await systemStore
          .findTenantsWithSameLineTargetHash({
            targetIdHash: target.target_id_hash,
            excludeTenantId: tenant.id,
          })
          .catch(() => []);
        siblingsByHash.set(target.target_id_hash, siblings.map((s) => s.tenantName));
      }),
    );
    const safeTargetsWithSiblings = safeTargets.map((target) => ({
      ...target,
      sibling_tenant_names: siblingsByHash.get(target.target_id_hash) ?? [],
    }));
    const sendReadyChannels = channels.filter(isLineChannelSendReady);
    const readyTargets = safeTargets.filter(
      (target) =>
        target.approved &&
        target.enabled &&
        target.allowed_actions.includes("receive_morning_brief") &&
        resolveLineTargetDeliveryReadiness({ lineChannels: channels, target }).ok,
    );

    return {
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          status: tenant.status,
        },
        channels,
        targets: safeTargetsWithSiblings,
        readiness: {
          ready_targets: readyTargets.length,
          total_targets: safeTargets.length,
          send_ready_channels: sendReadyChannels.length,
          total_channels: channels.length,
        },
      } satisfies OwnerWorkbenchLineSetupPayload,
    };
  },
);

app.get(
  "/api/owner/tenants/:tenantId/notification-setup",
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

    const [rules, recentRuns, targets, channels] = await Promise.all([
      systemStore.listNotificationRules(tenant.id),
      systemStore.listNotificationRuleRuns({ tenantId: tenant.id, limit: 20 }),
      listEffectiveLineTargets(tenant.id),
      listEffectiveLineChannels(tenant.id),
    ]);
    const safeTargets = targets.map(toSafeLineTargetRecord);
    const enabledTargets = safeTargets.filter(
      (target) =>
        target.approved &&
        target.enabled &&
        target.allowed_actions.includes("receive_morning_brief") &&
        resolveLineTargetDeliveryReadiness({ lineChannels: channels, target }).ok,
    );

    return {
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          status: tenant.status,
        },
        rules: rules.map(toOwnerNotificationRule),
        recent_runs: recentRuns,
        target_count: safeTargets.length,
        enabled_target_count: enabledTargets.length,
      } satisfies OwnerWorkbenchNotificationSetupPayload,
    };
  },
);

app.get(
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

    const response = await buildTenantReportPermissionsResponse(tenant.id, [
      tenant,
    ]);

    return {
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          status: tenant.status,
        },
        reports: response.reports,
        roles: response.roles,
        permissions: response.permissions,
        matrix: response.matrix,
        target_counts: response.target_counts,
        impacted_notification_plans: response.impacted_notification_plans,
      } satisfies OwnerWorkbenchPermissionSetupPayload,
    };
  },
);

app.get(
  "/api/owner/tenants/:tenantId/report-setup",
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

    const [runs, snapshots] = await Promise.all([
      systemStore.listRuns(tenant.id, undefined, 40),
      Promise.all(
        reportKeyValues.map(async (reportKey) => {
          const snapshot = await systemStore.getLatestSnapshot(
            tenant.id,
            reportKey,
          );
          if (!snapshot) {
            return null;
          }
          return {
            report_key: snapshot.report_key,
            run_id: snapshot.run_id,
            generated_at: snapshot.generated_at,
            params: snapshot.params,
            quality_status: snapshot.quality_status,
          };
        }),
      ),
    ]);
    const featureFlags = getTenantFeatureFlags(tenant);

    return {
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          status: tenant.status,
          feature_flags: {
            sml_chunked_heavy_reports_enabled:
              featureFlags.sml_chunked_heavy_reports_enabled,
          },
        },
        reports: reportKeyValues.map((reportKey) => {
          const entry = getReportCatalogEntry(reportKey);
          const asyncSupported = isChunkedHeavyReportKey(reportKey);
          return {
            report_key: reportKey,
            label: entry.permissionLabel,
            short_label: entry.shortLabel,
            description: entry.permissionDescription,
            category: entry.category,
            sensitive: entry.sensitive,
            heavy: asyncSupported,
            async_supported: asyncSupported,
            line_card: entry.capabilities.lineCard,
            signed_viewer: entry.capabilities.signedViewer,
          };
        }),
        latest_runs: runs.map(toOwnerReportRunSummary),
        latest_snapshots: snapshots.filter(
          (snapshot): snapshot is NonNullable<typeof snapshot> =>
            Boolean(snapshot),
        ),
      } satisfies OwnerWorkbenchReportSetupPayload,
    };
  },
);

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
    feature_flags: getTenantFeatureFlags(tenant),
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
    const manualSchedule = validateManualNotificationSchedule({
      rule,
      scheduledLocalDate: body.data.scheduled_local_date,
      scheduledLocalTime: body.data.scheduled_local_time,
    });
    if (!manualSchedule.ok) {
      return reply.status(400).send({ error: manualSchedule.error });
    }
    const mode = body.data.mode ?? "dry_run";
    if (mode === "send") {
      const readiness = await validateNotificationRuleSendReadiness(rule);
      if (!readiness.ok) {
        return reply.status(422).send({
          error: readiness.error,
          details: readiness.details,
        });
      }
    }
    const fallbackZoned = getZonedDateTimeParts({
      now: new Date(),
      timeZone: rule.timezone || BANGKOK_TIME_ZONE,
    });
    const scheduledLocalDate =
      manualSchedule.scheduledLocalDate ?? fallbackZoned.date;
    const scheduledLocalTime =
      manualSchedule.scheduledLocalTime ?? fallbackZoned.time;

    const queued = await enqueueManualNotificationRuleRun({
      rule,
      mode,
      scheduledLocalDate,
      scheduledLocalTime,
      source: "manual_test",
      clientRequestId: body.data.client_request_id,
    });
    kickNotificationQueueProcessor(queued.run.id);

    return reply.status(202).send({
      data: {
        ok: true,
        accepted: true,
        reused: queued.reused,
        status: queued.run.status,
        run_id: queued.run.id,
        run: queued.run,
        mode: queued.run.mode,
      },
    });
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
    const manualSchedule = validateManualNotificationSchedule({
      rule,
      scheduledLocalDate: body.data.scheduled_local_date,
      scheduledLocalTime: body.data.scheduled_local_time,
    });
    if (!manualSchedule.ok) {
      return reply.status(400).send({ error: manualSchedule.error });
    }
    const mode = body.data.mode ?? "send";
    if (mode === "send") {
      const readiness = await validateNotificationRuleSendReadiness(rule);
      if (!readiness.ok) {
        return reply.status(422).send({
          error: readiness.error,
          details: readiness.details,
        });
      }
    }
    const fallbackZoned = getZonedDateTimeParts({
      now: new Date(),
      timeZone: rule.timezone || BANGKOK_TIME_ZONE,
    });
    const scheduledLocalDate =
      manualSchedule.scheduledLocalDate ?? fallbackZoned.date;
    const scheduledLocalTime =
      manualSchedule.scheduledLocalTime ?? fallbackZoned.time;

    const queued = await enqueueManualNotificationRuleRun({
      rule,
      mode,
      scheduledLocalDate,
      scheduledLocalTime,
      source: "manual_run_now",
      clientRequestId: body.data.client_request_id,
    });
    kickNotificationQueueProcessor(queued.run.id);

    return reply.status(202).send({
      data: {
        ok: true,
        accepted: true,
        reused: queued.reused,
        status: queued.run.status,
        run_id: queued.run.id,
        run: queued.run,
        mode: queued.run.mode,
      },
    });
  },
);

app.post("/api/owner/tenants/dry-run", async (request, reply) => {
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
  const noteSafety = validateTenantNoteSafety(body.data.description);
  if (!noteSafety.ok) {
    return reply.status(422).send(noteSafety.response);
  }

  const existingTenant = (await systemStore.listTenants()).find(
    (tenant) => tenant.id === body.data.tenant_id,
  );
  const tenantSlug = getTenantSlug(body.data.tenant_id);

  return {
    data: buildTenantCreateDryRunPreview({
      dashboardPath: `/app/${tenantSlug}`,
      duplicateTenantName: existingTenant?.name ?? null,
      name: body.data.name,
      planCode: body.data.plan_code,
      status: body.data.status,
      tenantId: body.data.tenant_id,
      viewerEmail: body.data.viewer_email ?? null,
    }),
  };
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
  const noteSafety = validateTenantNoteSafety(body.data.description);
  if (!noteSafety.ok) {
    return reply.status(422).send(noteSafety.response);
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
    billingCycle: body.data.billing_cycle ?? null,
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
  const noteSafety = validateTenantNoteSafety(body.data.description);
  if (!noteSafety.ok) {
    return reply.status(422).send(noteSafety.response);
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
    billingCycle:
      body.data.billing_cycle !== undefined
        ? body.data.billing_cycle
        : current.billingCycle,
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

app.post("/api/owner/tenants/:tenantId/trial", async (request, reply) => {
  const adminAuth = requireAdminMutation(request);
  if (!adminAuth.ok) {
    return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
  }

  const routeParams = tenantParamsSchema.safeParse(request.params);
  if (!routeParams.success) {
    return reply.status(400).send({ error: "Invalid tenant_id" });
  }

  const body = z
    .object({ days: z.number().int().min(1).max(365) })
    .safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid trial request",
      details: body.error.flatten().fieldErrors,
    });
  }

  const tenant = await getTenantOrNull(routeParams.data.tenantId);
  if (!tenant) {
    return reply.status(404).send({ error: "Tenant not found." });
  }

  const periodEnd = new Date(Date.now() + body.data.days * 24 * 60 * 60 * 1000).toISOString();
  const updated = await systemStore.upsertTenant({
    ...tenant,
    status: "trial",
    currentPeriodEnd: periodEnd,
  });

  await systemStore.appendAuditLog({
    tenant_id: tenant.id,
    actor_id: null,
    action: "trial_period_set",
    target_type: "tenant",
    target_id: tenant.id,
    metadata_json: { days: body.data.days, period_end: periodEnd },
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

app.get(
  "/api/owner/tenants/:tenantId/flowaccount/config",
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

    if (!readSecretEncryptionSecret()) {
      return reply.status(503).send({
        error:
          "AI_BCC_SECRET_KEY is not configured. Set it on the server before reading FlowAccount configuration.",
      });
    }

    return {
      data: await readFlowAccountConfigStatus({
        store: systemStore,
        tenantId: tenant.id,
      }),
    };
  },
);

app.put(
  "/api/owner/tenants/:tenantId/flowaccount/config",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = tenantParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const body = flowAccountConfigUpdateSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid FlowAccount config request",
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
          "AI_BCC_SECRET_KEY is not configured. Set it on the server before saving FlowAccount secrets.",
      });
    }

    const status = await saveFlowAccountClientCredentials({
      store: systemStore,
      tenantId: tenant.id,
      environment: body.data.environment,
      authMode: body.data.auth_mode,
      clientId: body.data.client_id,
      clientSecret: body.data.client_secret,
    });

    await systemStore.appendAuditLog({
      tenant_id: tenant.id,
      actor_id: adminAuth.subject,
      action: "flowaccount_config_updated",
      target_type: "flowaccount",
      target_id: tenant.id,
      metadata_json: {
        environment: status.environment,
        auth_mode: status.auth_mode,
        credentials_configured: status.credentials_configured,
        provider_status: null,
        latency_ms: null,
        company_id: null,
        support_code_source: "missing",
        safe_error_message: null,
      },
    });

    return { data: status };
  },
);

app.post(
  "/api/owner/tenants/:tenantId/flowaccount/test",
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

    if (!readSecretEncryptionSecret()) {
      return reply.status(503).send({
        error:
          "AI_BCC_SECRET_KEY is not configured. Set it on the server before testing FlowAccount.",
      });
    }

    const result = await testStoredFlowAccountConnection({
      store: systemStore,
      tenantId: tenant.id,
    });
    const response = { data: toFlowAccountTestApiResponse(result) };

    if (result.token_refreshed) {
      await systemStore.appendAuditLog({
        tenant_id: tenant.id,
        actor_id: adminAuth.subject,
        action: "flowaccount_token_refreshed",
        target_type: "flowaccount",
        target_id: tenant.id,
        metadata_json: {
          environment: result.environment,
          provider_status: result.token_provider_status,
          latency_ms: null,
          company_id: null,
          support_code_source: result.support_code_source,
          safe_error_message: null,
        },
      });
    }

    if (result.failure_reason !== "missing_config") {
      const existing = await systemStore.getFlowAccountConnection(tenant.id);
      await systemStore.upsertFlowAccountConnection(
        buildFlowAccountConnectionRecord({
          tenantId: tenant.id,
          existing,
          status: result.ok ? "connected" : "error",
          companyId: result.company_id,
          supportCode: result.support_code,
          accessTokenExpiresAt: result.access_token_expires_at,
          lastTestedAt: result.checked_at,
          lastError: result.safe_error_message,
        }),
      );
    }

    await systemStore.appendAuditLog({
      tenant_id: tenant.id,
      actor_id: adminAuth.subject,
      action: result.ok
        ? "flowaccount_test_succeeded"
        : "flowaccount_test_failed",
      target_type: "flowaccount",
      target_id: tenant.id,
      metadata_json: {
        environment: result.environment,
        provider_status: result.provider_status,
        latency_ms: result.latency_ms,
        company_id: result.company_id,
        support_code_source: result.support_code_source,
        safe_error_message: result.safe_error_message,
      },
    });

    if (result.failure_reason === "missing_config") {
      return reply.status(424).send(response);
    }
    if (!result.ok) {
      return reply.status(502).send(response);
    }

    return response;
  },
);

app.get(
  "/api/owner/tenants/:tenantId/ai-ceo/config",
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
      data: await readAiCeoSetupStatus({
        store: systemStore,
        tenant,
      }),
    };
  },
);

app.put(
  "/api/owner/tenants/:tenantId/ai-ceo/config",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = tenantParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const body = aiCeoProfileUpdateSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid AI CEO config request",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenant = await getTenantOrNull(routeParams.data.tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }

    try {
      const profile = await saveAiCeoProfile({
        store: systemStore,
        tenant,
        update: body.data,
        actorId: adminAuth.subject,
      });
      await systemStore.appendAuditLog({
        tenant_id: tenant.id,
        actor_id: adminAuth.subject,
        action: "ai_ceo_profile_updated",
        target_type: "ai_ceo",
        target_id: tenant.id,
        metadata_json: {
          ai_enabled: profile.ai_enabled,
          shadow_mode_enabled: profile.shadow_mode_enabled,
          selected_model_id: profile.selected_model_id,
          key_mode: profile.key_mode,
          daily_token_budget: profile.daily_token_budget,
          monthly_token_budget: profile.monthly_token_budget,
          daily_cost_budget_usd: profile.daily_cost_budget_usd,
          monthly_cost_budget_usd: profile.monthly_cost_budget_usd,
        },
      });

      return {
        data: await readAiCeoSetupStatus({
          store: systemStore,
          tenant,
        }),
      };
    } catch (error) {
      if (error instanceof AiCeoSafeError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  },
);

app.put(
  "/api/owner/tenants/:tenantId/ai-ceo/openrouter-key",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = tenantParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const body = aiCeoOpenRouterKeyUpdateSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid OpenRouter key request",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenant = await getTenantOrNull(routeParams.data.tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }

    try {
      await saveTenantOpenRouterApiKey({
        store: systemStore,
        tenantId: tenant.id,
        apiKey: body.data.api_key,
      });
      const now = new Date().toISOString();
      const currentProfile =
        (await systemStore.getTenantAiProfile(tenant.id)) ??
        defaultTenantAiProfile({ tenant, now });
      await systemStore.upsertTenantAiProfile({
        ...currentProfile,
        key_mode: "tenant_override",
        updated_at: now,
      });
      await systemStore.appendAuditLog({
        tenant_id: tenant.id,
        actor_id: adminAuth.subject,
        action: "ai_ceo_openrouter_key_updated",
        target_type: "ai_ceo",
        target_id: tenant.id,
        metadata_json: {
          provider: "openrouter",
          mode: "tenant_override",
          configured: true,
        },
      });

      return {
        data: await readAiCeoSetupStatus({
          store: systemStore,
          tenant,
        }),
      };
    } catch (error) {
      if (error instanceof AiCeoSafeError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  },
);

app.post(
  "/api/owner/tenants/:tenantId/ai-ceo/sync-models",
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

    const models = await syncOpenRouterModelCatalog({ store: systemStore });
    await systemStore.appendAuditLog({
      tenant_id: tenant.id,
      actor_id: adminAuth.subject,
      action: "ai_ceo_model_catalog_synced",
      target_type: "ai_ceo",
      target_id: tenant.id,
      metadata_json: {
        provider: "openrouter",
        model_count: models.length,
      },
    });

    return {
      data: await readAiCeoSetupStatus({
        store: systemStore,
        tenant,
      }),
    };
  },
);

app.post(
  "/api/owner/tenants/:tenantId/ai-ceo/dry-run",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = tenantParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid tenant_id" });
    }

    const body = aiCeoDryRunRequestSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid AI CEO dry-run request",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenant = await getTenantOrNull(routeParams.data.tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }

    try {
      const result = await runAiCeoDryRun({
        store: systemStore,
        tenant,
        request: body.data,
        actorId: adminAuth.subject,
      });
      await systemStore.appendAuditLog({
        tenant_id: tenant.id,
        actor_id: adminAuth.subject,
        action: result.ok ? "ai_ceo_dry_run_succeeded" : "ai_ceo_dry_run_failed",
        target_type: "ai_ceo_run",
        target_id: result.run.id,
        metadata_json: {
          model_id: result.run.model_id,
          status: result.run.status,
          input_tokens: result.run.input_tokens,
          output_tokens: result.run.output_tokens,
          cost_estimate_usd: result.run.cost_estimate_usd,
          latency_ms: result.latency_ms,
          provider_status: result.provider_status,
          item_count: result.items.length,
          safe_error_message: result.safe_error_message,
        },
      });

      return { data: result };
    } catch (error) {
      if (error instanceof AiCeoSafeError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  },
);

app.patch(
  "/api/owner/tenants/:tenantId/ai-ceo/items/:itemId",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = tenantParamsSchema
      .extend({ itemId: z.string().trim().min(1).max(220) })
      .safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid AI CEO item params" });
    }

    const body = aiCeoItemStatusUpdateSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid AI CEO item status request",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenant = await getTenantOrNull(routeParams.data.tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found." });
    }

    const item = await updateAiAdvisorItemStatus({
      store: systemStore,
      tenantId: tenant.id,
      itemId: routeParams.data.itemId,
      status: body.data.status,
    });
    if (!item) {
      return reply.status(404).send({ error: "AI CEO item not found." });
    }

    await systemStore.appendAuditLog({
      tenant_id: tenant.id,
      actor_id: adminAuth.subject,
      action: "ai_ceo_item_status_updated",
      target_type: "ai_ceo_item",
      target_id: item.id,
      metadata_json: {
        status: item.status,
        severity: item.severity,
      },
    });

    return { data: item };
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
    channel_access_token_configured: false,
    channel_secret_configured: false,
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
    const response = await buildTenantReportPermissionsResponse(
      tenant.id,
      tenants,
    );
    return {
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          status: tenant.status,
        },
        reports: response.reports,
        roles: response.roles,
        permissions: response.permissions,
        matrix: response.matrix,
        target_counts: response.target_counts,
        impacted_notification_plans: response.impacted_notification_plans,
        updated_line_targets: saved.updatedTargetCount,
      } satisfies OwnerWorkbenchPermissionSetupPayload,
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

function toFlowAccountTestApiResponse(result: FlowAccountStoredTestResult) {
  return {
    ok: result.ok,
    checked_at: result.checked_at,
    environment: result.environment,
    latency_ms: result.latency_ms,
    provider_status: result.provider_status,
    company_id: result.company_id,
    support_code: result.support_code,
    safe_error_message: result.safe_error_message,
  };
}

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

app.get(
  "/api/owner/operational-alerts/telegram/status",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    return {
      data: await readTelegramOperationalAlertStatus(systemStore),
    };
  },
);

app.put(
  "/api/owner/operational-alerts/telegram/secrets",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }
    const body = telegramSecretUpdateSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid Telegram secret request",
        details: body.error.flatten().fieldErrors,
      });
    }
    if (!readSecretEncryptionSecret()) {
      return reply.status(503).send({
        error:
          "AI_BCC_SECRET_KEY is not configured. Set it on the server before saving Telegram secrets.",
      });
    }

    const result = await saveTelegramOperationalAlertToken({
      store: systemStore,
      token: body.data.bot_token,
    });
    await systemStore.appendAuditLog({
      tenant_id: null,
      actor_id: null,
      action: result.ok
        ? "telegram_operational_alert_secret_verified"
        : "telegram_operational_alert_secret_rejected",
      target_type: "operational_alert",
      target_id: "telegram",
      metadata_json: {
        ok: result.ok,
        provider_status: result.ok ? 200 : result.provider_status,
        safe_error_message: result.ok ? null : result.safe_error_message,
      },
    });
    if (!result.ok) {
      return reply.status(400).send({
        error: result.safe_error_message,
        provider_status: result.provider_status,
      });
    }

    return { data: result.status };
  },
);

app.get(
  "/api/owner/operational-alerts/telegram/updates",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }
    const result = await loadTelegramUpdateChats({ store: systemStore });
    if (!result.ok) {
      return reply.status(502).send({
        error: result.safe_error_message,
        provider_status: result.provider_status,
      });
    }
    return { data: result.chats };
  },
);

app.post(
  "/api/owner/operational-alerts/telegram/targets",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }
    const body = telegramTargetCreateSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid Telegram target request",
        details: body.error.flatten().fieldErrors,
      });
    }
    if (!readSecretEncryptionSecret()) {
      return reply.status(503).send({
        error:
          "AI_BCC_SECRET_KEY is not configured. Set it on the server before saving Telegram targets.",
      });
    }

    const target = await upsertTelegramOperationalAlertTarget({
      store: systemStore,
      chatId: body.data.chat_id,
      displayName: body.data.display_name,
      enabled: body.data.enabled,
    });
    await systemStore.appendAuditLog({
      tenant_id: null,
      actor_id: null,
      action: "telegram_operational_alert_target_saved",
      target_type: "operational_alert_target",
      target_id: target.id,
      metadata_json: {
        channel: "telegram",
        target_id_masked: target.target_id_masked,
        enabled: target.enabled,
      },
    });
    return {
      data: {
        id: target.id,
        display_name: target.display_name,
        target_id_masked: target.target_id_masked,
        enabled: target.enabled,
        updated_at: target.updated_at,
      },
    };
  },
);

app.post(
  "/api/owner/operational-alerts/telegram/test",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }
    const body = telegramTestAlertSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid Telegram test request",
        details: body.error.flatten().fieldErrors,
      });
    }
    const message = buildOperationalAlertMessage({
      title: "ทดสอบ Telegram ops alert",
      severity: "info",
      status: "test",
      details: [
        "ถ้าเห็นข้อความนี้ แปลว่าระบบส่งแจ้งเตือน Telegram ได้แล้ว",
        body.data.message ? `ข้อความ: ${body.data.message}` : "",
      ].filter(Boolean),
      action: "ไม่ต้องดำเนินการ นี่เป็นข้อความทดสอบ",
    });
    const deliveries = await sendOperationalTelegramAlert({
      store: systemStore,
      alertType: "test",
      severity: "info",
      messageText: message,
      dedupeKey: null,
      forceEnabled: true,
    });
    await systemStore.appendAuditLog({
      tenant_id: null,
      actor_id: null,
      action: "telegram_operational_alert_test_sent",
      target_type: "operational_alert",
      target_id: "telegram",
      metadata_json: {
        delivery_count: deliveries.length,
        statuses: deliveries.map((delivery) => delivery.status),
      },
    });
    return { data: deliveries };
  },
);

app.post(
  "/api/owner/operational-alerts/smoke-test",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }
    const body = operationalAlertSmokeTestSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid operational alert smoke test request",
        details: body.error.flatten().fieldErrors,
      });
    }
    const tenant = body.data.tenant_id
      ? await getTenantOrNull(body.data.tenant_id)
      : null;
    const alertType = body.data.alert_type;
    const title = resolveSmokeTestAlertTitle(alertType);
    const message = buildOperationalAlertMessage({
      title,
      severity: body.data.severity,
      tenantName: tenant?.name ?? body.data.tenant_id ?? null,
      scheduledTime: body.data.scheduled_time ?? null,
      reportKey: body.data.report_key ?? null,
      status: "dry_run",
      details: [
        "โหมด dry-run: ระบบบันทึก delivery preview แต่ไม่ส่งไป Telegram จริง",
        alertType === "javaws_diagnostic"
          ? "phase: non_base64_return, kind: unreadable_response"
          : "",
      ].filter(Boolean),
      action:
        "ใช้ทดสอบ copy, dedupe และหน้าจอ operations ก่อนเปิดแจ้งเตือนจริง",
    });
    const deliveries = await sendOperationalTelegramAlert({
      store: systemStore,
      tenant,
      alertType,
      severity: body.data.severity,
      messageText: message,
      dedupeKey: buildOperationalAlertDedupeKey({
        alertType,
        tenantId: tenant?.id ?? body.data.tenant_id ?? null,
        scheduledDate: body.data.scheduled_date ?? new Date().toISOString().slice(0, 10),
        scheduledTime: body.data.scheduled_time ?? null,
        reportKey: body.data.report_key ?? null,
        severity: body.data.severity,
      }),
      dryRun: true,
    });
    await systemStore.appendAuditLog({
      tenant_id: tenant?.id ?? null,
      actor_id: null,
      action: "operational_alert_smoke_test_dry_run",
      target_type: "operational_alert",
      target_id: alertType,
      metadata_json: {
        alert_type: alertType,
        severity: body.data.severity,
        delivery_count: deliveries.length,
      },
    });
    return { data: deliveries };
  },
);

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
  const maxConsecutiveFailures = Math.max(
    toSafeNumber(body.data.metadata_json.consecutive_notification_tick_failures),
    toSafeNumber(body.data.metadata_json.consecutive_report_run_tick_failures),
  );
  if (body.data.status === "error" && maxConsecutiveFailures >= 3) {
    const enabledTenants = (await systemStore.listTenants()).filter(
      (tenant) =>
        tenant.status === "active" &&
        getTenantFeatureFlags(tenant).telegram_operational_alerts_enabled,
    );
    if (enabledTenants.length) {
      const checkedDate = heartbeat.checked_at.slice(0, 10);
      const checkedHour = heartbeat.checked_at.slice(11, 13) || "00";
      await sendOperationalTelegramAlert({
        store: systemStore,
        alertType: "worker_tick_failed",
        severity: "critical",
        messageText: buildOperationalAlertMessage({
          title: "Worker tick ล้มเหลวต่อเนื่อง",
          severity: "critical",
          status: heartbeat.status,
          details: [
            `worker_id: ${heartbeat.worker_id}`,
            `role: ${heartbeat.role}`,
            `consecutive_failures: ${maxConsecutiveFailures}`,
          ],
          action:
            "ตรวจ worker process, API base URL, token, network และดู operations status ทันที",
        }),
        dedupeKey: buildOperationalAlertDedupeKey({
          alertType: "worker_tick_failed",
          tenantId: "system",
          ruleId: heartbeat.worker_id,
          scheduledDate: checkedDate,
          scheduledTime: `${checkedHour}:00`,
          severity: "critical",
        }),
        forceEnabled: true,
      }).catch(async (error) => {
        await systemStore.appendAuditLog({
          tenant_id: null,
          actor_id: null,
          action: "telegram_worker_health_alert_failed",
          target_type: "worker",
          target_id: heartbeat.worker_id,
          metadata_json: {
            safe_error_message: toSafeErrorMessage(error),
          },
        });
      });
    }
  }

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
  const queued: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];
  const rules = (await systemStore.listNotificationRules())
    .filter((rule) => rule.enabled)
    .slice(0, 500);
  const catchUpMinutes = body.data.catch_up_minutes ?? 15;

  ruleLoop: for (const rule of rules) {
    if (queued.length >= limit) {
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
      if (queued.length >= limit) {
        break ruleLoop;
      }

      const result = await enqueueWorkerNotificationRuleRun({
        rule,
        mode,
        scheduledLocalDate: due.date,
        scheduledLocalTime: due.time,
        source: "worker_due",
      });
      if (result.reused) {
        skipped.push({
          rule_id: rule.id,
          scheduled_local_date: due.date,
          scheduled_local_time: due.time,
          reason: "duplicate_minute",
          status: result.run.status,
          run_id: result.run.id,
        });
        continue;
      }
      queued.push({
        rule_id: rule.id,
        run_id: result.run.id,
        scheduled_local_date: due.date,
        scheduled_local_time: due.time,
        source: "worker_due",
      });
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
    if (queued.length >= limit) {
      break;
    }

    const rule = await systemStore.getNotificationRule(failedRun.rule_id);
    if (!rule || !rule.enabled) {
      continue;
    }
    if (failedRun.attempt >= rule.retry_policy.max_attempts) {
      continue;
    }

    const result = await enqueueWorkerNotificationRuleRun({
      rule,
      mode,
      scheduledLocalDate: failedRun.scheduled_local_date,
      scheduledLocalTime: failedRun.scheduled_local_time,
      attempt: failedRun.attempt + 1,
      source: "worker_retry",
      retryFromRun: failedRun,
    });
    if (result.reused) {
      skipped.push({
        rule_id: rule.id,
        reason: "duplicate_retry",
        status: result.run.status,
        run_id: result.run.id,
      });
      continue;
    }
    queued.push({
      rule_id: rule.id,
      run_id: result.run.id,
      scheduled_local_date: failedRun.scheduled_local_date,
      scheduled_local_time: failedRun.scheduled_local_time,
      source: "worker_retry",
      attempt: failedRun.attempt + 1,
    });
  }

  kickNotificationQueueProcessor("worker_tick");
  kickExecutiveDashboardRunProcessor("worker_tick");

  return {
    data: {
      queued,
      skipped,
      checked_rules: rules.length,
      checked_at: now.toISOString(),
      mode,
      processor_kicked: true,
    },
  };
});

app.post("/api/worker/report-runs/tick", async (request, reply) => {
  const workerAuth = await requireWorkerToken(request);
  if (!workerAuth.ok) {
    return reply.status(workerAuth.statusCode).send({ error: workerAuth.error });
  }

  const body = reportRunWorkerTickSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return reply.status(400).send({
      error: "Invalid report run worker tick",
      details: body.error.flatten().fieldErrors,
    });
  }

  const now = body.data.now ? new Date(body.data.now) : new Date();
  const result = await processQueuedChunkedReportRuns({
    limit: body.data.limit ?? CHUNKED_HEAVY_REPORT_GLOBAL_CONCURRENCY,
    workerId: body.data.worker_id ?? "worker_report_runs",
    now,
  });

  return {
    data: {
      ...result,
      checked_at: now.toISOString(),
    },
  };
});

app.post("/api/worker/trial-expiry/tick", async (request, reply) => {
  const workerAuth = await requireWorkerToken(request);
  if (!workerAuth.ok) {
    return reply.status(workerAuth.statusCode).send({ error: workerAuth.error });
  }

  const now = new Date();
  const todayBangkok = formatDateInBangkok(now);
  const expired: string[] = [];
  const warned: string[] = [];

  const trialTenants = await systemStore.listTrialTenantsWithPeriodEnd();

  for (const tenant of trialTenants) {
    if (tenant.status !== "trial" || !tenant.currentPeriodEnd) continue;

    const periodEnd = new Date(tenant.currentPeriodEnd);
    const msRemaining = periodEnd.getTime() - now.getTime();
    const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));

    if (msRemaining <= 0) {
      // Expired: auto-suspend
      const updated = await systemStore.updateTenantStatus({
        tenantId: tenant.id,
        status: "suspended",
        suspendedReason: "trial_expired",
        currentPeriodEnd: tenant.currentPeriodEnd,
      }).catch(() => null);

      if (!updated) continue;

      // LINE push to all approved targets (text-only, non-fatal per target)
      const targets = await listEffectiveLineTargets(tenant.id).catch(() => []);
      const approvedTargets = targets.filter((t) => t.approved && t.enabled);
      const expiredMessage = `การทดลองใช้งาน ${tenant.name} สิ้นสุดแล้ว ระบบหยุดส่งรายงาน\nกรุณาติดต่อทีมงานเพื่อเปิดใช้งานต่อ`;

      for (const target of approvedTargets) {
        const lineConfig = await buildLineChannelConfigForTarget(target);
        if (!lineConfig) continue;

        await sendLineTextPush({
          channelAccessToken: lineConfig.channelAccessToken,
          targetId: lineConfig.targetId,
          text: expiredMessage,
        }).catch(async (error: unknown) => {
          await systemStore.appendAuditLog({
            tenant_id: tenant.id,
            actor_id: null,
            action: "trial_expired_line_failed",
            target_type: "tenant",
            target_id: tenant.id,
            metadata_json: { safe_error_message: toSafeErrorMessage(error), target_id_masked: target.target_id_masked },
          });
        });
      }

      // Telegram admin alert (dedup'd per tenant per day)
      await sendOperationalTelegramAlert({
        store: systemStore,
        alertType: "trial_auto_expired",
        severity: "warning",
        messageText: buildOperationalAlertMessage({
          title: "Trial หมดอายุ — auto-suspended",
          severity: "warning",
          status: "suspended",
          details: [`tenant: ${tenant.id}`, `name: ${tenant.name}`, `period_end: ${tenant.currentPeriodEnd}`],
          action: "ตรวจสอบและต่ออายุหรือ cancel ผ่าน Owner UI",
        }),
        dedupeKey: buildOperationalAlertDedupeKey({
          alertType: "trial_auto_expired",
          tenantId: tenant.id,
          ruleId: "trial_expiry",
          scheduledDate: todayBangkok,
          scheduledTime: "00:00",
          severity: "warning",
        }),
      }).catch(() => null);

      await systemStore.appendAuditLog({
        tenant_id: tenant.id,
        actor_id: null,
        action: "trial_auto_expired",
        target_type: "tenant",
        target_id: tenant.id,
        metadata_json: { period_end: tenant.currentPeriodEnd, suspended_reason: "trial_expired" },
      });

      expired.push(tenant.id);
    } else if (daysRemaining >= 1 && daysRemaining <= 3) {
      // Warning: check dedup — ส่งได้วันละ 1 ครั้งต่อ tenant
      const recentLogs = await systemStore.listAuditLogs(200);
      const alreadyWarnedToday = recentLogs.some(
        (log) =>
          log.tenant_id === tenant.id &&
          log.action === "trial_warning_sent" &&
          typeof log.metadata_json === "object" &&
          log.metadata_json !== null &&
          (log.metadata_json as Record<string, unknown>).warning_date === todayBangkok,
      );
      if (alreadyWarnedToday) continue;

      const periodEndDisplay = new Intl.DateTimeFormat("th-TH", {
        timeZone: BANGKOK_TIME_ZONE,
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(periodEnd);
      const warningMessage = `การทดลองใช้งาน ${tenant.name} เหลืออีก ${daysRemaining} วัน (หมด ${periodEndDisplay})\nกรุณาติดต่อทีมงานเพื่อต่ออายุการใช้งาน`;

      const targets = await listEffectiveLineTargets(tenant.id).catch(() => []);
      const approvedTargets = targets.filter((t) => t.approved && t.enabled);

      for (const target of approvedTargets) {
        const lineConfig = await buildLineChannelConfigForTarget(target);
        if (!lineConfig) continue;

        await sendLineTextPush({
          channelAccessToken: lineConfig.channelAccessToken,
          targetId: lineConfig.targetId,
          text: warningMessage,
        }).catch(() => null);
      }

      await systemStore.appendAuditLog({
        tenant_id: tenant.id,
        actor_id: null,
        action: "trial_warning_sent",
        target_type: "tenant",
        target_id: tenant.id,
        metadata_json: { warning_date: todayBangkok, days_remaining: daysRemaining, period_end: tenant.currentPeriodEnd },
      });

      warned.push(tenant.id);
    }
  }

  return {
    data: {
      expired,
      warned,
      checked_tenants: trialTenants.length,
      checked_at: now.toISOString(),
    },
  };
});

app.post("/api/worker/subscription-due/tick", async (request, reply) => {
  const workerAuth = await requireWorkerToken(request);
  if (!workerAuth.ok) {
    return reply.status(workerAuth.statusCode).send({ error: workerAuth.error });
  }

  const GRACE_PERIOD_DAYS = 7;
  const now = new Date();
  const todayBangkok = formatDateInBangkok(now);

  const flippedPastDue: string[] = [];
  const suspended: string[] = [];
  const remindedAdmin: string[] = [];

  const subTenants = await systemStore.listSubscriptionTenantsWithPeriodEnd();

  for (const tenant of subTenants) {
    if (!tenant.currentPeriodEnd || !tenant.billingCycle) continue;

    const periodEnd = new Date(tenant.currentPeriodEnd);
    const msOverdue = now.getTime() - periodEnd.getTime();
    const daysOverdue = msOverdue / (24 * 60 * 60 * 1000);
    const msRemaining = -msOverdue;
    const daysRemaining = msRemaining / (24 * 60 * 60 * 1000);

    if (msOverdue > GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000) {
      // Grace period หมด → auto-suspend
      if (tenant.status !== "past_due") continue;

      const updatedTenant = await systemStore.updateTenantStatus({
        tenantId: tenant.id,
        status: "suspended",
        suspendedReason: "subscription_expired",
      }).catch(() => null);

      if (!updatedTenant) continue;

      // LINE push ลูกค้า 1 ครั้ง (dedup ด้วย period_end + action key)
      const recentLogs = await systemStore.listAuditLogs(200);
      const lineAlreadySent = recentLogs.some(
        (log) =>
          log.tenant_id === tenant.id &&
          log.action === "subscription_suspended_line_sent" &&
          typeof log.metadata_json === "object" &&
          log.metadata_json !== null &&
          (log.metadata_json as Record<string, unknown>).period_end === tenant.currentPeriodEnd,
      );

      if (!lineAlreadySent) {
        const targets = await listEffectiveLineTargets(tenant.id).catch(() => []);
        const approvedTargets = targets.filter((t) => t.approved && t.enabled);
        const suspendMessage = `${tenant.name} หยุดให้บริการแล้ว เนื่องจากยังไม่ได้ต่ออายุการใช้งาน\nกรุณาติดต่อทีมงานเพื่อเปิดใช้งานอีกครั้ง`;

        for (const target of approvedTargets) {
          const lineConfig = await buildLineChannelConfigForTarget(target);
          if (!lineConfig) continue;

          await sendLineTextPush({
            channelAccessToken: lineConfig.channelAccessToken,
            targetId: lineConfig.targetId,
            text: suspendMessage,
          }).catch(() => null);
        }

        await systemStore.appendAuditLog({
          tenant_id: tenant.id,
          actor_id: null,
          action: "subscription_suspended_line_sent",
          target_type: "tenant",
          target_id: tenant.id,
          metadata_json: { period_end: tenant.currentPeriodEnd },
        });
      }

      // Telegram admin alert
      await sendOperationalTelegramAlert({
        store: systemStore,
        alertType: "subscription_auto_suspended",
        severity: "critical",
        messageText: buildOperationalAlertMessage({
          title: "Subscription หมด — auto-suspended",
          severity: "critical",
          status: "suspended",
          details: [
            `tenant: ${tenant.id}`,
            `name: ${tenant.name}`,
            `period_end: ${tenant.currentPeriodEnd}`,
            `billing_cycle: ${tenant.billingCycle}`,
            `overdue: ${Math.floor(daysOverdue)} วัน`,
          ],
          action: "ต่ออายุและเปิด status กลับ active ผ่าน Owner UI",
        }),
        dedupeKey: buildOperationalAlertDedupeKey({
          alertType: "subscription_auto_suspended",
          tenantId: tenant.id,
          ruleId: "subscription_due",
          scheduledDate: todayBangkok,
          scheduledTime: "00:00",
          severity: "critical",
        }),
      }).catch(() => null);

      await systemStore.appendAuditLog({
        tenant_id: tenant.id,
        actor_id: null,
        action: "subscription_auto_suspended",
        target_type: "tenant",
        target_id: tenant.id,
        metadata_json: {
          period_end: tenant.currentPeriodEnd,
          billing_cycle: tenant.billingCycle,
          suspended_reason: "subscription_expired",
        },
      });

      suspended.push(tenant.id);
    } else if (msOverdue > 0) {
      // หมดแล้ว แต่ยังอยู่ใน grace period → flip past_due
      if (tenant.status !== "active") continue;

      const updatedTenant = await systemStore.updateTenantStatus({
        tenantId: tenant.id,
        status: "past_due",
      }).catch(() => null);

      if (!updatedTenant) continue;

      // LINE push ลูกค้า 1 ครั้ง (dedup ด้วย period_end)
      const recentLogs = await systemStore.listAuditLogs(200);
      const lineAlreadySent = recentLogs.some(
        (log) =>
          log.tenant_id === tenant.id &&
          log.action === "past_due_grace_started" &&
          typeof log.metadata_json === "object" &&
          log.metadata_json !== null &&
          (log.metadata_json as Record<string, unknown>).period_end === tenant.currentPeriodEnd,
      );

      if (!lineAlreadySent) {
        const targets = await listEffectiveLineTargets(tenant.id).catch(() => []);
        const approvedTargets = targets.filter((t) => t.approved && t.enabled);
        const graceMessage = `${tenant.name} จะหยุดให้บริการใน 7 วัน เนื่องจากยังไม่ได้ต่ออายุการใช้งาน\nกรุณาติดต่อทีมงานเพื่อต่ออายุ`;

        for (const target of approvedTargets) {
          const lineConfig = await buildLineChannelConfigForTarget(target);
          if (!lineConfig) continue;

          await sendLineTextPush({
            channelAccessToken: lineConfig.channelAccessToken,
            targetId: lineConfig.targetId,
            text: graceMessage,
          }).catch(() => null);
        }

        await systemStore.appendAuditLog({
          tenant_id: tenant.id,
          actor_id: null,
          action: "past_due_grace_started",
          target_type: "tenant",
          target_id: tenant.id,
          metadata_json: { period_end: tenant.currentPeriodEnd },
        });
      }

      // Telegram admin alert
      await sendOperationalTelegramAlert({
        store: systemStore,
        alertType: "subscription_past_due",
        severity: "warning",
        messageText: buildOperationalAlertMessage({
          title: "Subscription หมดแล้ว — grace period 7 วัน",
          severity: "warning",
          status: "past_due",
          details: [
            `tenant: ${tenant.id}`,
            `name: ${tenant.name}`,
            `period_end: ${tenant.currentPeriodEnd}`,
            `billing_cycle: ${tenant.billingCycle}`,
          ],
          action: "ต่ออายุผ่าน Owner UI ก่อน grace period หมด",
        }),
        dedupeKey: buildOperationalAlertDedupeKey({
          alertType: "subscription_past_due",
          tenantId: tenant.id,
          ruleId: "subscription_due",
          scheduledDate: todayBangkok,
          scheduledTime: "00:00",
          severity: "warning",
        }),
      }).catch(() => null);

      flippedPastDue.push(tenant.id);
    } else if (daysRemaining >= 0 && daysRemaining <= 3) {
      // ยังไม่หมด แต่เหลือ ≤ 3 วัน → Telegram reminder เท่านั้น (ไม่ LINE ลูกค้า)
      const recentLogs = await systemStore.listAuditLogs(200);
      const alreadyRemindedToday = recentLogs.some(
        (log) =>
          log.tenant_id === tenant.id &&
          log.action === "subscription_renewal_reminder_sent" &&
          typeof log.metadata_json === "object" &&
          log.metadata_json !== null &&
          (log.metadata_json as Record<string, unknown>).reminder_date === todayBangkok,
      );

      if (alreadyRemindedToday) continue;

      const daysRemainingDisplay = Math.ceil(daysRemaining);

      await sendOperationalTelegramAlert({
        store: systemStore,
        alertType: "subscription_renewal_due",
        severity: "info",
        messageText: buildOperationalAlertMessage({
          title: `Subscription ใกล้หมด — เหลือ ${daysRemainingDisplay} วัน`,
          severity: "info",
          status: "active",
          details: [
            `tenant: ${tenant.id}`,
            `name: ${tenant.name}`,
            `period_end: ${tenant.currentPeriodEnd}`,
            `billing_cycle: ${tenant.billingCycle}`,
          ],
          action: "ต่ออายุผ่าน Owner UI",
        }),
        dedupeKey: buildOperationalAlertDedupeKey({
          alertType: "subscription_renewal_due",
          tenantId: tenant.id,
          ruleId: "subscription_due",
          scheduledDate: todayBangkok,
          scheduledTime: "00:00",
          severity: "info",
        }),
      }).catch(() => null);

      await systemStore.appendAuditLog({
        tenant_id: tenant.id,
        actor_id: null,
        action: "subscription_renewal_reminder_sent",
        target_type: "tenant",
        target_id: tenant.id,
        metadata_json: {
          reminder_date: todayBangkok,
          days_remaining: daysRemainingDisplay,
          period_end: tenant.currentPeriodEnd,
        },
      });

      remindedAdmin.push(tenant.id);
    }
  }

  return {
    data: {
      flipped_past_due: flippedPastDue,
      suspended,
      reminded_admin: remindedAdmin,
      checked_tenants: subTenants.length,
      checked_at: now.toISOString(),
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

  // Send auto-reply immediately while replyToken is still fresh (30s TTL).
  // Done before saveLineWebhookEvents / registerWebhookLineTargets to avoid
  // blocking async DB + HTTP calls consuming the TTL window.
  const replyCredentials = await readStoredLineChannelCredentials({
    store: systemStore,
    tenantId: webhookTenantId,
    preferredLineChannelId: webhookLineChannelId,
  }).catch(() => null);

  if (replyCredentials) {
    for (const event of events) {
      if (!event.reply_token) continue;
      if (!["follow", "join", "message"].includes(event.event_type)) continue;

      // Skip approved targets — they don't need onboarding reply.
      const existingTarget = event.source_id
        ? await systemStore
            .getLineTargetByHash({
              tenantId: webhookTenantId,
              targetIdHash: hashLineTargetId(event.source_id),
            })
            .catch(() => null)
        : null;
      if (existingTarget?.approved) continue;

      await sendLineReply({
        channelAccessToken: replyCredentials.channelAccessToken,
        replyToken: event.reply_token,
        messages: [
          {
            type: "text",
            text: "ขอบคุณที่ติดตาม ทีมงานกำลังตั้งค่าให้ รอรับรายงานเร็วๆ นี้",
          },
        ],
      }).catch((error: unknown) => {
        // replyToken expires after 30s (e.g. LINE Developers console test) — non-fatal.
        request.log.warn(
          {
            safe_error_message: toSafeErrorMessage(error),
            event_type: event.event_type,
          },
          "LINE auto-reply failed (non-fatal)",
        );
      });
    }
  }

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
    }).catch((auditError: unknown) => {
      request.log.warn(
        { safe_error_message: toSafeErrorMessage(auditError) },
        "LINE webhook audit log failed (non-fatal)",
      );
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
  const targetTenantName = (await getTenantOrNull(target.tenant_id))?.name;
  const salesPreview =
    salesSnapshot?.report_key === "sales_goods_services"
      ? renderSalesGoodsServicesLinePreview({
          snapshot: salesSnapshot,
          dashboardUrl: salesViewerUrl,
          tenantName: targetTenantName,
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
          tenantName: targetTenantName,
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
  "/api/reports/:tenantId/executive-dashboard-runs",
  async (request, reply) => {
    const routeParams = tenantParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid dashboard link." });
    }

    const body = executiveDashboardRunCreateSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid dashboard request.",
        details: body.error.flatten().fieldErrors,
      });
    }

    const access = await verifyDashboardViewerAccess({
      tenantId: routeParams.data.tenantId,
      token: body.data.dashboard_token,
      reply,
    });
    if (!access.ok) {
      return access.response;
    }

    const range = buildDashboardRunParamsFromSelection({
      dateFrom: body.data.date_from,
      dateTo: body.data.date_to,
      payload: access.payload,
    });
    if (!range.ok) {
      return reply.status(400).send({ error: range.error });
    }

    const exactActiveRun = await systemStore.findActiveExecutiveDashboardRun({
      tenantId: access.tenantId,
      tokenHash: access.tokenHash,
      params: range.params,
    });
    if (exactActiveRun) {
      return reply.status(202).send({
        data: await serializeExecutiveDashboardRun(exactActiveRun),
        reused: true,
      });
    }

    const tenantActiveRun = await systemStore.findActiveExecutiveDashboardRun({
      tenantId: access.tenantId,
    });
    if (tenantActiveRun) {
      if (tenantActiveRun.token_hash === access.tokenHash) {
        return reply.status(202).send({
          data: await serializeExecutiveDashboardRun(tenantActiveRun),
          reused: true,
          message:
            "ลิงก์นี้มีงานวิเคราะห์กำลังทำอยู่ ระบบจะแสดงความคืบหน้าของงานเดิมก่อน",
        });
      }
      return reply.status(409).send({
        error:
          "ร้านนี้มีงานวิเคราะห์จากลิงก์อื่นกำลังทำอยู่ กรุณารอให้งานนั้นจบแล้วลองใหม่",
      });
    }

    const rateLimitSince = new Date(
      Date.now() - DASHBOARD_TOKEN_RATE_LIMIT_WINDOW_MS,
    ).toISOString();
    const recentRunCount = await systemStore.countRecentExecutiveDashboardRuns({
      tenantId: access.tenantId,
      tokenHash: access.tokenHash,
      since: rateLimitSince,
    });
    if (recentRunCount >= DASHBOARD_TOKEN_RATE_LIMIT_COUNT) {
      return reply.status(429).send({
        error:
          "ลิงก์นี้เรียกดูช่วงข้อมูลใหม่บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
      });
    }

    const nowIso = new Date().toISOString();
    const runId = buildExecutiveDashboardRunId({
      tenantId: access.tenantId,
      tokenHash: access.tokenHash,
      params: range.params,
      clientRequestId: body.data.client_request_id,
    });
    const existingRun = await systemStore.getExecutiveDashboardRun(runId);
    if (existingRun) {
      return reply.status(202).send({
        data: await serializeExecutiveDashboardRun(existingRun),
        reused: true,
      });
    }

    const reportKeys = access.payload.allowed_report_keys.filter((reportKey) =>
      access.tokenRecord.scope_json.allowed_report_keys.includes(reportKey),
    );
    if (!reportKeys.length) {
      return reply.status(403).send({
        error: "ลิงก์นี้ไม่มีรายงานที่อนุญาตให้เปิด dashboard",
      });
    }
    const run = await systemStore.upsertExecutiveDashboardRun({
      id: runId,
      tenant_id: access.tenantId,
      token_hash: access.tokenHash,
      token_jti: access.payload.jti,
      source_run_id: access.payload.source_run_id,
      params: range.params,
      report_keys: reportKeys,
      status: "queued",
      report_run_ids: [],
      report_results: [],
      safe_error_message: null,
      queued_at: nowIso,
      claimed_at: null,
      started_at: null,
      finished_at: null,
      worker_id: null,
      progress_stage: "queued",
      progress_percent: 5,
      progress_current_report_key: null,
      progress_done_reports: 0,
      progress_total_reports: reportKeys.length,
      progress_updated_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    });

    await systemStore.appendAuditLog({
      tenant_id: access.tenantId,
      actor_id: null,
      action: "executive_dashboard_run_queued",
      target_type: "executive_dashboard_run",
      target_id: run.id,
      metadata_json: {
        dashboard_token_jti: access.payload.jti,
        source_run_id: access.payload.source_run_id,
        selected_date_from: range.params.date_from,
        selected_date_to: range.params.date_to,
        selected_time_from: range.params.time_from ?? null,
        selected_time_to: range.params.time_to ?? null,
        report_keys: reportKeys,
      },
    });

    kickExecutiveDashboardRunProcessor(run.id);

    return reply.status(202).send({
      data: await serializeExecutiveDashboardRun(run),
      reused: false,
    });
  },
);

app.get(
  "/api/reports/:tenantId/executive-dashboard-runs/:runId",
  async (request, reply) => {
    const routeParams = executiveDashboardRunParamsSchema.safeParse(
      request.params,
    );
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid dashboard run." });
    }

    const query = executiveDashboardRunQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid dashboard link." });
    }

    const access = await verifyDashboardViewerAccess({
      tenantId: routeParams.data.tenantId,
      token: query.data.dashboard_token,
      reply,
    });
    if (!access.ok) {
      return access.response;
    }

    const run = await systemStore.getExecutiveDashboardRun(
      routeParams.data.runId,
    );
    if (!run || run.tenant_id !== access.tenantId) {
      return reply.status(404).send({ error: "ไม่พบงานวิเคราะห์นี้" });
    }
    if (run.token_hash !== access.tokenHash) {
      return reply.status(403).send({
        error: "ลิงก์นี้ไม่มีสิทธิ์เปิดงานวิเคราะห์นี้",
      });
    }

    return { data: await serializeExecutiveDashboardRun(run) };
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
        tenantName: (await getTenantOrNull(params.data.tenantId))?.name,
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
        tenantName: (await getTenantOrNull(params.data.tenantId))?.name,
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
      tenantName: (await getTenantOrNull(params.data.tenantId))?.name,
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
      tenantName: tenant.name,
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
      tenantName: tenant.name,
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
            tenantName: tenant.name,
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
              tenantName: tenant.name,
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
  "/api/reports/:tenantId/:reportKey/run-async",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = signedViewerParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid report params" });
    }
    const reportKey = routeParams.data.reportKey;
    if (!isChunkedHeavyReportKey(reportKey)) {
      return reply.status(400).send({
        error: "รายงานนี้ยังไม่รองรับ async chunked run",
      });
    }

    const body = asyncReportRunBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid report params",
        details: body.error.flatten().fieldErrors,
      });
    }

    const tenant = await getTenantOrNull(routeParams.data.tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found" });
    }
    if (!isSmlChunkedHeavyReportsEnabled(tenant)) {
      return reply.status(409).send({
        error:
          "ยังไม่ได้เปิดใช้ chunked heavy reports สำหรับร้านนี้ ระบบยังใช้ runner เดิมอยู่",
      });
    }

    const params = salesGoodsServicesParamsSchema.parse({
      date_from: body.data.date_from,
      date_to: body.data.date_to,
      time_from: body.data.time_from,
      time_to: body.data.time_to,
    });
    const enqueueResult = await enqueueChunkedHeavyReportRun({
      tenantId: routeParams.data.tenantId,
      reportKey,
      params,
      force: body.data.force ?? false,
      requestAction: "chunked_report_run_requested",
    });

    if (!enqueueResult.ok) {
      return reply.status(enqueueResult.statusCode).send({
        error: enqueueResult.error,
        run: enqueueResult.runRecord,
        active_run: enqueueResult.activeRun,
      });
    }

    if (!enqueueResult.duplicate) {
      kickChunkedReportRunProcessor(enqueueResult.runRecord.id);
    }

    return reply.status(enqueueResult.duplicate ? 200 : 202).send({
      data: enqueueResult.runRecord,
      duplicate: enqueueResult.duplicate,
      progress: await buildChunkedRunProgress(enqueueResult.runRecord),
    });
  },
);

app.get(
  "/api/reports/:tenantId/runs/:runId/progress",
  async (request, reply) => {
    const adminAuth = requireAdminMutation(request);
    if (!adminAuth.ok) {
      return reply.status(adminAuth.statusCode).send({ error: adminAuth.error });
    }

    const routeParams = reportRunProgressParamsSchema.safeParse(request.params);
    if (!routeParams.success) {
      return reply.status(400).send({ error: "Invalid report run params" });
    }

    const run = await systemStore.getRun(routeParams.data.runId);
    if (!run || run.tenant_id !== routeParams.data.tenantId) {
      return reply.status(404).send({ error: "Report run not found" });
    }

    return {
      data: await buildChunkedRunProgress(run),
    };
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
	    applyJavaWsFailureDiagnostics(runRecord, error);
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
	    applyJavaWsFailureDiagnostics(runRecord, error);
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
	    applyJavaWsFailureDiagnostics(runRecord, error);
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
	    applyJavaWsFailureDiagnostics(runRecord, error);
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
	    applyJavaWsFailureDiagnostics(runRecord, error);
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

async function runAndPersistArCustomerMovementReport(input: {
  tenantId: TenantId;
  params: SalesGoodsServicesParams;
  requestAction: string;
}): Promise<
  | {
      ok: true;
      snapshot: ArCustomerMovementSnapshot;
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
    id: createRunId(input.tenantId, "ar_customer_movement"),
    tenant_id: input.tenantId,
    report_key: "ar_customer_movement",
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
      report_key: "ar_customer_movement",
      params: input.params,
      source_basis: "ar_movement_as_of_date",
      contains_customer_ar_data: true,
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
    const snapshot = await runArCustomerMovementReport({
      tenant_id: input.tenantId,
      run_id: runRecord.id,
      params: input.params,
      datasource,
    });

    runRecord.status = "success";
    runRecord.finished_at = new Date().toISOString();
    runRecord.row_count = snapshot.summary.document_count;
    await systemStore.upsertRun(runRecord);
    await systemStore.saveSnapshot(snapshot);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
      actor_id: null,
      action: "ar_customer_movement_report_run_succeeded",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: "ar_customer_movement",
        row_count: runRecord.row_count,
        quality_status: snapshot.quality_status,
        source_basis: snapshot.source_basis,
        contains_customer_ar_data: true,
      },
    });

    return { ok: true, snapshot, runRecord };
	  } catch (error) {
	    runRecord.status = "failed";
	    runRecord.finished_at = new Date().toISOString();
	    runRecord.safe_error_message = toSafeArCustomerMovementErrorMessage(error);
	    applyJavaWsFailureDiagnostics(runRecord, error);
	    await systemStore.upsertRun(runRecord);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
      actor_id: null,
      action: "ar_customer_movement_report_run_failed",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: "ar_customer_movement",
        safe_error_message: runRecord.safe_error_message,
        source_basis: "ar_movement_as_of_date",
        contains_customer_ar_data: true,
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

function toSafeArCustomerMovementErrorMessage(error: unknown) {
  if (
    error instanceof Error &&
    /timeout|timed out|canceling statement/i.test(error.message)
  ) {
    return "รายงานเคลื่อนไหวลูกหนี้ใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้งหรือตรวจประสิทธิภาพ query";
  }
  return toSafeErrorMessage(error);
}

function applyJavaWsFailureDiagnostics(
  runRecord: ReportRunRecord,
  error: unknown,
) {
  const diagnostics = extractJavaWsFailureDiagnostics(error);
  if (!diagnostics) {
    return;
  }
  runRecord.failure_kind = diagnostics.failure_kind;
  runRecord.failure_phase = diagnostics.failure_phase;
  runRecord.failure_metadata_json = sanitizeJavaWsFailureMetadata(
    diagnostics.failure_metadata_json,
  );
}

function sanitizeJavaWsFailureMetadata(value: Record<string, unknown>) {
  const safeKeys = new Set([
    "operation",
    "latency_ms",
    "status_code",
    "response_byte_count",
    "decoded_byte_count",
    "phase",
  ]);
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!safeKeys.has(key)) {
      continue;
    }
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    ) {
      sanitized[key] = item;
    }
  }
  return sanitized;
}

async function runAndPersistArDebtReceiptReport(input: {
  tenantId: TenantId;
  params: SalesGoodsServicesParams;
  requestAction: string;
}): Promise<
  | {
      ok: true;
      snapshot: ArDebtReceiptSnapshot;
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
    id: createRunId(input.tenantId, "ar_debt_receipt"),
    tenant_id: input.tenantId,
    report_key: "ar_debt_receipt",
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
      report_key: "ar_debt_receipt",
      params: input.params,
      source_basis: "ar_debt_receipt_doc_date",
      contains_customer_ar_data: true,
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
    const snapshot = await runArDebtReceiptReport({
      tenant_id: input.tenantId,
      run_id: runRecord.id,
      params: input.params,
      datasource,
    });

    runRecord.status = "success";
    runRecord.finished_at = new Date().toISOString();
    runRecord.row_count = snapshot.summary.receipt_count;
    await systemStore.upsertRun(runRecord);
    await systemStore.saveSnapshot(snapshot);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
      actor_id: null,
      action: "ar_debt_receipt_report_run_succeeded",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: "ar_debt_receipt",
        row_count: runRecord.row_count,
        quality_status: snapshot.quality_status,
        source_basis: snapshot.source_basis,
        unmatched_payment_count: snapshot.summary.unmatched_payment_count,
        contains_customer_ar_data: true,
      },
    });

    return { ok: true, snapshot, runRecord };
	  } catch (error) {
	    runRecord.status = "failed";
	    runRecord.finished_at = new Date().toISOString();
	    runRecord.safe_error_message = toSafeArDebtReceiptErrorMessage(error);
	    applyJavaWsFailureDiagnostics(runRecord, error);
	    await systemStore.upsertRun(runRecord);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
      actor_id: null,
      action: "ar_debt_receipt_report_run_failed",
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: "ar_debt_receipt",
        safe_error_message: runRecord.safe_error_message,
        source_basis: "ar_debt_receipt_doc_date",
        contains_customer_ar_data: true,
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

async function runAndPersistCashBankReport(input: {
  tenantId: TenantId;
  reportKey: CashBankReportKey;
  params: SalesGoodsServicesParams;
  requestAction: string;
}): Promise<
  | {
      ok: true;
      snapshot: CashBankSnapshot;
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
  const sourceBasis = getCashBankSourceBasis(input.reportKey);
  const runRecord: ReportRunRecord = {
    id: createRunId(input.tenantId, input.reportKey),
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
      source_basis: sourceBasis,
      contains_cash_bank_data: true,
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
    const runner =
      input.reportKey === "cash_bank_receipts"
        ? runCashBankReceiptsReport
        : runCashBankPaymentsReport;
    const snapshot = await runner({
      tenant_id: input.tenantId,
      run_id: runRecord.id,
      params: input.params,
      datasource,
    });

    runRecord.status = "success";
    runRecord.finished_at = new Date().toISOString();
    runRecord.row_count = snapshot.summary.document_count;
    await systemStore.upsertRun(runRecord);
    await systemStore.saveSnapshot(snapshot);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
      actor_id: null,
      action: `${input.reportKey}_report_run_succeeded`,
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: input.reportKey,
        row_count: runRecord.row_count,
        total_amount: snapshot.summary.total_amount,
        channel_total_amount: snapshot.summary.channel_total_amount,
        unallocated_amount: snapshot.summary.unallocated_amount,
        mismatch_document_count: snapshot.summary.mismatch_document_count,
        quality_status: snapshot.quality_status,
        source_basis: snapshot.source_basis,
        contains_cash_bank_data: true,
      },
    });

    return { ok: true, snapshot, runRecord };
  } catch (error) {
    runRecord.status = "failed";
    runRecord.finished_at = new Date().toISOString();
    runRecord.safe_error_message = toSafeCashBankErrorMessage(error, input.reportKey);
    applyJavaWsFailureDiagnostics(runRecord, error);
    await systemStore.upsertRun(runRecord);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
      actor_id: null,
      action: `${input.reportKey}_report_run_failed`,
      target_type: "report_run",
      target_id: runRecord.id,
      metadata_json: {
        report_key: input.reportKey,
        safe_error_message: runRecord.safe_error_message,
        source_basis: sourceBasis,
        contains_cash_bank_data: true,
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

function getCashBankSourceBasis(reportKey: CashBankReportKey) {
  return reportKey === "cash_bank_receipts"
    ? "cash_bank_receipts_doc_date"
    : "cash_bank_payments_doc_date";
}

function toSafeCashBankErrorMessage(
  error: unknown,
  reportKey: CashBankReportKey,
) {
  if (
    error instanceof Error &&
    /timeout|timed out|canceling statement/i.test(error.message)
  ) {
    const title =
      reportKey === "cash_bank_receipts" ? "รายงานรับเงิน" : "รายงานจ่ายเงิน";
    return `${title}ใช้เวลานานเกินไป กรุณาลองช่วงวันที่สั้นลงหรือตรวจประสิทธิภาพ query`;
  }
  return toSafeErrorMessage(error);
}

function toSafeArDebtReceiptErrorMessage(error: unknown) {
  if (
    error instanceof Error &&
    /timeout|timed out|canceling statement/i.test(error.message)
  ) {
    return "รายงานรับชำระหนี้ใช้เวลานานเกินไป กรุณาลองช่วงวันที่สั้นลงหรือตรวจประสิทธิภาพ query";
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
startOpsMonitorLoop();

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

function buildProductionProofMetrics(input: {
  lineDeliveries: LineDeliveryRecord[];
  notificationRules: NotificationRuleRecord[];
  notificationRuns: NotificationRuleRunRecord[];
  now: Date;
  reportRuns: ReportRunRecord[];
  tenants: Array<{
    datasource_configured: boolean;
    id: string;
    line_configured: boolean;
    status: Tenant["status"];
  }>;
}) {
  const windowDays = 7;
  const nowMs = input.now.getTime();
  const windowStartMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  const activeTenants = input.tenants.filter(
    (tenant) => tenant.status === "active",
  );
  const enabledRuleTenantIds = new Set(
    input.notificationRules
      .filter((rule) => rule.enabled)
      .map((rule) => rule.tenant_id),
  );
  const eligibleTenantIds = new Set(
    activeTenants
      .filter((tenant) => enabledRuleTenantIds.has(tenant.id))
      .map((tenant) => tenant.id),
  );
  const isInWindow = (value: string | null | undefined) => {
    if (!value) {
      return false;
    }
    const timestamp = new Date(value).getTime();
    return (
      Number.isFinite(timestamp) &&
      timestamp >= windowStartMs &&
      timestamp <= nowMs
    );
  };
  const successLikeStatuses = new Set(["success", "success_with_warnings"]);
  const sendRuns = input.notificationRuns.filter(
    (run) =>
      eligibleTenantIds.has(run.tenant_id) &&
      run.mode === "send" &&
      isInWindow(run.created_at),
  );
  const scheduledRuns = sendRuns.filter(
    (run) => run.source === "worker_due" || run.source === "worker_retry",
  );
  const proofRuns = scheduledRuns.length ? scheduledRuns : sendRuns;
  const lineDeliveries = input.lineDeliveries.filter(
    (delivery) =>
      eligibleTenantIds.has(delivery.tenant_id) &&
      delivery.delivery_type === "notification_rule" &&
      isInWindow(delivery.sent_at ?? delivery.created_at),
  );
  const recentReportRuns = input.reportRuns.filter(
    (run) =>
      eligibleTenantIds.has(run.tenant_id) &&
      isInWindow(run.finished_at ?? run.started_at ?? run.queued_at),
  );
  const heavyDurations = recentReportRuns
    .filter(
      (run) =>
        successLikeStatuses.has(run.status) &&
        run.started_at &&
        run.finished_at &&
        (run.report_key === "stock_balance" ||
          run.report_key === "ar_customer_movement"),
    )
    .map((run) =>
      Math.max(
        0,
        new Date(run.finished_at ?? "").getTime() -
          new Date(run.started_at ?? "").getTime(),
      ),
    )
    .filter((value) => Number.isFinite(value));
  const percentile = (values: number[], p: number) => {
    if (!values.length) {
      return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * p) - 1),
    );
    return sorted[index] ?? null;
  };
  const latestSuccessRun = proofRuns
    .filter((run) => successLikeStatuses.has(run.status))
    .sort((a, b) =>
      (b.finished_at ?? b.updated_at ?? b.created_at).localeCompare(
        a.finished_at ?? a.updated_at ?? a.created_at,
      ),
    )[0];
  const latestProblemRun = proofRuns
    .filter((run) => run.status === "failed" || run.status === "skipped")
    .sort((a, b) =>
      (b.finished_at ?? b.updated_at ?? b.created_at).localeCompare(
        a.finished_at ?? a.updated_at ?? a.created_at,
      ),
    )[0];
  const scheduledSuccessCount = proofRuns.filter((run) =>
    successLikeStatuses.has(run.status),
  ).length;
  const lineSuccessCount = lineDeliveries.filter(
    (delivery) => delivery.status === "success",
  ).length;
  const notificationDurations = proofRuns
    .filter((run) => run.started_at && run.finished_at)
    .map((run) =>
      Math.max(
        0,
        new Date(run.finished_at ?? "").getTime() -
          new Date(run.started_at ?? "").getTime(),
      ),
    )
    .filter((value) => Number.isFinite(value));
  const notificationSlowCount = proofRuns.filter((run) => {
    const startedAt = run.started_at ?? run.claimed_at ?? run.queued_at;
    if (!startedAt) {
      return false;
    }
    const endAt = run.finished_at ?? input.now.toISOString();
    const elapsedMs = new Date(endAt).getTime() - new Date(startedAt).getTime();
    return (
      Number.isFinite(elapsedMs) &&
      elapsedMs >= NOTIFICATION_RUN_SLOW_WARNING_MS
    );
  }).length;

  return {
    window_days: windowDays,
    window_started_at: new Date(windowStartMs).toISOString(),
    generated_at: input.now.toISOString(),
    active_tenant_count: activeTenants.length,
    eligible_tenant_count: eligibleTenantIds.size,
    production_used_tenant_count: eligibleTenantIds.size,
    notification_rule_enabled_tenant_count: enabledRuleTenantIds.size,
    scheduled_run_count: proofRuns.length,
    scheduled_success_count: scheduledSuccessCount,
    scheduled_warning_count: proofRuns.filter(
      (run) => run.status === "success_with_warnings",
    ).length,
    scheduled_failed_count: proofRuns.filter((run) => run.status === "failed")
      .length,
    scheduled_pending_count: proofRuns.filter(
      (run) => run.status === "queued" || run.status === "running",
    ).length,
    scheduled_success_rate:
      proofRuns.length > 0 ? scheduledSuccessCount / proofRuns.length : null,
    scheduled_p95_duration_ms: percentile(notificationDurations, 0.95),
    scheduled_slow_count: notificationSlowCount,
    line_delivery_count: lineDeliveries.length,
    line_delivery_success_count: lineSuccessCount,
    line_delivery_failed_count: lineDeliveries.filter(
      (delivery) => delivery.status === "failed",
    ).length,
    line_delivery_success_rate:
      lineDeliveries.length > 0 ? lineSuccessCount / lineDeliveries.length : null,
    javaws_incident_count: recentReportRuns.filter(
      (run) => run.failure_kind || run.failure_phase,
    ).length,
    report_failure_count: recentReportRuns.filter((run) => run.status === "failed")
      .length,
    heavy_report_success_count: heavyDurations.length,
    heavy_report_p50_ms: percentile(heavyDurations, 0.5),
    heavy_report_p90_ms: percentile(heavyDurations, 0.9),
    latest_success_at:
      latestSuccessRun?.finished_at ?? latestSuccessRun?.updated_at ?? null,
    latest_problem_at:
      latestProblemRun?.finished_at ?? latestProblemRun?.updated_at ?? null,
  };
}

async function buildOperationsStatus(input: { includeAuditLogs: boolean }) {
  const generatedAt = new Date();
  const proofWindowStartedAt = new Date(
    generatedAt.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const runtimeConfig = await readEffectiveSystemRuntimeConfig(systemStore);
  const runtimeStatus = await readSystemRuntimeConfigStatus(systemStore);
  const latestHeartbeat = await systemStore.getLatestWorkerHeartbeat(
    "notification_rule_worker",
  );
  const tenants = await systemStore.listTenants();
  const notificationRules = await systemStore.listNotificationRules();
  const enabledNotificationRuleCounts = new Map<string, number>();
  for (const rule of notificationRules) {
    if (!rule.enabled) {
      continue;
    }
    enabledNotificationRuleCounts.set(
      rule.tenant_id,
      (enabledNotificationRuleCounts.get(rule.tenant_id) ?? 0) + 1,
    );
  }
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
      const [lineChannels, lineTargets, datasource] = await Promise.all([
        listEffectiveLineChannels(tenant.id),
        listEffectiveLineTargets(tenant.id),
        readDatasourceConfigStatus({
          store: systemStore,
          tenantId: tenant.id,
          envConfig: readDatasourceConfig(tenant.id),
        }),
      ]);
      return {
        id: tenant.id,
        name: tenant.name,
        database_name: tenant.databaseName,
        status: tenant.status,
        plan_code: tenant.planCode,
        datasource_configured: datasource.kind === "sml_javaws",
        line_configured:
          lineChannels.some(
            (channel) =>
              channel.enabled && channel.channel_access_token_configured,
          ),
        line_target_masked:
          lineTargets.find((target) => target.enabled && target.approved)
            ?.target_id_masked ?? null,
        notification_rules_enabled:
          enabledNotificationRuleCounts.get(tenant.id) ?? 0,
        notification_usage_status: enabledNotificationRuleCounts.get(tenant.id)
          ? "production_used"
          : "notifications_not_enabled",
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
  const [
    telegramStatus,
    telegramDeliveries,
    recentReportRuns,
    notificationRuns,
    recentLineDeliveries,
  ] = await Promise.all([
    readTelegramOperationalAlertStatus(systemStore),
    systemStore.listOperationalAlertDeliveries({
      channel: "telegram",
      limit: 30,
    }),
    systemStore.listRecentRuns({
      tenantIds: tenants.map((tenant) => tenant.id),
      since: proofWindowStartedAt,
      limit: 1000,
    }),
    systemStore.listRecentNotificationRuleRuns({
      tenantIds: tenants.map((tenant) => tenant.id),
      since: proofWindowStartedAt,
      limit: 1000,
    }),
    systemStore.listRecentLineDeliveries({
      tenantIds: tenants.map((tenant) => tenant.id),
      since: proofWindowStartedAt,
      limit: 1000,
    }),
  ]);
  const productionProof = buildProductionProofMetrics({
    lineDeliveries: recentLineDeliveries,
    notificationRules,
    notificationRuns,
    now: generatedAt,
    reportRuns: recentReportRuns,
    tenants: tenantHealth,
  });
  const latestJavaWsFailure =
    recentReportRuns
      .filter((run) => run.failure_kind || run.failure_phase)
      .sort((a, b) =>
        (b.finished_at ?? b.started_at).localeCompare(
          a.finished_at ?? a.started_at,
        ),
      )[0] ?? null;
  const heavyReportRuns = recentReportRuns
    .filter(
      (run) =>
        run.report_key === "stock_balance" ||
        run.report_key === "ar_customer_movement",
    )
    .slice(0, 20)
    .map((run) => ({
      id: run.id,
      tenant_id: run.tenant_id,
      report_key: run.report_key,
      status: run.status,
      started_at: run.started_at,
      finished_at: run.finished_at,
      duration_ms:
        run.finished_at && run.started_at
          ? Math.max(
              0,
              new Date(run.finished_at).getTime() -
                new Date(run.started_at).getTime(),
            )
          : null,
      row_count: run.row_count,
      failure_kind: run.failure_kind ?? null,
      failure_phase: run.failure_phase ?? null,
      safe_error_message: run.safe_error_message,
    }));

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
    operational_alerts: {
      telegram: {
        status: telegramStatus,
        deliveries: telegramDeliveries,
      },
    },
    production_proof: productionProof,
    report_health: {
      latest_javaws_failure: latestJavaWsFailure
        ? {
            id: latestJavaWsFailure.id,
            tenant_id: latestJavaWsFailure.tenant_id,
            report_key: latestJavaWsFailure.report_key,
            status: latestJavaWsFailure.status,
            finished_at: latestJavaWsFailure.finished_at,
            failure_kind: latestJavaWsFailure.failure_kind ?? null,
            failure_phase: latestJavaWsFailure.failure_phase ?? null,
            failure_metadata_json:
              latestJavaWsFailure.failure_metadata_json ?? {},
            safe_error_message: latestJavaWsFailure.safe_error_message,
          }
        : null,
      heavy_report_runs: heavyReportRuns,
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

async function createDashboardAccessForSnapshot(input: {
  snapshot: ReportSnapshot;
  signingSecret: string;
}) {
  const allowedReportKeys = await resolveDashboardAllowedReportKeys(input.snapshot);
  const expiresAt = new Date(
    Date.now() + DASHBOARD_TOKEN_TTL_HOURS * 60 * 60 * 1000,
  );
  const jti = `dash_${randomUUID()}`;
  const token = createDashboardViewerToken({
    secret: input.signingSecret,
    tenantId: input.snapshot.tenant_id,
    sourceRunId: input.snapshot.run_id,
    allowedReportKeys,
    maxDateWindowDays: DASHBOARD_TOKEN_MAX_DATE_WINDOW_DAYS,
    lookbackDays: DASHBOARD_TOKEN_LOOKBACK_DAYS,
    expiresAt,
    jti,
  });
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await systemStore.upsertDashboardViewerToken({
    token_hash: tokenHash,
    tenant_id: input.snapshot.tenant_id,
    source_run_id: input.snapshot.run_id,
    jti,
    scope_json: {
      allowed_report_keys: allowedReportKeys,
      max_date_window_days: DASHBOARD_TOKEN_MAX_DATE_WINDOW_DAYS,
      lookback_days: DASHBOARD_TOKEN_LOOKBACK_DAYS,
    },
    expires_at: expiresAt.toISOString(),
    revoked_at: null,
    last_used_at: null,
    created_at: new Date().toISOString(),
  });
  await systemStore.appendAuditLog({
    tenant_id: input.snapshot.tenant_id,
    actor_id: null,
    action: "dashboard_viewer_token_issued",
    target_type: "report_run",
    target_id: input.snapshot.run_id,
    metadata_json: {
      dashboard_token_jti: jti,
      source_run_id: input.snapshot.run_id,
      source_report_key: input.snapshot.report_key,
      allowed_report_keys: allowedReportKeys,
      max_date_window_days: DASHBOARD_TOKEN_MAX_DATE_WINDOW_DAYS,
      lookback_days: DASHBOARD_TOKEN_LOOKBACK_DAYS,
      expires_at: expiresAt.toISOString(),
    },
  });

  return {
    token,
    expires_at: expiresAt.toISOString(),
    source_run_id: input.snapshot.run_id,
    allowed_report_keys: allowedReportKeys,
    max_date_window_days: DASHBOARD_TOKEN_MAX_DATE_WINDOW_DAYS,
    lookback_days: DASHBOARD_TOKEN_LOOKBACK_DAYS,
  };
}

async function resolveDashboardAllowedReportKeys(snapshot: ReportSnapshot) {
  const runs = await systemStore.listNotificationRuleRuns({
    tenantId: snapshot.tenant_id,
    limit: 100,
  });
  const sourceNotificationRun = runs.find((run) =>
    run.report_run_ids.includes(snapshot.run_id),
  );
  const reportKeysFromRun =
    sourceNotificationRun?.report_results
      ?.map((result) => result.report_key)
      .filter((reportKey): reportKey is ReportKey =>
        reportKeyValues.includes(reportKey),
      ) ?? [];
  const allowedReportKeys = reportKeyValues.filter((reportKey) =>
    reportKeysFromRun.includes(reportKey),
  );

  return allowedReportKeys.length ? allowedReportKeys : [snapshot.report_key];
}

type DashboardViewerAccess = {
  ok: true;
  tenantId: TenantId;
  payload: DashboardViewerTokenPayload;
  tokenHash: string;
  tokenRecord: NonNullable<
    Awaited<ReturnType<typeof systemStore.getDashboardViewerToken>>
  >;
};

async function verifyDashboardViewerAccess(input: {
  tenantId: TenantId;
  token: string;
  reply: FastifyReply;
}): Promise<DashboardViewerAccess | { ok: false; response: FastifyReply }> {
  const signingSecret = await readReportViewerSigningSecret();
  if (!signingSecret) {
    return {
      ok: false,
      response: input.reply.status(503).send({
        error: "Report viewer signing is not configured.",
      }),
    };
  }

  const verification = verifyDashboardViewerToken({
    token: input.token,
    secret: signingSecret,
    tenantId: input.tenantId,
  });
  if (!verification.ok) {
    const errorMessage =
      verification.reason === "expired"
        ? "ลิงก์วิเคราะห์วันที่อื่นหมดอายุแล้ว กรุณาเปิดจาก LINE ล่าสุดอีกครั้ง"
        : "ลิงก์วิเคราะห์วันที่อื่นไม่ถูกต้อง";
    const statusCode =
      verification.reason === "missing" || verification.reason === "malformed"
        ? 400
        : 403;
    return {
      ok: false,
      response: input.reply.status(statusCode).send({ error: errorMessage }),
    };
  }

  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  const tokenRecord = await systemStore.getDashboardViewerToken(tokenHash);
  if (
    !tokenRecord ||
    tokenRecord.tenant_id !== input.tenantId ||
    tokenRecord.jti !== verification.payload.jti ||
    tokenRecord.source_run_id !== verification.payload.source_run_id
  ) {
    return {
      ok: false,
      response: input.reply.status(403).send({
        error: "ลิงก์วิเคราะห์วันที่อื่นไม่อยู่ใน scope ที่ระบบออกให้",
      }),
    };
  }
  if (tokenRecord.revoked_at) {
    return {
      ok: false,
      response: input.reply.status(403).send({
        error: "ลิงก์วิเคราะห์วันที่อื่นถูกยกเลิกแล้ว",
      }),
    };
  }
  if (Date.parse(tokenRecord.expires_at) <= Date.now()) {
    return {
      ok: false,
      response: input.reply.status(403).send({
        error: "ลิงก์วิเคราะห์วันที่อื่นหมดอายุแล้ว กรุณาเปิดจาก LINE ล่าสุดอีกครั้ง",
      }),
    };
  }

  const tenant = await getTenantOrNull(input.tenantId);
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

  const allowedFromRecord = new Set(tokenRecord.scope_json.allowed_report_keys);
  const allowedFromPayload = verification.payload.allowed_report_keys.filter(
    (reportKey) => allowedFromRecord.has(reportKey),
  );
  if (!allowedFromPayload.length) {
    return {
      ok: false,
      response: input.reply.status(403).send({
        error: "ลิงก์นี้ไม่มีรายงานที่อนุญาตให้เปิด dashboard",
      }),
    };
  }

  await systemStore.markDashboardViewerTokenUsed({
    tokenHash,
    usedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    tenantId: input.tenantId,
    payload: {
      ...verification.payload,
      allowed_report_keys: allowedFromPayload,
      max_date_window_days: Math.min(
        verification.payload.max_date_window_days,
        tokenRecord.scope_json.max_date_window_days,
      ),
      lookback_days: Math.min(
        verification.payload.lookback_days,
        tokenRecord.scope_json.lookback_days,
      ),
    },
    tokenHash,
    tokenRecord,
  };
}

function buildDashboardRunParamsFromSelection(input: {
  dateFrom: string;
  dateTo: string;
  payload: DashboardViewerTokenPayload;
}):
  | { ok: true; params: SalesGoodsServicesParams }
  | { ok: false; error: string } {
  const start = Date.parse(`${input.dateFrom}T00:00:00.000Z`);
  const end = Date.parse(`${input.dateTo}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    return { ok: false, error: "กรุณาเลือกช่วงวันที่ให้ถูกต้อง" };
  }

  const inclusiveDays = Math.floor((end - start) / 86_400_000) + 1;
  if (inclusiveDays > input.payload.max_date_window_days) {
    return {
      ok: false,
      error: `เลือกช่วงข้อมูลได้ไม่เกิน ${input.payload.max_date_window_days} วันต่อครั้ง`,
    };
  }

  const today = formatDateInBangkok(new Date());
  const earliest = addDays(today, -input.payload.lookback_days);
  if (input.dateFrom < earliest || input.dateTo > today) {
    return {
      ok: false,
      error: `ลิงก์นี้เลือกข้อมูลย้อนหลังได้ถึง ${input.payload.lookback_days} วัน และไม่เปิดวันที่อนาคต`,
    };
  }

  const zonedNow = getZonedDateTimeParts({
    now: new Date(),
    timeZone: BANGKOK_TIME_ZONE,
  });
  const params = toReportParams({
    date_from: input.dateFrom,
    date_to: input.dateTo,
    time_from: undefined,
    time_to: input.dateTo === zonedNow.date ? zonedNow.time : undefined,
  });
  const rangeError = validateViewerReportRange(params);
  if (rangeError) {
    return { ok: false, error: rangeError };
  }
  return { ok: true, params };
}

function buildExecutiveDashboardRunId(input: {
  tenantId: TenantId;
  tokenHash: string;
  params: SalesGoodsServicesParams;
  clientRequestId?: string | null;
}) {
  const digest = createHash("sha256")
    .update(
      [
        input.tenantId,
        input.tokenHash,
        input.params.date_from,
        input.params.date_to,
        input.params.time_from ?? "",
        input.params.time_to ?? "",
        input.clientRequestId?.trim() || "",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 24);
  return `executive_dashboard_run_${input.tenantId}_${digest}`;
}

async function serializeExecutiveDashboardRun(run: ExecutiveDashboardRunRecord) {
  const snapshots = (
    await Promise.all(
      run.report_results
        .map((result) => result.run_id)
        .filter((runId): runId is string => Boolean(runId))
        .map((runId) => systemStore.getSnapshotByRunId(run.tenant_id, runId)),
    )
  ).filter((snapshot): snapshot is ReportSnapshot => Boolean(snapshot));

  return {
    id: run.id,
    tenant_id: run.tenant_id,
    source_run_id: run.source_run_id,
    params: run.params,
    report_keys: run.report_keys,
    status: run.status,
    report_run_ids: run.report_run_ids,
    report_results: run.report_results,
    safe_error_message: run.safe_error_message,
    queued_at: run.queued_at,
    claimed_at: run.claimed_at,
    started_at: run.started_at,
    finished_at: run.finished_at,
    progress_stage: run.progress_stage,
    progress_percent: run.progress_percent,
    progress_current_report_key: run.progress_current_report_key,
    progress_done_reports: run.progress_done_reports,
    progress_total_reports: run.progress_total_reports,
    progress_updated_at: run.progress_updated_at,
    created_at: run.created_at,
    updated_at: run.updated_at,
    snapshots,
  };
}

function getTenantFeatureFlags(_tenant: Tenant) {
  return productTenantFeatureFlags;
}

function isBusinessSignalsEnabled(tenant: Tenant) {
  return getTenantFeatureFlags(tenant).business_signals_enabled;
}

function isLineActionDigestV2Enabled(tenant: Tenant) {
  return getTenantFeatureFlags(tenant).line_action_digest_v2_enabled;
}

function isHeavyReportFallbackEnabled(tenant: Tenant) {
  return getTenantFeatureFlags(tenant).line_heavy_report_fallback_enabled;
}

function isLineReportFailureIncidentEnabled(tenant: Tenant) {
  return getTenantFeatureFlags(tenant).line_report_failure_incident_enabled;
}

function isSmlChunkedHeavyReportsEnabled(tenant: Tenant) {
  return getTenantFeatureFlags(tenant).sml_chunked_heavy_reports_enabled;
}

function isChunkedHeavyReportKey(
  reportKey: ReportKey,
): reportKey is "stock_balance" | "ar_customer_movement" {
  return reportKey === "stock_balance" || reportKey === "ar_customer_movement";
}

function shouldUseChunkedHeavyReport(tenant: Tenant, reportKey: ReportKey) {
  return isSmlChunkedHeavyReportsEnabled(tenant) && isChunkedHeavyReportKey(reportKey);
}

function formatDegradedReportNames(reportKeys: ReportKey[]) {
  const uniqueKeys = [...new Set(reportKeys)];
  return uniqueKeys
    .map((reportKey) => getReportCatalogEntry(reportKey).shortLabel)
    .join(", ");
}

type DegradedNotificationReport = {
  reportKey: "stock_balance" | "ar_customer_movement";
  degradedReason:
    | typeof STOCK_BALANCE_TIMEOUT_REASON
    | typeof AR_CUSTOMER_MOVEMENT_TIMEOUT_REASON;
  failedRunId: string;
  safeErrorMessage: string;
  fallback:
    | StockBalanceFallbackSnapshot
    | ArCustomerMovementFallbackSnapshot
    | null;
  cooldownUsed: boolean;
  preview: ReportLinePreview;
};

type NotificationRuleExecutionSource = NotificationRuleRunRecord["source"];

type NotificationRuleExecutionResult =
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
    };

const NOTIFICATION_QUEUE_STALE_MS =
  NOTIFICATION_CHUNKED_WAIT_MS + NOTIFICATION_STALE_GRACE_MS;
const NOTIFICATION_QUEUE_BACKGROUND_LIMIT = 1;
const NOTIFICATION_QUEUE_PROCESSOR_LOCK_KEY = "notification_rule_queue_processor";
const OPS_MONITOR_LOCK_KEY = "notification_ops_monitor";
const OPS_MONITOR_CONFIG: NotificationOpsMonitorConfig = {
  heartbeatStaleMs: WORKER_HEARTBEAT_STALE_MS,
  lineRetryGraceMs: LINE_RETRY_GRACE_MS,
  slowCriticalMs: NOTIFICATION_RUN_SLOW_CRITICAL_MS,
  slowWarningMs: NOTIFICATION_RUN_SLOW_WARNING_MS,
};
let notificationQueueProcessorActive = false;
let opsMonitorActive = false;

type ChunkedHeavyReportKey = "stock_balance" | "ar_customer_movement";

async function enqueueChunkedHeavyReportRun(input: {
  tenantId: TenantId;
  reportKey: ChunkedHeavyReportKey;
  params: SalesGoodsServicesParams;
  force: boolean;
  requestAction: string;
}): Promise<
  | {
      ok: true;
      duplicate: boolean;
      runRecord: ReportRunRecord;
    }
  | {
      ok: false;
      statusCode: 409 | 424;
      error: string;
      runRecord?: ReportRunRecord;
      activeRun?: ReportRunRecord;
    }
> {
  if (!input.force) {
    const duplicateRun = await systemStore.findActiveReportRun({
      tenantId: input.tenantId,
      reportKey: input.reportKey,
      params: input.params,
    });
    if (duplicateRun) {
      return { ok: true, duplicate: true, runRecord: duplicateRun };
    }

    const activeRun = await findActiveTenantChunkedHeavyRun(input.tenantId);
    if (activeRun) {
      return {
        ok: false,
        statusCode: 409,
        error:
          "มีรายงานหนักกำลังรันอยู่แล้ว กรุณารอให้รอบปัจจุบันเสร็จก่อนเริ่มรอบใหม่",
        activeRun,
      };
    }
  }

  const now = new Date().toISOString();
  const runRecord: ReportRunRecord = {
    id: createRunId(input.tenantId, `${input.reportKey}_chunked`),
    tenant_id: input.tenantId,
    report_key: input.reportKey,
    params: input.params,
    status: "queued",
    queued_at: now,
    claimed_at: null,
    worker_id: null,
    execution_strategy: "chunked",
    progress_stage: "queued",
    progress_percent: 0,
    progress_updated_at: now,
    started_at: now,
    finished_at: null,
    row_count: 0,
    safe_error_message: null,
  };

  const datasource = await resolveTenantDatasourceConfig(input.tenantId);
  if (!datasource) {
    const failedRun: ReportRunRecord = {
      ...runRecord,
      status: "failed",
      progress_stage: "failed",
      progress_updated_at: now,
      finished_at: now,
      safe_error_message:
        "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้ กรุณาเชื่อม SML และทดสอบให้ผ่านก่อนรันรายงาน",
    };
    await systemStore.upsertRun(failedRun);
    await systemStore.appendAuditLog({
      tenant_id: input.tenantId,
      actor_id: null,
      action: "chunked_report_run_failed",
      target_type: "report_run",
      target_id: failedRun.id,
      metadata_json: {
        report_key: input.reportKey,
        safe_error_message: failedRun.safe_error_message,
      },
    });
    return {
      ok: false,
      statusCode: 424,
      error: failedRun.safe_error_message ?? "SML JavaWS is not configured",
      runRecord: failedRun,
    };
  }

  await systemStore.upsertRun(runRecord);
  await systemStore.appendAuditLog({
    tenant_id: input.tenantId,
    actor_id: null,
    action: input.requestAction,
    target_type: "report_run",
    target_id: runRecord.id,
    metadata_json: {
      report_key: input.reportKey,
      execution_strategy: "chunked",
      force: input.force,
      params: input.params,
    },
  });

  return { ok: true, duplicate: false, runRecord };
}

async function findActiveTenantChunkedHeavyRun(tenantId: TenantId) {
  const runs = await systemStore.listRuns(tenantId);
  return (
    runs.find(
      (run) =>
        isChunkedHeavyReportKey(run.report_key) &&
        run.execution_strategy === "chunked" &&
        (run.status === "queued" || run.status === "running"),
    ) ?? null
  );
}

async function buildChunkedRunProgress(run: ReportRunRecord) {
  const chunks =
    run.execution_strategy === "chunked"
      ? await systemStore.listRunChunks(run.id)
      : [];
  const doneChunks = chunks.filter((chunk) => chunk.status === "success");
  const failedChunks = chunks.filter((chunk) => chunk.status === "failed");
  const runningChunks = chunks.filter((chunk) => chunk.status === "running");
  const queuedChunks = chunks.filter((chunk) => chunk.status === "queued");
  const startedAtMs = Date.parse(run.queued_at ?? run.started_at);
  const endedAtMs = Date.parse(run.finished_at ?? new Date().toISOString());
  const elapsedMs =
    Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs)
      ? Math.max(0, endedAtMs - startedAtMs)
      : 0;

  return {
    run,
    progress_stage: run.progress_stage ?? run.status,
    progress_percent:
      run.status === "success"
        ? 100
        : run.progress_percent ?? estimateChunkedProgressPercent(chunks),
    chunk_summary: {
      total: chunks.length,
      done: doneChunks.length,
      failed: failedChunks.length,
      running: runningChunks.length,
      queued: queuedChunks.length,
      rows_processed: doneChunks.reduce(
        (total, chunk) => total + chunk.row_count,
        0,
      ),
      total_units: chunks.reduce(
        (max, chunk) => Math.max(max, chunk.total_units),
        0,
      ),
    },
    elapsed_ms: elapsedMs,
    can_close_page: run.status === "queued" || run.status === "running",
    next_action_message: getChunkedRunNextActionMessage(run),
  };
}

function estimateChunkedProgressPercent(chunks: ReportRunChunkRecord[]) {
  if (!chunks.length) {
    return 0;
  }
  const done = chunks.filter((chunk) => chunk.status === "success").length;
  return Math.min(95, 10 + Math.floor((done / chunks.length) * 80));
}

function getChunkedRunNextActionMessage(run: ReportRunRecord) {
  if (run.status === "success") {
    return "รายงานเสร็จแล้ว สามารถใช้ snapshot ล่าสุดได้";
  }
  if (run.status === "failed") {
    return "ลองลดช่วงข้อมูล ตรวจ SML JavaWS หรือใช้ snapshot ล่าสุดถ้ามี";
  }
  return "ปิดหน้าได้ ระบบยังรันต่อและจะอัปเดตสถานะให้อัตโนมัติ";
}

function kickChunkedReportRunProcessor(runId: string) {
  setTimeout(() => {
    void processQueuedChunkedReportRuns({
      limit: CHUNKED_HEAVY_REPORT_GLOBAL_CONCURRENCY,
      workerId: "api_report_background",
    }).catch((error) => {
      app.log.error({ error, runId }, "Chunked report run processor failed");
    });
  }, 0);
}

async function processQueuedChunkedReportRuns(input: {
  limit?: number;
  workerId: string;
  now?: Date;
}) {
  if (chunkedReportRunProcessorState.running) {
    return {
      processed: [] as ReportRunRecord[],
      skipped: [{ reason: "processor_busy" }],
      stale_requeued: {
        runs: [] as ReportRunRecord[],
        chunks: [] as ReportRunChunkRecord[],
      },
    };
  }

  chunkedReportRunProcessorState.running = true;
  try {
    const now = input.now ?? new Date();
    const staleBefore = new Date(
      now.getTime() - CHUNKED_HEAVY_REPORT_STALE_MS,
    ).toISOString();
    const [staleRuns, staleChunks] = await Promise.all([
      systemStore.requeueStaleReportRuns({
        staleBefore,
        updatedAt: now.toISOString(),
      }),
      systemStore.requeueStaleReportRunChunks({
        staleBefore,
        updatedAt: now.toISOString(),
      }),
    ]);
    const maxClaims = Math.min(
      input.limit ?? CHUNKED_HEAVY_REPORT_GLOBAL_CONCURRENCY,
      CHUNKED_HEAVY_REPORT_GLOBAL_CONCURRENCY,
    );
    const queuedRuns = await systemStore.listQueuedReportRuns(maxClaims * 4);
    const claimedRuns: ReportRunRecord[] = [];
    const skipped: Array<Record<string, unknown>> = [];

    for (const queuedRun of queuedRuns) {
      if (claimedRuns.length >= maxClaims) {
        break;
      }
      if (!isChunkedHeavyReportKey(queuedRun.report_key)) {
        skipped.push({ run_id: queuedRun.id, reason: "unsupported_report_key" });
        continue;
      }
      const claimedRun = await systemStore.claimReportRun({
        runId: queuedRun.id,
        claimedAt: new Date().toISOString(),
        workerId: input.workerId,
      });
      if (!claimedRun) {
        skipped.push({ run_id: queuedRun.id, reason: "already_claimed_or_tenant_busy" });
        continue;
      }
      claimedRuns.push(claimedRun);
    }

    const processed = await Promise.all(
      claimedRuns.map((run) => executeChunkedHeavyReportRun(run)),
    );
    return {
      processed,
      skipped,
      stale_requeued: {
        runs: staleRuns,
        chunks: staleChunks,
      },
    };
  } finally {
    chunkedReportRunProcessorState.running = false;
  }
}

async function runAndPersistChunkedHeavyReportNow(input: {
  tenantId: TenantId;
  reportKey: ChunkedHeavyReportKey;
  params: SalesGoodsServicesParams;
  requestAction: string;
  workerId: string;
}): ReturnType<typeof runAndPersistReportByKey> {
  const deadlineMs = Date.now() + CHUNKED_HEAVY_NOTIFICATION_WAIT_MS;
  while (Date.now() <= deadlineMs) {
    const enqueueResult = await enqueueChunkedHeavyReportRun({
      tenantId: input.tenantId,
      reportKey: input.reportKey,
      params: input.params,
      force: false,
      requestAction: input.requestAction,
    });

    if (enqueueResult.ok) {
      return waitForChunkedHeavyReportSnapshot({
        runRecord: enqueueResult.runRecord,
        reportKey: input.reportKey,
        workerId: input.workerId,
        deadlineMs,
      });
    }

    const activeRun = enqueueResult.activeRun;
    if (
      activeRun &&
      (activeRun.status === "queued" || activeRun.status === "running") &&
      Date.now() <= deadlineMs
    ) {
      await processQueuedChunkedReportRuns({
        limit: 1,
        workerId: input.workerId,
      });
      await delay(CHUNKED_HEAVY_NOTIFICATION_POLL_MS);
      continue;
    }

    const runRecord = enqueueResult.runRecord ?? activeRun;
    if (runRecord) {
      return {
        ok: false,
        statusCode: 424,
        error: enqueueResult.error,
        runRecord,
      };
    }
    return {
      ok: false,
      statusCode: 424,
      error: enqueueResult.error,
      runRecord: buildMissingChunkedReportRun(input, enqueueResult.error),
    };
  }

  return {
    ok: false,
    statusCode: 424,
    error: toSafeChunkedReportErrorMessage(
      input.reportKey,
      new Error("chunked heavy report max duration exceeded"),
    ),
    runRecord: buildMissingChunkedReportRun(
      input,
      toSafeChunkedReportErrorMessage(
        input.reportKey,
        new Error("chunked heavy report max duration exceeded"),
      ),
    ),
  };
}

async function waitForChunkedHeavyReportSnapshot(input: {
  runRecord: ReportRunRecord;
  reportKey: ChunkedHeavyReportKey;
  workerId: string;
  deadlineMs: number;
}): ReturnType<typeof runAndPersistReportByKey> {
  let runRecord = input.runRecord;
  while (Date.now() <= input.deadlineMs) {
    const latestRun = await systemStore.getRun(runRecord.id);
    if (latestRun) {
      runRecord = latestRun;
    }

    if (runRecord.status === "success") {
      const snapshot = await systemStore.getSnapshotByRunId(
        runRecord.tenant_id,
        runRecord.id,
        input.reportKey,
      );
      if (snapshot) {
        return {
          ok: true,
          snapshot,
          runRecord,
        };
      }
      return {
        ok: false,
        statusCode: 500,
        error:
          "ประมวลผลรายงานสำเร็จแต่ไม่พบ snapshot กรุณาตรวจสอบระบบจัดเก็บรายงาน",
        runRecord,
      };
    }

    if (runRecord.status === "failed") {
      return {
        ok: false,
        statusCode: 424,
        error:
          runRecord.safe_error_message ??
          toSafeChunkedReportErrorMessage(
            input.reportKey,
            new Error("chunked report run failed"),
          ),
        runRecord,
      };
    }

    await processQueuedChunkedReportRuns({
      limit: 1,
      workerId: input.workerId,
    });
    await delay(CHUNKED_HEAVY_NOTIFICATION_POLL_MS);
  }

  const latestRun = await systemStore.getRun(runRecord.id);
  if (latestRun) {
    runRecord = latestRun;
  }
  const safeErrorMessage = toSafeChunkedReportErrorMessage(
    input.reportKey,
    new Error("chunked heavy report max duration exceeded"),
  );
  await systemStore.appendAuditLog({
    tenant_id: runRecord.tenant_id,
    actor_id: null,
    action: "chunked_report_run_wait_timeout",
    target_type: "report_run",
    target_id: runRecord.id,
    metadata_json: {
      report_key: input.reportKey,
      execution_strategy: "chunked",
      safe_error_message: safeErrorMessage,
    },
  });
  return {
    ok: false,
    statusCode: 424,
    error: safeErrorMessage,
    runRecord,
  };
}

function buildMissingChunkedReportRun(
  input: {
    tenantId: TenantId;
    reportKey: ChunkedHeavyReportKey;
    params: SalesGoodsServicesParams;
  },
  safeErrorMessage: string,
): ReportRunRecord {
  const now = new Date().toISOString();
  return {
    id: createRunId(input.tenantId, `${input.reportKey}_chunked_failed`),
    tenant_id: input.tenantId,
    report_key: input.reportKey,
    params: input.params,
    status: "failed",
    queued_at: now,
    claimed_at: null,
    worker_id: null,
    execution_strategy: "chunked",
    progress_stage: "failed",
    progress_percent: 100,
    progress_updated_at: now,
    started_at: now,
    finished_at: now,
    row_count: 0,
    safe_error_message: safeErrorMessage,
  };
}

type ChunkedNotificationReportExecution =
  | {
      status: "ready";
      result: Awaited<ReturnType<typeof runAndPersistReportByKey>>;
      duplicate: boolean;
    }
  | {
      status: "waiting";
      runRecord: ReportRunRecord | null;
      activeRun: ReportRunRecord | null;
      duplicate: boolean;
      safeErrorMessage: string | null;
    };

async function runOrWaitChunkedNotificationReport(input: {
  tenantId: TenantId;
  reportKey: ChunkedHeavyReportKey;
  params: SalesGoodsServicesParams;
  requestAction: string;
}): Promise<ChunkedNotificationReportExecution> {
  const enqueueResult = await enqueueChunkedHeavyReportRun({
    tenantId: input.tenantId,
    reportKey: input.reportKey,
    params: input.params,
    force: false,
    requestAction: input.requestAction,
  });

  if (!enqueueResult.ok) {
    const activeRun = enqueueResult.activeRun ?? null;
    if (activeRun && (activeRun.status === "queued" || activeRun.status === "running")) {
      kickChunkedReportRunProcessor(activeRun.id);
      return {
        status: "waiting",
        runRecord: null,
        activeRun,
        duplicate: true,
        safeErrorMessage: enqueueResult.error,
      };
    }

    const safeErrorMessage = enqueueResult.error;
    return {
      status: "ready",
      duplicate: false,
      result: {
        ok: false,
        statusCode: enqueueResult.statusCode === 409 ? 424 : enqueueResult.statusCode,
        error: safeErrorMessage,
        runRecord:
          enqueueResult.runRecord ??
          activeRun ??
          buildMissingChunkedReportRun(input, safeErrorMessage),
      },
    };
  }

  let runRecord =
    (await systemStore.getRun(enqueueResult.runRecord.id)) ??
    enqueueResult.runRecord;

  if (runRecord.status === "success") {
    const snapshot = await systemStore.getSnapshotByRunId(
      runRecord.tenant_id,
      runRecord.id,
      input.reportKey,
    );
    if (snapshot) {
      return {
        status: "ready",
        duplicate: enqueueResult.duplicate,
        result: {
          ok: true,
          snapshot,
          runRecord,
        },
      };
    }
    return {
      status: "ready",
      duplicate: enqueueResult.duplicate,
      result: {
        ok: false,
        statusCode: 500,
        error:
          "ประมวลผลรายงานสำเร็จแต่ไม่พบ snapshot กรุณาตรวจสอบระบบจัดเก็บรายงาน",
        runRecord,
      },
    };
  }

  if (runRecord.status === "failed") {
    return {
      status: "ready",
      duplicate: enqueueResult.duplicate,
      result: {
        ok: false,
        statusCode: 424,
        error:
          runRecord.safe_error_message ??
          toSafeChunkedReportErrorMessage(
            input.reportKey,
            new Error("chunked report run failed"),
          ),
        runRecord,
      },
    };
  }

  kickChunkedReportRunProcessor(runRecord.id);
  return {
    status: "waiting",
    runRecord,
    activeRun: null,
    duplicate: enqueueResult.duplicate,
    safeErrorMessage: null,
  };
}

function getNotificationRunStartedAtMs(run: NotificationRuleRunRecord) {
  const startedAt =
    run.started_at ?? run.claimed_at ?? run.queued_at ?? run.created_at;
  const parsed = Date.parse(startedAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isNotificationChunkedWaitTimedOut(
  run: NotificationRuleRunRecord,
  now: Date,
) {
  return now.getTime() - getNotificationRunStartedAtMs(run) >= NOTIFICATION_CHUNKED_WAIT_MS;
}

function buildNotificationChunkedWaitTimeoutMessage(reportKey: ChunkedHeavyReportKey) {
  return toSafeChunkedReportErrorMessage(
    reportKey,
    new Error("chunked heavy report max duration exceeded"),
  );
}

async function findNotificationChunkedReportRun(input: {
  tenantId: TenantId;
  reportKey: ChunkedHeavyReportKey;
  params: SalesGoodsServicesParams;
  reportRunIds: string[];
}) {
  for (const runId of [...input.reportRunIds].reverse()) {
    const run = await systemStore.getRun(runId);
    if (
      run &&
      run.tenant_id === input.tenantId &&
      run.report_key === input.reportKey &&
      sameReportParams(run.params, input.params)
    ) {
      return run;
    }
  }
  return systemStore.findActiveReportRun({
    tenantId: input.tenantId,
    reportKey: input.reportKey,
    params: input.params,
  });
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function executeChunkedHeavyReportRun(initialRun: ReportRunRecord) {
  let run = await updateChunkedReportRun(initialRun, {
    status: "running",
    progress_stage: "preflight",
    progress_percent: Math.max(initialRun.progress_percent ?? 0, 5),
    progress_updated_at: new Date().toISOString(),
  });
  const startedAtMs = Date.now();
  const tenant = await getTenantOrNull(run.tenant_id);
  if (!tenant) {
    return failChunkedReportRun(
      run,
      "ไม่พบร้านค้าที่คิวรายงานนี้อ้างอิง",
    );
  }
  const datasource = await resolveTenantDatasourceConfig(run.tenant_id);
  if (!datasource) {
    return failChunkedReportRun(
      run,
      "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้ กรุณาเชื่อม SML และทดสอบให้ผ่านก่อนรันรายงาน",
    );
  }
  if (!isChunkedHeavyReportKey(run.report_key)) {
    return failChunkedReportRun(
      run,
      "รายงานนี้ยังไม่รองรับ chunked runner",
    );
  }

  try {
    return await withDatasourceClient(
      datasource,
      {
        connectionTimeoutMs: 5000,
        idleTimeoutMs: 1000,
        statementTimeoutMs: 45000,
        queryTimeoutMs: 50000,
      },
      async (client) => {
        await ensureChunkedReportChunks({ run, client, startedAtMs });
        await requeueRunningChunksForClaimedRun(run);
        run = await updateRunProgressFromChunks(run, "running_chunk");

        const rowsByChunk = new Map<number, Record<string, unknown>[]>();
        while (true) {
          assertChunkedRunDuration(startedAtMs);
          const chunks = await systemStore.listRunChunks(run.id);
          const failedChunk = chunks.find((chunk) => chunk.status === "failed");
          if (failedChunk) {
            throw new Error(
              failedChunk.safe_error_message ??
                "ประมวลผลบาง chunk ไม่สำเร็จ",
            );
          }
          if (chunks.every((chunk) => chunk.status === "success")) {
            break;
          }
          const nextChunk = chunks.find((chunk) => chunk.status === "queued");
          if (!nextChunk) {
            throw new Error("มี chunk ที่ยังไม่พร้อมประมวลผล");
          }
          const result = await executeChunkedReportChunk({
            run,
            chunk: nextChunk,
            client,
            startedAtMs,
          });
          if (result.status === "success") {
            rowsByChunk.set(nextChunk.chunk_no, result.rows);
          }
          run = await updateRunProgressFromChunks(run, "running_chunk");
        }

        run = await updateChunkedReportRun(run, {
          progress_stage: "summarizing",
          progress_percent: 95,
          progress_updated_at: new Date().toISOString(),
        });
        const allRows = await collectChunkedReportRowsForSummary({
          run,
          client,
          rowsByChunk,
          startedAtMs,
        });
        const generatedAt = new Date().toISOString();
        const snapshot =
          run.report_key === "stock_balance"
            ? summarizeStockBalance({
                tenant_id: run.tenant_id,
                run_id: run.id,
                params: run.params,
                generated_at: generatedAt,
                source: client.source,
                rows: allRows,
              })
            : summarizeArCustomerMovement({
                tenant_id: run.tenant_id,
                run_id: run.id,
                params: run.params,
                generated_at: generatedAt,
                source: client.source,
                rows: allRows,
              });

        const completedRun = await updateChunkedReportRun(run, {
          status: "success",
          progress_stage: "completed",
          progress_percent: 100,
          progress_updated_at: generatedAt,
          finished_at: generatedAt,
          row_count: getSnapshotRowCount(snapshot),
          safe_error_message: null,
        });
        await systemStore.saveSnapshot(snapshot);
        await systemStore.appendAuditLog({
          tenant_id: completedRun.tenant_id,
          actor_id: null,
          action: "chunked_report_run_succeeded",
          target_type: "report_run",
          target_id: completedRun.id,
          metadata_json: {
            report_key: completedRun.report_key,
            row_count: completedRun.row_count,
            quality_status: snapshot.quality_status,
            execution_strategy: "chunked",
          },
        });
        return completedRun;
      },
    );
  } catch (error) {
    return failChunkedReportRun(
      run,
      toSafeChunkedReportErrorMessage(run.report_key, error),
      error,
    );
  }
}

async function ensureChunkedReportChunks(input: {
  run: ReportRunRecord;
  client: SmlDatasourceClient;
  startedAtMs: number;
}) {
  const existingChunks = await systemStore.listRunChunks(input.run.id);
  if (existingChunks.length) {
    return existingChunks;
  }

  const chunks: ReportRunChunkRecord[] = [];
  let cursor: string | null = null;
  let unitStartIndex = 0;
  let chunkNo = 1;
  const chunkSize =
    input.run.report_key === "stock_balance"
      ? CHUNKED_HEAVY_STOCK_CHUNK_SIZE
      : CHUNKED_HEAVY_AR_CHUNK_SIZE;
  while (true) {
    assertChunkedRunDuration(input.startedAtMs);
    const units = await fetchChunkUnitPage({
      run: input.run,
      client: input.client,
      after: cursor,
      to: null,
      limit: chunkSize,
    });
    if (!units.length) {
      break;
    }
    const cursorTo = units[units.length - 1] ?? null;
    chunks.push(
      createReportRunChunk({
        run: input.run,
        chunkNo,
        unitStartIndex,
        unitCount: units.length,
        totalUnits: 0,
        cursorFrom: cursor,
        cursorTo,
        metadata: { preflight_units: units.length },
      }),
    );
    unitStartIndex += units.length;
    chunkNo += 1;
    const previousCursor = cursor;
    cursor = cursorTo;
    if (cursorTo === previousCursor || units.length < chunkSize) {
      break;
    }
  }

  const totalUnits = unitStartIndex;
  const chunksWithTotals = chunks.map((chunk) => ({
    ...chunk,
    total_units: totalUnits,
  }));
  if (chunksWithTotals.length) {
    await systemStore.upsertRunChunks(chunksWithTotals);
  }
  await updateRunProgressFromChunks(input.run, "running_chunk");
  return chunksWithTotals;
}

async function requeueRunningChunksForClaimedRun(run: ReportRunRecord) {
  const chunks = await systemStore.listRunChunks(run.id);
  const runningChunks = chunks.filter((chunk) => chunk.status === "running");
  if (!runningChunks.length) {
    return;
  }
  const now = new Date().toISOString();
  await systemStore.upsertRunChunks(
    runningChunks.map((chunk) => ({
      ...chunk,
      status: "queued",
      started_at: null,
      finished_at: null,
      duration_ms: null,
      safe_error_message: null,
      updated_at: now,
    })),
  );
}

async function executeChunkedReportChunk(input: {
  run: ReportRunRecord;
  chunk: ReportRunChunkRecord;
  client: SmlDatasourceClient;
  startedAtMs: number;
}): Promise<
  | { status: "success"; rows: Record<string, unknown>[] }
  | { status: "retry" | "split" }
> {
  assertChunkedRunDuration(input.startedAtMs);
  const startedAt = new Date().toISOString();
  const attempt = input.chunk.attempt + 1;
  const runningChunk = await systemStore.upsertRunChunk({
    ...input.chunk,
    status: "running",
    attempt,
    started_at: startedAt,
    finished_at: null,
    duration_ms: null,
    safe_error_message: null,
    updated_at: startedAt,
  });

  try {
    const rows = await fetchRowsForChunk({
      run: input.run,
      chunk: runningChunk,
      client: input.client,
    });
    const finishedAt = new Date().toISOString();
    await systemStore.upsertRunChunk({
      ...runningChunk,
      status: "success",
      row_count: rows.length,
      finished_at: finishedAt,
      duration_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      safe_error_message: null,
      updated_at: finishedAt,
    });
    return { status: "success", rows };
  } catch (error) {
    const safeErrorMessage = toSafeChunkedReportErrorMessage(
      input.run.report_key,
      error,
    );
    if (
      isTimeoutError(error) &&
      runningChunk.unit_count > CHUNKED_HEAVY_MIN_SPLIT_UNITS &&
      (await splitTimedOutChunk({
        run: input.run,
        chunk: runningChunk,
        client: input.client,
      }))
    ) {
      return { status: "split" };
    }

    const failedAt = new Date().toISOString();
    if (attempt < CHUNKED_HEAVY_MAX_CHUNK_ATTEMPTS) {
      await systemStore.upsertRunChunk({
        ...runningChunk,
        status: "queued",
        started_at: null,
        finished_at: null,
        duration_ms: null,
        safe_error_message: safeErrorMessage,
        updated_at: failedAt,
      });
      return { status: "retry" };
    }

    await systemStore.upsertRunChunk({
      ...runningChunk,
      status: "failed",
      finished_at: failedAt,
      duration_ms: Math.max(0, Date.parse(failedAt) - Date.parse(startedAt)),
      safe_error_message: safeErrorMessage,
      updated_at: failedAt,
    });
    throw new Error(safeErrorMessage);
  }
}

async function splitTimedOutChunk(input: {
  run: ReportRunRecord;
  chunk: ReportRunChunkRecord;
  client: SmlDatasourceClient;
}) {
  const splitLimit = Math.max(
    1,
    Math.floor(input.chunk.unit_count / 2),
  );
  const leftUnits = await fetchChunkUnitPage({
    run: input.run,
    client: input.client,
    after: input.chunk.cursor_from,
    to: input.chunk.cursor_to,
    limit: splitLimit,
  });
  const midpoint = leftUnits[leftUnits.length - 1] ?? null;
  if (midpoint === null || midpoint === input.chunk.cursor_to) {
    return false;
  }

  const now = new Date().toISOString();
  const existingChunks = await systemStore.listRunChunks(input.run.id);
  const nextChunkNo =
    Math.max(0, ...existingChunks.map((chunk) => chunk.chunk_no)) + 1;
  const leftChunk: ReportRunChunkRecord = {
    ...input.chunk,
    chunk_key: buildReportRunChunkKey({
      runId: input.run.id,
      chunkNo: input.chunk.chunk_no,
      cursorFrom: input.chunk.cursor_from,
      cursorTo: midpoint,
    }),
    status: "queued",
    attempt: 0,
    unit_count: leftUnits.length,
    cursor_to: midpoint,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    safe_error_message: null,
    metadata_json: {
      ...input.chunk.metadata_json,
      split_after_timeout: true,
    },
    updated_at: now,
  };
  const rightChunk = createReportRunChunk({
    run: input.run,
    chunkNo: nextChunkNo,
    unitStartIndex: input.chunk.unit_start_index + leftUnits.length,
    unitCount: Math.max(0, input.chunk.unit_count - leftUnits.length),
    totalUnits: input.chunk.total_units,
    cursorFrom: midpoint,
    cursorTo: input.chunk.cursor_to,
    metadata: {
      split_from_chunk_no: input.chunk.chunk_no,
      split_after_timeout: true,
    },
    now,
  });
  await systemStore.upsertRunChunks([leftChunk, rightChunk]);
  return true;
}

async function collectChunkedReportRowsForSummary(input: {
  run: ReportRunRecord;
  client: SmlDatasourceClient;
  rowsByChunk: Map<number, Record<string, unknown>[]>;
  startedAtMs: number;
}) {
  const chunks = await systemStore.listRunChunks(input.run.id);
  const failedChunk = chunks.find((chunk) => chunk.status === "failed");
  if (failedChunk) {
    throw new Error(
      failedChunk.safe_error_message ?? "ประมวลผลบาง chunk ไม่สำเร็จ",
    );
  }

  const allRows: Record<string, unknown>[] = [];
  for (const chunk of chunks.filter((item) => item.status === "success")) {
    assertChunkedRunDuration(input.startedAtMs);
    const rows =
      input.rowsByChunk.get(chunk.chunk_no) ??
      (await fetchRowsForChunk({
        run: input.run,
        chunk,
        client: input.client,
      }));
    allRows.push(...rows);
  }
  return allRows;
}

async function fetchChunkUnitPage(input: {
  run: ReportRunRecord;
  client: SmlDatasourceClient;
  after: string | null;
  to: string | null;
  limit: number;
}) {
  const query =
    input.run.report_key === "stock_balance"
      ? buildStockBalanceItemCodePageQuery({
          afterItemCode: input.after,
          toItemCode: input.to,
          limit: input.limit,
        })
      : buildArCustomerMovementCustomerCodePageQuery(input.run.params, {
          afterCustomerCode: input.after,
          toCustomerCode: input.to,
          limit: input.limit,
        });
  const result = await input.client.query<{ unit_code: unknown }>(
    query.text,
    query.values,
  );
  return result.rows.map((row) => String(row.unit_code ?? ""));
}

async function fetchRowsForChunk(input: {
  run: ReportRunRecord;
  chunk: ReportRunChunkRecord;
  client: SmlDatasourceClient;
}) {
  const query =
    input.run.report_key === "stock_balance"
      ? buildStockBalanceQuery(input.run.params, {
          itemCodeAfter: input.chunk.cursor_from,
          itemCodeTo: input.chunk.cursor_to,
        })
      : buildArCustomerMovementQuery(input.run.params, {
          customerCodeAfter: input.chunk.cursor_from,
          customerCodeTo: input.chunk.cursor_to,
        });
  const result = await input.client.query<Record<string, unknown>>(
    query.text,
    query.values,
  );
  return result.rows;
}

function createReportRunChunk(input: {
  run: ReportRunRecord;
  chunkNo: number;
  unitStartIndex: number;
  unitCount: number;
  totalUnits: number;
  cursorFrom: string | null;
  cursorTo: string | null;
  metadata?: Record<string, unknown>;
  now?: string;
}): ReportRunChunkRecord {
  const now = input.now ?? new Date().toISOString();
  return {
    id: `report_run_chunk_${randomUUID()}`,
    tenant_id: input.run.tenant_id,
    report_run_id: input.run.id,
    report_key: input.run.report_key,
    chunk_no: input.chunkNo,
    chunk_key: buildReportRunChunkKey({
      runId: input.run.id,
      chunkNo: input.chunkNo,
      cursorFrom: input.cursorFrom,
      cursorTo: input.cursorTo,
    }),
    status: "queued",
    attempt: 0,
    unit_start_index: input.unitStartIndex,
    unit_count: input.unitCount,
    total_units: input.totalUnits,
    row_count: 0,
    cursor_from: input.cursorFrom,
    cursor_to: input.cursorTo,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    safe_error_message: null,
    metadata_json: input.metadata ?? {},
    created_at: now,
    updated_at: now,
  };
}

function buildReportRunChunkKey(input: {
  runId: string;
  chunkNo: number;
  cursorFrom: string | null;
  cursorTo: string | null;
}) {
  const digest = createHash("sha256")
    .update(
      [
        input.runId,
        input.chunkNo,
        input.cursorFrom ?? "",
        input.cursorTo ?? "",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 16);
  return `chunk_${input.chunkNo}_${digest}`;
}

async function updateRunProgressFromChunks(
  run: ReportRunRecord,
  stage: NonNullable<ReportRunRecord["progress_stage"]>,
) {
  const chunks = await systemStore.listRunChunks(run.id);
  return updateChunkedReportRun(run, {
    progress_stage: chunks.length ? stage : "summarizing",
    progress_percent: chunks.length ? estimateChunkedProgressPercent(chunks) : 90,
    progress_updated_at: new Date().toISOString(),
  });
}

async function updateChunkedReportRun(
  run: ReportRunRecord,
  patch: Partial<ReportRunRecord>,
) {
  const updated: ReportRunRecord = {
    ...run,
    ...patch,
  };
  await systemStore.upsertRun(updated);
  return updated;
}

async function failChunkedReportRun(
  run: ReportRunRecord,
  safeErrorMessage: string,
  error?: unknown,
) {
  const failedAt = new Date().toISOString();
  const failureDiagnostics = error
    ? extractJavaWsFailureDiagnostics(error)
    : null;
  const failedRun = await updateChunkedReportRun(run, {
    status: "failed",
    progress_stage: "failed",
    progress_updated_at: failedAt,
    finished_at: failedAt,
    safe_error_message: safeErrorMessage,
    failure_kind: failureDiagnostics?.failure_kind ?? run.failure_kind ?? null,
    failure_phase: failureDiagnostics?.failure_phase ?? run.failure_phase ?? null,
    failure_metadata_json: failureDiagnostics
      ? sanitizeJavaWsFailureMetadata(failureDiagnostics.failure_metadata_json)
      : (run.failure_metadata_json ?? {}),
  });
  await systemStore.appendAuditLog({
    tenant_id: run.tenant_id,
    actor_id: null,
    action: "chunked_report_run_failed",
    target_type: "report_run",
    target_id: run.id,
    metadata_json: {
      report_key: run.report_key,
      safe_error_message: safeErrorMessage,
      execution_strategy: "chunked",
    },
  });
  return failedRun;
}

function assertChunkedRunDuration(startedAtMs: number) {
  if (Date.now() - startedAtMs > CHUNKED_HEAVY_REPORT_MAX_DURATION_MS) {
    throw new Error("chunked heavy report max duration exceeded");
  }
}

function toSafeChunkedReportErrorMessage(
  reportKey: ReportKey,
  error: unknown,
) {
  if (
    error instanceof Error &&
    /chunked heavy report max duration exceeded/i.test(error.message)
  ) {
    if (reportKey === "stock_balance") {
      return "รายงานสต็อกคงเหลือใช้เวลานานเกินไป กรุณาลดช่วงข้อมูล ตรวจ SML JavaWS หรือใช้ snapshot ล่าสุดถ้ามี";
    }
    if (reportKey === "ar_customer_movement") {
      return "รายงานเคลื่อนไหวลูกหนี้ใช้เวลานานเกินไป กรุณาลดช่วงข้อมูล ตรวจ SML JavaWS หรือใช้ snapshot ล่าสุดถ้ามี";
    }
    return "รายงานใช้เวลานานเกินกำหนด กรุณาลดช่วงข้อมูล ตรวจ SML JavaWS หรือใช้ snapshot ล่าสุดถ้ามี";
  }
  if (reportKey === "stock_balance") {
    return toSafeStockBalanceErrorMessage(error);
  }
  if (reportKey === "ar_customer_movement") {
    return toSafeArCustomerMovementErrorMessage(error);
  }
  return toSafeErrorMessage(error);
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    /timeout|timed out|canceling statement|query timeout/i.test(error.message)
  );
}

function getBusinessSignalThresholdsForTenant(_tenant: Tenant) {
  const thresholds = productBusinessSignalThresholds;
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

function normalizeClientRequestId(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 120 ? trimmed : randomUUID();
}

function buildManualNotificationRunId(input: {
  ruleId: string;
  scheduledLocalDate: string;
  scheduledLocalTime: string;
  mode: LineSendMode;
  source: NotificationRuleExecutionSource;
  clientRequestId: string;
}) {
  const digest = createHash("sha256")
    .update(
      [
        input.ruleId,
        input.scheduledLocalDate,
        input.scheduledLocalTime,
        input.mode,
        input.source,
        input.clientRequestId,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 20);
  return `notification_run_${input.ruleId}_${digest}`;
}

async function enqueueManualNotificationRuleRun(input: {
  rule: NotificationRuleRecord;
  mode: LineSendMode;
  scheduledLocalDate: string;
  scheduledLocalTime: string;
  source: "manual_test" | "manual_run_now";
  clientRequestId?: string | null;
}) {
  const clientRequestId = normalizeClientRequestId(input.clientRequestId);
  const runId = buildManualNotificationRunId({
    ruleId: input.rule.id,
    scheduledLocalDate: input.scheduledLocalDate,
    scheduledLocalTime: input.scheduledLocalTime,
    mode: input.mode,
    source: input.source,
    clientRequestId,
  });
  const existingById = await systemStore.getNotificationRuleRun(runId);
  if (existingById) {
    return { run: existingById, reused: true, clientRequestId };
  }
  const activeRun = await systemStore.findActiveNotificationRuleRun({
    ruleId: input.rule.id,
    scheduledLocalDate: input.scheduledLocalDate,
    scheduledLocalTime: input.scheduledLocalTime,
    mode: input.mode,
    source: input.source,
    clientRequestId,
  });
  if (activeRun) {
    return { run: activeRun, reused: true, clientRequestId };
  }

  const params = deriveNotificationPeriodRange({
    periodPreset: input.rule.period_preset,
    periodStrategy: input.rule.period_strategy,
    scheduledLocalDate: input.scheduledLocalDate,
    scheduledLocalTime: input.scheduledLocalTime,
    now: new Date(),
    timeZone: input.rule.timezone,
  });
  const baseIdempotencyKey = buildNotificationIdempotencyKey({
    ruleId: input.rule.id,
    scheduledLocalDate: input.scheduledLocalDate,
    scheduledLocalTime: input.scheduledLocalTime,
  });
  const nowIso = new Date().toISOString();
  const run = await systemStore.upsertNotificationRuleRun({
    id: runId,
    rule_id: input.rule.id,
    tenant_id: input.rule.tenant_id,
    scheduled_local_date: input.scheduledLocalDate,
    scheduled_local_time: input.scheduledLocalTime,
    timezone: input.rule.timezone || BANGKOK_TIME_ZONE,
    period_from: params.date_from,
    period_to: params.date_to,
    period_from_time: params.time_from ?? null,
    period_to_time: params.time_to ?? null,
    period_strategy: input.rule.period_strategy,
    unknown_doc_time_count: 0,
    status: "queued",
    mode: input.mode,
    source: input.source,
    attempt: 1,
    idempotency_key: `${baseIdempotencyKey}:${input.source}:${clientRequestId}`,
    report_run_ids: [],
    report_results: null,
    delivery_ids: [],
    safe_error_message: null,
    started_at: null,
    finished_at: null,
    queued_at: nowIso,
    claimed_at: null,
    worker_id: null,
    client_request_id: clientRequestId,
    next_retry_at: null,
    progress_stage: "queued",
    progress_percent: 5,
    progress_current_report_key: null,
    progress_done_reports: 0,
    progress_total_reports: input.rule.report_keys.length,
    progress_updated_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
  });

	  await systemStore.appendAuditLog({
	    tenant_id: input.rule.tenant_id,
    actor_id: null,
    action: "notification_rule_run_queued",
    target_type: "notification_rule_run",
    target_id: run.id,
    metadata_json: {
      notification_rule_id: input.rule.id,
      mode: input.mode,
      source: input.source,
      client_request_id: clientRequestId,
      scheduled_local_date: input.scheduledLocalDate,
      scheduled_local_time: input.scheduledLocalTime,
      period_from: params.date_from,
      period_to: params.date_to,
      period_from_time: params.time_from ?? null,
      period_to_time: params.time_to ?? null,
    },
  });

  return { run, reused: false, clientRequestId };
}

async function enqueueWorkerNotificationRuleRun(input: {
  rule: NotificationRuleRecord;
  mode: LineSendMode;
  scheduledLocalDate: string;
  scheduledLocalTime: string;
  source: "worker_due" | "worker_retry";
  attempt?: number;
  retryFromRun?: NotificationRuleRunRecord | null;
}) {
  const attempt = input.attempt ?? input.retryFromRun?.attempt ?? 1;
  const idempotencyKey = buildNotificationIdempotencyKey({
    ruleId: input.rule.id,
    scheduledLocalDate: input.scheduledLocalDate,
    scheduledLocalTime: input.scheduledLocalTime,
    attempt,
  });
  const existing = await systemStore.getNotificationRuleRunByKey(idempotencyKey);
  if (existing) {
    return { run: existing, reused: true };
  }
  const activeRun = await systemStore.findActiveNotificationRuleRun({
    ruleId: input.rule.id,
    scheduledLocalDate: input.scheduledLocalDate,
    scheduledLocalTime: input.scheduledLocalTime,
    mode: input.mode,
    source: input.source,
  });
  if (activeRun) {
    return { run: activeRun, reused: true };
  }

  const params = input.retryFromRun
    ? {
        date_from: input.retryFromRun.period_from,
        date_to: input.retryFromRun.period_to,
        time_from: input.retryFromRun.period_from_time ?? undefined,
        time_to: input.retryFromRun.period_to_time ?? undefined,
      }
    : deriveNotificationPeriodRange({
        periodPreset: input.rule.period_preset,
        periodStrategy: input.rule.period_strategy,
        scheduledLocalDate: input.scheduledLocalDate,
        scheduledLocalTime: input.scheduledLocalTime,
        now: new Date(),
        timeZone: input.rule.timezone,
      });
  const digest = createHash("sha256")
    .update([idempotencyKey, input.source, input.mode].join("|"))
    .digest("hex")
    .slice(0, 20);
  const nowIso = new Date().toISOString();
  const reusableReportResults = selectDeliveryRetryReportResults({
    rule: input.rule,
    retryFromRun: input.retryFromRun,
  });
  const reusableReportRunIds = reusableReportResults
    ? [
        ...new Set(
          [
            ...(input.retryFromRun?.report_run_ids ?? []),
            ...reusableReportResults
              .map((result) => result.run_id)
              .filter((runId): runId is string => Boolean(runId)),
          ],
        ),
      ]
    : input.retryFromRun?.report_run_ids ?? [];
  const run = await systemStore.upsertNotificationRuleRun({
    id: `notification_run_${input.rule.id}_${digest}`,
    rule_id: input.rule.id,
    tenant_id: input.rule.tenant_id,
    scheduled_local_date: input.scheduledLocalDate,
    scheduled_local_time: input.scheduledLocalTime,
    timezone: input.rule.timezone || BANGKOK_TIME_ZONE,
    period_from: params.date_from,
    period_to: params.date_to,
    period_from_time: params.time_from ?? null,
    period_to_time: params.time_to ?? null,
    period_strategy: input.rule.period_strategy,
    unknown_doc_time_count: 0,
    status: "queued",
    mode: input.mode,
    source: input.source,
    attempt,
    idempotency_key: idempotencyKey,
    report_run_ids: reusableReportRunIds,
    report_results: reusableReportResults ? [...reusableReportResults] : null,
    delivery_ids: [],
    safe_error_message: null,
    started_at: null,
    finished_at: null,
    queued_at: nowIso,
    claimed_at: null,
    worker_id: null,
    client_request_id: null,
    next_retry_at: null,
    progress_stage: "queued",
    progress_percent: 5,
    progress_current_report_key: null,
    progress_done_reports: 0,
    progress_total_reports: input.rule.report_keys.length,
    progress_updated_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
  });

  await systemStore.appendAuditLog({
    tenant_id: input.rule.tenant_id,
    actor_id: null,
    action: "notification_rule_run_queued",
    target_type: "notification_rule_run",
    target_id: run.id,
    metadata_json: {
      notification_rule_id: input.rule.id,
      mode: input.mode,
      source: input.source,
      scheduled_local_date: input.scheduledLocalDate,
      scheduled_local_time: input.scheduledLocalTime,
      attempt,
      period_from: params.date_from,
      period_to: params.date_to,
      period_from_time: params.time_from ?? null,
      period_to_time: params.time_to ?? null,
      retry_from_run_id: input.retryFromRun?.id ?? null,
      delivery_only_retry: Boolean(reusableReportResults),
      reused_report_result_count: reusableReportResults?.length ?? 0,
      reused_report_run_ids: reusableReportResults ? reusableReportRunIds : [],
    },
  });

  if (reusableReportResults) {
    await systemStore.appendAuditLog({
      tenant_id: input.rule.tenant_id,
      actor_id: null,
      action: "notification_rule_delivery_retry_reusing_reports",
      target_type: "notification_rule_run",
      target_id: run.id,
      metadata_json: {
        notification_rule_id: input.rule.id,
        mode: input.mode,
        source: input.source,
        scheduled_local_date: input.scheduledLocalDate,
        scheduled_local_time: input.scheduledLocalTime,
        attempt,
        retry_from_run_id: input.retryFromRun?.id ?? null,
        report_run_ids: reusableReportRunIds,
        report_result_count: reusableReportResults.length,
      },
    });
  }

  return { run, reused: false };
}

async function failClaimedNotificationRun(input: {
  run: NotificationRuleRunRecord;
  safeErrorMessage: string;
}) {
  const failedAt = new Date().toISOString();
  const run = await systemStore.upsertNotificationRuleRun({
    ...input.run,
    status: "failed",
    safe_error_message: input.safeErrorMessage,
    finished_at: failedAt,
    next_retry_at: null,
    updated_at: failedAt,
  });
  const rule = await systemStore.getNotificationRule(run.rule_id);
  if (rule) {
    await systemStore.upsertNotificationRule({
      ...rule,
      last_run_at: failedAt,
      last_run_status: "failed",
      last_safe_error_message: input.safeErrorMessage,
      updated_at: failedAt,
    });
  }
  return run;
}

async function markStaleNotificationQueueRuns(now: Date) {
  const failedAt = now.toISOString();
  const staleRuns = await systemStore.markStaleNotificationRuleRunsFailed({
    staleBefore: new Date(now.getTime() - NOTIFICATION_QUEUE_STALE_MS).toISOString(),
    failedAt,
    safeErrorMessage:
      "งานแจ้งเตือนค้างนานเกินไป กรุณากดส่งใหม่หรือรอรอบถัดไป",
  });
  for (const run of staleRuns) {
    const rule = await systemStore.getNotificationRule(run.rule_id);
    let runForAudit = run;
    const nextRetryAt =
      rule && run.mode === "send" && run.attempt < rule.retry_policy.max_attempts
        ? new Date(
            now.getTime() + rule.retry_policy.retry_delay_minutes * 60_000,
          ).toISOString()
        : null;
    if (nextRetryAt) {
      runForAudit = await systemStore.upsertNotificationRuleRun({
        ...run,
        next_retry_at: nextRetryAt,
        updated_at: failedAt,
      });
    }
    if (rule) {
      await systemStore.upsertNotificationRule({
        ...rule,
        last_run_at: failedAt,
        last_run_status: "failed",
        last_safe_error_message: runForAudit.safe_error_message,
        updated_at: failedAt,
      });
    }
    await systemStore.appendAuditLog({
      tenant_id: runForAudit.tenant_id,
      actor_id: null,
      action: "notification_rule_run_stale_failed",
      target_type: "notification_rule_run",
      target_id: runForAudit.id,
      metadata_json: {
        rule_id: runForAudit.rule_id,
        source: runForAudit.source,
        attempt: runForAudit.attempt,
        queued_at: runForAudit.queued_at,
        claimed_at: runForAudit.claimed_at,
        started_at: runForAudit.started_at,
        worker_id: runForAudit.worker_id,
        progress_stage: runForAudit.progress_stage,
        progress_current_report_key: runForAudit.progress_current_report_key,
        report_run_ids: runForAudit.report_run_ids,
        next_retry_at: nextRetryAt,
        stale_after_ms: NOTIFICATION_QUEUE_STALE_MS,
      },
    });
    if (rule) {
      const tenant = await getTenantOrNull(runForAudit.tenant_id);
      try {
        const deliveries = await sendOperationalTelegramAlert({
          store: systemStore,
          tenant,
          alertType: "notification_run_failed",
          severity: "critical",
          messageText: buildOperationalAlertMessage({
            title: "งานแจ้งเตือนผู้บริหารค้างเกิน stale safety",
            severity: "critical",
            tenantName: tenant?.name ?? runForAudit.tenant_id,
            scheduledTime: `${runForAudit.scheduled_local_date} ${runForAudit.scheduled_local_time}`,
            reportKey: runForAudit.progress_current_report_key,
            status: "failed",
            runId: runForAudit.id,
            details: [
              `attempt: ${runForAudit.attempt}`,
              `progress_stage: ${runForAudit.progress_stage ?? "unknown"}`,
              `next_retry_at: ${nextRetryAt ?? "none"}`,
            ],
            action:
              "ตรวจ report run/chunked worker และปล่อยให้ retry รอบถัดไปทำต่อด้วย period เดิม",
          }),
          dedupeKey: buildOperationalAlertDedupeKey({
            alertType: "notification_run_failed",
            tenantId: runForAudit.tenant_id,
            ruleId: rule.id,
            scheduledDate: runForAudit.scheduled_local_date,
            scheduledTime: runForAudit.scheduled_local_time,
            reportKey: runForAudit.progress_current_report_key,
            severity: "critical",
          }),
        });
        await systemStore.appendAuditLog({
          tenant_id: runForAudit.tenant_id,
          actor_id: null,
          action: "telegram_operational_alert_processed",
          target_type: "operational_alert",
          target_id: "notification_run_failed",
          metadata_json: {
            alert_type: "notification_run_failed",
            severity: "critical",
            notification_rule_run_id: runForAudit.id,
            delivery_ids: deliveries.map((delivery) => delivery.id),
            delivery_statuses: deliveries.map((delivery) => delivery.status),
          },
        });
      } catch (error) {
        await systemStore.appendAuditLog({
          tenant_id: runForAudit.tenant_id,
          actor_id: null,
          action: "telegram_operational_alert_failed",
          target_type: "operational_alert",
          target_id: "notification_run_failed",
          metadata_json: {
            alert_type: "notification_run_failed",
            severity: "critical",
            notification_rule_run_id: runForAudit.id,
            safe_error_message: toSafeErrorMessage(error),
          },
        });
      }
    }
  }
  return staleRuns;
}

async function processQueuedNotificationRuleRuns(input: {
  limit?: number;
  workerId: string;
  now?: Date;
}) {
  if (notificationQueueProcessorActive) {
    return {
      processed: [] as NotificationRuleExecutionResult[],
      skipped: [{ reason: "processor_busy" }],
      stale_failed: [] as NotificationRuleRunRecord[],
    };
  }

  const lockAcquired = await systemStore.tryAcquireLock({
    lockKey: NOTIFICATION_QUEUE_PROCESSOR_LOCK_KEY,
  });
  if (!lockAcquired) {
    await systemStore.appendAuditLog({
      tenant_id: null,
      actor_id: null,
      action: "notification_rule_processor_busy",
      target_type: "worker",
      target_id: NOTIFICATION_QUEUE_PROCESSOR_LOCK_KEY,
      metadata_json: {
        worker_id: input.workerId,
        checked_at: new Date().toISOString(),
      },
    });
    return {
      processed: [] as NotificationRuleExecutionResult[],
      skipped: [{ reason: "processor_busy", lock: "db" }],
      stale_failed: [] as NotificationRuleRunRecord[],
    };
  }

  notificationQueueProcessorActive = true;
  try {
    const now = input.now ?? new Date();
    const staleFailed = await markStaleNotificationQueueRuns(now);
    const maxRuns = input.limit ?? NOTIFICATION_QUEUE_BACKGROUND_LIMIT;
    const resumableRuns = await systemStore.listResumableNotificationRuleRuns({
      limit: maxRuns,
      pollBefore: new Date(now.getTime() - NOTIFICATION_WAIT_POLL_MS).toISOString(),
    });
    const processed: NotificationRuleExecutionResult[] = [];
    const skipped: Array<Record<string, unknown>> = [];

    const processRunningNotificationRun = async (
      runToProcess: NotificationRuleRunRecord,
    ) => {
      const rule = await systemStore.getNotificationRule(runToProcess.rule_id);
      if (!rule || !rule.enabled) {
        const failedRun = await failClaimedNotificationRun({
          run: runToProcess,
          safeErrorMessage: !rule
            ? "ไม่พบแผนแจ้งเตือนที่คิวนี้อ้างอิง"
            : "แผนแจ้งเตือนถูกปิดใช้งานก่อนเริ่มรัน",
        });
        processed.push({
          ok: false,
          statusCode: 424,
          error: failedRun.safe_error_message ?? "รันแผนแจ้งเตือนไม่สำเร็จ",
          run: failedRun,
          deliveries: [],
          report_run_ids: failedRun.report_run_ids,
          mode: runToProcess.mode,
        });
        return;
      }

      const result = await executeNotificationRule({
        rule,
        mode: runToProcess.mode,
        force: true,
        now,
        scheduledLocalDate: runToProcess.scheduled_local_date,
        scheduledLocalTime: runToProcess.scheduled_local_time,
        attempt: runToProcess.attempt,
        source: runToProcess.source,
        run: runToProcess,
        workerId: input.workerId,
        clientRequestId: runToProcess.client_request_id,
      });
      processed.push(result);
    };

    for (const waitingRun of resumableRuns) {
      if (processed.length >= maxRuns) {
        break;
      }
      if (
        waitingRun.status !== "running" ||
        waitingRun.progress_stage !== "waiting_chunked_report"
      ) {
        skipped.push({ run_id: waitingRun.id, reason: "not_resumable" });
        continue;
      }
      await processRunningNotificationRun(waitingRun);
    }

    const remainingCapacity = Math.max(0, maxRuns - processed.length);
    const queuedRuns = remainingCapacity
      ? await systemStore.listQueuedNotificationRuleRuns(remainingCapacity)
      : [];

    for (const queuedRun of queuedRuns) {
      const claimedRun = await systemStore.claimQueuedNotificationRuleRun({
        runId: queuedRun.id,
        claimedAt: new Date().toISOString(),
        workerId: input.workerId,
      });
      if (!claimedRun) {
        skipped.push({ run_id: queuedRun.id, reason: "already_claimed" });
        continue;
      }

      await processRunningNotificationRun(claimedRun);
    }

    return { processed, skipped, stale_failed: staleFailed };
  } finally {
    notificationQueueProcessorActive = false;
    await systemStore.releaseLock({
      lockKey: NOTIFICATION_QUEUE_PROCESSOR_LOCK_KEY,
    });
  }
}

function kickNotificationQueueProcessor(runId: string) {
  setTimeout(() => {
    void processQueuedNotificationRuleRuns({
      limit: NOTIFICATION_QUEUE_BACKGROUND_LIMIT,
      workerId: "api_manual_background",
    }).catch((err) => {
      app.log.error({ err, runId }, "Manual notification queue processor failed");
    });
  }, 0);
}

function startOpsMonitorLoop() {
  if (!OPS_MONITOR_ENABLED) {
    app.log.info("Notification ops monitor disabled by OPS_MONITOR_ENABLED=false");
    return;
  }

  const runTick = () => {
    void runOpsMonitorTick().catch((error) => {
      app.log.error({ error }, "Notification ops monitor tick failed");
    });
  };

  const startupTimer = setTimeout(runTick, 1_000);
  startupTimer.unref?.();
  const interval = setInterval(runTick, OPS_MONITOR_POLL_MS);
  interval.unref?.();
}

async function runOpsMonitorTick() {
  if (opsMonitorActive) {
    return { skipped: "processor_busy" };
  }

  const lockAcquired = await systemStore.tryAcquireLock({
    lockKey: OPS_MONITOR_LOCK_KEY,
  });
  if (!lockAcquired) {
    return { skipped: "db_lock_busy" };
  }

  opsMonitorActive = true;
  try {
    const result = await runNotificationOpsMonitor({
      config: OPS_MONITOR_CONFIG,
      now: new Date(),
      sendAlert: (alert) =>
        sendOperationalTelegramAlert({
          store: systemStore,
          ...alert,
        }),
      store: systemStore,
    });
    if (
      result.active_run_alerts ||
      result.heartbeat_alerts ||
      result.line_retry_alerts
    ) {
      await systemStore.appendAuditLog({
        tenant_id: null,
        actor_id: null,
        action: "notification_ops_monitor_tick_alerted",
        target_type: "operational_monitor",
        target_id: OPS_MONITOR_LOCK_KEY,
        metadata_json: result,
      });
    }
    return result;
  } finally {
    opsMonitorActive = false;
    await systemStore.releaseLock({
      lockKey: OPS_MONITOR_LOCK_KEY,
    });
  }
}

function kickExecutiveDashboardRunProcessor(runId: string) {
  setTimeout(() => {
    void processQueuedExecutiveDashboardRuns({
      limit: EXECUTIVE_DASHBOARD_QUEUE_BACKGROUND_LIMIT,
      workerId: "api_dashboard_background",
    }).catch((err) => {
      app.log.error({ err, runId }, "Executive dashboard processor failed");
    });
  }, 0);
}

async function processQueuedExecutiveDashboardRuns(input: {
  limit?: number;
  workerId: string;
}) {
  if (dashboardRunProcessorState.running) {
    return {
      processed: [] as ExecutiveDashboardRunRecord[],
      skipped: [{ reason: "processor_busy" }],
    };
  }

  dashboardRunProcessorState.running = true;
  try {
    const queuedRuns = await systemStore.listQueuedExecutiveDashboardRuns(
      input.limit ?? EXECUTIVE_DASHBOARD_QUEUE_BACKGROUND_LIMIT,
    );
    const processed: ExecutiveDashboardRunRecord[] = [];
    const skipped: Array<Record<string, unknown>> = [];

    for (const queuedRun of queuedRuns) {
      const claimedRun = await systemStore.claimExecutiveDashboardRun({
        runId: queuedRun.id,
        claimedAt: new Date().toISOString(),
        workerId: input.workerId,
      });
      if (!claimedRun) {
        skipped.push({ run_id: queuedRun.id, reason: "already_claimed" });
        continue;
      }
      processed.push(await executeExecutiveDashboardRun(claimedRun));
    }

    return { processed, skipped };
  } finally {
    dashboardRunProcessorState.running = false;
  }
}

async function executeExecutiveDashboardRun(
  initialRun: ExecutiveDashboardRunRecord,
) {
  const startedAtMs = Date.now();
  const nowIso = new Date().toISOString();
  const tenant = await getTenantOrNull(initialRun.tenant_id);
  const totalReports = initialRun.report_keys.length;
  let run = await systemStore.upsertExecutiveDashboardRun({
    ...initialRun,
    status: "running",
    started_at: initialRun.started_at ?? nowIso,
    progress_stage: initialRun.progress_stage ?? "claimed",
    progress_percent: initialRun.progress_percent ?? 10,
    progress_total_reports: totalReports,
    progress_updated_at: initialRun.progress_updated_at ?? nowIso,
    updated_at: nowIso,
  });
  const reportResults: NotificationReportResult[] = [...run.report_results];
  const reportRunIds = new Set(run.report_run_ids);

  const recordReportResult = (result: NotificationReportResult) => {
    const existingIndex = reportResults.findIndex(
      (item) => item.report_key === result.report_key,
    );
    if (existingIndex >= 0) {
      reportResults[existingIndex] = result;
    } else {
      reportResults.push(result);
    }
    if (result.run_id) {
      reportRunIds.add(result.run_id);
    }
  };

  const updateProgress = async (progress: {
    stage: string;
    percent: number;
    currentReportKey?: ReportKey | null;
    doneReports?: number;
  }) => {
    const progressUpdatedAt = new Date().toISOString();
    run = await systemStore.upsertExecutiveDashboardRun({
      ...run,
      report_run_ids: [...reportRunIds],
      report_results: [...reportResults],
      progress_stage: progress.stage,
      progress_percent: clampProgressPercent(progress.percent),
      progress_current_report_key: progress.currentReportKey ?? null,
      progress_done_reports:
        progress.doneReports ?? run.progress_done_reports ?? 0,
      progress_total_reports: totalReports,
      progress_updated_at: progressUpdatedAt,
      updated_at: progressUpdatedAt,
    });
    return run;
  };

  const failRun = async (safeErrorMessage: string) => {
    const finishedAt = new Date().toISOString();
    run = await systemStore.upsertExecutiveDashboardRun({
      ...run,
      status: "failed",
      report_run_ids: [...reportRunIds],
      report_results: [...reportResults],
      safe_error_message: safeErrorMessage,
      finished_at: finishedAt,
      progress_stage: "failed",
      progress_percent: 100,
      progress_current_report_key: null,
      progress_updated_at: finishedAt,
      updated_at: finishedAt,
    });
    await systemStore.appendAuditLog({
      tenant_id: run.tenant_id,
      actor_id: null,
      action: "executive_dashboard_run_failed",
      target_type: "executive_dashboard_run",
      target_id: run.id,
      metadata_json: {
        dashboard_token_jti: run.token_jti,
        source_run_id: run.source_run_id,
        selected_date_from: run.params.date_from,
        selected_date_to: run.params.date_to,
        report_keys: run.report_keys,
        safe_error_message: safeErrorMessage,
        duration_ms: Date.now() - startedAtMs,
      },
    });
    return run;
  };

  if (!tenant) {
    return failRun("ไม่พบร้านค้าที่ผูกกับลิงก์ dashboard นี้");
  }
  const access = tenantAccessStatus(tenant);
  if (!access.enabled) {
    return failRun(access.message);
  }

  const heavyReportFallbackEnabled = isHeavyReportFallbackEnabled(tenant);

  for (const [reportIndex, reportKey] of run.report_keys.entries()) {
    await updateProgress({
      stage: "running_report",
      percent: calculateReportProgressPercent(reportIndex, totalReports),
      currentReportKey: reportKey,
      doneReports: reportIndex,
    });

    const cachedSnapshot = await systemStore.getLatestSnapshotByParams(
      run.tenant_id,
      reportKey,
      run.params,
    );
    if (cachedSnapshot && cachedSnapshot.source !== "sample_snapshot") {
      recordReportResult(
        buildReferenceDashboardReportResult({
          reportKey,
          snapshot: cachedSnapshot,
        }),
      );
      await updateProgress({
        stage: "running_report",
        percent: calculateReportProgressPercent(reportIndex + 1, totalReports),
        currentReportKey: reportKey,
        doneReports: reportIndex + 1,
      });
      continue;
    }

    const recentTimeoutRun =
      reportKey === "stock_balance" &&
      heavyReportFallbackEnabled &&
      !shouldUseChunkedHeavyReport(tenant, reportKey)
        ? findRecentStockBalanceTimeoutRun({
            runs: await systemStore.listRuns(run.tenant_id, "stock_balance"),
            params: run.params,
          })
        : reportKey === "ar_customer_movement" &&
            heavyReportFallbackEnabled &&
            !shouldUseChunkedHeavyReport(tenant, reportKey)
          ? findRecentArCustomerMovementTimeoutRun({
              runs: await systemStore.listRuns(
                run.tenant_id,
                "ar_customer_movement",
              ),
              params: run.params,
            })
          : null;
    if (recentTimeoutRun) {
      const degradedReason =
        reportKey === "stock_balance"
          ? STOCK_BALANCE_TIMEOUT_REASON
          : AR_CUSTOMER_MOVEMENT_TIMEOUT_REASON;
      const fallback =
        reportKey === "stock_balance"
          ? resolveStockBalanceFallbackSnapshot({
              snapshot: await systemStore.getLatestSnapshotByParams(
                run.tenant_id,
                reportKey,
                run.params,
              ),
              params: run.params,
            })
          : resolveArCustomerMovementFallbackSnapshot({
              snapshot: await systemStore.getLatestSnapshotByParams(
                run.tenant_id,
                reportKey,
                run.params,
              ),
              params: run.params,
            });
      reportRunIds.add(recentTimeoutRun.id);
      recordReportResult(
        buildDegradedNotificationReportResult({
          reportKey,
          failedRunId: recentTimeoutRun.id,
          fallback,
          degradedReason,
          durationMs: null,
        }),
      );
      await updateProgress({
        stage: "running_report",
        percent: calculateReportProgressPercent(reportIndex + 1, totalReports),
        currentReportKey: reportKey,
        doneReports: reportIndex + 1,
      });
      continue;
    }

    const reportStartedAt = Date.now();
    const { result, policy, coalesced } = await runNotificationReportWithPolicy({
      tenant,
      tenantId: run.tenant_id,
      reportKey,
      params: run.params,
      requestAction: "executive_dashboard_report_run_requested",
      heavyReportFallbackEnabled,
    });
    const durationMs = Date.now() - reportStartedAt;
    reportRunIds.add(result.runRecord.id);
    if (durationMs >= 45_000) {
      await systemStore.appendAuditLog({
        tenant_id: run.tenant_id,
        actor_id: null,
        action: "executive_dashboard_report_slow",
        target_type: "report_run",
        target_id: result.runRecord.id,
        metadata_json: {
          dashboard_run_id: run.id,
          report_key: reportKey,
          duration_ms: durationMs,
          report_execution_policy: policy.mode,
          coalesced,
        },
      });
    }

    if (!result.ok) {
      const isHeavyTimeout =
        (reportKey === "stock_balance" &&
          heavyReportFallbackEnabled &&
          isStockBalanceTimeoutMessage(result.error)) ||
        (reportKey === "ar_customer_movement" &&
          heavyReportFallbackEnabled &&
          isArCustomerMovementTimeoutMessage(result.error));
      if (isHeavyTimeout) {
        const degradedReason =
          reportKey === "stock_balance"
            ? STOCK_BALANCE_TIMEOUT_REASON
            : AR_CUSTOMER_MOVEMENT_TIMEOUT_REASON;
        const fallback =
          reportKey === "stock_balance"
            ? resolveStockBalanceFallbackSnapshot({
                snapshot: await systemStore.getLatestSnapshotByParams(
                  run.tenant_id,
                  reportKey,
                  run.params,
                ),
                params: run.params,
              })
            : resolveArCustomerMovementFallbackSnapshot({
                snapshot: await systemStore.getLatestSnapshotByParams(
                  run.tenant_id,
                  reportKey,
                  run.params,
                ),
                params: run.params,
              });
        recordReportResult(
          buildDegradedNotificationReportResult({
            reportKey,
            failedRunId: result.runRecord.id,
            fallback,
            degradedReason,
            durationMs,
          }),
        );
      } else {
        recordReportResult(
          buildFailedNotificationReportResult({
            reportKey,
            runRecord: result.runRecord,
            durationMs,
          }),
        );
      }
    } else {
      recordReportResult(
        buildFreshNotificationReportResult({
          reportKey,
          runRecord: result.runRecord,
          snapshot: result.snapshot,
          durationMs,
        }),
      );
    }

    await updateProgress({
      stage: "running_report",
      percent: calculateReportProgressPercent(reportIndex + 1, totalReports),
      currentReportKey: reportKey,
      doneReports: reportIndex + 1,
    });
  }

  const usableResults = reportResults.filter(
    (result) => result.status !== "failed" && result.freshness !== "unavailable",
  );
  const warningResults = reportResults.filter(
    (result) => result.status !== "success" || result.freshness !== "fresh",
  );
  const status =
    usableResults.length === 0
      ? "failed"
      : warningResults.length
        ? "success_with_warnings"
        : "success";
  const finishedAt = new Date().toISOString();
  const safeErrorMessage =
    status === "failed"
      ? "สร้าง dashboard ไม่สำเร็จทุกใบ กรุณาลองใหม่ภายหลัง"
      : warningResults.length
        ? "มีบางรายงานใช้ข้อมูลอ้างอิงหรือสร้างไม่สำเร็จ"
        : null;

  run = await systemStore.upsertExecutiveDashboardRun({
    ...run,
    status,
    report_run_ids: [...reportRunIds],
    report_results: [...reportResults],
    safe_error_message: safeErrorMessage,
    finished_at: finishedAt,
    progress_stage: status === "failed" ? "failed" : "completed",
    progress_percent: 100,
    progress_current_report_key: null,
    progress_done_reports: totalReports,
    progress_total_reports: totalReports,
    progress_updated_at: finishedAt,
    updated_at: finishedAt,
  });

  await systemStore.appendAuditLog({
    tenant_id: run.tenant_id,
    actor_id: null,
    action: "executive_dashboard_run_completed",
    target_type: "executive_dashboard_run",
    target_id: run.id,
    metadata_json: {
      dashboard_token_jti: run.token_jti,
      source_run_id: run.source_run_id,
      selected_date_from: run.params.date_from,
      selected_date_to: run.params.date_to,
      selected_time_from: run.params.time_from ?? null,
      selected_time_to: run.params.time_to ?? null,
      report_keys: run.report_keys,
      report_results: reportResults.map((result) => ({
        report_key: result.report_key,
        freshness: result.freshness,
        status: result.status,
        run_id: result.run_id,
        duration_ms: result.duration_ms,
        row_count: result.row_count,
        degraded_reason: result.degraded_reason,
      })),
      duration_ms: Date.now() - startedAtMs,
    },
  });

  return run;
}

function buildReferenceDashboardReportResult(input: {
  reportKey: ReportKey;
  snapshot: ReportSnapshot;
}): NotificationReportResult {
  return {
    report_key: input.reportKey,
    status: "success",
    freshness: "reference",
    run_id: input.snapshot.run_id,
    snapshot_generated_at: input.snapshot.generated_at,
    duration_ms: 0,
    row_count: getSnapshotRowCount(input.snapshot),
    degraded_reason: null,
  };
}

async function executeNotificationRule(input: {
  rule: NotificationRuleRecord;
  mode: LineSendMode;
  force: boolean;
  now: Date;
  scheduledLocalDate?: string;
  scheduledLocalTime?: string;
  attempt?: number;
  source: NotificationRuleExecutionSource;
  run?: NotificationRuleRunRecord;
  workerId?: string | null;
  clientRequestId?: string | null;
}): Promise<NotificationRuleExecutionResult> {
  const executionStartedAtMs = Date.now();
  const tenant = await getTenantOrNull(input.rule.tenant_id);
  const zoned =
    input.run
      ? {
          date: input.run.scheduled_local_date,
          time: input.run.scheduled_local_time,
          isoWeekday: 1,
        }
      : input.scheduledLocalDate && input.scheduledLocalTime
      ? {
          date: input.scheduledLocalDate,
          time: input.scheduledLocalTime,
          isoWeekday: 1,
        }
      : getZonedDateTimeParts({
          now: input.now,
          timeZone: input.rule.timezone || BANGKOK_TIME_ZONE,
        });
  const params = input.run
    ? {
        date_from: input.run.period_from,
        date_to: input.run.period_to,
        time_from: input.run.period_from_time ?? undefined,
        time_to: input.run.period_to_time ?? undefined,
      }
    : deriveNotificationPeriodRange({
        periodPreset: input.rule.period_preset,
        periodStrategy: input.rule.period_strategy,
        scheduledLocalDate: zoned.date,
        scheduledLocalTime: zoned.time,
        now: input.now,
        timeZone: input.rule.timezone,
      });
  const attempt = input.run?.attempt ?? input.attempt ?? 1;
  const baseIdempotencyKey = buildNotificationIdempotencyKey({
    ruleId: input.rule.id,
    scheduledLocalDate: zoned.date,
    scheduledLocalTime: zoned.time,
    attempt,
  });
  const idempotencyKey =
    input.run?.idempotency_key ??
    (input.force
      ? `${baseIdempotencyKey}:manual:${Date.now()}`
      : baseIdempotencyKey);
  const nowIso = new Date().toISOString();
  const totalReports = input.rule.report_keys.length;
  let run: NotificationRuleRunRecord = input.run
    ? {
        ...input.run,
        status: "running",
        mode: input.mode,
        source: input.source,
        started_at: input.run.started_at ?? nowIso,
        claimed_at: input.run.claimed_at ?? nowIso,
        worker_id: input.workerId ?? input.run.worker_id,
        client_request_id:
          input.clientRequestId ?? input.run.client_request_id ?? null,
        progress_stage: input.run.progress_stage ?? "claimed",
        progress_percent: input.run.progress_percent ?? 10,
        progress_current_report_key:
          input.run.progress_current_report_key ?? null,
        progress_done_reports: input.run.progress_done_reports ?? 0,
        progress_total_reports:
          input.run.progress_total_reports ?? totalReports,
        progress_updated_at: input.run.progress_updated_at ?? nowIso,
        report_results: input.run.report_results ?? null,
        updated_at: nowIso,
      }
    : {
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
        mode: input.mode,
        source: input.source,
        attempt,
        idempotency_key: idempotencyKey,
        report_run_ids: [],
        report_results: null,
        delivery_ids: [],
        safe_error_message: null,
        started_at: nowIso,
        finished_at: null,
        queued_at: null,
        claimed_at: input.workerId ? nowIso : null,
        worker_id: input.workerId ?? null,
        client_request_id: input.clientRequestId ?? null,
        next_retry_at: null,
        progress_stage: "claimed",
        progress_percent: 10,
        progress_current_report_key: null,
        progress_done_reports: 0,
        progress_total_reports: totalReports,
        progress_updated_at: nowIso,
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

  run = input.run ? run : await systemStore.upsertNotificationRuleRun(run);
  const degradedReports: DegradedNotificationReport[] = [];
  const reportResults: NotificationReportResult[] = [
    ...(run.report_results ?? []),
  ];
  const reportRunIds: string[] = [
    ...new Set(
      [
        ...run.report_run_ids,
        ...reportResults
          .map((result) => result.run_id)
          .filter((runId): runId is string => Boolean(runId)),
      ],
    ),
  ];
  const addReportRunId = (runId?: string | null) => {
    if (runId && !reportRunIds.includes(runId)) {
      reportRunIds.push(runId);
    }
  };
  const recordReportResult = (result: NotificationReportResult) => {
    const existingIndex = reportResults.findIndex(
      (item) => item.report_key === result.report_key,
    );
    addReportRunId(result.run_id);
    if (existingIndex >= 0) {
      reportResults[existingIndex] = result;
      return;
    }
    reportResults.push(result);
  };
  const updateRunProgress = async (progress: {
    stage: NotificationRunProgressStage;
    percent: number;
    currentReportKey?: ReportKey | null;
    doneReports?: number | null;
    totalReports?: number | null;
  }) => {
    const progressUpdatedAt = new Date().toISOString();
    run = await systemStore.upsertNotificationRuleRun({
      ...run,
      progress_stage: progress.stage,
      progress_percent: clampProgressPercent(progress.percent),
      progress_current_report_key: progress.currentReportKey ?? null,
      progress_done_reports:
        progress.doneReports ?? run.progress_done_reports ?? null,
      progress_total_reports:
        progress.totalReports ?? run.progress_total_reports ?? totalReports,
      progress_updated_at: progressUpdatedAt,
      report_run_ids: [...reportRunIds],
      report_results: reportResults.length
        ? [...reportResults]
        : run.report_results,
      updated_at: progressUpdatedAt,
    });
    return run;
  };
  const getDegradedAuditMetadata = () => {
    if (!degradedReports.length) {
      return {};
    }
    const primary = degradedReports[0];
    return {
      degraded_report_keys: degradedReports.map((report) => report.reportKey),
      degraded_reason: primary.degradedReason,
      fallback_source_run_id: primary.fallback?.snapshot.run_id ?? null,
      fallback_snapshot_generated_at:
        primary.fallback?.snapshot.generated_at ?? null,
      fallback_snapshot_age_hours: primary.fallback?.ageHours ?? null,
      heavy_report_cooldown_used: degradedReports.some(
        (report) => report.cooldownUsed,
      ),
      degraded_reports: degradedReports.map((report) => ({
        report_key: report.reportKey,
        degraded_reason: report.degradedReason,
        failed_run_id: report.failedRunId,
        safe_error_message: report.safeErrorMessage,
        fallback_source_run_id: report.fallback?.snapshot.run_id ?? null,
        fallback_snapshot_generated_at:
          report.fallback?.snapshot.generated_at ?? null,
        fallback_snapshot_age_hours: report.fallback?.ageHours ?? null,
        heavy_report_cooldown_used: report.cooldownUsed,
      })),
    };
  };

  const finishRun = async (update: {
    status: NotificationRuleRunRecord["status"];
    safeErrorMessage?: string | null;
    reportRunIds?: string[];
    deliveryIds?: string[];
    nextRetryAt?: string | null;
  }) => {
    const finishedAt = new Date().toISOString();
    const finishedProgressStage =
      update.status === "failed" ? "failed" : "completed";
    run = await systemStore.upsertNotificationRuleRun({
      ...run,
      status: update.status,
      safe_error_message: update.safeErrorMessage ?? null,
      report_run_ids: update.reportRunIds ?? [...reportRunIds],
      report_results: reportResults.length ? [...reportResults] : null,
      delivery_ids: update.deliveryIds ?? run.delivery_ids,
      finished_at: finishedAt,
      next_retry_at: update.nextRetryAt ?? null,
      progress_stage: finishedProgressStage,
      progress_percent: 100,
      progress_current_report_key: null,
      progress_done_reports:
        update.status === "failed"
          ? (run.progress_done_reports ?? 0)
          : totalReports,
      progress_total_reports: totalReports,
      progress_updated_at: finishedAt,
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
    reportRunIdsForFailure: string[] = [...reportRunIds],
    deliveryIds: string[] = run.delivery_ids,
    options?: {
      deliveryRecords?: LineDeliveryRecord[];
      failureKind?: ReportFailureKind | null;
    },
  ) => {
    const deliveryRecords = options?.deliveryRecords ?? [];
    const resolvedDeliveryIds = deliveryRecords.length
      ? deliveryRecords.map((delivery) => delivery.id)
      : deliveryIds;
    const nextRetryAt =
      input.mode === "send" && attempt < input.rule.retry_policy.max_attempts
        ? new Date(
            Date.now() + input.rule.retry_policy.retry_delay_minutes * 60_000,
          ).toISOString()
        : null;
    await finishRun({
      status: "failed",
      safeErrorMessage,
      reportRunIds: reportRunIdsForFailure,
      deliveryIds: resolvedDeliveryIds,
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
        failure_kind: options?.failureKind ?? null,
        next_retry_at: nextRetryAt,
        incident_delivery_ids: deliveryRecords.map((delivery) => delivery.id),
        incident_delivery_statuses: deliveryRecords.map(
          (delivery) => delivery.status,
        ),
        ...getDegradedAuditMetadata(),
      },
    });
    return {
      ok: false as const,
      statusCode,
      error: safeErrorMessage,
      run,
      deliveries: deliveryRecords,
      report_run_ids: reportRunIdsForFailure,
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

  const snapshots: ReportSnapshot[] = [];
  const businessSignalsEnabled = isBusinessSignalsEnabled(tenant);
  const heavyReportFallbackEnabled = isHeavyReportFallbackEnabled(tenant);
  const sendOpsAlertSafe = async (alert: {
    alertType:
      | "notification_summary"
      | "notification_run_failed"
      | "javaws_failure"
      | "line_delivery_failed"
      | "heavy_report_slow";
    severity: "info" | "warning" | "critical";
    reportKey?: ReportKey | null;
    messageText: string;
  }) => {
    try {
      const deliveries = await sendOperationalTelegramAlert({
        store: systemStore,
        tenant,
        alertType: alert.alertType,
        severity: alert.severity,
        messageText: alert.messageText,
        dedupeKey: buildOperationalAlertDedupeKey({
          alertType: alert.alertType,
          tenantId: input.rule.tenant_id,
          ruleId: input.rule.id,
          scheduledDate: zoned.date,
          scheduledTime: zoned.time,
          reportKey: alert.reportKey ?? null,
          severity: alert.severity,
        }),
      });
      if (deliveries.length) {
        await systemStore.appendAuditLog({
          tenant_id: input.rule.tenant_id,
          actor_id: null,
          action: "telegram_operational_alert_processed",
          target_type: "operational_alert",
          target_id: alert.alertType,
          metadata_json: {
            alert_type: alert.alertType,
            severity: alert.severity,
            report_key: alert.reportKey ?? null,
            delivery_ids: deliveries.map((delivery) => delivery.id),
            delivery_statuses: deliveries.map((delivery) => delivery.status),
          },
        });
      }
    } catch (error) {
      await systemStore.appendAuditLog({
        tenant_id: input.rule.tenant_id,
        actor_id: null,
        action: "telegram_operational_alert_failed",
        target_type: "operational_alert",
        target_id: alert.alertType,
        metadata_json: {
          alert_type: alert.alertType,
          severity: alert.severity,
          report_key: alert.reportKey ?? null,
          safe_error_message: toSafeErrorMessage(error),
        },
      });
    }
  };
  const sendFinalReportFailureOpsAlert = async (failure: {
    reportKey: ReportKey;
    runRecord: ReportRunRecord;
    safeErrorMessage: string;
  }) => {
    if (input.mode !== "send" || attempt < input.rule.retry_policy.max_attempts) {
      return;
    }
    const javaWsFailure = Boolean(
      failure.runRecord.failure_kind || failure.runRecord.failure_phase,
    );
    await sendOpsAlertSafe({
      alertType: javaWsFailure ? "javaws_failure" : "notification_run_failed",
      severity: "critical",
      reportKey: failure.reportKey,
      messageText: buildOperationalAlertMessage({
        title: javaWsFailure
          ? "JavaWS ทำให้สร้างรายงานผู้บริหารไม่สำเร็จ"
          : "สร้างรายงานผู้บริหารไม่สำเร็จหลัง retry สุดท้าย",
        severity: "critical",
        tenantName: tenant.name,
        scheduledTime: `${zoned.date} ${zoned.time}`,
        reportKey: failure.reportKey,
        runId: failure.runRecord.id,
        status: "failed",
        details: [
          `สาเหตุ: ${failure.safeErrorMessage}`,
          failure.runRecord.failure_kind
            ? `ชนิดปัญหา: ${failure.runRecord.failure_kind}`
            : "",
          failure.runRecord.failure_phase
            ? `JavaWS phase: ${failure.runRecord.failure_phase}`
            : "",
        ].filter(Boolean),
        action:
          "ตรวจ SML JavaWS/Tomcat, SMLConfig, database และสิทธิ์อ่านข้อมูล แล้วรันทดสอบรายงานอีกครั้ง",
      }),
    });
  };
  const sendReportFailureIncidentNotice = async (incident: {
    reportKey: ReportKey;
    runId: string;
    safeErrorMessage: string;
    failureKind: ReportFailureKind;
  }) => {
    if (
      !shouldSendReportFailureIncidentNotice({
        enabled: isLineReportFailureIncidentEnabled(tenant),
        mode: input.mode,
        attempt,
        maxAttempts: input.rule.retry_policy.max_attempts,
      })
    ) {
      return [] as LineDeliveryRecord[];
    }

    await updateRunProgress({
      stage: "sending_line",
      percent: 94,
      currentReportKey: null,
      doneReports: run.progress_done_reports ?? reportResults.length,
      totalReports,
    });

    const deliveries: LineDeliveryRecord[] = [];
    const deliveryTargetHashes = new Set<string>();
    const preview = buildOperationalIncidentLinePreview({
      tenantId: input.rule.tenant_id,
      tenantName: tenant.name,
      reportKey: incident.reportKey,
      runId: incident.runId,
      periodFrom: params.date_from,
      periodTo: params.date_to,
      scheduledLocalDate: zoned.date,
      scheduledLocalTime: zoned.time,
      safeErrorMessage: incident.safeErrorMessage,
      failureKind: incident.failureKind,
    });

    for (const targetId of input.rule.target_ids) {
      const target = await getEffectiveLineTargetById(targetId);
      if (!target) {
        await systemStore.appendAuditLog({
          tenant_id: input.rule.tenant_id,
          actor_id: null,
          action: "notification_rule_incident_target_missing",
          target_type: "line_target",
          target_id: targetId,
          metadata_json: {
            notification_rule_id: input.rule.id,
            report_key: incident.reportKey,
            report_run_id: incident.runId,
            failure_kind: incident.failureKind,
            source: input.source,
            mode: input.mode,
            attempt,
          },
        });
        continue;
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
            incident_notice: true,
            target_id_hash: target.target_id_hash,
            target_id_masked: target.target_id_masked,
            source: input.source,
            mode: input.mode,
            attempt,
          },
        });
        continue;
      }
      deliveryTargetHashes.add(target.target_id_hash);

      const permission = canAccessLineReport({
        tenantId: input.rule.tenant_id,
        target,
        reportKey: incident.reportKey,
        action: "receive_morning_brief",
      });
      if (!permission.allowed) {
        await systemStore.appendAuditLog({
          tenant_id: input.rule.tenant_id,
          actor_id: null,
          action: "notification_rule_incident_target_skipped_permission",
          target_type: "line_target",
          target_id: target.id,
          metadata_json: {
            notification_rule_id: input.rule.id,
            report_key: incident.reportKey,
            report_run_id: incident.runId,
            failure_kind: incident.failureKind,
            reason: permission.reason,
            source: input.source,
            mode: input.mode,
            attempt,
            target_id_hash: target.target_id_hash,
            target_id_masked: target.target_id_masked,
          },
        });
        continue;
      }

      const deliveryKey = buildNotificationRuleIncidentDeliveryKey({
        ruleId: input.rule.id,
        scheduledLocalDate: zoned.date,
        scheduledLocalTime: zoned.time,
        reportKey: incident.reportKey,
        targetIdHash: target.target_id_hash,
        source: input.source,
        notificationRunId: run.id,
      });
      if (input.mode === "send") {
        const existingDelivery =
          await systemStore.findSuccessfulLineDeliveryByKey({
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
            ? "notification_rule_incident_sent"
            : delivery.status === "dry_run"
            ? "notification_rule_incident_dry_run"
            : delivery.status === "skipped"
            ? "notification_rule_incident_skipped_unconfigured"
            : "notification_rule_incident_send_failed",
        target_type: "line_delivery",
        target_id: delivery.id,
        metadata_json: {
          notification_rule_id: input.rule.id,
          report_key: incident.reportKey,
          report_run_id: incident.runId,
          report_run_ids: reportRunIds,
          delivery_key: deliveryKey,
          mode: input.mode,
          source: input.source,
          attempt,
          target_id_masked: delivery.target_id_masked,
          target_id_hash: target.target_id_hash,
          safe_error_message: delivery.safe_error_message,
          original_safe_error_message: incident.safeErrorMessage,
          failure_kind: incident.failureKind,
        },
      });
    }

    return deliveries;
  };
  for (const [reportIndex, reportKey] of input.rule.report_keys.entries()) {
    const previousFreshResult = reportResults.find(
      (result) =>
        result.report_key === reportKey &&
        result.status === "success" &&
        result.freshness === "fresh" &&
        Boolean(result.run_id),
    );
    if (previousFreshResult?.run_id) {
      addReportRunId(previousFreshResult.run_id);
      const previousSnapshot = await systemStore.getSnapshotByRunId(
        input.rule.tenant_id,
        previousFreshResult.run_id,
        reportKey,
      );
      if (!previousSnapshot) {
        return failRun(
          "พบผลรายงานเดิมแต่ไม่พบ snapshot สำหรับส่ง LINE กรุณารันใหม่อีกครั้ง",
          500,
          reportRunIds,
        );
      }
      snapshots.push(previousSnapshot);
      continue;
    }

    const wasWaitingForCurrentReport =
      run.progress_stage === "waiting_chunked_report" &&
      run.progress_current_report_key === reportKey;

    await updateRunProgress({
      stage: "running_report",
      percent: calculateReportProgressPercent(reportIndex, totalReports),
      currentReportKey: reportKey,
      doneReports: reportIndex,
      totalReports,
    });
    const markReportProgressDone = async () => {
      await updateRunProgress({
        stage: "running_report",
        percent: calculateReportProgressPercent(reportIndex + 1, totalReports),
        currentReportKey: reportKey,
        doneReports: reportIndex + 1,
        totalReports,
      });
    };

    if (
      reportKey === "stock_balance" &&
      heavyReportFallbackEnabled &&
      !shouldUseChunkedHeavyReport(tenant, reportKey)
    ) {
      const recentTimeoutRun = findRecentStockBalanceTimeoutRun({
        runs: await systemStore.listRuns(input.rule.tenant_id, "stock_balance"),
        params,
      });
      if (recentTimeoutRun) {
        if (!reportRunIds.includes(recentTimeoutRun.id)) {
          addReportRunId(recentTimeoutRun.id);
        }
        const fallback = resolveStockBalanceFallbackSnapshot({
          snapshot: await systemStore.getLatestSnapshotByParams(
            input.rule.tenant_id,
            "stock_balance",
            params,
          ),
          params,
        });
        const preview = buildDegradedStockBalancePreview({
          tenantId: input.rule.tenant_id,
          tenantName: tenant.name,
          failedRunId: recentTimeoutRun.id,
          fallback,
          cooldownUsed: true,
        });
        degradedReports.push({
          reportKey: "stock_balance",
          degradedReason: STOCK_BALANCE_TIMEOUT_REASON,
          failedRunId: recentTimeoutRun.id,
          safeErrorMessage:
            recentTimeoutRun.safe_error_message ??
            "รายงานสต็อกคงเหลือใช้เวลานานเกินไป",
          fallback,
          cooldownUsed: true,
          preview,
        });
        recordReportResult(
          buildDegradedNotificationReportResult({
            reportKey,
            failedRunId: recentTimeoutRun.id,
            fallback,
            degradedReason: STOCK_BALANCE_TIMEOUT_REASON,
            durationMs: null,
          }),
        );
        await markReportProgressDone();
        continue;
      }
    }

    if (
      reportKey === "ar_customer_movement" &&
      heavyReportFallbackEnabled &&
      !shouldUseChunkedHeavyReport(tenant, reportKey)
    ) {
      const recentTimeoutRun = findRecentArCustomerMovementTimeoutRun({
        runs: await systemStore.listRuns(
          input.rule.tenant_id,
          "ar_customer_movement",
        ),
        params,
      });
      if (recentTimeoutRun) {
        if (!reportRunIds.includes(recentTimeoutRun.id)) {
          addReportRunId(recentTimeoutRun.id);
        }
        const fallback = resolveArCustomerMovementFallbackSnapshot({
          snapshot: await systemStore.getLatestSnapshotByParams(
            input.rule.tenant_id,
            "ar_customer_movement",
            params,
          ),
          params,
        });
        const preview = buildDegradedArCustomerMovementPreview({
          tenantId: input.rule.tenant_id,
          tenantName: tenant.name,
          failedRunId: recentTimeoutRun.id,
          fallback,
          cooldownUsed: true,
        });
        degradedReports.push({
          reportKey: "ar_customer_movement",
          degradedReason: AR_CUSTOMER_MOVEMENT_TIMEOUT_REASON,
          failedRunId: recentTimeoutRun.id,
          safeErrorMessage:
            recentTimeoutRun.safe_error_message ??
            "รายงานเคลื่อนไหวลูกหนี้ใช้เวลานานเกินไป",
          fallback,
          cooldownUsed: true,
          preview,
        });
        recordReportResult(
          buildDegradedNotificationReportResult({
            reportKey,
            failedRunId: recentTimeoutRun.id,
            fallback,
            degradedReason: AR_CUSTOMER_MOVEMENT_TIMEOUT_REASON,
            durationMs: null,
          }),
        );
        await markReportProgressDone();
        continue;
      }
    }

    const chunkedReportKey =
      isChunkedHeavyReportKey(reportKey) &&
      shouldUseChunkedHeavyReport(tenant, reportKey)
        ? reportKey
        : null;
    const reusableChunkedRun = chunkedReportKey
      ? await findNotificationChunkedReportRun({
          tenantId: input.rule.tenant_id,
          reportKey: chunkedReportKey,
          params,
          reportRunIds,
        })
      : null;
    if (
      chunkedReportKey &&
      wasWaitingForCurrentReport &&
      reusableChunkedRun?.status !== "success" &&
      isNotificationChunkedWaitTimedOut(run, new Date())
    ) {
      const safeErrorMessage =
        buildNotificationChunkedWaitTimeoutMessage(chunkedReportKey);
      const timedOutRun =
        reusableChunkedRun ??
        buildMissingChunkedReportRun(
          {
            tenantId: input.rule.tenant_id,
            reportKey: chunkedReportKey,
            params,
          },
          safeErrorMessage,
        );
      addReportRunId(timedOutRun.id);
      recordReportResult(
        buildFailedNotificationReportResult({
          reportKey,
          runRecord: timedOutRun,
          durationMs: Date.now() - getNotificationRunStartedAtMs(run),
        }),
      );
      await systemStore.appendAuditLog({
        tenant_id: input.rule.tenant_id,
        actor_id: null,
        action: "notification_rule_chunked_wait_timeout",
        target_type: "notification_rule_run",
        target_id: run.id,
        metadata_json: {
          notification_rule_id: input.rule.id,
          report_key: reportKey,
          report_run_id: timedOutRun.id,
          wait_limit_ms: NOTIFICATION_CHUNKED_WAIT_MS,
          source: input.source,
          mode: input.mode,
          attempt,
          scheduled_local_date: zoned.date,
          scheduled_local_time: zoned.time,
          safe_error_message: safeErrorMessage,
        },
      });
      const failureKind = classifyReportFailureKind(safeErrorMessage);
      if (businessSignalsEnabled) {
        await persistBusinessSignals(
          [
            buildReportFailureBusinessSignal({
              tenant_id: input.rule.tenant_id,
              report_key: reportKey,
              run_id: timedOutRun.id,
              period_from: params.date_from,
              period_to: params.date_to,
              safe_error_message: safeErrorMessage,
              failure_kind: failureKind,
            }),
          ],
          {
            source: input.source,
            notificationRuleId: input.rule.id,
          },
        );
      }
      await sendOpsAlertSafe({
        alertType: "notification_run_failed",
        severity: "critical",
        reportKey,
        messageText: buildOperationalAlertMessage({
          title: "รอ chunked report ครบ SLA แล้วยังไม่สำเร็จ",
          severity: "critical",
          tenantName: tenant.name,
          scheduledTime: `${zoned.date} ${zoned.time}`,
          reportKey,
          runId: timedOutRun.id,
          status: "failed",
          details: [
            `notification_run_id: ${run.id}`,
            `attempt: ${attempt}`,
            `wait_limit_minutes: ${Math.round(NOTIFICATION_CHUNKED_WAIT_MS / 60_000)}`,
            `สาเหตุ: ${safeErrorMessage}`,
          ],
          action:
            "ตรวจ chunked report run/chunks และปล่อย retry รอบถัดไปใช้ period เดิม ไม่ต้องกดส่งซ้ำทันที",
        }),
      });
      const incidentDeliveries = await sendReportFailureIncidentNotice({
        reportKey,
        runId: timedOutRun.id,
        safeErrorMessage,
        failureKind,
      });
      return failRun(
        safeErrorMessage,
        424,
        reportRunIds,
        incidentDeliveries.map((delivery) => delivery.id),
        {
          deliveryRecords: incidentDeliveries,
          failureKind,
        },
      );
    }

    const reportStartedAt = Date.now();
    let reportExecution:
      | Awaited<ReturnType<typeof runNotificationRuleReportWithPolicy>>
      | null = null;
    if (chunkedReportKey && reusableChunkedRun?.status === "success") {
      const reusableSnapshot = await systemStore.getSnapshotByRunId(
        input.rule.tenant_id,
        reusableChunkedRun.id,
        chunkedReportKey,
      );
      reportExecution = {
        status: "ready",
        result: reusableSnapshot
          ? {
              ok: true,
              snapshot: reusableSnapshot,
              runRecord: reusableChunkedRun,
            }
          : {
              ok: false,
              statusCode: 500,
              error:
                "ประมวลผลรายงานสำเร็จแต่ไม่พบ snapshot กรุณาตรวจสอบระบบจัดเก็บรายงาน",
              runRecord: reusableChunkedRun,
            },
        coalesced: true,
        policy: getReportExecutionPolicy(reportKey),
      };
    }
    reportExecution ??= await runNotificationRuleReportWithPolicy({
      tenant,
      tenantId: input.rule.tenant_id,
      reportKey,
      params,
      requestAction: "notification_rule_report_run_requested",
      heavyReportFallbackEnabled,
    });
    if (reportExecution.status === "waiting") {
      const waitingRun = reportExecution.runRecord ?? reportExecution.activeRun;
      addReportRunId(reportExecution.runRecord?.id ?? null);
      await updateRunProgress({
        stage: "waiting_chunked_report",
        percent: calculateReportProgressPercent(reportIndex, totalReports),
        currentReportKey: reportKey,
        doneReports: reportIndex,
        totalReports,
      });
      await systemStore.appendAuditLog({
        tenant_id: input.rule.tenant_id,
        actor_id: null,
        action: "notification_rule_waiting_chunked_report",
        target_type: "notification_rule_run",
        target_id: run.id,
        metadata_json: {
          notification_rule_id: input.rule.id,
          report_key: reportKey,
          report_run_id: reportExecution.runRecord?.id ?? null,
          active_report_run_id: reportExecution.activeRun?.id ?? null,
          active_report_key: reportExecution.activeRun?.report_key ?? null,
          source: input.source,
          mode: input.mode,
          attempt,
          scheduled_local_date: zoned.date,
          scheduled_local_time: zoned.time,
          poll_seconds: Math.round(NOTIFICATION_WAIT_POLL_MS / 1000),
          wait_deadline_at: new Date(
            getNotificationRunStartedAtMs(run) + NOTIFICATION_CHUNKED_WAIT_MS,
          ).toISOString(),
          report_execution_policy: reportExecution.policy.mode,
          coalesced: reportExecution.coalesced,
          safe_error_message: reportExecution.safeErrorMessage,
        },
      });
      if (waitingRun?.status === "queued" || waitingRun?.status === "running") {
        kickChunkedReportRunProcessor(waitingRun.id);
      }
      return {
        ok: true,
        status: "processed",
        run,
        deliveries: [],
        report_run_ids: reportRunIds,
        mode: input.mode,
      };
    }
    const { result, coalesced, policy } = reportExecution;
    const reportDurationMs = Date.now() - reportStartedAt;
    addReportRunId(result.runRecord.id);
	    if (reportDurationMs >= 45_000) {
	      await systemStore.appendAuditLog({
        tenant_id: input.rule.tenant_id,
        actor_id: null,
        action: "notification_rule_report_slow",
        target_type: "report_run",
        target_id: result.runRecord.id,
        metadata_json: {
          notification_rule_id: input.rule.id,
          report_key: reportKey,
          duration_ms: reportDurationMs,
          source: input.source,
          mode: input.mode,
          scheduled_local_date: zoned.date,
          scheduled_local_time: zoned.time,
          report_execution_policy: policy.mode,
	          coalesced,
	        },
	      });
	      const slowSeverity = await classifyHeavyReportSlowSeverity({
	        tenantId: input.rule.tenant_id,
	        reportKey,
	        durationMs: reportDurationMs,
	      });
	      if (slowSeverity === "critical") {
	        await sendOpsAlertSafe({
	          alertType: "heavy_report_slow",
	          severity: slowSeverity,
	          reportKey,
	          messageText: buildOperationalAlertMessage({
	            title: "รายงานหนักใช้เวลานานผิดปกติ",
	            severity: slowSeverity,
	            tenantName: tenant.name,
	            scheduledTime: `${zoned.date} ${zoned.time}`,
	            reportKey,
	            runId: result.runRecord.id,
	            status: "slow",
	            details: [
	              `duration_ms: ${reportDurationMs}`,
	              `row_count: ${result.runRecord.row_count}`,
	              `execution_policy: ${policy.mode}`,
	            ],
	            action:
	              "ตรวจ JavaWS/Tomcat และ slow chunk audit ถ้ายังช้าซ้ำให้ลดช่วงข้อมูลหรือปรับ chunk size",
	          }),
	        });
	      }
	    }
    if (!result.ok) {
      if (
        reportKey === "stock_balance" &&
        heavyReportFallbackEnabled &&
        !shouldUseChunkedHeavyReport(tenant, reportKey) &&
        isStockBalanceTimeoutMessage(result.error)
      ) {
        const fallback = resolveStockBalanceFallbackSnapshot({
          snapshot: await systemStore.getLatestSnapshotByParams(
            input.rule.tenant_id,
            "stock_balance",
            params,
          ),
          params,
        });
        const preview = buildDegradedStockBalancePreview({
          tenantId: input.rule.tenant_id,
          tenantName: tenant.name,
          failedRunId: result.runRecord.id,
          fallback,
          cooldownUsed: false,
        });
        degradedReports.push({
          reportKey: "stock_balance",
          degradedReason: STOCK_BALANCE_TIMEOUT_REASON,
          failedRunId: result.runRecord.id,
          safeErrorMessage: result.error,
          fallback,
          cooldownUsed: false,
          preview,
        });
        recordReportResult(
          buildDegradedNotificationReportResult({
            reportKey,
            failedRunId: result.runRecord.id,
            fallback,
            degradedReason: STOCK_BALANCE_TIMEOUT_REASON,
            durationMs: reportDurationMs,
          }),
        );
        await markReportProgressDone();
        continue;
      }
      if (
        reportKey === "ar_customer_movement" &&
        heavyReportFallbackEnabled &&
        !shouldUseChunkedHeavyReport(tenant, reportKey) &&
        isArCustomerMovementTimeoutMessage(result.error)
      ) {
        const fallback = resolveArCustomerMovementFallbackSnapshot({
          snapshot: await systemStore.getLatestSnapshotByParams(
            input.rule.tenant_id,
            "ar_customer_movement",
            params,
          ),
          params,
        });
        const preview = buildDegradedArCustomerMovementPreview({
          tenantId: input.rule.tenant_id,
          tenantName: tenant.name,
          failedRunId: result.runRecord.id,
          fallback,
          cooldownUsed: false,
        });
        degradedReports.push({
          reportKey: "ar_customer_movement",
          degradedReason: AR_CUSTOMER_MOVEMENT_TIMEOUT_REASON,
          failedRunId: result.runRecord.id,
          safeErrorMessage: result.error,
          fallback,
          cooldownUsed: false,
          preview,
        });
        recordReportResult(
          buildDegradedNotificationReportResult({
            reportKey,
            failedRunId: result.runRecord.id,
            fallback,
            degradedReason: AR_CUSTOMER_MOVEMENT_TIMEOUT_REASON,
            durationMs: reportDurationMs,
          }),
        );
        await markReportProgressDone();
        continue;
      }
      recordReportResult(
        buildFailedNotificationReportResult({
          reportKey,
          runRecord: result.runRecord,
          durationMs: reportDurationMs,
        }),
      );
      const failureKind = classifyReportFailureKind(result.error);
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
              failure_kind: failureKind,
            }),
          ],
          {
            source: input.source,
            notificationRuleId: input.rule.id,
          },
        );
      }
	      const incidentDeliveries = await sendReportFailureIncidentNotice({
	        reportKey,
	        runId: result.runRecord.id,
	        safeErrorMessage: result.error,
	        failureKind,
	      });
	      await sendFinalReportFailureOpsAlert({
	        reportKey,
	        runRecord: result.runRecord,
	        safeErrorMessage: result.error,
	      });
	      return failRun(
        result.error,
        result.statusCode,
        reportRunIds,
        incidentDeliveries.map((delivery) => delivery.id),
        {
          deliveryRecords: incidentDeliveries,
          failureKind,
        },
      );
    }
    recordReportResult(
      buildFreshNotificationReportResult({
        reportKey,
        runRecord: result.runRecord,
        snapshot: result.snapshot,
        durationMs: reportDurationMs,
      }),
    );
    snapshots.push(result.snapshot);
    await markReportProgressDone();
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

  await updateRunProgress({
    stage: "preparing_line",
    percent: 88,
    currentReportKey: null,
    doneReports: totalReports,
    totalReports,
  });

  const deliveries: LineDeliveryRecord[] = [];
  const deliveryTargetHashes = new Set<string>();
  const deliveryIdToTargetHash = new Map<string, string>();
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
      input.rule.digest_mode === "action_only" &&
      lineActionDigestV2Enabled &&
      degradedReports.length === 0;
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
    const fallbackPreviewByReportKey = new Map<ReportKey, ReportLinePreview>(
      [
        ...fallbackPreviews.map((reportPreview) => [
          reportPreview.report_key,
          reportPreview,
        ] as const),
        ...degradedReports.map((report) => [
          report.reportKey,
          report.preview,
        ] as const),
      ],
    );
    const orderedFallbackPreviews = input.rule.report_keys
      .map((reportKey) => fallbackPreviewByReportKey.get(reportKey) ?? null)
      .filter((preview): preview is ReportLinePreview => Boolean(preview));
    const preview =
      actionDigestPreview ?? buildNotificationDigestPreview(orderedFallbackPreviews);
    const digestIssueAuditMapping =
      actionDigestSelection?.issues.map((issue) => ({
        issue_key: issue.issue_key,
        raw_signal_ids: issue.raw_signal_ids,
        raw_signal_keys: issue.raw_signal_keys,
      })) ?? [];
    const deliveryKey = buildNotificationRuleDeliveryKey({
      ruleId: input.rule.id,
      scheduledLocalDate: zoned.date,
      scheduledLocalTime: zoned.time,
      targetIdHash: target.target_id_hash,
      source: input.source,
      notificationRunId: run.id,
    });
    if (input.mode === "send") {
      const existingDelivery = await systemStore.findSuccessfulLineDeliveryByKey({
        tenantId: input.rule.tenant_id,
        deliveryKey,
      });
      if (existingDelivery) {
        deliveries.push(existingDelivery);
        continue;
      }
    }

    await updateRunProgress({
      stage: "sending_line",
      percent: 94,
      currentReportKey: null,
      doneReports: totalReports,
      totalReports,
    });

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
    deliveryIdToTargetHash.set(delivery.id, target.target_id_hash);
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
        ...getDegradedAuditMetadata(),
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
	    if (input.mode === "send") {
	      const isRateLimit = (failedDelivery.safe_error_message ?? "").includes("429");
	      const lineFailSeverity = isRateLimit ? "warning" : "critical";
	      const lineFailAction = isRateLimit
	        ? "LINE quota หมดหรือถูก rate limit — ตรวจ LINE OA Console และ upgrade plan ถ้าจำเป็น (ระบบจะ retry อัตโนมัติ)"
	        : "ตรวจ LINE OA token, target permission, quota และลองส่ง test alert อีกครั้ง";
	      const failedDeliveryHash = deliveryIdToTargetHash.get(failedDelivery.id);
	      const siblingTenants = failedDeliveryHash
	        ? await systemStore.findTenantsWithSameLineTargetHash({
	            targetIdHash: failedDeliveryHash,
	            excludeTenantId: tenant.id,
	          }).catch(() => [])
	        : [];
	      const siblingNote = siblingTenants.length > 0
	        ? `target นี้แชร์กับร้าน: ${siblingTenants.map((s) => s.tenantName).join(", ")} — quota อาจถูกใช้โดยร้านอื่น`
	        : null;
	      await sendOpsAlertSafe({
	        alertType: "line_delivery_failed",
	        severity: lineFailSeverity,
	        reportKey: null,
	        messageText: buildOperationalAlertMessage({
	          title: "ส่ง LINE executive notification ไม่สำเร็จ",
	          severity: lineFailSeverity,
	          tenantName: tenant.name,
	          scheduledTime: `${zoned.date} ${zoned.time}`,
	          status: "failed",
	          runId: run.id,
	          details: [
	            `LINE target: ${failedDelivery.target_id_masked ?? "unknown"}`,
	            `สาเหตุ: ${failedDelivery.safe_error_message ?? "ส่ง LINE ไม่สำเร็จ"}`,
	            ...(siblingNote ? [siblingNote] : []),
	            ...(isRateLimit && !siblingNote ? ["หมายเหตุ: 429 อาจเกิดจาก quota ร่วมกับร้านอื่นในช่อง LINE OA เดียวกัน"] : []),
	          ],
	          action: lineFailAction,
	        }),
	      });
	    }
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

  const completedWithWarningsMessage = degradedReports.length
    ? `ส่งสำเร็จพร้อมข้อสังเกต: ${formatDegradedReportNames(
        degradedReports.map((report) => report.reportKey),
      )} ข้อมูลสดไม่พร้อม`
    : null;
  await finishRun({
    status: deliveries.length
      ? degradedReports.length
        ? "success_with_warnings"
        : "success"
      : "skipped",
    safeErrorMessage: deliveries.length
      ? completedWithWarningsMessage
      : "ไม่มีปลายทาง LINE ในกฎนี้",
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
	      ...getDegradedAuditMetadata(),
	    },
	  });
	  if (input.mode === "send") {
	    const warningCount =
	      degradedReports.length +
	      deliveries.filter((delivery) => delivery.status !== "success").length;
	    await sendOpsAlertSafe({
	      alertType: "notification_summary",
	      severity: warningCount ? "warning" : "info",
	      reportKey: null,
	      messageText: buildOperationalAlertMessage({
	        title: "สรุปรอบแจ้งเตือนผู้บริหาร",
	        severity: warningCount ? "warning" : "info",
	        tenantName: tenant.name,
	        scheduledTime: `${zoned.date} ${zoned.time}`,
	        status: run.status,
	        runId: run.id,
	        details: [
	          `reports: ${input.rule.report_keys.length}`,
	          `LINE deliveries: ${deliveries.length}`,
	          `success LINE: ${
	            deliveries.filter((delivery) => delivery.status === "success").length
	          }`,
	          `duration_ms: ${Date.now() - executionStartedAtMs}`,
	          `warning_count: ${warningCount}`,
	        ],
	        action: warningCount
	          ? "ตรวจ operations status และรายงานที่ degraded ก่อนใช้ยอดรอบนี้ตัดสินใจ"
	          : "ไม่ต้องดำเนินการ ระบบส่งรายงานผู้บริหารสำเร็จ",
	      }),
	    });
	  }

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

function calculateReportProgressPercent(doneReports: number, totalReports: number) {
  if (totalReports <= 0) {
    return 85;
  }
  return clampProgressPercent(10 + Math.round((doneReports / totalReports) * 75));
}

async function classifyHeavyReportSlowSeverity(input: {
  tenantId: TenantId;
  reportKey: ReportKey;
  durationMs: number;
}) {
  if (
    input.reportKey !== "stock_balance" &&
    input.reportKey !== "ar_customer_movement"
  ) {
    return null;
  }
  const staticWarningMs =
    input.reportKey === "stock_balance" ? 240_000 : 180_000;
  const staticCriticalMs =
    input.reportKey === "stock_balance" ? 300_000 : 240_000;
  const recentDurations = (await systemStore.listRuns(input.tenantId, input.reportKey))
    .filter(
      (run) =>
        run.status === "success" &&
        run.started_at &&
        run.finished_at &&
        run.finished_at !== run.started_at,
    )
    .slice(0, 7)
    .map((run) =>
      Math.max(
        0,
        new Date(run.finished_at as string).getTime() -
          new Date(run.started_at).getTime(),
      ),
    )
    .filter((duration) => duration > 0)
    .sort((a, b) => a - b);
  const medianMs = recentDurations.length
    ? recentDurations[Math.floor(recentDurations.length / 2)]
    : null;
  const warningThresholdMs = Math.max(
    staticWarningMs,
    medianMs ? Math.round(medianMs * 1.5) : 0,
  );
  const criticalThresholdMs = Math.max(
    staticCriticalMs,
    medianMs ? Math.round(medianMs * 1.5) : 0,
  );
  if (input.durationMs >= criticalThresholdMs) {
    return "critical" as const;
  }
  if (input.durationMs >= warningThresholdMs) {
    return "warning" as const;
  }
  return null;
}

function clampProgressPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toSafeNumber(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function readBoundedIntegerEnv(
  name: string,
  fallback: number,
  bounds: { min: number; max: number },
) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(parsed)));
}

function readBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return fallback;
}

function resolveSmokeTestAlertTitle(alertType: string) {
  switch (alertType) {
    case "javaws_diagnostic":
      return "JavaWS ตอบข้อมูลอ่านไม่ได้";
    case "heavy_report_slow":
      return "รายงานหนักใช้เวลานานผิดปกติ";
    case "notification_summary":
      return "สรุปรอบแจ้งเตือนผู้บริหาร";
    case "notification_run_slow":
      return "งานแจ้งเตือนผู้บริหารใช้เวลานานกว่าปกติ";
    case "line_delivery_failed":
      return "ส่ง LINE executive notification ไม่สำเร็จ";
    case "worker_tick_failed":
      return "Worker tick ล้มเหลวต่อเนื่อง";
    case "heartbeat_stale":
      return "Worker heartbeat หายหรือเกิน SLA";
    default:
      return "จำลอง incident notice";
  }
}

function validateManualNotificationSchedule(input: {
  rule: NotificationRuleRecord;
  scheduledLocalDate?: string;
  scheduledLocalTime?: string;
}):
  | {
      ok: true;
      scheduledLocalDate?: string;
      scheduledLocalTime?: string;
    }
  | { ok: false; error: string } {
  if (!input.scheduledLocalDate && !input.scheduledLocalTime) {
    return { ok: true };
  }
  if (!input.scheduledLocalDate || !input.scheduledLocalTime) {
    return {
      ok: false,
      error: "กรุณาระบุวันที่รอบแจ้งเตือนและเวลาแจ้งเตือนให้ครบ",
    };
  }

  const isoWeekday = isoWeekdayFromYmd(input.scheduledLocalDate);
  const allowed = input.rule.schedule.some(
    (entry) =>
      entry.weekdays.includes(isoWeekday) &&
      entry.times.includes(input.scheduledLocalTime!),
  );
  if (!allowed) {
    return {
      ok: false,
      error:
        "รอบที่เลือกไม่อยู่ในตารางแจ้งเตือนของแผนนี้ กรุณาเลือกวันที่และเวลาที่อยู่ใน schedule",
    };
  }

  return {
    ok: true,
    scheduledLocalDate: input.scheduledLocalDate,
    scheduledLocalTime: input.scheduledLocalTime,
  };
}

async function runNotificationReportWithPolicy(input: {
  tenant: Tenant;
  tenantId: TenantId;
  reportKey: ReportKey;
  params: SalesGoodsServicesParams;
  requestAction: string;
  heavyReportFallbackEnabled: boolean;
}) {
  const policy = getReportExecutionPolicy(input.reportKey);
  const shouldUseChunked =
    policy.mode === "fresh_first_with_reference_fallback" &&
    shouldUseChunkedHeavyReport(input.tenant, input.reportKey);
  const runner = shouldUseChunked
    ? () =>
        runAndPersistChunkedHeavyReportNow({
          tenantId: input.tenantId,
          reportKey: input.reportKey as ChunkedHeavyReportKey,
          params: input.params,
          requestAction: input.requestAction,
          workerId: "notification_chunked_report",
        })
    : () => runAndPersistReportByKey(input);

  if (
    !shouldUseChunked &&
    (!input.heavyReportFallbackEnabled ||
      policy.mode !== "fresh_first_with_reference_fallback")
  ) {
    return {
      result: await runner(),
      coalesced: false,
      policy,
    };
  }

  const coalesced = await notificationHeavyReportCoalescer.run({
    tenantId: input.tenantId,
    reportKey: input.reportKey,
    params: input.params,
    runner,
  });

  return {
    result: coalesced.value,
    coalesced: coalesced.coalesced,
    policy,
  };
}

async function runNotificationRuleReportWithPolicy(input: {
  tenant: Tenant;
  tenantId: TenantId;
  reportKey: ReportKey;
  params: SalesGoodsServicesParams;
  requestAction: string;
  heavyReportFallbackEnabled: boolean;
}): Promise<
  | {
      status: "ready";
      result: Awaited<ReturnType<typeof runAndPersistReportByKey>>;
      coalesced: boolean;
      policy: ReturnType<typeof getReportExecutionPolicy>;
    }
  | {
      status: "waiting";
      runRecord: ReportRunRecord | null;
      activeRun: ReportRunRecord | null;
      coalesced: boolean;
      policy: ReturnType<typeof getReportExecutionPolicy>;
      safeErrorMessage: string | null;
    }
> {
  const policy = getReportExecutionPolicy(input.reportKey);
  const shouldUseChunked =
    policy.mode === "fresh_first_with_reference_fallback" &&
    shouldUseChunkedHeavyReport(input.tenant, input.reportKey);

  if (!shouldUseChunked) {
    const ready = await runNotificationReportWithPolicy(input);
    return {
      status: "ready",
      ...ready,
    };
  }

  const chunked = await runOrWaitChunkedNotificationReport({
    tenantId: input.tenantId,
    reportKey: input.reportKey as ChunkedHeavyReportKey,
    params: input.params,
    requestAction: input.requestAction,
  });

  if (chunked.status === "waiting") {
    return {
      status: "waiting",
      runRecord: chunked.runRecord,
      activeRun: chunked.activeRun,
      coalesced: chunked.duplicate,
      policy,
      safeErrorMessage: chunked.safeErrorMessage,
    };
  }

  return {
    status: "ready",
    result: chunked.result,
    coalesced: chunked.duplicate,
    policy,
  };
}

function buildFreshNotificationReportResult(input: {
  reportKey: ReportKey;
  runRecord: ReportRunRecord;
  snapshot: ReportSnapshot;
  durationMs: number;
}): NotificationReportResult {
  return {
    report_key: input.reportKey,
    status: "success",
    freshness: "fresh",
    run_id: input.runRecord.id,
    snapshot_generated_at: input.snapshot.generated_at,
    duration_ms: Math.max(0, Math.round(input.durationMs)),
    row_count: input.runRecord.row_count,
    degraded_reason: null,
  };
}

function buildFailedNotificationReportResult(input: {
  reportKey: ReportKey;
  runRecord: ReportRunRecord;
  durationMs: number;
  degradedReason?: string | null;
}): NotificationReportResult {
  return {
    report_key: input.reportKey,
    status: "failed",
    freshness: "unavailable",
    run_id: input.runRecord.id,
    snapshot_generated_at: null,
    duration_ms: Math.max(0, Math.round(input.durationMs)),
    row_count: input.runRecord.row_count,
    degraded_reason: input.degradedReason ?? null,
  };
}

function buildDegradedNotificationReportResult(input: {
  reportKey: ReportKey;
  failedRunId: string;
  fallback: StockBalanceFallbackSnapshot | ArCustomerMovementFallbackSnapshot | null;
  degradedReason: string;
  durationMs?: number | null;
}): NotificationReportResult {
  const snapshot = input.fallback?.snapshot ?? null;
  return {
    report_key: input.reportKey,
    status: "success_with_warning",
    freshness: snapshot ? "reference" : "unavailable",
    run_id: snapshot?.run_id ?? input.failedRunId,
    snapshot_generated_at: snapshot?.generated_at ?? null,
    duration_ms:
      typeof input.durationMs === "number"
        ? Math.max(0, Math.round(input.durationMs))
        : null,
    row_count: snapshot ? getSnapshotRowCount(snapshot) : null,
    degraded_reason: input.degradedReason,
  };
}

function getSnapshotRowCount(snapshot: ReportSnapshot) {
  switch (snapshot.report_key) {
    case "stock_balance":
      return snapshot.summary.sku_count;
    case "stock_reorder":
      return snapshot.summary.reorder_count;
    case "ar_customer_movement":
    case "cash_bank_receipts":
    case "cash_bank_payments":
      return snapshot.summary.document_count;
    case "ar_debt_receipt":
      return snapshot.summary.receipt_count;
    case "gross_profit_by_product":
    case "gross_profit_by_ar_customer":
      return snapshot.summary.row_count;
    case "sales_goods_services":
    case "purchase_goods_payables":
      return snapshot.summary.document_count + snapshot.summary.line_count;
  }
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

type NotificationRuleValidationDetail = {
  target_id?: string;
  report_key?: ReportKey;
  reason: string;
  message: string;
};

function isLineChannelSendReady(channel: LineChannelRecord) {
  return channel.enabled && channel.channel_access_token_configured;
}

function resolveLineTargetDeliveryReadiness(input: {
  lineChannels: LineChannelRecord[];
  target: Pick<StoredLineTargetRecord, "line_channel_id">;
}):
  | { ok: true }
  | { ok: false; reason: string; message: string } {
  if (input.target.line_channel_id) {
    const preferredChannel = input.lineChannels.find(
      (channel) => channel.id === input.target.line_channel_id,
    );
    if (!preferredChannel) {
      return {
        ok: false,
        reason: "line_channel_missing",
        message: "LINE OA ที่ผูกกับผู้รับนี้ไม่อยู่ในร้านหรือถูกลบแล้ว",
      };
    }
    if (!preferredChannel.enabled) {
      return {
        ok: false,
        reason: "line_channel_disabled",
        message: "LINE OA ที่ผูกกับผู้รับนี้ถูกปิดใช้งาน",
      };
    }
    if (!preferredChannel.channel_access_token_configured) {
      return {
        ok: false,
        reason: "line_channel_token_missing",
        message:
          "LINE OA ที่ผูกกับผู้รับนี้ยังไม่มี access token สำหรับส่งจริง",
      };
    }
    return { ok: true };
  }

  if (!input.lineChannels.some(isLineChannelSendReady)) {
    return {
      ok: false,
      reason: "line_channel_token_missing",
      message: "ยังไม่มี LINE OA ที่มี access token สำหรับส่งจริง",
    };
  }
  return { ok: true };
}

async function validateNotificationRuleSendReadiness(
  rule: NotificationRuleRecord,
) {
  return validateNotificationRulePayload({
    tenant_id: rule.tenant_id,
    name: rule.name,
    enabled: true,
    timezone: rule.timezone,
    period_preset: rule.period_preset,
    period_strategy: rule.period_strategy,
    schedule: rule.schedule,
    report_keys: rule.report_keys,
    target_ids: rule.target_ids,
  });
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
      details: NotificationRuleValidationDetail[];
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

  const details: NotificationRuleValidationDetail[] = [];
  const lineChannels = input.enabled
    ? await listEffectiveLineChannels(input.tenant_id)
    : [];
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
    if (!lineChannels.some(isLineChannelSendReady)) {
      details.push({
        reason: "line_channel_token_missing",
        message: "ยังไม่มี LINE OA ที่มี access token สำหรับส่งจริง",
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
    if (input.enabled) {
      const deliveryReadiness = resolveLineTargetDeliveryReadiness({
        lineChannels,
        target,
      });
      if (!deliveryReadiness.ok) {
        details.push({
          target_id: targetId,
          reason: deliveryReadiness.reason,
          message: deliveryReadiness.message,
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

function toOwnerReportRunSummary(run: ReportRunRecord) {
  return {
    id: run.id,
    tenant_id: run.tenant_id,
    report_key: run.report_key,
    params: run.params,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at,
    row_count: run.row_count,
    safe_error_message: run.safe_error_message,
    queued_at: run.queued_at ?? null,
    claimed_at: run.claimed_at ?? null,
    worker_id: run.worker_id ?? null,
    execution_strategy: run.execution_strategy ?? null,
    progress_stage: run.progress_stage ?? null,
    progress_percent: run.progress_percent ?? null,
    progress_updated_at: run.progress_updated_at ?? null,
    failure_kind: run.failure_kind ?? null,
    failure_phase: run.failure_phase ?? null,
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
    business_signal_thresholds: productBusinessSignalThresholds,
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

  const runningRuns = notificationRuns.filter(
    (run) => run.status === "queued" || run.status === "running",
  );
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
  return uniqueReportKeysInOrder(reportKeys);
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
      [
        "sales_goods_services",
        "purchase_goods_payables",
        "gross_profit_by_product",
        "gross_profit_by_ar_customer",
        "stock_balance",
        "stock_reorder",
      ],
      [
        "sales_goods_services",
        "purchase_goods_payables",
        "gross_profit_by_product",
        "gross_profit_by_ar_customer",
        "stock_balance",
        "stock_reorder",
        "ar_customer_movement",
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
      target.allowed_actions.includes("receive_morning_brief") &&
      resolveLineTargetDeliveryReadiness({ lineChannels, target }).ok,
  );
  const access = tenantAccessStatus(tenant);
  const customerDashboardSlug = getTenantSlug(tenant.id);

  const summary = {
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
  const setupReadinessChecks = buildStoreSetupReadinessChecks({
    summary,
    datasource,
    lineChannels,
    lineTargets: lineTargets.map(toSafeLineTargetRecord),
    notificationRules,
    runs,
  });

  return {
    ...summary,
    setup_readiness: summarizeStoreSetupReadiness(setupReadinessChecks),
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
    notificationRuns,
    deliveries,
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
      systemStore.listNotificationRuleRuns({ tenantId, limit: 50 }),
      systemStore.listLineDeliveries(tenantId),
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
  const proofStrip = deriveProductionProofStrip({
    tenant_id: tenantId,
    eligible:
      summary.tenant.status === "active" &&
      summary.health.datasource_configured &&
      summary.health.line_targets_enabled > 0,
    runs: notificationRuns.map((run) => ({
      tenant_id: run.tenant_id,
      status: run.status,
      source: run.source ?? null,
      mode: run.mode ?? null,
      started_at: run.started_at ?? null,
      finished_at: run.finished_at ?? null,
    })),
    deliveries: deliveries.map((delivery) => ({
      tenant_id: delivery.tenant_id,
      status: delivery.status,
      delivery_type: delivery.delivery_type ?? null,
      sent_at: delivery.sent_at ?? null,
      created_at: delivery.created_at ?? null,
    })),
  });
  const latestJavaWsFailureRun = runs.find(
    (run) =>
      run.status === "failed" && run.failure_phase && run.failure_kind,
  );

  return {
    summary,
    datasource,
    line_channels: lineChannels,
    line_targets: safeTargets,
    notification_rules: notificationRules.map(toOwnerNotificationRule),
    business_signals: businessSignals,
    readiness: summarizeStoreSetupReadiness(checks),
    proof_strip: proofStrip,
    latest_javaws_failure: latestJavaWsFailureRun
      ? {
          report_key: latestJavaWsFailureRun.report_key,
          failure_kind: latestJavaWsFailureRun.failure_kind ?? null,
          failure_phase: latestJavaWsFailureRun.failure_phase ?? null,
          finished_at: latestJavaWsFailureRun.finished_at ?? null,
          safe_error_message: latestJavaWsFailureRun.safe_error_message ?? null,
        }
      : null,
  };
}

function buildStoreSetupReadinessChecks(input: {
  summary: {
    access: ReturnType<typeof tenantAccessStatus>;
    tenant: {
      id: TenantId;
    };
  };
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
      target.allowed_actions.includes("receive_morning_brief") &&
      resolveLineTargetDeliveryReadiness({
        lineChannels: input.lineChannels,
        target,
      }).ok,
  );
  const sendReadyLineChannels = input.lineChannels.filter(isLineChannelSendReady);

  return [
    {
      key: "store_active",
      ok: input.summary.access.enabled,
      label: "เปิดใช้งานร้าน",
      detail: input.summary.access.message,
      href: `/owner-v2/stores/${encodeURIComponent(input.summary.tenant.id)}?tab=advanced`,
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
      href: `/owner/reports?tenant=${encodeURIComponent(
        input.summary.tenant.id,
      )}`,
    },
    {
      key: "line_channel",
      ok: sendReadyLineChannels.length > 0,
      label: "มี LINE OA",
      detail: input.lineChannels.length
        ? `${sendReadyLineChannels.length}/${input.lineChannels.length} LINE OA มี token พร้อมส่งจริง`
        : "ใช้ LINE OA กลางหรือเพิ่ม LINE OA ของร้าน แล้วบันทึก access token",
      href: `/owner/line?tenant=${encodeURIComponent(input.summary.tenant.id)}`,
    },
    {
      key: "line_target",
      ok: enabledTargets.length > 0,
      label: "มีผู้รับแจ้งเตือน",
      detail: `${enabledTargets.length}/${input.lineTargets.length} ผู้รับเปิดรับรายงาน`,
      href: `/owner/line?tenant=${encodeURIComponent(input.summary.tenant.id)}`,
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

function summarizeStoreSetupReadiness(
  checks: ReturnType<typeof buildStoreSetupReadinessChecks>,
) {
  const completed = checks.filter((check) => check.ok).length;

  return {
    ready: completed === checks.length,
    completed,
    total: checks.length,
    next_action: checks.find((check) => !check.ok) ?? null,
    checks,
  };
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

function resolveOwnerWorkbenchTenantId(input: {
  requestedTenantId?: TenantId;
  tenants: Tenant[];
}) {
  if (
    input.requestedTenantId &&
    input.tenants.some((tenant) => tenant.id === input.requestedTenantId)
  ) {
    return input.requestedTenantId;
  }

  return (
    input.tenants.find((tenant) => tenant.status !== "cancelled")?.id ??
    input.tenants[0]?.id ??
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

function isoWeekdayFromYmd(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();
  return dayOfWeek === 0 ? 7 : dayOfWeek;
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
    tenantName: (await getTenantOrNull(input.access.tenantId))?.name,
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
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
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

const reportRunProgressParamsSchema = z.object({
  tenantId: tenantIdSchema,
  runId: z.string().min(1).max(220),
});

const asyncReportRunBodySchema = z
  .object({
    date_from: isoDateSchema,
    date_to: isoDateSchema,
    time_from: localTimeSchema.optional(),
    time_to: localTimeSchema.optional(),
    force: z.coerce.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const parsed = salesGoodsServicesParamsSchema.safeParse({
      date_from: value.date_from,
      date_to: value.date_to,
      time_from: value.time_from,
      time_to: value.time_to,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue(issue);
      }
    }
  });

const signedViewerAuthSchema = z.object({
  token: z.string().min(1).max(4096),
  run_id: z.string().min(1).max(180),
});

const executiveDashboardRunParamsSchema = z.object({
  tenantId: tenantIdSchema,
  runId: z.string().min(1).max(220),
});

const executiveDashboardRunCreateSchema = z.object({
  dashboard_token: z.string().min(1).max(4096),
  date_from: isoDateSchema,
  date_to: isoDateSchema,
  client_request_id: z.string().trim().min(1).max(120).optional(),
});

const executiveDashboardRunQuerySchema = z.object({
  dashboard_token: z.string().min(1).max(4096),
});

const reportRunWorkerTickSchema = z.object({
  worker_id: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  now: z.string().datetime().optional(),
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
  report_keys: z.array(reportKeySchema).min(1).max(reportKeyValues.length).optional(),
  target_ids: z.array(z.string().trim().min(1).max(180)).max(50).optional(),
});

const notificationRuleExecuteSchema = z.object({
  mode: z.enum(["dry_run", "send"]).optional(),
  scheduled_local_date: isoDateSchema.optional(),
  scheduled_local_time: localTimeSchema.optional(),
  client_request_id: z.string().trim().min(1).max(120).optional(),
}).superRefine((value, ctx) => {
  if (Boolean(value.scheduled_local_date) !== Boolean(value.scheduled_local_time)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "scheduled_local_date and scheduled_local_time must be provided together",
      path: value.scheduled_local_date
        ? ["scheduled_local_time"]
        : ["scheduled_local_date"],
    });
  }
});

const notificationRuleTickSchema = z.object({
  mode: z.enum(["dry_run", "send"]).optional(),
  now: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  catch_up_minutes: z.coerce.number().int().min(0).max(60).optional(),
  worker_id: z.string().trim().min(1).max(120).optional(),
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

function validateTenantNoteSafety(description: string | undefined) {
  const hints = findSensitiveTenantNoteHints(description ?? "");
  if (!hints.length) {
    return { ok: true as const };
  }

  return {
    ok: false as const,
    response: {
      error:
        "Tenant note appears to contain token/password/secret data. Remove sensitive data and save secrets only in encrypted setup pages.",
      details: {
        description: [
          "Remove token/password/secret-like content from note before saving.",
        ],
      },
      sensitive_hints: hints,
    },
  };
}

const billingCycleSchema = z.enum(["monthly", "yearly", "one_time"]);

const ownerTenantCreateSchema = z.object({
  tenant_id: tenantIdSchema,
  name: z.string().trim().min(2).max(120),
  database_name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
  status: tenantStatusSchema.default("trial"),
  plan_code: planCodeSchema.default("starter"),
  current_period_end: z.string().datetime().nullable().optional(),
  billing_cycle: billingCycleSchema.nullable().optional(),
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
  billing_cycle: billingCycleSchema.nullable().optional(),
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

const telegramSecretUpdateSchema = z.object({
  bot_token: z.string().trim().min(20).max(4096),
});

const telegramTargetCreateSchema = z.object({
  chat_id: z.string().trim().min(1).max(128),
  display_name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional().default(true),
});

const telegramTestAlertSchema = z.object({
  message: z.string().trim().max(500).optional(),
});

const operationalAlertSeveritySchema = z.enum(["info", "warning", "critical"]);

const operationalAlertSmokeTestSchema = z.object({
  alert_type: z
    .enum([
      "incident_dry_run",
      "javaws_diagnostic",
      "heavy_report_slow",
      "notification_summary",
      "notification_run_slow",
      "line_delivery_failed",
      "worker_tick_failed",
      "heartbeat_stale",
    ])
    .default("incident_dry_run"),
  severity: operationalAlertSeveritySchema.default("warning"),
  tenant_id: tenantIdSchema.optional(),
  scheduled_date: isoDateSchema.optional(),
  scheduled_time: localTimeSchema.optional(),
  report_key: reportKeySchema.optional(),
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

const flowAccountConfigUpdateSchema = z.object({
  environment: z.literal("sandbox"),
  auth_mode: z.literal("client_credentials"),
  client_id: z.string().trim().min(1).max(512),
  client_secret: z.string().trim().min(1).max(2048),
});

const aiCeoItemStatusUpdateSchema = z.object({
  status: aiCeoAdvisorItemStatusSchema,
});

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
