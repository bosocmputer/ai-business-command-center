"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { findSensitiveTenantNoteHints, type BusinessSignalRecord, type BusinessSignalStatus, type Tenant } from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { AlertIcon, ArrowRightIcon, CheckCircleIcon } from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import OwnerV2SetupWizard from "./OwnerV2SetupWizard";
import OwnerV2TenantConfigEditor from "./OwnerV2TenantConfigEditor";
import {
  Fact,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  formatDateTime,
  formatLineDeliveryStatus,
  formatRunStatus,
  formatTenantStatus,
  primaryActionClass,
  secondaryActionClass,
  tenantStatusColor,
} from "./ui";
import type {
  OwnerV2SetupStep,
  OwnerV2StoreSetupCheck,
  OwnerV2StoreSetupPayload,
  OwnerV2StepId,
} from "./types";

type StoreFormState = {
  name: string;
  description: string;
  status: Exclude<Tenant["status"], "cancelled">;
  plan_code: Tenant["planCode"];
  current_period_end_date: string;
  billing_cycle: "monthly" | "yearly" | "one_time" | null;
  suspended_reason: string;
};

type DetailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: OwnerV2StoreSetupPayload };

type StoreTab = "setup" | "system" | "advanced";

const editableStatuses: StoreFormState["status"][] = [
  "trial",
  "active",
  "past_due",
  "suspended",
];

const VALID_TABS: StoreTab[] = ["setup", "system", "advanced"];

const TAB_LABELS: Record<StoreTab, string> = {
  setup: "การตั้งค่าร้าน",
  system: "สถานะระบบ",
  advanced: "ตั้งค่าขั้นสูง",
};

export default function OwnerV2StoreDetail({ tenantId }: { tenantId: string }) {
  const [detailState, setDetailState] = useState<DetailState>({
    status: "loading",
  });
  const [form, setForm] = useState<StoreFormState | null>(null);
  const [initialForm, setInitialForm] = useState<StoreFormState | null>(null);
  const [busy, setBusy] = useState<"save" | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "warning" | "error";
    text: string;
  } | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setDetailState({ status: "loading" });
      setMessage(null);
      try {
        const data = await ownerV2Fetch<OwnerV2StoreSetupPayload>(
          `/api/owner/tenants/${encodeURIComponent(tenantId)}/store-setup`,
          { signal },
        );
        if (signal?.aborted) {
          return;
        }
        const nextForm = toStoreFormState(data.summary.tenant);
        setDetailState({ status: "success", data });
        setForm(nextForm);
        setInitialForm(nextForm);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setDetailState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดข้อมูลร้านไม่สำเร็จ",
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

  const sensitiveHints = useMemo(
    () => findSensitiveTenantNoteHints(form?.description ?? ""),
    [form?.description],
  );
  const selectedTenantStatus =
    detailState.status === "success"
      ? detailState.data.summary.tenant.status
      : null;
  const dirty =
    form !== null &&
    initialForm !== null &&
    JSON.stringify(form) !== JSON.stringify(initialForm);
  const saveDisabled =
    busy !== null ||
    selectedTenantStatus === "cancelled" ||
    !form ||
    !dirty ||
    !form.name.trim() ||
    sensitiveHints.length > 0;

  const router = useRouter();
  const searchParams = useSearchParams();
  const explicitTab = searchParams.get("tab");
  const activeTab = explicitTab ? parseTab(explicitTab) : "setup";

  // Hooks must run before any early return (Rules of Hooks). Use a nullable
  // view of the loaded data so the memos no-op while loading; we redeclare
  // narrowed consts after the guards below where TypeScript knows we are in
  // the success branch.
  const loadedData =
    detailState.status === "success" ? detailState.data : null;
  const wizardSteps = useMemo(
    () =>
      loadedData
        ? buildWizardSteps(
            loadedData.readiness.checks,
            loadedData.summary.tenant.id,
          )
        : [],
    [loadedData],
  );

  const wizardTenant = useMemo(() => {
    if (!loadedData) {
      return null;
    }
    const t = loadedData.summary.tenant;
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      plan_code: t.planCode,
      dashboard_path: loadedData.summary.customer_dashboard_path,
      ready: loadedData.readiness.ready,
      completed_steps: loadedData.readiness.completed,
      total_steps: loadedData.readiness.total,
      next_action: null,
      health: {
        datasource_configured: loadedData.summary.health.datasource_configured,
        line_targets_enabled: loadedData.summary.health.line_targets_enabled,
        notification_rules_enabled:
          loadedData.summary.health.notification_rules_enabled,
        latest_report_status: loadedData.summary.health.latest_report_status,
        latest_notification_run_status:
          loadedData.summary.health.latest_notification_run_status,
        critical_business_signals:
          loadedData.summary.health.critical_business_signals,
      },
    };
  }, [loadedData]);

  function selectTab(tab: StoreTab) {
    if (tab === activeTab) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    // Always set ?tab= explicitly, even for the "setup" tab, so copied links
    // preserve the admin's current view.
    params.set("tab", tab);
    // Switching away from setup leaves the setup wizard, so drop the step.
    if (tab !== "setup") {
      params.delete("step");
    }
    router.replace(`/owner-v2/stores/${encodeURIComponent(tenantId)}?${params.toString()}`, {
      scroll: false,
    });
  }

  async function saveStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || saveDisabled) {
      setMessage({
        tone: "warning",
        text: sensitiveHints.length
          ? "หมายเหตุมีคำที่เหมือนข้อมูลลับ กรุณาลบ token/password/secret ก่อนบันทึก"
          : "ยังไม่มีข้อมูลที่เปลี่ยน หรือชื่อร้านยังไม่ครบ",
      });
      return;
    }

    setBusy("save");
    setMessage(null);
    try {
      await ownerV2Fetch(`/api/owner/tenants/${encodeURIComponent(tenantId)}`, {
        method: "PATCH",
        body: {
          name: form.name.trim(),
          description: form.description.trim(),
          status: form.status,
          plan_code: form.plan_code,
          current_period_end: dateInputToIso(form.current_period_end_date),
          billing_cycle: form.billing_cycle,
          suspended_reason:
            form.status === "suspended"
              ? form.suspended_reason.trim() || null
              : null,
        },
      });
      setMessage({
        tone: "success",
        text: "บันทึกข้อมูลร้านแล้ว ระบบโหลด readiness ล่าสุดให้เรียบร้อย",
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "บันทึกข้อมูลร้านไม่สำเร็จ กรุณาลองใหม่",
      });
    } finally {
      setBusy(null);
    }
  }

  if (detailState.status === "loading" || !form) {
    return <StoreDetailSkeleton />;
  }

  if (detailState.status === "error") {
    return (
      <Panel>
        <PanelBody>
          <Notice
            tone="error"
            title="โหลดข้อมูลร้านไม่สำเร็จ"
            text={`${detailState.message} ลองรีเฟรชหน้านี้ หรือตรวจ session ผู้ดูแล`}
          />
          <Button
            className="mt-4 w-full sm:w-auto"
            onClick={() => void load()}
            type="button"
          >
            รีเฟรชข้อมูลร้าน
          </Button>
        </PanelBody>
      </Panel>
    );
  }

  // detailState.status === "success" past the guards, so these are non-null.
  const detail = detailState.data;
  const tenant = detail.summary.tenant;
  const readiness = detail.readiness;
  const nextAction = readiness.next_action;
  const health = detail.summary.health;
  const verdict = deriveStoreVerdict(detail);
  const heroTone = verdict?.tone ?? (readiness.ready ? "success" : "warning");
  const progressPct = Math.round(
    (readiness.completed / Math.max(1, readiness.total)) * 100,
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      <StoreHero
        tenant={tenant}
        readiness={readiness}
        verdict={verdict}
        heroTone={heroTone}
        progressPct={progressPct}
        nextAction={nextAction}
      />

      {message ? (
        <Notice tone={message.tone} title="สถานะข้อมูลร้าน" text={message.text} />
      ) : null}

      {/* Tab bar — TailAdmin underline style with attention badges.
          Badges surface problems without forcing the admin to click each tab. */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800">
        {VALID_TABS.map((tab) => {
          const isActive = tab === activeTab;
          const badge = tabBadgeFor(tab, {
            readiness,
            hasJavaWsFailure: Boolean(detail.latest_javaws_failure),
            openSignals: health.open_business_signals,
            dirty,
          });
          return (
            <button
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition sm:px-5 ${
                isActive
                  ? "border-brand-500 text-brand-600 dark:border-brand-400 dark:text-brand-400"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:text-gray-200"
              }`}
              key={tab}
              onClick={() => selectTab(tab)}
              type="button"
            >
              {TAB_LABELS[tab]}
              {badge ? (
                <span
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${badge.className}`}
                >
                  {badge.label}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {activeTab === "setup" ? (
        <div className="space-y-5 sm:space-y-6">
          {/* Setup wizard — the primary setup path with per-step CTA cards.
              Shown when not ready; hidden when fully ready (the checklist
              below already confirms the all-green state compactly). */}
          {wizardTenant && !readiness.ready ? (
            <OwnerV2SetupWizard
              steps={wizardSteps}
              tenant={wizardTenant}
            />
          ) : null}

          {/* Readiness checklist — compact confirmation. When not ready this
              is redundant with the wizard (which shows the same checks as
              actionable cards), so hide it to avoid duplication. When ready
              it's the only thing shown — a clean all-green list with no
              fixed-height scroll container. */}
          {readiness.ready ? (
            <Panel>
              <PanelHeader
                title="รายการตรวจสอบความพร้อม"
                description="ทุกข้อตั้งค่าครบแล้ว — กด “ดู” เพื่อเปิดหน้าตั้งค่าของขั้นนั้น"
              />
              <PanelBody>
                <div className="flex flex-col gap-2">
                  {readiness.checks.map((check) => (
                    <ReadinessRow check={check} key={check.key} tenantId={tenant.id} />
                  ))}
                </div>
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {activeTab === "system" ? (
        <div className="space-y-5 sm:space-y-6">
          {/* Sub-panel 1 — การเชื่อมต่อ (SML / LINE / แผน / signals) */}
          <Panel>
            <PanelHeader
              title="การเชื่อมต่อ"
              description="สถานะ SML, LINE และแผนแจ้งเตือนของร้านนี้"
            />
            <PanelBody>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Fact
                  label="SML datasource"
                  tone={detail.datasource.kind === "sml_javaws" ? "success" : "warning"}
                  value={
                    detail.datasource.kind === "sml_javaws"
                      ? detail.datasource.database ?? "ตั้งค่าแล้ว"
                      : "ยังไม่พร้อม"
                  }
                />
                <Fact
                  label="LINE พร้อมส่ง"
                  tone={health.line_targets_enabled > 0 ? "success" : "warning"}
                  value={`${health.line_targets_enabled}/${health.line_targets_total} ผู้รับ`}
                />
                <Fact
                  label="แผนแจ้งเตือน"
                  tone={health.notification_rules_enabled > 0 ? "success" : "warning"}
                  value={`${health.notification_rules_enabled}/${health.notification_rules_total} แผนเปิด`}
                />
                <Fact
                  label="Business signals"
                  tone={
                    health.critical_business_signals > 0
                      ? "error"
                      : health.open_business_signals > 0
                        ? "warning"
                        : "success"
                  }
                  value={`${health.open_business_signals} เปิดอยู่`}
                />
              </div>
              <div className="mt-5 flex flex-col gap-3 border-t border-gray-100 pt-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                    FlowAccount sandbox
                  </p>
                  <p className="mt-1 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
                    ทดสอบ client credentials และ /company/info แยกจาก readiness หลัก
                  </p>
                </div>
                <Link
                  className={secondaryActionClass}
                  href={`/owner-v2/stores/${encodeURIComponent(tenant.id)}/flowaccount`}
                >
                  ตั้งค่า FlowAccount
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
              </div>
            </PanelBody>
          </Panel>

          {/* Sub-panel 2 — รอบล่าสุด (report / snapshot / delivery / notification) */}
          <Panel>
            <PanelHeader
              title="รอบล่าสุด"
              description="รายงาน, snapshot, LINE delivery และรอบแจ้งเตือนล่าสุด"
            />
            <PanelBody>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Fact
                  label="รายงานล่าสุด"
                  value={
                    health.latest_report_run_at
                      ? `${formatRunStatus(health.latest_report_status)} · ${formatDateTime(health.latest_report_run_at)}`
                      : "ยังไม่มี run"
                  }
                />
                <Fact
                  label="Snapshot ล่าสุด"
                  value={formatDateTime(health.latest_snapshot_at)}
                />
                <Fact
                  label="LINE delivery ล่าสุด"
                  value={
                    health.latest_line_delivery_at
                      ? `${formatLineDeliveryStatus(health.latest_line_delivery_status)} · ${formatDateTime(health.latest_line_delivery_at)}`
                      : "ยังไม่มี delivery"
                  }
                />
                <Fact
                  label="แจ้งเตือนล่าสุด"
                  value={
                    health.latest_notification_run_at
                      ? `${formatRunStatus(health.latest_notification_run_status)} · ${formatDateTime(health.latest_notification_run_at)}`
                      : "ยังไม่มีรอบ"
                  }
                />
              </div>
            </PanelBody>
          </Panel>

          {/* Sub-panel 3 — Incidents & Proof (เฉพาะเมื่อมีเนื้อหา) */}
          {detail.latest_javaws_failure ||
          (detail.business_signals ?? []).length > 0 ||
          detail.proof_strip.eligible ? (
            <Panel>
              <PanelHeader
                title="Incidents & Proof"
                description="incident ล่าสุด, สัญญาณธุรกิจ และหลักฐาน 7 วัน"
              />
              <PanelBody spaced>
                {detail.latest_javaws_failure ? (
                  <Notice
                    tone="error"
                    title={`JavaWS incident ล่าสุด: ${detail.latest_javaws_failure.failure_phase ?? "unknown"}`}
                    text={`รายงาน ${detail.latest_javaws_failure.report_key} phase ${detail.latest_javaws_failure.failure_phase ?? "unknown"} · ${detail.latest_javaws_failure.safe_error_message ?? "ไม่มีรายละเอียดปลอดภัย"} · ${formatDateTime(detail.latest_javaws_failure.finished_at)}`}
                  />
                ) : null}
                <BusinessSignalPanel
                  onReload={() => void load()}
                  signals={detail.business_signals ?? []}
                  tenantId={tenant.id}
                />
                {detail.proof_strip.eligible ? (
                  <StoreProofStrip strip={detail.proof_strip} />
                ) : null}
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {activeTab === "advanced" ? (
        <div className="space-y-5 sm:space-y-6">
          <Panel>
            <PanelHeader
              title="แก้ข้อมูลร้าน"
              description="ชื่อร้าน แพ็กเกจ สถานะ และหมายเหตุ"
            />
            <PanelBody spaced>
              <StoreEditForm
                busy={busy}
                dirty={dirty}
                form={form}
                initialForm={initialForm}
                saveDisabled={saveDisabled}
                sensitiveHints={sensitiveHints}
                setForm={setForm}
                setMessage={setMessage}
                saveStore={saveStore}
                tenant={tenant}
              />
            </PanelBody>
          </Panel>

          {tenant.status !== "cancelled" ? (
            <OwnerV2TenantConfigEditor
              onCancelled={() => router.push("/owner-v2/stores")}
              tenantId={tenant.id}
              tenantName={tenant.name}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero — identity header (TailAdmin profile.html pattern) + next-action
/* ------------------------------------------------------------------ */

function StoreHero({
  heroTone,
  nextAction,
  progressPct,
  readiness,
  tenant,
  verdict,
}: {
  heroTone: StoreVerdict["tone"];
  nextAction: OwnerV2StoreSetupCheck | null;
  progressPct: number;
  readiness: OwnerV2StoreSetupPayload["readiness"];
  tenant: Tenant;
  verdict: StoreVerdict | null;
}) {
  const toneClass = heroToneConfig(heroTone);
  const ready = readiness.ready;
  return (
    <section className={`overflow-hidden rounded-2xl border ${toneClass.border} ${toneClass.bg}`}>
      {/* Identity row */}
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between lg:p-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${toneClass.iconTile}`}
            >
              {heroTone === "success" ? (
                <CheckCircleIcon className="h-6 w-6" />
              ) : (
                <AlertIcon className="h-6 w-6" />
              )}
            </span>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              {tenant.name}
            </h1>
            <Badge color={tenantStatusColor(tenant.status)}>
              {formatTenantStatus(tenant.status)}
            </Badge>
            <Badge color="light">{tenant.planCode}</Badge>
            {tenant.status === "cancelled" ? null : (
              <Badge color={ready ? "success" : "warning"}>
                {ready ? "พร้อมใช้งาน" : `${readiness.completed}/${readiness.total} พร้อม`}
              </Badge>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-theme-xs text-gray-500 dark:text-gray-400">
            <span className="font-mono break-all">{tenant.id}</span>
            <span className="hidden h-3.5 w-px bg-gray-300 dark:bg-gray-700 sm:block" />
            <span>
              {ready
                ? `พร้อมใช้งานครบ ${readiness.total}/${readiness.total}`
                : `เหลือ ${readiness.total - readiness.completed} ข้อให้ทำ`}
            </span>
            {tenant.currentPeriodEnd ? (
              <>
                <span className="hidden h-3.5 w-px bg-gray-300 dark:bg-gray-700 sm:block" />
                <span>สิ้นสุดรอบ {formatDate(tenant.currentPeriodEnd)}</span>
              </>
            ) : tenant.status === "trial" ? (
              <>
                <span className="hidden h-3.5 w-px bg-gray-300 dark:bg-gray-700 sm:block" />
                <span className="text-warning-600 dark:text-warning-400">
                  ยังไม่กำหนดวันหมด trial — ตั้งที่แท็บ &ldquo;ตั้งค่าขั้นสูง&rdquo;
                </span>
              </>
            ) : null}
            {tenant.status === "past_due" && tenant.currentPeriodEnd ? (
              <>
                <span className="hidden h-3.5 w-px bg-gray-300 dark:bg-gray-700 sm:block" />
                <span className="font-medium text-red-600 dark:text-red-400">
                  ผ่อนผันถึง{" "}
                  {formatDate(
                    new Date(
                      new Date(tenant.currentPeriodEnd).getTime() +
                        7 * 24 * 60 * 60 * 1000,
                    ).toISOString(),
                  )}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Next-action band — the single thing the admin should do next */}
      <div className={`border-t ${toneClass.divider} px-5 py-4 lg:px-6`}>
        {nextAction ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-warning-600 dark:text-warning-400" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  ขั้นต่อไป: {nextAction.label}
                </p>
                <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                  {nextAction.detail}
                </p>
              </div>
            </div>
            <Link
              className={primaryActionClass}
              href={v2HrefForCheck(tenant.id, nextAction)}
            >
              {verdict?.actionLabel ?? "เปิดขั้นนี้"}
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-success-500" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                ร้านนี้พร้อมใช้งานครบทุกข้อ
              </p>
              <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                {verdict?.text ?? "ตรวจหน้าลูกค้าหรือรอบแจ้งเตือนได้จากหน้านี้"}
              </p>
            </div>
          </div>
        )}

        {/* Progress bar */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-theme-xs text-gray-500 dark:text-gray-400">
            <span>ความพร้อม</span>
            <span>
              {readiness.completed}/{readiness.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200/70 dark:bg-white/[0.06]">
            <div
              className={`h-full rounded-full transition-all ${
                ready ? "bg-success-500" : "bg-brand-500"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Setup tab — readiness checklist rows
/* ------------------------------------------------------------------ */

function ReadinessRow({
  check,
  tenantId,
}: {
  check: OwnerV2StoreSetupCheck;
  tenantId: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg p-3 transition hover:bg-gray-50 dark:hover:bg-white/[0.03]">
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          check.ok
            ? "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400"
            : "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-300"
        }`}
      >
        {check.ok ? (
          <CheckCircleIcon className="h-4 w-4" />
        ) : (
          <AlertIcon className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
              {check.label}
            </p>
            <p className="mt-1 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
              {check.detail}
            </p>
          </div>
          <Link
            className={secondaryActionClass}
            href={v2HrefForCheck(tenantId, check)}
          >
            {check.ok ? "ดู" : "ทำต่อ"}
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Advanced tab — store edit form (extracted for readability)
/* ------------------------------------------------------------------ */

function StoreEditForm({
  busy,
  dirty,
  form,
  initialForm,
  saveDisabled,
  sensitiveHints,
  setForm,
  setMessage,
  saveStore,
  tenant,
}: {
  busy: "save" | null;
  dirty: boolean;
  form: StoreFormState;
  initialForm: StoreFormState | null;
  saveDisabled: boolean;
  sensitiveHints: string[];
  setForm: React.Dispatch<React.SetStateAction<StoreFormState | null>>;
  setMessage: React.Dispatch<
    React.SetStateAction<{
      tone: "success" | "warning" | "error";
      text: string;
    } | null>
  >;
  saveStore: (event: FormEvent<HTMLFormElement>) => void;
  tenant: Tenant;
}) {
  const cancelled = tenant.status === "cancelled";
  return (
    <form className="space-y-6" onSubmit={saveStore}>
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2">
        <label className="block min-w-0" htmlFor="edit-tenant-name">
          <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
            ชื่อร้าน
          </span>
          <input
            className="owner-v2-input"
            disabled={cancelled}
            id="edit-tenant-name"
            onChange={(event) =>
              setForm((current) =>
                current
                  ? { ...current, name: event.target.value }
                  : current,
              )
            }
            value={form.name}
          />
        </label>
        <label className="block min-w-0" htmlFor="edit-tenant-id">
          <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
            tenant_id
          </span>
          <input
            className="owner-v2-input font-mono"
            disabled
            id="edit-tenant-id"
            value={tenant.id}
          />
        </label>
        <label className="block min-w-0" htmlFor="edit-tenant-plan">
          <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
            Plan
          </span>
          <select
            className="owner-v2-input"
            disabled={cancelled}
            id="edit-tenant-plan"
            onChange={(event) =>
              setForm((current) =>
                current
                  ? {
                      ...current,
                      plan_code: event.target.value as Tenant["planCode"],
                    }
                  : current,
              )
            }
            value={form.plan_code}
          >
            <option value="starter">starter</option>
            <option value="business">business</option>
            <option value="pro">pro</option>
          </select>
        </label>
        <label className="block min-w-0" htmlFor="edit-tenant-status">
          <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
            สถานะ
          </span>
          <select
            className="owner-v2-input"
            disabled={cancelled}
            id="edit-tenant-status"
            onChange={(event) =>
              setForm((current) =>
                current
                  ? {
                      ...current,
                      status: event.target.value as StoreFormState["status"],
                    }
                  : current,
              )
            }
            value={form.status}
          >
            {editableStatuses.map((status) => (
              <option key={status} value={status}>
                {formatTenantStatus(status)}
              </option>
            ))}
          </select>
        </label>
        <div className="block min-w-0">
          <label
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
            htmlFor="edit-tenant-billing-cycle"
          >
            รูปแบบการชำระ
          </label>
          <select
            className="owner-v2-input"
            disabled={cancelled}
            id="edit-tenant-billing-cycle"
            onChange={(event) => {
              const v = event.target.value;
              setForm((current) =>
                current
                  ? {
                      ...current,
                      billing_cycle:
                        v === "monthly" || v === "yearly" || v === "one_time"
                          ? v
                          : null,
                    }
                  : current,
              );
            }}
            value={form.billing_cycle ?? ""}
          >
            <option value="">ไม่ระบุ (ไม่มี automation)</option>
            <option value="monthly">รายเดือน</option>
            <option value="yearly">รายปี</option>
            <option value="one_time">ครั้งเดียว</option>
          </select>
          {!form.billing_cycle ? (
            <span className="mt-1.5 block text-xs leading-5 text-warning-600 dark:text-warning-400">
              ยังไม่ได้ตั้งรูปแบบการชำระ — ระบบจะไม่ auto-manage subscription นี้
            </span>
          ) : (
            <span className="mt-1.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">
              ระบบจะแจ้งเตือนและ suspend อัตโนมัติตามรูปแบบที่เลือก
            </span>
          )}
        </div>
        <div className="block min-w-0">
          <label
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
            htmlFor="edit-tenant-period-end"
          >
            สิ้นสุดรอบใช้งาน
          </label>
          <input
            className={`owner-v2-input ${
              form.current_period_end_date &&
              form.current_period_end_date < todayDateString()
                ? "border-warning-300 focus:border-warning-300 focus:ring-warning-500/10"
                : ""
            }`}
            disabled={cancelled}
            id="edit-tenant-period-end"
            onChange={(event) =>
              setForm((current) =>
                current
                  ? {
                      ...current,
                      current_period_end_date: event.target.value,
                    }
                  : current,
              )
            }
            type="date"
            value={form.current_period_end_date}
          />
          {form.current_period_end_date &&
          form.current_period_end_date < todayDateString() ? (
            <span className="mt-1.5 block text-xs leading-5 text-warning-600 dark:text-warning-400">
              วันที่อยู่ในอดีต — ถ้าตั้งใจให้หมดแล้ว ระบบจะ suspend อัตโนมัติในรอบถัดไป
            </span>
          ) : (
            <span className="mt-1.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">
              เว้นว่างได้ถ้ายังไม่ต้องกำหนดรอบสิทธิ์
            </span>
          )}
          {!cancelled ? (
            <div className="mt-2 flex gap-2">
              {([
                { label: "+1 เดือน", days: 30 },
                { label: "+1 ปี", days: 365 },
              ] as const).map(({ label, days }) => (
                <button
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]"
                  key={days}
                  onClick={() => {
                    const base =
                      form.current_period_end_date &&
                      form.current_period_end_date >= todayDateString()
                        ? new Date(`${form.current_period_end_date}T00:00:00+07:00`)
                        : new Date();
                    const next = new Date(base.getTime() + days * 86_400_000);
                    setForm((current) =>
                      current
                        ? {
                            ...current,
                            current_period_end_date: dateToDateInput(next),
                          }
                        : current,
                    );
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <label className="block min-w-0" htmlFor="edit-tenant-suspended-reason">
          <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
            เหตุผลระงับ
          </span>
          <input
            className="owner-v2-input"
            disabled={cancelled || form.status !== "suspended"}
            id="edit-tenant-suspended-reason"
            onChange={(event) =>
              setForm((current) =>
                current
                  ? { ...current, suspended_reason: event.target.value }
                  : current,
              )
            }
            value={form.suspended_reason}
          />
          <span className="mt-1.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">
            {form.status === "suspended"
              ? "ข้อความนี้ช่วยให้ admin คนถัดไปรู้เหตุผล"
              : "ใช้เมื่อสถานะเป็นระงับ"}
          </span>
        </label>
      </div>
      <label className="block min-w-0" htmlFor="edit-tenant-description">
        <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
          หมายเหตุ
        </span>
        <textarea
          className="owner-v2-input min-h-28"
          disabled={cancelled}
          id="edit-tenant-description"
          onChange={(event) =>
            setForm((current) =>
              current
                ? { ...current, description: event.target.value }
                : current,
            )
          }
          value={form.description}
        />
        <span
          className={`mt-1.5 block text-xs leading-5 ${
            sensitiveHints.length
              ? "text-error-500"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {sensitiveHints.length
            ? `พบคำที่เสี่ยงเป็นข้อมูลลับ: ${sensitiveHints.join(", ")}`
            : "ห้ามใส่ token/password/secret ในช่องนี้"}
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="w-full sm:w-auto"
          disabled={saveDisabled}
          type="submit"
        >
          {busy === "save" ? "กำลังบันทึก..." : "บันทึกข้อมูลร้าน"}
        </Button>
        <Button
          className="w-full sm:w-auto"
          disabled={busy !== null || !dirty}
          onClick={() => {
            setForm(initialForm);
            setMessage(null);
          }}
          type="button"
          variant="outline"
        >
          คืนค่าล่าสุด
        </Button>
        <Link className={secondaryActionClass} href="/owner-v2/stores">
          ยกเลิก
        </Link>
        <p className="w-full text-xs text-gray-500 dark:text-gray-400 sm:w-auto">
          ปุ่มบันทึกเปิดเมื่อข้อมูลเปลี่ยนและไม่มีข้อมูลลับในหมายเหตุ
        </p>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* System tab — proof strip
/* ------------------------------------------------------------------ */

function StoreProofStrip({
  strip,
}: {
  strip: OwnerV2StoreSetupPayload["proof_strip"];
}) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            Proof 7 วัน
          </p>
          <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
            วันที่มีรอบส่งจริงของร้านนี้ ย้อนหลัง 7 วัน
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge color="light" size="sm">
            {strip.evidence_count}/7 วันสำเร็จ
          </Badge>
          {strip.missing_round_count > 0 ? (
            <Badge color="warning" size="sm">
              ขาด {strip.missing_round_count} รอบ
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {strip.days.map((day) => (
          <span
            className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-theme-xs font-medium ${storeProofDayClass(
              day.status,
            )}`}
            key={day.day}
            title={`Day ${day.day} · ${day.date} · ${storeProofDayLabel(day.status)}`}
          >
            D{day.day}
          </span>
        ))}
      </div>
      {strip.latest_success_at || strip.latest_problem_at ? (
        <p className="mt-3 text-theme-xs text-gray-500 dark:text-gray-400">
          {strip.latest_success_at
            ? `สำเร็จล่าสุด ${formatDateTime(strip.latest_success_at)}`
            : "ยังไม่มีรอบสำเร็จ"}
          {strip.latest_problem_at
            ? ` · ปัญหาล่าสุด ${formatDateTime(strip.latest_problem_at)}`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* System tab — business signal status manager
/* ------------------------------------------------------------------ */

const BUSINESS_SIGNAL_STATUSES: BusinessSignalStatus[] = [
  "open",
  "acknowledged",
  "resolved",
  "dismissed",
];

const businessSignalStatusLabel: Record<BusinessSignalStatus, string> = {
  open: "เปิดอยู่",
  acknowledged: "รับทราบ",
  resolved: "แก้แล้ว",
  dismissed: "ซ่อนรอบนี้",
};

const businessSignalStatusTone: Record<
  BusinessSignalStatus,
  "light" | "warning" | "success" | "error"
> = {
  open: "warning",
  acknowledged: "light",
  resolved: "success",
  dismissed: "light",
};

const businessSignalSeverityTone: Record<string, "error" | "warning" | "light"> = {
  critical: "error",
  warning: "warning",
  info: "light",
};

function BusinessSignalPanel({
  signals,
  tenantId,
  onReload,
}: {
  signals: BusinessSignalRecord[];
  tenantId: string;
  onReload: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  async function updateStatus(
    signal: BusinessSignalRecord,
    status: BusinessSignalStatus,
  ) {
    if (busyId !== null) {
      return;
    }
    setBusyId(signal.id);
    setMessage(null);
    try {
      await ownerV2Fetch(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/business-signals/${encodeURIComponent(signal.id)}`,
        {
          method: "PATCH",
          body: { status },
        },
      );
      setMessage({
        tone: "success",
        text: `${businessSignalStatusLabel[status]} “${signal.title}” แล้ว`,
      });
      onReload();
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "เปลี่ยนสถานะ signal ไม่สำเร็จ",
      });
    } finally {
      setBusyId(null);
    }
  }

  if (!signals.length) {
    return (
      <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
        <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
          Business signals
        </p>
        <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
          ยังไม่มีสัญญาณเตือนธุรกิจสำหรับร้านนี้ในสแนปชอตล่าสุด
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            Business signals ({signals.length})
          </p>
          <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
            จัดการสถานะเรื่องที่ต้องตรวจ — สถานะบันทึกลง audit log เพื่อให้ cockpit ตรงกัน
          </p>
        </div>
      </div>
      {message ? (
        <p
          className={`mb-3 text-theme-xs font-medium ${
            message.tone === "error" ? "text-error-600" : "text-success-600"
          }`}
        >
          {message.text}
        </p>
      ) : null}
      <div className="space-y-2">
        {signals.map((signal) => (
          <div
            className="flex flex-col gap-2 rounded-lg border border-gray-100 p-3 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between"
            key={signal.id}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-theme-sm font-semibold text-gray-900 dark:text-white">
                  {signal.title}
                </p>
                <Badge
                  color={businessSignalSeverityTone[signal.severity] ?? "light"}
                  size="sm"
                >
                  {signal.severity}
                </Badge>
                <Badge
                  color={businessSignalStatusTone[signal.status]}
                  size="sm"
                >
                  {businessSignalStatusLabel[signal.status]}
                </Badge>
              </div>
              {signal.insight ? (
                <p className="mt-1 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
                  {signal.insight}
                </p>
              ) : null}
              {signal.recommended_action ? (
                <p className="mt-1 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
                  แนะนำ: {signal.recommended_action}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              {BUSINESS_SIGNAL_STATUSES.filter((s) => s !== signal.status).map(
                (status) => (
                  <button
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-theme-xs font-medium text-gray-600 shadow-theme-xs transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                    disabled={busyId !== null}
                    key={status}
                    onClick={() => void updateStatus(signal, status)}
                    type="button"
                  >
                    {businessSignalStatusLabel[status]}
                  </button>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function storeProofDayClass(status: OwnerV2StoreSetupPayload["proof_strip"]["days"][number]["status"]) {
  switch (status) {
    case "success":
      return "bg-success-500/15 text-success-600 dark:text-success-400";
    case "partial":
      return "bg-blue-light-500/15 text-blue-light-600 dark:text-blue-light-400";
    case "failed":
      return "bg-error-500/15 text-error-600 dark:text-error-400";
    case "missing":
      return "bg-warning-500/15 text-warning-600 dark:text-warning-400";
    default:
      return "bg-gray-200 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400";
  }
}

function storeProofDayLabel(
  status: OwnerV2StoreSetupPayload["proof_strip"]["days"][number]["status"],
) {
  switch (status) {
    case "success":
      return "สำเร็จ";
    case "partial":
      return "รันแล้ว ยังไม่ครบ";
    case "failed":
      return "ล้มเหลว";
    case "missing":
      return "ไม่มีรอบ";
    default:
      return "ยังไม่ทราบ";
  }
}

/* ------------------------------------------------------------------ */
/* Loading skeleton
/* ------------------------------------------------------------------ */

function StoreDetailSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      <div className="h-10 w-72 animate-pulse rounded-lg bg-gray-100 dark:bg-white/[0.03]" />
      <div className="h-96 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pure helpers (data shape unchanged)
/* ------------------------------------------------------------------ */

function toStoreFormState(tenant: Tenant): StoreFormState {
  return {
    name: tenant.name,
    description: tenant.description ?? "",
    status:
      tenant.status === "cancelled"
        ? "suspended"
        : (tenant.status as StoreFormState["status"]),
    plan_code: tenant.planCode,
    current_period_end_date: isoToDateInput(tenant.currentPeriodEnd),
    billing_cycle: tenant.billingCycle ?? null,
    suspended_reason: tenant.suspendedReason ?? "",
  };
}

function todayDateString() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function dateToDateInput(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

function isoToDateInput(value?: string | null) {
  if (!value) {
    return "";
  }
  return value.slice(0, 10);
}

function dateInputToIso(value: string) {
  if (!value) {
    return null;
  }
  return new Date(`${value}T00:00:00+07:00`).toISOString();
}

function formatDate(value?: string | null) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

type StoreVerdict = {
  tone: "success" | "warning" | "error";
  title: string;
  text: string;
  actionLabel: string;
  href: string;
};

/**
 * Derive the single most useful "what now" verdict for a store, following
 * doc 20 §"Empty And Error States": missing SML → missing LINE → failed round
 * → ready. Mirrors the cockpit priority but scoped to this tenant's detail.
 */
function deriveStoreVerdict(
  detail: OwnerV2StoreSetupPayload,
): StoreVerdict | null {
  const health = detail.summary.health;
  const tenantId = detail.summary.tenant.id;
  const tenantPath = `/owner-v2/stores/${encodeURIComponent(tenantId)}`;

  // SML configured but latest round failed (incident).
  if (
    health.latest_notification_run_status === "failed" ||
    health.latest_report_status === "failed"
  ) {
    return {
      tone: "error",
      title: "รอบล่าสุดยังใช้สรุปธุรกิจไม่ได้",
      text: "ระบบบันทึก incident แล้ว ให้ตรวจสาเหตุจาก SML/JavaWS ก่อนรันใหม่",
      actionLabel: "ดูรายละเอียดปัญหา",
      href: detail.latest_javaws_failure
        ? `${tenantPath}/sml`
        : `${tenantPath}/reports`,
    };
  }

  // No SML datasource yet.
  if (!health.datasource_configured) {
    return {
      tone: "warning",
      title: "ยังดึงรายงานไม่ได้",
      text: "ร้านนี้ยังไม่ได้ตั้งค่า SML JavaWS จึงยังส่ง brief จริงไม่ได้",
      actionLabel: "ตั้งค่า SML",
      href: `${tenantPath}/sml`,
    };
  }

  // SML ok but LINE missing.
  if (
    health.line_targets_enabled === 0 ||
    health.latest_line_delivery_status === "failed"
  ) {
    return {
      tone: "warning",
      title: "พร้อมดึงรายงาน แต่ยังส่งผู้บริหารไม่ได้",
      text: "เลือก LINE OA และอนุมัติผู้รับก่อนเปิดรอบแจ้งเตือน",
      actionLabel: "ตั้งค่า LINE",
      href: `${tenantPath}/line`,
    };
  }

  // All ready.
  if (
    health.datasource_configured &&
    health.line_targets_enabled > 0 &&
    health.notification_rules_enabled > 0
  ) {
    return {
      tone: "success",
      title: "ร้านหลักพร้อมใช้งาน",
      text: "รอรอบแจ้งเตือนถัดไป หรือเปิดดู proof ล่าสุดได้",
      actionLabel: "ดูรอบล่าสุด",
      href: `${tenantPath}?step=notifications`,
    };
  }

  return null;
}

function heroToneConfig(tone: StoreVerdict["tone"]) {
  switch (tone) {
    case "success":
      return {
        border: "border-success-500",
        bg: "bg-success-50 dark:bg-success-500/10",
        divider: "border-success-500/30 dark:border-success-500/20",
        iconTile: "bg-success-500/15 text-success-600 dark:text-success-400",
      };
    case "error":
      return {
        border: "border-error-500",
        bg: "bg-error-50 dark:bg-error-500/10",
        divider: "border-error-500/30 dark:border-error-500/20",
        iconTile: "bg-error-500/15 text-error-600 dark:text-error-400",
      };
    default:
      return {
        border: "border-warning-500",
        bg: "bg-warning-50 dark:bg-warning-500/10",
        divider: "border-warning-500/30 dark:border-warning-500/20",
        iconTile: "bg-warning-500/15 text-warning-600 dark:text-warning-400",
      };
  }
}

function v2HrefForCheck(tenantId: string, check: OwnerV2StoreSetupCheck) {
  const encodedTenantId = encodeURIComponent(tenantId);
  if (check.key === "store_active") {
    return `/owner-v2/stores/${encodedTenantId}?tab=advanced`;
  }
  if (check.key === "sml_javaws") {
    return `/owner-v2/stores/${encodedTenantId}/sml`;
  }
  if (check.key === "report_test") {
    return `/owner-v2/stores/${encodedTenantId}/reports`;
  }
  if (check.key === "line_channel" || check.key === "line_target") {
    return `/owner-v2/stores/${encodedTenantId}/line`;
  }
  if (check.key === "report_permissions") {
    return `/owner-v2/stores/${encodedTenantId}/permissions`;
  }
  if (check.key === "notification_plan") {
    return `/owner-v2/stores/${encodedTenantId}/notifications`;
  }
  return `/owner-v2/stores/${encodedTenantId}`;
}

const CHECK_TO_STEP: Record<string, OwnerV2StepId> = {
  store_active: "store",
  sml_javaws: "sml",
  report_test: "reports",
  line_channel: "line",
  line_target: "line",
  report_permissions: "permissions",
  notification_plan: "notifications",
};

const STEP_ACTION_LABEL: Record<OwnerV2StepId, string> = {
  store: "ตรวจร้าน",
  sml: "เชื่อม SML",
  reports: "ทดสอบรายงาน",
  line: "ตั้ง LINE",
  permissions: "ตรวจสิทธิ์",
  notifications: "ตั้งแผน",
};

/**
 * Map the store-setup readiness checks into the wizard step shape, so the
 * wizard nav mirrors the readiness checklist (deduped per step + in step
 * order) instead of duplicating the readiness panel.
 */
function buildWizardSteps(
  checks: OwnerV2StoreSetupCheck[],
  tenantId: string,
): OwnerV2SetupStep[] {
  const seenSteps = new Set<OwnerV2StepId>();
  const steps: OwnerV2SetupStep[] = [];
  for (const check of checks) {
    const step = CHECK_TO_STEP[check.key] ?? "store";
    if (seenSteps.has(step)) {
      continue;
    }
    seenSteps.add(step);
    steps.push({
      key: check.key,
      ok: check.ok,
      label: check.label,
      detail: check.detail,
      step,
      action_label: STEP_ACTION_LABEL[step],
      href: `/owner-v2/stores/${encodeURIComponent(tenantId)}?step=${step}`,
    });
  }
  // Ensure the "store" step is always present (it maps to the tenant info view).
  if (!seenSteps.has("store")) {
    steps.unshift({
      key: "store_active",
      ok: true,
      label: "ข้อมูลร้าน",
      detail: "ข้อมูลพื้นฐานของร้าน",
      step: "store",
      action_label: "ดูร้าน",
      href: `/owner-v2/stores/${encodeURIComponent(tenantId)}?step=store`,
    });
  }
  return steps;
}

function parseTab(value: string | null): StoreTab {
  return value && VALID_TABS.includes(value as StoreTab)
    ? (value as StoreTab)
    : "setup";
}

/**
 * Per-tab attention badge. Returns null when there's nothing to surface so
 * the tab stays clean. Tone follows the semantic families (warning/error).
 */
function tabBadgeFor(
  tab: StoreTab,
  ctx: {
    readiness: OwnerV2StoreSetupPayload["readiness"];
    hasJavaWsFailure: boolean;
    openSignals: number;
    dirty: boolean;
  },
): { label: string; className: string } | null {
  if (tab === "setup") {
    const remaining = ctx.readiness.total - ctx.readiness.completed;
    if (remaining > 0) {
      return {
        label: String(remaining),
        className: "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-orange-400",
      };
    }
    return null;
  }
  if (tab === "system") {
    const attention =
      (ctx.hasJavaWsFailure ? 1 : 0) + ctx.openSignals;
    if (attention > 0) {
      return {
        label: String(attention),
        className: "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500",
      };
    }
    return null;
  }
  if (tab === "advanced") {
    return ctx.dirty
      ? {
          label: "•",
          className: "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400",
        }
      : null;
  }
  return null;
}
