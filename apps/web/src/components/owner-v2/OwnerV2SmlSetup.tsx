"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { AlertIcon, CheckCircleIcon, InfoIcon } from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import type {
  OwnerV2DatasourceStatus,
  OwnerV2DatasourceTestResult,
  OwnerV2JavaWsDatabaseDiscoveryResult,
  OwnerV2SmlSetupPayload,
} from "./types";

type JavaWsAuthMode = "none" | "basic" | "bearer";

type SmlFormState = {
  baseUrl: string;
  webappPath: string;
  configFileName: string;
  database: string;
  authMode: JavaWsAuthMode;
  authUsername: string;
  authSecret: string;
};

type SmlState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "success";
      config: OwnerV2DatasourceStatus;
      setup: OwnerV2SmlSetupPayload;
    };

export default function OwnerV2SmlSetup({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<SmlState>({ status: "loading" });
  const [form, setForm] = useState<SmlFormState>(emptyForm());
  const [initialForm, setInitialForm] = useState<SmlFormState>(emptyForm());
  const [busy, setBusy] = useState<
    "save" | "test-saved" | "test-draft" | "discover" | null
  >(null);
  const [testResult, setTestResult] =
    useState<OwnerV2DatasourceTestResult | null>(null);
  const [discovery, setDiscovery] =
    useState<OwnerV2JavaWsDatabaseDiscoveryResult | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "warning" | "error";
    text: string;
  } | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      setMessage(null);
      try {
        const [config, setup] = await Promise.all([
          ownerV2Fetch<OwnerV2DatasourceStatus>(
            `/api/owner/tenants/${encodeURIComponent(
              tenantId,
            )}/datasource/config`,
            { signal },
          ),
          ownerV2Fetch<OwnerV2SmlSetupPayload>(
            `/api/owner/tenants/${encodeURIComponent(tenantId)}/sml-setup`,
            { signal },
          ),
        ]);
        if (signal?.aborted) {
          return;
        }
        const nextForm = formFromConfig(config);
        setState({ status: "success", config, setup });
        setForm(nextForm);
        setInitialForm(nextForm);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดการเชื่อม SML ไม่สำเร็จ",
        });
      }
    },
    [tenantId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const validation = useMemo(() => validateDraft(form, true), [form]);
  const discoveryValidation = useMemo(() => validateDraft(form, false), [form]);
  const dirty =
    JSON.stringify(formForCompare(form)) !==
    JSON.stringify(formForCompare(initialForm));
  const canUseSavedConfig =
    state.status === "success" && state.config.kind === "sml_javaws";
  const saveDisabled =
    busy !== null ||
    state.status !== "success" ||
    !state.config.encryption_configured ||
    !validation.ok ||
    !dirty;
  const draftTestDisabled =
    busy !== null || state.status !== "success" || !validation.ok;
  const savedTestDisabled = busy !== null || !canUseSavedConfig;
  const discoverDisabled =
    busy !== null || state.status !== "success" || !discoveryValidation.ok;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveDisabled) {
      setMessage({
        tone: "warning",
        text:
          state.status === "success" && !state.config.encryption_configured
            ? "ยังไม่มี encryption key จึงบันทึก secret ไม่ได้"
            : validation.ok
              ? "ยังไม่มีข้อมูลที่เปลี่ยน"
              : `กรอกข้อมูลให้ครบ: ${validation.missing.join(", ")}`,
      });
      return;
    }
    setBusy("save");
    setMessage(null);
    try {
      const config = await ownerV2Fetch<OwnerV2DatasourceStatus>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/datasource/config`,
        {
          method: "PUT",
          body: buildDatasourcePayload(form),
        },
      );
      setMessage({
        tone: "success",
        text: "บันทึก SML JavaWS แล้ว กดทดสอบค่าที่บันทึกเพื่อยืนยันก่อนเปิดแจ้งเตือน",
      });
      setTestResult(null);
      setDiscovery(null);
      const nextForm = formFromConfig(config);
      setForm(nextForm);
      setInitialForm(nextForm);
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "บันทึก SML JavaWS ไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  async function testSaved() {
    if (savedTestDisabled) {
      return;
    }
    await runTest("test-saved");
  }

  async function testDraft() {
    if (draftTestDisabled) {
      setMessage({
        tone: "warning",
        text: validation.ok
          ? "ยังทดสอบฟอร์มไม่ได้"
          : `กรอกข้อมูลให้ครบ: ${validation.missing.join(", ")}`,
      });
      return;
    }
    await runTest("test-draft", buildDatasourcePayload(form));
  }

  async function runTest(
    mode: "test-saved" | "test-draft",
    body?: ReturnType<typeof buildDatasourcePayload>,
  ) {
    setBusy(mode);
    setMessage(null);
    try {
      const result = await ownerV2Fetch<OwnerV2DatasourceTestResult>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/datasource/test`,
        body ? { method: "POST", body } : { method: "POST" },
      );
      setTestResult(result);
      setMessage({
        tone: result.ok ? "success" : "warning",
        text: result.ok
          ? `ทดสอบ SML ผ่าน ${result.latency_ms} ms`
          : result.safe_error_message ?? "ทดสอบ SML ไม่ผ่าน",
      });
    } catch (error) {
      const details = (error as Error & { details?: unknown }).details;
      setTestResult(null);
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : `ทดสอบ SML ไม่สำเร็จ ${JSON.stringify(details ?? {})}`,
      });
    } finally {
      setBusy(null);
    }
  }

  async function discoverDatabases() {
    if (discoverDisabled) {
      setMessage({
        tone: "warning",
        text: discoveryValidation.ok
          ? "ยังค้นหา database ไม่ได้"
          : `กรอกข้อมูลให้ครบ: ${discoveryValidation.missing.join(", ")}`,
      });
      return;
    }
    setBusy("discover");
    setMessage(null);
    try {
      const result = await ownerV2Fetch<OwnerV2JavaWsDatabaseDiscoveryResult>(
        `/api/owner/tenants/${encodeURIComponent(
          tenantId,
        )}/datasource/javaws/databases`,
        {
          method: "POST",
          body: buildDiscoveryPayload(form),
        },
      );
      setDiscovery(result);
      setMessage({
        tone: result.ok ? "success" : "warning",
        text: result.ok
          ? `พบ ${result.databases.length.toLocaleString("th-TH")} database`
          : result.safe_error_message ?? "ค้นหา database ไม่สำเร็จ",
      });
    } catch (error) {
      setDiscovery(null);
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "ค้นหา database ไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "loading") {
    return <SmlSkeleton />;
  }

  if (state.status === "error") {
    return (
      <Panel>
        <PanelBody>
          <Notice
            tone="error"
            title="โหลด SML ไม่สำเร็จ"
            text={`${state.message} ลองรีเฟรชหน้านี้ หรือตรวจ session ผู้ดูแล`}
          />
          <Button
            className="mt-4"
            onClick={() => void load()}
            size="sm"
            type="button"
          >
            รีเฟรช SML
          </Button>
        </PanelBody>
      </Panel>
    );
  }

  const { config, setup } = state;

  return (
    <div className="space-y-5 sm:space-y-6">
      {message ? (
        <Notice tone={message.tone} title="สถานะ SML" text={message.text} />
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel>
          <PanelHeader
            action={
              <Badge color={config.kind === "sml_javaws" ? "success" : "warning"}>
                {formatDatasourceSource(config.source)}
              </Badge>
            }
            title="SML JavaWS"
          />
          <PanelBody>
            <form className="space-y-5" onSubmit={save}>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Field label="Tomcat URL" help="เช่น http://host:port">
                  <input
                    className="owner-v2-input"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        baseUrl: event.target.value,
                      }))
                    }
                    placeholder="http://127.0.0.1:8080"
                    value={form.baseUrl}
                  />
                </Field>
                <Field label="SMLConfig file">
                  <input
                    className="owner-v2-input"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        configFileName: event.target.value,
                      }))
                    }
                    placeholder="SMLConfigDATA.xml"
                    value={form.configFileName}
                  />
                </Field>
                <Field label="Database">
                  <input
                    className="owner-v2-input"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        database: event.target.value,
                      }))
                    }
                    placeholder="sml1_2026"
                    value={form.database}
                  />
                </Field>
                <Field label="Webapp path">
                  <input
                    className="owner-v2-input"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        webappPath: event.target.value,
                      }))
                    }
                    placeholder="/SMLJavaWebService"
                    value={form.webappPath}
                  />
                </Field>
              </div>

              <div className="space-y-4 border-t border-gray-100 pt-5 dark:border-gray-800">
                <div>
                  <h4 className="text-sm font-medium text-gray-800 dark:text-white/90">
                    Auth หลัง reverse proxy
                  </h4>
                  <p className="mt-1 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
                    ใช้เฉพาะกรณีมี proxy หรือ gateway ครอบ JavaWS อยู่ด้านหน้า
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                  <Field label="Mode">
                    <select
                      className="owner-v2-input"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          authMode: event.target.value as JavaWsAuthMode,
                          authSecret: "",
                        }))
                      }
                      value={form.authMode}
                    >
                      <option value="none">ไม่ใช้ auth</option>
                      <option value="basic">Basic auth</option>
                      <option value="bearer">Bearer token</option>
                    </select>
                  </Field>
                  {form.authMode === "basic" ? (
                    <Field label="Auth username">
                      <input
                        className="owner-v2-input"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            authUsername: event.target.value,
                          }))
                        }
                        placeholder="proxy-user"
                        value={form.authUsername}
                      />
                    </Field>
                  ) : null}
                  {form.authMode !== "none" ? (
                    <Field
                      label={
                        form.authMode === "basic"
                          ? "Auth password"
                          : "Bearer token"
                      }
                      help={
                        config.auth_configured
                          ? "กรอก secret ใหม่เมื่อต้องทดสอบหรือบันทึกจากฟอร์ม"
                          : "secret จะถูกเข้ารหัสฝั่ง server"
                      }
                    >
                      <input
                        className="owner-v2-input"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            authSecret: event.target.value,
                          }))
                        }
                        placeholder={
                          config.auth_configured
                            ? "กรอก secret อีกครั้ง"
                            : "ใส่ secret"
                        }
                        type="password"
                        value={form.authSecret}
                      />
                    </Field>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-gray-100 pt-5 sm:flex-row sm:flex-wrap sm:items-center dark:border-gray-800">
                <Button
                  className="w-full sm:w-auto"
                  disabled={saveDisabled}
                  size="sm"
                  type="submit"
                >
                  {busy === "save" ? "กำลังบันทึก..." : "บันทึก SML"}
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  disabled={savedTestDisabled}
                  onClick={() => void testSaved()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {busy === "test-saved" ? "กำลังทดสอบ..." : "ทดสอบค่าที่บันทึก"}
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  disabled={draftTestDisabled}
                  onClick={() => void testDraft()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {busy === "test-draft" ? "กำลังทดสอบ..." : "ทดสอบฟอร์มนี้"}
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  disabled={discoverDisabled}
                  onClick={() => void discoverDatabases()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {busy === "discover" ? "กำลังค้นหา..." : "ค้นหา database"}
                </Button>
              </div>

              {!config.encryption_configured ? (
                <Notice
                  tone="warning"
                  title="ยังบันทึก secret ไม่ได้"
                  text="เพิ่ม secret_key ใน bootstrap config ก่อนบันทึก SML JavaWS"
                />
              ) : null}
              {!validation.ok ? (
                <Notice
                  tone="warning"
                  title="ข้อมูลยังไม่ครบ"
                  text={`กรอก: ${validation.missing.join(", ")}`}
                />
              ) : null}
            </form>
          </PanelBody>
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="สถานะปัจจุบัน" />
            <PanelBody>
              <div className="grid grid-cols-1 gap-3">
                <Fact
                  label="Datasource"
                  tone={config.kind === "sml_javaws" ? "success" : "warning"}
                  value={
                    config.kind === "sml_javaws"
                      ? config.database ?? "ตั้งค่าแล้ว"
                      : "ยังไม่ตั้งค่า"
                  }
                />
                <Fact
                  label="SMLConfig"
                  value={config.config_file_name ?? "ยังไม่ระบุ"}
                />
                <Fact
                  label="Auth"
                  tone={config.auth_configured ? "success" : "warning"}
                  value={
                    config.auth_mode
                      ? `${config.auth_mode} · ${
                          config.auth_configured ? "พร้อม" : "ยังไม่พร้อม"
                        }`
                      : "ยังไม่ตั้ง"
                  }
                />
                <Fact
                  label="อัปเดตล่าสุด"
                  value={formatDateTime(config.updated_at)}
                />
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="รายงานล่าสุด" />
            <PanelBody>
              {setup.latest_report_run ? (
                <div className="space-y-3">
                  <Fact
                    label={setup.latest_report_run.report_key}
                    tone={
                      setup.latest_report_run.status === "success"
                        ? "success"
                        : "warning"
                    }
                    value={`${formatRunStatus(
                      setup.latest_report_run.status,
                    )} · ${setup.latest_report_run.row_count.toLocaleString(
                      "th-TH",
                    )} rows`}
                  />
                  {setup.latest_report_run.safe_error_message ? (
                    <Notice
                      tone="warning"
                      title="error ล่าสุด"
                      text={setup.latest_report_run.safe_error_message}
                    />
                  ) : null}
                </div>
              ) : (
                <Notice
                  tone="warning"
                  title="ยังไม่มี report run"
                  text="บันทึกและทดสอบ SML ก่อน แล้วค่อยรันรายงานทดสอบ"
                />
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>

      {discovery ? (
        <Panel>
          <PanelHeader
            action={
              <Badge color={discovery.ok ? "success" : "warning"}>
                {discovery.latency_ms} ms
              </Badge>
            }
            title="ผลค้นหา database"
          />
          <PanelBody>
            {discovery.safe_error_message ? (
              <Notice
                tone="warning"
                title="ค้นหาไม่สมบูรณ์"
                text={discovery.safe_error_message}
              />
            ) : null}
            {discovery.databases.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {discovery.databases.slice(0, 12).map((database) => (
                  <button
                    className="min-w-0 max-w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-theme-xs font-medium text-gray-700 shadow-theme-xs transition hover:border-brand-300 hover:text-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                    key={`${database.database_name}-${database.code}`}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        database: database.database_name,
                      }))
                    }
                    type="button"
                  >
                    <span className="block truncate">{database.database_name}</span>
                  </button>
                ))}
                {discovery.databases.length > 12 ? (
                  <span className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400">
                    +{(discovery.databases.length - 12).toLocaleString("th-TH")}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                ไม่พบ database จาก JavaWS รอบนี้
              </p>
            )}
          </PanelBody>
        </Panel>
      ) : null}

      {testResult ? (
        <Panel>
          <PanelHeader
            action={
              <Badge color={testResult.ok ? "success" : "error"}>
                {testResult.ok ? "ผ่าน" : "ไม่ผ่าน"}
              </Badge>
            }
            title="ผลทดสอบ SML"
          />
          <PanelBody>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Fact label="Latency" value={`${testResult.latency_ms} ms`} />
              <Fact
                label="Database"
                value={testResult.database_name ?? "ยังไม่ทราบ"}
              />
              <Fact
                label="ตรวจเมื่อ"
                value={formatDateTime(testResult.checked_at)}
              />
              <Fact
                label="Required tables"
                tone={
                  Object.values(testResult.required_tables).every(Boolean)
                    ? "success"
                    : "warning"
                }
                value={`${Object.values(testResult.required_tables).filter(Boolean).length}/5 พร้อม`}
              />
            </div>
            {testResult.safe_error_message ? (
              <Notice
                tone="warning"
                title="ข้อความจากระบบ"
                text={testResult.safe_error_message}
              />
            ) : null}
          </PanelBody>
        </Panel>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Link
          className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200"
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}`}
        >
          กลับข้อมูลร้าน
        </Link>
        <Link
          className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-theme-xs transition hover:bg-brand-600"
          href={`/owner-v2?tenant=${encodeURIComponent(tenantId)}&step=reports`}
        >
          ไปทดสอบรายงาน
        </Link>
      </div>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      {children}
    </section>
  );
}

function PanelHeader({
  action,
  title,
}: {
  action?: ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
      <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
        {title}
      </h3>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function PanelBody({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-5 border-t border-gray-100 p-5 sm:p-6 dark:border-gray-800">
      {children}
    </div>
  );
}

function Field({
  children,
  help,
  label,
}: {
  children: ReactNode;
  help?: string;
  label: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
        {label}
      </span>
      {children}
      {help ? (
        <span className="mt-1.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">
          {help}
        </span>
      ) : null}
    </label>
  );
}

function Fact({
  label,
  tone = "light",
  value,
}: {
  label: string;
  tone?: "success" | "warning" | "error" | "light";
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
        {tone !== "light" ? (
          <Badge color={tone} size="sm">
            {tone === "success"
              ? "ปกติ"
              : tone === "warning"
                ? "ต้องดู"
                : "ผิดพลาด"}
          </Badge>
        ) : null}
      </div>
      <p className="mt-2 break-words text-theme-sm font-medium text-gray-800 dark:text-white/90">
        {value || "-"}
      </p>
    </div>
  );
}

function Notice({
  text,
  title,
  tone,
}: {
  text: string;
  title: string;
  tone: "success" | "warning" | "error";
}) {
  const toneConfig = {
    success: {
      className:
        "border-success-500 bg-success-50 dark:border-success-500/30 dark:bg-success-500/15",
      icon: <CheckCircleIcon className="size-6 fill-current" />,
      iconClassName: "text-success-500",
    },
    warning: {
      className:
        "border-warning-500 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/15",
      icon: <InfoIcon className="size-6 fill-current" />,
      iconClassName: "text-warning-500",
    },
    error: {
      className:
        "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15",
      icon: <AlertIcon className="size-6 fill-current" />,
      iconClassName: "text-error-500",
    },
  }[tone];
  return (
    <div className={`rounded-xl border p-4 ${toneConfig.className}`}>
      <div className="flex items-start gap-3">
        <div className={`-mt-0.5 shrink-0 ${toneConfig.iconClassName}`}>
          {toneConfig.icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            {title}
          </p>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}

function SmlSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="h-[560px] animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      <div className="space-y-6">
        <div className="h-72 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
        <div className="h-48 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      </div>
    </div>
  );
}

function emptyForm(): SmlFormState {
  return {
    baseUrl: "",
    webappPath: "/SMLJavaWebService",
    configFileName: "",
    database: "",
    authMode: "none",
    authUsername: "",
    authSecret: "",
  };
}

function formFromConfig(config: OwnerV2DatasourceStatus): SmlFormState {
  return {
    baseUrl: config.base_url ?? "",
    webappPath: config.webapp_path ?? "/SMLJavaWebService",
    configFileName: config.config_file_name ?? "",
    database: config.database ?? "",
    authMode: isJavaWsAuthMode(config.auth_mode) ? config.auth_mode : "none",
    authUsername: "",
    authSecret: "",
  };
}

function formForCompare(form: SmlFormState) {
  return {
    baseUrl: form.baseUrl,
    webappPath: form.webappPath,
    configFileName: form.configFileName,
    database: form.database,
    authMode: form.authMode,
    authUsername: form.authUsername,
  };
}

function isJavaWsAuthMode(value: string | null): value is JavaWsAuthMode {
  return value === "none" || value === "basic" || value === "bearer";
}

function validateDraft(form: SmlFormState, includeDatabase: boolean) {
  const missing: string[] = [];
  if (!form.baseUrl.trim()) {
    missing.push("Tomcat URL");
  }
  if (!form.configFileName.trim()) {
    missing.push("SMLConfig file");
  }
  if (includeDatabase && !form.database.trim()) {
    missing.push("Database");
  }
  if (form.authMode === "basic" && !form.authUsername.trim()) {
    missing.push("Auth username");
  }
  if (form.authMode !== "none" && !form.authSecret.trim()) {
    missing.push(form.authMode === "basic" ? "Auth password" : "Bearer token");
  }
  return { ok: missing.length === 0, missing };
}

function buildDatasourcePayload(form: SmlFormState) {
  return {
    kind: "sml_javaws" as const,
    baseUrl: form.baseUrl.trim(),
    webappPath: form.webappPath.trim() || "/SMLJavaWebService",
    endpoint: "DotNetFrameWork" as const,
    configFileName: form.configFileName.trim(),
    database: form.database.trim(),
    queryMethod: "_queryCompress" as const,
    auth:
      form.authMode === "basic"
        ? {
            mode: "basic" as const,
            username: form.authUsername.trim(),
            password: form.authSecret,
          }
        : form.authMode === "bearer"
          ? { mode: "bearer" as const, token: form.authSecret }
          : { mode: "none" as const },
  };
}

function buildDiscoveryPayload(form: SmlFormState) {
  const payload = buildDatasourcePayload({
    ...form,
    database: form.database.trim() || "__discovery_only__",
  });
  return {
    kind: "sml_javaws" as const,
    baseUrl: payload.baseUrl,
    webappPath: payload.webappPath,
    endpoint: payload.endpoint,
    configFileName: payload.configFileName,
    auth: payload.auth,
  };
}

function formatDatasourceSource(value: string) {
  if (value === "encrypted_store") {
    return "encrypted store";
  }
  if (value === "env") {
    return "env";
  }
  return "ยังไม่ตั้ง";
}

function formatRunStatus(status?: string | null) {
  if (!status) {
    return "ยังไม่ทราบ";
  }
  const labels: Record<string, string> = {
    queued: "รอรัน",
    running: "กำลังรัน",
    success: "สำเร็จ",
    failed: "ล้มเหลว",
  };
  return labels[status] ?? status;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "ยังไม่มีเวลา";
  }
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}
