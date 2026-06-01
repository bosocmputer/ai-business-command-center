import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const DEFAULT_BOOTSTRAP_CONFIG_FILE = ".data/ai-bcc.config.json";

const bootstrapConfigSchema = z
  .object({
    system_database_url: z.string().trim().min(1).optional(),
    secret_key: z.string().trim().min(1).optional(),
    app_base_url: z.string().trim().min(1).optional(),
    public_api_base_url: z.string().trim().min(1).optional(),
    report_viewer_signing_secret: z.string().trim().min(1).optional(),
    morning_brief: z
      .object({
        enabled: z.boolean().optional(),
        tenant_ids: z.array(z.string().trim().min(1)).optional(),
        time: z.string().trim().min(1).optional(),
        timezone: z.string().trim().min(1).optional(),
        mode: z.enum(["send", "dry_run"]).optional(),
        force: z.boolean().optional(),
        api_base_url: z.string().trim().min(1).optional(),
      })
      .optional(),
    worker: z
      .object({
        heartbeat_token: z.string().trim().min(1).optional(),
        worker_id: z.string().trim().min(1).optional(),
      })
      .optional(),
    backup: z
      .object({
        configured: z.boolean().optional(),
        last_backup_at: z.string().trim().min(1).nullable().optional(),
      })
      .optional(),
  })
  .passthrough();

export type BootstrapConfig = z.infer<typeof bootstrapConfigSchema>;

export function getBootstrapConfigPath() {
  return resolve(
    process.env.AI_BCC_CONFIG_FILE?.trim() || DEFAULT_BOOTSTRAP_CONFIG_FILE,
  );
}

export function readBootstrapConfig(): BootstrapConfig {
  const path = getBootstrapConfigPath();
  if (!existsSync(path)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return bootstrapConfigSchema.parse(parsed);
}

export function readBootstrapConfigStatus() {
  const path = getBootstrapConfigPath();
  try {
    const config = readBootstrapConfig();
    return {
      path,
      exists: existsSync(path),
      system_database_configured: Boolean(
        config.system_database_url || process.env.SYSTEM_DATABASE_URL?.trim(),
      ),
      secret_key_present: Boolean(
        config.secret_key || process.env.AI_BCC_SECRET_KEY?.trim(),
      ),
      app_base_url_configured: Boolean(
        config.app_base_url || process.env.APP_BASE_URL?.trim(),
      ),
      public_api_base_url_configured: Boolean(
        config.public_api_base_url || process.env.NEXT_PUBLIC_API_BASE_URL?.trim(),
      ),
      read_error: null as string | null,
    };
  } catch (error) {
    return {
      path,
      exists: existsSync(path),
      system_database_configured: Boolean(process.env.SYSTEM_DATABASE_URL?.trim()),
      secret_key_present: Boolean(process.env.AI_BCC_SECRET_KEY?.trim()),
      app_base_url_configured: Boolean(process.env.APP_BASE_URL?.trim()),
      public_api_base_url_configured: Boolean(
        process.env.NEXT_PUBLIC_API_BASE_URL?.trim(),
      ),
      read_error:
        error instanceof Error ? error.message : "Bootstrap config is invalid.",
    };
  }
}

export function readSystemDatabaseUrl() {
  return (
    readBootstrapConfig().system_database_url?.trim() ||
    process.env.SYSTEM_DATABASE_URL?.trim() ||
    null
  );
}

export function readBootstrapSecretKey() {
  return (
    readBootstrapConfig().secret_key?.trim() ||
    process.env.AI_BCC_SECRET_KEY?.trim() ||
    null
  );
}

export function readBootstrapReportViewerSigningSecret() {
  return (
    readBootstrapConfig().report_viewer_signing_secret?.trim() ||
    process.env.REPORT_VIEWER_SIGNING_SECRET?.trim() ||
    null
  );
}

export function writeBootstrapConfigPatch(patch: BootstrapConfig) {
  const path = getBootstrapConfigPath();
  const current = readBootstrapConfig();
  const next: BootstrapConfig = {
    ...current,
    ...patch,
    morning_brief: {
      ...current.morning_brief,
      ...patch.morning_brief,
    },
    worker: {
      ...current.worker,
      ...patch.worker,
    },
    backup: {
      ...current.backup,
      ...patch.backup,
    },
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return readBootstrapConfigStatus();
}
