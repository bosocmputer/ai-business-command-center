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
            ? "ยังไม่มีกุญแจเข้ารหัส จึงบันทึกรหัสลับไม่ได้"
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
        text:
          "บันทึกค่า SML แล้ว กดทดสอบค่าที่บันทึกแล้วเพื่อยืนยันก่อนเปิดแจ้งเตือน",
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
            : "บันทึกค่า SML ไม่สำเร็จ",
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
      setTestResult(null);
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "ทดสอบ SML ไม่สำเร็จ",
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
  const actionHelp = buildActionHelp({
    busy,
    canUseSavedConfig,
    config,
    dirty,
    discoveryValidation,
    validation,
  });

  return (
    <div className="space-y-5 sm:space-y-6">
      {message ? (
        <Notice tone={message.tone} title="สถานะ SML" text={message.text} />
      ) : null}

      <SmlActionGuide
        canDiscover={discoveryValidation.ok}
        canSave={config.encryption_configured && validation.ok}
        canTestSaved={canUseSavedConfig}
        hasDatabase={Boolean(form.database.trim())}
        latestReportSucceeded={setup.latest_report_run?.status === "success"}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel>
          <PanelHeader
            action={
              <Badge color={config.kind === "sml_javaws" ? "success" : "warning"}>
                {formatDatasourceSource(config.source)}
              </Badge>
            }
            description="ตั้งค่า URL, SMLConfig และ database ของร้านนี้ แล้วทดสอบก่อนเปิดใช้รายงานหรือแจ้งเตือน"
            title="SML JavaWS"
          />
          <PanelBody>
            <form className="space-y-5" onSubmit={save}>
              <div>
                <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  ค่าสำเร็จรูป (เลือกเพื่อกรอกให้เร็ว)
                </span>
                <select
                  className="owner-v2-input"
                  onChange={(event) => {
                    const preset = SML_DATASOURCE_PRESETS.find(
                      (item) => item.id === event.target.value,
                    );
                    if (preset) {
                      setForm((current) => ({
                        ...current,
                        baseUrl: preset.baseUrl,
                        webappPath: preset.webappPath,
                        configFileName: preset.configFileName,
                        database: preset.database,
                      }));
                    }
                  }}
                  value=""
                >
                  <option value="">— เลือกค่าสำเร็จรูป —</option>
                  {SML_DATASOURCE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label} ({preset.description})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Field
                  label="URL SML JavaWS"
                  help="ใส่ URL ของ Tomcat หรือ reverse proxy ที่เข้าถึง JavaWS ได้"
                >
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
                <Field
                  label="ไฟล์ SMLConfig"
                  help="ชื่อไฟล์ config ที่ JavaWS ใช้อ่าน connection ของ SML"
                >
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
                <Field
                  label="ชื่อฐานข้อมูล SML"
                  help="ใช้ปุ่มค้นหา database เพื่อลดการพิมพ์ผิด"
                >
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
                <Field
                  label="Path JavaWS"
                  help="โดยทั่วไปใช้ค่าเดิมนี้ ยกเว้นร้านติดตั้ง path อื่น"
                >
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
                    รหัสผ่านหน้า JavaWS (ถ้ามี)
                  </h4>
                  <p className="mt-1 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
                    ใช้เฉพาะร้านที่มี proxy, gateway หรือ token ก่อนเข้า JavaWS
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                  <Field label="โหมด">
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
                    <Field label="ผู้ใช้ auth">
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
                          ? "รหัสผ่าน auth"
                          : "Bearer token"
                      }
                      help={
                        config.auth_configured
                          ? "กรอกรหัสลับใหม่เมื่อต้องทดสอบหรือบันทึกจากฟอร์ม"
                          : "รหัสลับจะถูกเข้ารหัสฝั่ง server"
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
                            ? "กรอกรหัสลับอีกครั้ง"
                            : "ใส่รหัสลับ"
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
                  disabled={discoverDisabled}
                  onClick={() => void discoverDatabases()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {busy === "discover" ? "กำลังค้นหา..." : "1 · ค้นหา database"}
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  disabled={draftTestDisabled}
                  onClick={() => void testDraft()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {busy === "test-draft" ? "กำลังทดสอบ..." : "2 · ทดสอบก่อนบันทึก"}
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  disabled={saveDisabled}
                  size="sm"
                  type="submit"
                >
                  {busy === "save" ? "กำลังบันทึก..." : "3 · บันทึก"}
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  disabled={savedTestDisabled}
                  onClick={() => void testSaved()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {busy === "test-saved" ? "กำลังทดสอบ..." : "4 · ทดสอบที่บันทึกแล้ว"}
                </Button>
                {actionHelp.length ? <ActionHelp items={actionHelp} /> : null}
              </div>

              {!config.encryption_configured ? (
                <Notice
                  tone="warning"
                  title="ยังบันทึกรหัสลับไม่ได้"
                  text="ตั้งค่ากุญแจเข้ารหัสของระบบกลางก่อนบันทึกข้อมูลที่มีรหัสลับ"
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
            <PanelHeader
              description="ดูว่าร้านนี้พร้อมใช้รายงานจาก SML แล้วหรือยัง"
              title="สถานะปัจจุบัน"
            />
            <PanelBody>
              <div className="grid grid-cols-1 gap-3">
                <Fact
                  label="การเชื่อมต่อ"
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
                  label="รหัสผ่านหน้า JavaWS"
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
            <PanelHeader
              description="ใช้ตรวจเร็วว่าการเชื่อม SML เคยสร้างรายงานสำเร็จหรือไม่"
              title="รายงานล่าสุด"
            />
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
                    )} แถว`}
                  />
                  {setup.latest_report_run.safe_error_message ? (
                    <Notice
                      tone="warning"
                      title="ปัญหารายงานล่าสุด"
                      text={setup.latest_report_run.safe_error_message}
                    />
                  ) : null}
                </div>
              ) : (
                <Notice
                  tone="warning"
                  title="ยังไม่มีผลรันรายงาน"
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
            description="เลือกชื่อ database ที่พบเพื่อเติมลงฟอร์มโดยไม่ต้องพิมพ์เอง"
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
            description="ผลนี้ใช้ยืนยันว่า JavaWS ตอบกลับและอ่านข้อมูลพื้นฐานได้"
            title="ผลทดสอบ SML"
          />
          <PanelBody>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Fact label="เวลาตอบกลับ" value={`${testResult.latency_ms} ms`} />
              <Fact
                label="ชื่อฐานข้อมูล SML"
                value={testResult.database_name ?? "ยังไม่ทราบ"}
              />
              <Fact
                label="ตรวจเมื่อ"
                value={formatDateTime(testResult.checked_at)}
              />
              <Fact
                label="ตารางที่ต้องใช้"
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
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}?step=reports`}
        >
          ไปทดสอบรายงาน
        </Link>
      </div>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      {children}
    </section>
  );
}

function PanelHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h3>
        {description ? (
          <p className="mt-1 max-w-2xl text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function PanelBody({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}

function SmlActionGuide({
  canDiscover,
  canSave,
  canTestSaved,
  hasDatabase,
  latestReportSucceeded,
}: {
  canDiscover: boolean;
  canSave: boolean;
  canTestSaved: boolean;
  hasDatabase: boolean;
  latestReportSucceeded: boolean;
}) {
  const reportReady = canTestSaved && latestReportSucceeded;
  const steps = [
    {
      detail: "กรอก URL SML JavaWS และไฟล์ SMLConfig ให้ครบ",
      label: "เตรียมข้อมูลเชื่อมต่อ",
      ok: canDiscover,
    },
    {
      detail: "ใช้ปุ่มค้นหาเพื่อลดโอกาสพิมพ์ชื่อ database ผิด",
      label: "เลือก database",
      ok: hasDatabase,
    },
    {
      detail: "ทดสอบก่อนบันทึกได้ แล้วบันทึกค่า SML ที่ผ่านการตรวจ",
      label: "บันทึกและทดสอบ SML",
      ok: canSave && canTestSaved,
    },
    {
      detail: "รันรายงานทดสอบให้สำเร็จก่อนเปิดแผนแจ้งเตือน",
      label: "ยืนยันรายงาน",
      ok: reportReady,
    },
  ];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white px-4 py-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
            ลำดับที่ควรทำ
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
            ทำตามลำดับนี้เพื่อลดการบันทึกผิดร้านหรือเปิดแจ้งเตือนก่อน SML พร้อม
          </p>
        </div>
        <Badge
          color={reportReady ? "success" : canTestSaved ? "warning" : "light"}
        >
          {reportReady
            ? "พร้อมไปขั้นรายงาน"
            : canTestSaved
              ? "ทดสอบ SML ได้"
              : "ยังต้องตั้งค่า"}
        </Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <div
            className="rounded-xl bg-gray-50 p-3 dark:bg-white/[0.02]"
            key={step.label}
          >
            <div className="flex items-start gap-3">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  step.ok
                    ? "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400"
                    : "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-300"
                }`}
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                  {step.label}
                </p>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {step.detail}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActionHelp({ items }: { items: string[] }) {
  return (
    <div className="w-full rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
        ถ้าปุ่มยังปิดอยู่ ให้ตรวจจุดนี้ก่อน
      </p>
      <ul className="mt-2 space-y-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
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
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
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
      <div className="h-[560px] animate-pulse overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6" />
      <div className="space-y-6">
        <div className="h-72 animate-pulse overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6" />
        <div className="h-48 animate-pulse overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6" />
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
    missing.push("URL SML JavaWS");
  }
  if (!form.configFileName.trim()) {
    missing.push("ไฟล์ SMLConfig");
  }
  if (includeDatabase && !form.database.trim()) {
    missing.push("ชื่อฐานข้อมูล SML");
  }
  if (form.authMode === "basic" && !form.authUsername.trim()) {
    missing.push("ผู้ใช้ auth");
  }
  if (form.authMode !== "none" && !form.authSecret.trim()) {
    missing.push(form.authMode === "basic" ? "รหัสผ่าน auth" : "Bearer token");
  }
  return { ok: missing.length === 0, missing };
}

function buildActionHelp({
  busy,
  canUseSavedConfig,
  config,
  dirty,
  discoveryValidation,
  validation,
}: {
  busy: "save" | "test-saved" | "test-draft" | "discover" | null;
  canUseSavedConfig: boolean;
  config: OwnerV2DatasourceStatus;
  dirty: boolean;
  discoveryValidation: ReturnType<typeof validateDraft>;
  validation: ReturnType<typeof validateDraft>;
}) {
  if (busy) {
    return ["รอให้คำสั่งที่กำลังทำงานอยู่เสร็จก่อน"];
  }
  const items: string[] = [];
  if (!discoveryValidation.ok) {
    items.push(
      `ปุ่มค้นหา database ต้องกรอก: ${discoveryValidation.missing.join(", ")}`,
    );
  }
  if (!validation.ok) {
    items.push(`ปุ่มทดสอบและบันทึกต้องกรอก: ${validation.missing.join(", ")}`);
  }
  if (!config.encryption_configured) {
    items.push("ปุ่มบันทึกต้องมีกุญแจเข้ารหัสของระบบกลางก่อน");
  }
  if (validation.ok && config.encryption_configured && !dirty) {
    items.push("ปุ่มบันทึกจะเปิดเมื่อแก้ข้อมูลในฟอร์ม");
  }
  if (!canUseSavedConfig) {
    items.push("ปุ่มทดสอบค่าที่บันทึกแล้วจะเปิดหลังบันทึกค่า SML");
  }
  return Array.from(new Set(items));
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
    return "บันทึกในระบบ";
  }
  if (value === "env") {
    return "จาก environment";
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
    failed: "ไม่สำเร็จ",
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

const SML_DATASOURCE_PRESETS = [
  {
    id: "seaandhill-demo",
    label: "Sea & Hill demo",
    description: "147.50.69.68:80 · SMLConfigDEMO.xml · thapput",
    baseUrl: "http://147.50.69.68:80",
    webappPath: "/SMLJavaWebService",
    configFileName: "SMLConfigDEMO.xml",
    database: "thapput",
  },
  {
    id: "demo-3bb",
    label: "3BB demo",
    description: "demserver.3bbddns.com:47308 · SMLConfigDATA.xml · demo",
    baseUrl: "http://demserver.3bbddns.com:47308",
    webappPath: "/SMLJavaWebService",
    configFileName: "SMLConfigDATA.xml",
    database: "demo",
  },
] as const;
