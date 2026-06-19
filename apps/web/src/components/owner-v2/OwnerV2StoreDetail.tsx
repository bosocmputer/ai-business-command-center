"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { findSensitiveTenantNoteHints, type Tenant } from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { AlertIcon, CheckCircleIcon } from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import OwnerV2SetupWizard from "./OwnerV2SetupWizard";
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
  suspended_reason: string;
};

type DetailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: OwnerV2StoreSetupPayload };

const editableStatuses: StoreFormState["status"][] = [
  "trial",
  "active",
  "past_due",
  "suspended",
];

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

  const detail = detailState.data;
  const tenant = detail.summary.tenant;
  const readiness = detail.readiness;
  const nextAction = readiness.next_action;
  const searchParams = useSearchParams();
  const wizardSteps = useMemo(() => buildWizardSteps(readiness.checks, tenant.id), [readiness.checks, tenant.id]);
  const initialWizardStep = parseStep(searchParams.get("step"));
  const showStoreForm = tenant.status !== "cancelled" || message;

  const wizardTenant = useMemo(
    () => ({
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
      plan_code: tenant.planCode,
      dashboard_path: detail.summary.customer_dashboard_path,
      ready: readiness.ready,
      completed_steps: readiness.completed,
      total_steps: readiness.total,
      next_action: null,
      health: {
        datasource_configured: detail.summary.health.datasource_configured,
        line_targets_enabled: detail.summary.health.line_targets_enabled,
        notification_rules_enabled:
          detail.summary.health.notification_rules_enabled,
        latest_report_status: detail.summary.health.latest_report_status,
        latest_notification_run_status:
          detail.summary.health.latest_notification_run_status,
        critical_business_signals:
          detail.summary.health.critical_business_signals,
      },
    }),
    [tenant, detail.summary, readiness],
  );

  const verdict = deriveStoreVerdict(detail);

  return (
    <div className="space-y-5 sm:space-y-6">
      {message ? (
        <Notice tone={message.tone} title="สถานะข้อมูลร้าน" text={message.text} />
      ) : null}

      {verdict ? (
        <StoreVerdictBanner href={verdict.href} tenantId={tenant.id} tone={verdict.tone} title={verdict.title} text={verdict.text} actionLabel={verdict.actionLabel} />
      ) : null}

      <Panel>
        <PanelHeader
          action={
            tenant.status === "cancelled" ? (
              <Badge color="error">ยกเลิกแล้ว</Badge>
            ) : (
              <Badge color={readiness.ready ? "success" : "warning"}>
                {readiness.ready
                  ? "พร้อมใช้งาน"
                  : `${readiness.completed}/${readiness.total} พร้อม`}
              </Badge>
            )
          }
          title="สิ่งที่ต้องทำ"
        />
        <PanelBody>
          {nextAction ? (
            <div className="rounded-xl border border-warning-500 bg-warning-50 p-4 dark:border-warning-500/30 dark:bg-warning-500/10">
              <div className="flex items-start gap-3">
                <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-warning-600 dark:text-warning-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                    ขั้นต่อไป: {nextAction.label}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                    {nextAction.detail}
                  </p>
                  <Link
                    className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-theme-xs transition hover:bg-brand-600 sm:w-auto"
                    href={v2HrefForCheck(tenant.id, nextAction)}
                  >
                    เปิดขั้นนี้
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <Notice
              tone="success"
              title="ร้านนี้พร้อมใช้งาน"
              text="ตรวจหน้าลูกค้าหรือรอบแจ้งเตือนได้จากหน้านี้"
            />
          )}
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
            <div
              className={`h-full rounded-full ${
                readiness.ready ? "bg-success-500" : "bg-brand-500"
              }`}
              style={{
                width: `${Math.round(
                  (readiness.completed / Math.max(1, readiness.total)) * 100,
                )}%`,
              }}
            />
          </div>
          <div className="custom-scrollbar mt-4 flex max-h-[320px] flex-col gap-2 overflow-y-auto">
            {readiness.checks.map((check) => (
              <ReadinessRow check={check} key={check.key} tenantId={tenant.id} />
            ))}
          </div>
        </PanelBody>
      </Panel>

      <OwnerV2SetupWizard
        initialStep={initialWizardStep}
        steps={wizardSteps}
        tenant={wizardTenant}
      />

      <Panel>
        <PanelHeader title="สถานะระบบของร้าน" />
        <PanelBody>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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
              tone={
                detail.summary.health.line_targets_enabled > 0
                  ? "success"
                  : "warning"
              }
              value={`${detail.summary.health.line_targets_enabled}/${detail.summary.health.line_targets_total} ผู้รับ`}
            />
            <Fact
              label="แผนแจ้งเตือน"
              tone={
                detail.summary.health.notification_rules_enabled > 0
                  ? "success"
                  : "warning"
              }
              value={`${detail.summary.health.notification_rules_enabled}/${detail.summary.health.notification_rules_total} แผนเปิด`}
            />
            <Fact
              label="Business signals"
              tone={
                detail.summary.health.critical_business_signals > 0
                  ? "error"
                  : detail.summary.health.open_business_signals > 0
                    ? "warning"
                    : "success"
              }
              value={`${detail.summary.health.open_business_signals} เปิดอยู่`}
            />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Fact
              label="รายงานล่าสุด"
              value={
                detail.summary.health.latest_report_run_at
                  ? `${formatRunStatus(detail.summary.health.latest_report_status)} · ${formatDateTime(detail.summary.health.latest_report_run_at)}`
                  : "ยังไม่มี run"
              }
            />
            <Fact
              label="Snapshot ล่าสุด"
              value={formatDateTime(detail.summary.health.latest_snapshot_at)}
            />
            <Fact
              label="LINE delivery ล่าสุด"
              value={
                detail.summary.health.latest_line_delivery_at
                  ? `${formatLineDeliveryStatus(detail.summary.health.latest_line_delivery_status)} · ${formatDateTime(detail.summary.health.latest_line_delivery_at)}`
                  : "ยังไม่มี delivery"
              }
            />
            <Fact
              label="แจ้งเตือนล่าสุด"
              value={
                detail.summary.health.latest_notification_run_at
                  ? `${formatRunStatus(detail.summary.health.latest_notification_run_status)} · ${formatDateTime(detail.summary.health.latest_notification_run_at)}`
                  : "ยังไม่มีรอบ"
              }
            />
          </div>
          {detail.latest_javaws_failure ? (
            <div className="mt-5">
              <Notice
                tone="error"
                title={`JavaWS incident ล่าสุด: ${detail.latest_javaws_failure.failure_phase ?? "unknown"}`}
                text={`รายงาน ${detail.latest_javaws_failure.report_key} phase ${detail.latest_javaws_failure.failure_phase ?? "unknown"} · ${detail.latest_javaws_failure.safe_error_message ?? "ไม่มีรายละเอียดปลอดภัย"} · ${formatDateTime(detail.latest_javaws_failure.finished_at)}`}
              />
            </div>
          ) : null}
          {detail.proof_strip.eligible ? (
            <div className="mt-5">
              <StoreProofStrip strip={detail.proof_strip} />
            </div>
          ) : null}
        </PanelBody>
      </Panel>

      {showStoreForm ? (
        <details className="group rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                แก้ข้อมูลร้าน
              </h3>
              <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                ชื่อร้าน, แพ็กเกจ, สถานะ และหมายเหตุ (คลิกเพื่อขยาย)
              </p>
            </div>
            <span className="text-theme-xs text-gray-400 transition group-open:rotate-180">
              ▼
            </span>
          </summary>
          <form className="mt-5 space-y-5" onSubmit={saveStore}>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Field label="ชื่อร้าน">
                <input
                  className="owner-v2-input"
                  disabled={tenant.status === "cancelled"}
                  onChange={(event) =>
                    setForm((current) =>
                      current
                        ? { ...current, name: event.target.value }
                        : current,
                    )
                  }
                  value={form.name}
                />
              </Field>
              <Field label="tenant_id">
                <input className="owner-v2-input font-mono" disabled value={tenant.id} />
              </Field>
              <Field label="Plan">
                <select
                  className="owner-v2-input"
                  disabled={tenant.status === "cancelled"}
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
              </Field>
              <Field label="สถานะ">
                <select
                  className="owner-v2-input"
                  disabled={tenant.status === "cancelled"}
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
              </Field>
              <Field help="เว้นว่างได้ถ้ายังไม่ต้องกำหนดรอบสิทธิ์" label="สิ้นสุดรอบใช้งาน">
                <input
                  className="owner-v2-input"
                  disabled={tenant.status === "cancelled"}
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
              </Field>
              <Field
                help={
                  form.status === "suspended"
                    ? "ข้อความนี้ช่วยให้ admin คนถัดไปรู้เหตุผล"
                    : "ใช้เมื่อสถานะเป็นระงับ"
                }
                label="เหตุผลระงับ"
              >
                <input
                  className="owner-v2-input"
                  disabled={
                    tenant.status === "cancelled" || form.status !== "suspended"
                  }
                  onChange={(event) =>
                    setForm((current) =>
                      current
                        ? { ...current, suspended_reason: event.target.value }
                        : current,
                    )
                  }
                  value={form.suspended_reason}
                />
              </Field>
            </div>
            <Field
              help={
                sensitiveHints.length
                  ? `พบคำที่เสี่ยงเป็นข้อมูลลับ: ${sensitiveHints.join(", ")}`
                  : "ห้ามใส่ token/password/secret ในช่องนี้"
              }
              label="หมายเหตุ"
            >
              <textarea
                className="owner-v2-input min-h-28"
                disabled={tenant.status === "cancelled"}
                onChange={(event) =>
                  setForm((current) =>
                    current
                      ? { ...current, description: event.target.value }
                      : current,
                  )
                }
                value={form.description}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button className="w-full sm:w-auto" disabled={saveDisabled} type="submit">
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
              <p className="w-full text-xs text-gray-500 dark:text-gray-400 sm:w-auto">
                ปุ่มบันทึกเปิดเมื่อข้อมูลเปลี่ยนและไม่มีข้อมูลลับในหมายเหตุ
              </p>
            </div>
          </form>
        </details>
      ) : null}
    </div>
  );
}

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

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
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
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
        {title}
      </h3>
      {action}
    </div>
  );
}

function PanelBody({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
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
            className="inline-flex w-full shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-theme-xs font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200 sm:w-auto"
            href={v2HrefForCheck(tenantId, check)}
          >
            {check.ok ? "ดู" : "ทำต่อ"}
          </Link>
        </div>
      </div>
    </div>
  );
}

function QuickLink({
  href,
  label,
  value,
}: {
  href: string;
  label: string;
  value: string;
}) {
  return (
    <Link
      className="block rounded-lg p-3 transition hover:bg-gray-50 hover:text-brand-600 dark:hover:bg-white/[0.03] dark:hover:text-brand-400"
      href={href}
    >
      <span className="block text-theme-sm font-medium text-gray-800 dark:text-white/90">
        {label}
      </span>
      <span className="mt-1 block break-words text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
        {value}
      </span>
    </Link>
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
      <div className="flex items-start justify-between gap-2">
        <p className="text-theme-xs text-gray-500 dark:text-gray-400">
          {label}
        </p>
        <Badge color={tone} size="sm">
          {tone === "success"
            ? "ปกติ"
            : tone === "warning"
              ? "ต้องดู"
              : tone === "error"
                ? "สำคัญ"
          : "ข้อมูล"}
        </Badge>
      </div>
      <p className="mt-3 break-words text-theme-sm font-semibold text-gray-800 dark:text-white/90">
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
  const classes = {
    success:
      "border-success-500 bg-success-50 dark:border-success-500/30 dark:bg-success-500/15",
    warning:
      "border-warning-500 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/15",
    error:
      "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15",
  }[tone];
  const Icon = tone === "success" ? CheckCircleIcon : AlertIcon;
  const iconClass =
    tone === "success"
      ? "text-success-500"
      : tone === "warning"
        ? "text-warning-500 dark:text-orange-400"
        : "text-error-500";
  return (
    <div className={`rounded-xl border p-4 ${classes}`}>
      <div className="flex items-start gap-3">
        <Icon className={`-mt-0.5 h-6 w-6 shrink-0 ${iconClass}`} />
        <div>
          <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
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

function StoreDetailSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="h-[520px] animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
        <div className="space-y-6">
          <div className="h-80 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
          <div className="h-48 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
        </div>
      </div>
      <div className="h-56 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
    </div>
  );
}

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
    suspended_reason: tenant.suspendedReason ?? "",
  };
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

function StoreVerdictBanner({
  actionLabel,
  href,
  tenantId,
  text,
  title,
  tone,
}: {
  actionLabel: string;
  href: string;
  tenantId: string;
  text: string;
  title: string;
  tone: StoreVerdict["tone"];
}) {
  void tenantId;
  return (
    <div
      className={`rounded-2xl border p-5 ${
        tone === "success"
          ? "border-success-500 bg-success-50 dark:border-success-500/30 dark:bg-success-500/15"
          : tone === "warning"
            ? "border-warning-500 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/15"
            : "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {title}
          </p>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {text}
          </p>
        </div>
        <Link
          className="inline-flex w-full shrink-0 items-center justify-center rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-theme-xs transition hover:bg-brand-600 sm:w-auto"
          href={href}
        >
          {actionLabel}
        </Link>
      </div>
    </div>
  );
}

function v2HrefForCheck(tenantId: string, check: OwnerV2StoreSetupCheck) {
  const encodedTenantId = encodeURIComponent(tenantId);
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

const VALID_STEPS: OwnerV2StepId[] = [
  "store",
  "sml",
  "reports",
  "line",
  "permissions",
  "notifications",
];

function parseStep(value: string | null): OwnerV2StepId {
  return value && VALID_STEPS.includes(value as OwnerV2StepId)
    ? (value as OwnerV2StepId)
    : "store";
}


function formatTenantStatus(status: string) {
  const labels: Record<string, string> = {
    trial: "ทดลองใช้",
    active: "ใช้งาน",
    past_due: "ค้างชำระ",
    suspended: "ระงับ",
    cancelled: "ยกเลิก",
  };
  return labels[status] ?? status;
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

function formatLineDeliveryStatus(status?: string | null) {
  if (!status) {
    return "ยังไม่ทราบ";
  }
  const labels: Record<string, string> = {
    sent: "ส่งแล้ว",
    failed: "ส่งไม่สำเร็จ",
    skipped: "ข้าม",
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
