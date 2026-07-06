"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getReportCatalogEntry } from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
// removed icons from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import OwnerV2StoreSetupNav from "./OwnerV2StoreSetupNav";
import type {
  OwnerV2DatasourceStatus,
  OwnerV2DatasourceTestResult,
  OwnerV2JavaWsDatabaseDiscoveryResult,
  OwnerV2SmlSetupPayload,
} from "./types";
import {
  Fact,
  Field,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  TechnicalDetails,
  formatDateTime,
  formatRunStatus,
} from "./ui";

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
  const [technicalMessage, setTechnicalMessage] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      setMessage(null);
      setTechnicalMessage(null);
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
      setTechnicalMessage(null);
      return;
    }
    setBusy("save");
    setMessage(null);
    setTechnicalMessage(null);
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
      setTechnicalMessage(null);
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
          "บันทึกค่า SML ไม่สำเร็จ ลองตรวจค่าที่กรอกและกุญแจเข้ารหัสบนเครื่องแม่ข่าย",
      });
      setTechnicalMessage(toSmlTechnicalMessage(error));
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
      setTechnicalMessage(null);
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
    setTechnicalMessage(null);
    try {
      const result = await ownerV2Fetch<OwnerV2DatasourceTestResult>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/datasource/test`,
        body ? { method: "POST", body } : { method: "POST" },
      );
      setTestResult(result);
      setMessage({
        tone: result.ok ? "success" : "warning",
        text: result.ok
          ? "ทดสอบ SML ผ่านแล้ว"
          : result.safe_error_message ?? "ทดสอบ SML ไม่ผ่าน",
      });
      setTechnicalMessage(null);
    } catch (error) {
      setTestResult(null);
      setMessage({
        tone: "error",
        text:
          "ทดสอบ SML ไม่สำเร็จ ตรวจ URL, ไฟล์ SMLConfig, ฐานข้อมูล และสิทธิ์การเข้าถึงแล้วลองใหม่",
      });
      setTechnicalMessage(toSmlTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function discoverDatabases() {
    if (discoverDisabled) {
      setMessage({
        tone: "warning",
        text: discoveryValidation.ok
          ? "ยังค้นหาฐานข้อมูลไม่ได้"
          : `กรอกข้อมูลให้ครบ: ${discoveryValidation.missing.join(", ")}`,
      });
      setTechnicalMessage(null);
      return;
    }
    setBusy("discover");
    setMessage(null);
    setTechnicalMessage(null);
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
          ? `พบ ${result.databases.length.toLocaleString("th-TH")} ฐานข้อมูล`
          : result.safe_error_message ?? "ค้นหาฐานข้อมูลไม่สำเร็จ",
      });
      setTechnicalMessage(null);
    } catch (error) {
      setDiscovery(null);
      setMessage({
        tone: "error",
        text:
          "ค้นหาฐานข้อมูลไม่สำเร็จ ตรวจ URL และไฟล์ SMLConfig ก่อนลองค้นหาใหม่",
      });
      setTechnicalMessage(toSmlTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "loading") {
    return (
      <div className="space-y-5 sm:space-y-6">
        <OwnerV2StoreSetupNav current="sml" tenantId={tenantId} />
        <SmlSkeleton />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-5 sm:space-y-6">
        <OwnerV2StoreSetupNav current="sml" tenantId={tenantId} />
        <Panel>
          <PanelBody spaced>
            <Notice
              tone="error"
              title="โหลด SML ไม่สำเร็จ"
              text="ลองโหลดใหม่อีกครั้ง ถ้ายังไม่สำเร็จ ให้เปิดศูนย์ตรวจระบบหรือเข้าสู่ระบบผู้ดูแลใหม่"
            />
            <TechnicalDetails embedded title="รายละเอียดข้อผิดพลาด">
              <Fact label="ข้อความระบบ" value={state.message} />
            </TechnicalDetails>
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
      </div>
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
  const draftComparison = buildDraftComparison(form, config);

  return (
    <div className="space-y-5 sm:space-y-6">
      <OwnerV2StoreSetupNav current="sml" tenantId={tenantId} />
      {message ? (
        <Notice tone={message.tone} title="สถานะ SML" text={message.text} />
      ) : null}
      {technicalMessage ? (
        <TechnicalDetails embedded title="รายละเอียดการทำรายการ">
          <Fact label="ข้อความระบบ" value={technicalMessage} />
        </TechnicalDetails>
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
            description="ตั้งค่า URL, ไฟล์ SMLConfig และฐานข้อมูลของร้านนี้ แล้วทดสอบก่อนเปิดใช้รายงานหรือแจ้งเตือน"
            title="SML JavaWS"
          />
          <PanelBody spaced>
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
                  help="ชื่อไฟล์ตั้งค่าที่ JavaWS ใช้อ่านการเชื่อมต่อของ SML"
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
                  help="ใช้ปุ่มค้นหาฐานข้อมูลเพื่อลดการพิมพ์ผิด"
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
                  label="เส้นทาง JavaWS"
                  help="โดยทั่วไปใช้ค่าเดิมนี้ ยกเว้นร้านติดตั้งเส้นทางอื่น"
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
                    ใช้เฉพาะร้านที่มีชั้นล็อกอินหรือรหัสผ่านก่อนเข้า JavaWS
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
                      <option value="none">ไม่ใช้รหัสผ่าน</option>
                      <option value="basic">ผู้ใช้และรหัสผ่าน</option>
                      <option value="bearer">รหัสโทเคน</option>
                    </select>
                  </Field>
                  {form.authMode === "basic" ? (
                    <Field label="ชื่อผู้ใช้">
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
                          ? "รหัสผ่าน"
                          : "รหัสโทเคน"
                      }
                      help={
                        config.auth_configured
                          ? "กรอกรหัสลับใหม่เมื่อต้องทดสอบหรือบันทึกจากฟอร์ม"
                          : "รหัสลับจะถูกเข้ารหัสก่อนบันทึก"
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
                  {busy === "discover" ? "กำลังค้นหา..." : "1 · ค้นหาฐานข้อมูล"}
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
              <DraftComparisonBanner comparison={draftComparison} />
            </form>
          </PanelBody>
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelHeader
              description="ดูว่าร้านนี้พร้อมใช้รายงานจาก SML แล้วหรือยัง"
              title="สถานะปัจจุบัน"
            />
            <PanelBody spaced>
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
                      ? `${formatAuthMode(config.auth_mode)} · ${
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
            <PanelBody spaced>
              {setup.latest_report_run ? (
                <div className="space-y-3">
                  <Fact
                    label={getReportCatalogEntry(setup.latest_report_run.report_key).shortLabel}
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
                {discovery.ok ? "พบฐานข้อมูล" : "ควรตรวจ"}
              </Badge>
            }
            description="เลือกชื่อฐานข้อมูลที่พบเพื่อเติมลงฟอร์มโดยไม่ต้องพิมพ์เอง"
            title="ผลค้นหาฐานข้อมูล"
          />
          <PanelBody spaced>
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
                ไม่พบฐานข้อมูลจาก JavaWS รอบนี้
              </p>
            )}
            <TechnicalDetails
              embedded
              title="รายละเอียดเทคนิคของการค้นหาฐานข้อมูล"
              description="เปิดดูเมื่อต้องตรวจเวลาเชื่อมต่อ JavaWS หรือเทียบกับ log ฝั่งระบบ"
            >
              <Fact label="เวลาตอบกลับ" value={`${discovery.latency_ms} ms`} />
            </TechnicalDetails>
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
          <PanelBody spaced>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Fact
                label="ผลทดสอบ"
                tone={testResult.ok ? "success" : "error"}
                value={testResult.ok ? "เชื่อมต่อได้" : "ควรตรวจ"}
              />
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
            <TechnicalDetails
              embedded
              title="รายละเอียดเทคนิคของการทดสอบ SML"
              description="เปิดดูเมื่อต้องตรวจเวลาเชื่อมต่อ JavaWS หรือส่งข้อมูลให้ทีมดูแลระบบ"
            >
              <Fact label="เวลาตอบกลับ" value={`${testResult.latency_ms} ms`} />
            </TechnicalDetails>
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
      detail: "ใช้ปุ่มค้นหาเพื่อลดโอกาสพิมพ์ชื่อฐานข้อมูลผิด",
      label: "เลือกฐานข้อมูล",
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
    missing.push("ชื่อผู้ใช้");
  }
  if (form.authMode !== "none" && !form.authSecret.trim()) {
    missing.push(form.authMode === "basic" ? "รหัสผ่าน" : "รหัสโทเคน");
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
      `ปุ่มค้นหาฐานข้อมูลต้องกรอก: ${discoveryValidation.missing.join(", ")}`,
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
    return "จากเครื่องแม่ข่าย";
  }
  return "ยังไม่ตั้ง";
}

function formatAuthMode(value: string) {
  const labels: Record<string, string> = {
    basic: "ชื่อผู้ใช้/รหัสผ่าน",
    bearer: "โทเคน",
    none: "ไม่ต้องใช้รหัส",
  };
  return labels[value] ?? value;
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

type DraftComparison = {
  changedFields: string[];
  hasChanges: boolean;
  nextAction: string;
  summary: string;
};

const normalize = (value: string) => value.trim().toLowerCase();

function buildDraftComparison(
  form: SmlFormState,
  config: OwnerV2DatasourceStatus,
): DraftComparison {
  const fieldComparisons = [
    {
      label: "URL SML JavaWS",
      draft: normalize(form.baseUrl),
      saved: normalize(config.base_url ?? ""),
    },
    {
      label: "เส้นทาง JavaWS",
      draft: normalize(form.webappPath || "/SMLJavaWebService"),
      saved: normalize(config.webapp_path || "/SMLJavaWebService"),
    },
    {
      label: "SMLConfig",
      draft: normalize(form.configFileName),
      saved: normalize(config.config_file_name ?? ""),
    },
    {
      label: "ฐานข้อมูล SML",
      draft: normalize(form.database),
      saved: normalize(config.database ?? ""),
    },
    {
      label: "โหมดรหัสผ่าน",
      draft: form.authMode,
      saved: (config.auth_mode ?? "none") as string,
    },
  ];
  const changedFields = fieldComparisons
    .filter((item) => item.draft !== item.saved)
    .map((item) => item.label);
  if (form.authMode !== "none" && form.authSecret.trim()) {
    changedFields.push("รหัสลับใหม่");
  }
  const hasChanges = changedFields.length > 0;
  const isSaved = Boolean(config.base_url);
  const summary = hasChanges
    ? `กำลังแก้: ${changedFields.join(", ")}`
    : "ค่าที่กรอกตรงกับค่าที่บันทึกแล้ว";
  const nextAction = !isSaved
    ? "ยังไม่เคยบันทึก JavaWS ให้ทดสอบก่อนบันทึกแล้วกดบันทึก"
    : hasChanges
      ? "กดทดสอบก่อนบันทึกเพื่อยืนยันว่าเชื่อมต่อได้"
      : "ค่าเดิมยังใช้ได้ — ไม่จำเป็นต้องบันทึก";
  return { changedFields, hasChanges, nextAction, summary };
}

function toSmlTechnicalMessage(error: unknown) {
  return error instanceof Error ? error.message : "ไม่พบรายละเอียด";
}

function DraftComparisonBanner({
  comparison,
}: {
  comparison: DraftComparison;
}) {
  return (
    <div
      aria-live="polite"
      className={`rounded-xl border p-3 ${
        comparison.hasChanges
          ? "border-warning-500/40 bg-warning-50 dark:bg-warning-500/10"
          : "border-success-500/40 bg-success-50 dark:bg-success-500/10"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-theme-xs font-medium ${
            comparison.hasChanges
              ? "bg-warning-100 text-warning-700 dark:bg-warning-500/20 dark:text-warning-300"
              : "bg-success-100 text-success-700 dark:bg-success-500/20 dark:text-success-300"
          }`}
        >
          {comparison.hasChanges ? "มีการแก้ไข" : "ตรงกับที่บันทึก"}
        </span>
        <span className="text-theme-sm text-gray-700 dark:text-gray-300">
          {comparison.summary}
        </span>
      </div>
      <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
        ควรทำต่อ: {comparison.nextAction}
      </p>
    </div>
  );
}
