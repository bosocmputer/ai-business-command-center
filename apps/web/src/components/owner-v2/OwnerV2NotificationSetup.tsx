"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BANGKOK_TIME_ZONE,
  getReportCatalogEntry,
  getReportPresetEntry,
  reportKeyValues,
  reportPresetKeyValues,
  type LineChannelRecord,
  type LineTargetRecord,
  type NotificationDigestMode,
  type NotificationPeriodPreset,
  type NotificationPeriodStrategy,
  type NotificationRuleRunRecord,
  type ReportKey,
  type ReportPresetKey,
} from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { AlertIcon, CheckCircleIcon, InfoIcon, PlusIcon } from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import type {
  OwnerV2LineSetupPayload,
  OwnerV2NotificationSetupPayload,
} from "./types";

type OwnerNotificationRule = OwnerV2NotificationSetupPayload["rules"][number];

type NotificationSetupState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "success";
      notifications: OwnerV2NotificationSetupPayload;
      line: OwnerV2LineSetupPayload;
    };

type NotificationFormState = {
  name: string;
  enabled: boolean;
  digestMode: NotificationDigestMode;
  periodPreset: NotificationPeriodPreset;
  reportKeys: ReportKey[];
  targetIds: string[];
  timeInput: string;
  times: string[];
  weekdays: number[];
  manualDate: string;
  manualTime: string;
};

type NotificationRuleRunResult = {
  ok: boolean;
  accepted?: boolean;
  reused?: boolean;
  status?: NotificationRuleRunRecord["status"] | "sent" | "processed" | "skipped";
  run_id?: string;
  run?: NotificationRuleRunRecord;
  mode?: "dry_run" | "send";
};

const ownerPeriodStrategy: NotificationPeriodStrategy = "executive_checkpoints";

const weekdays = [
  { label: "จ", value: 1 },
  { label: "อ", value: 2 },
  { label: "พ", value: 3 },
  { label: "พฤ", value: 4 },
  { label: "ศ", value: 5 },
  { label: "ส", value: 6 },
  { label: "อา", value: 7 },
] as const;

const digestModes: Array<{
  value: NotificationDigestMode;
  label: string;
  description: string;
}> = [
  {
    value: "action_only",
    label: "ส่งเรื่องที่ต้องดูเป็นหลัก",
    description: "ถ้าไม่มีเรื่องต้องดู ระบบ fallback เป็นรายงานเดิม",
  },
  {
    value: "all_reports",
    label: "ส่งครบทุก report",
    description: "เหมาะกับช่วงตรวจระบบหรือร้านที่อยากอ่านตัวเลขครบ",
  },
];

const periodPresets: Array<{
  value: NotificationPeriodPreset;
  label: string;
  description: string;
}> = [
  {
    value: "yesterday",
    label: "เมื่อวาน",
    description: "เหมาะกับรอบ 08:00",
  },
  {
    value: "today_so_far",
    label: "วันนี้ถึงตอนนี้",
    description: "เหมาะกับรอบเย็น",
  },
  {
    value: "last_7_days",
    label: "7 วันล่าสุด",
    description: "ใช้เมื่ออยากดูแนวโน้มสั้น",
  },
];

const categoryLabels: Record<string, string> = {
  ar: "ลูกหนี้",
  gross_profit: "กำไร",
  inventory: "สต็อก",
  purchase: "ซื้อ",
  sales: "ขาย",
};

const emptyNotificationRuns: NotificationRuleRunRecord[] = [];
const emptyNotificationRules: OwnerNotificationRule[] = [];
const emptyChannels: LineChannelRecord[] = [];
const emptyTargets: LineTargetRecord[] = [];

export default function OwnerV2NotificationSetup({
  tenantId,
}: {
  tenantId: string;
}) {
  const [state, setState] = useState<NotificationSetupState>({
    status: "loading",
  });
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<NotificationFormState>(emptyForm());
  const [initialForm, setInitialForm] =
    useState<NotificationFormState>(emptyForm());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [runResult, setRunResult] = useState<NotificationRuleRunResult | null>(
    null,
  );
  const [sendConfirmRuleId, setSendConfirmRuleId] = useState<string | null>(
    null,
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      setMessage(null);
      try {
        const [notifications, line] = await Promise.all([
          ownerV2Fetch<OwnerV2NotificationSetupPayload>(
            `/api/owner/tenants/${encodeURIComponent(
              tenantId,
            )}/notification-setup`,
            { signal },
          ),
          ownerV2Fetch<OwnerV2LineSetupPayload>(
            `/api/owner/tenants/${encodeURIComponent(tenantId)}/line-setup`,
            { signal },
          ),
        ]);
        if (signal?.aborted) {
          return;
        }
        setState({ status: "success", notifications, line });
        setSelectedRuleId((current) => {
          if (current && notifications.rules.some((rule) => rule.id === current)) {
            return current;
          }
          const firstRule = notifications.rules[0] ?? null;
          const nextForm = firstRule
            ? formFromRule(firstRule)
            : defaultForm({ targets: line.targets, channels: line.channels });
          setForm(nextForm);
          setInitialForm(nextForm);
          return firstRule?.id ?? null;
        });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดแผนแจ้งเตือนไม่สำเร็จ",
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

  const rules =
    state.status === "success"
      ? state.notifications.rules
      : emptyNotificationRules;
  const recentRuns =
    state.status === "success"
      ? state.notifications.recent_runs
      : emptyNotificationRuns;
  const lineTargets =
    state.status === "success" ? state.line.targets : emptyTargets;
  const lineChannels =
    state.status === "success" ? state.line.channels : emptyChannels;
  const selectedRule = selectedRuleId
    ? rules.find((rule) => rule.id === selectedRuleId) ?? null
    : null;

  const selectedTargetReadiness = useMemo(
    () =>
      form.targetIds
        .map((targetId) => lineTargets.find((target) => target.id === targetId))
        .filter((target): target is LineTargetRecord => Boolean(target))
        .map((target) => ({
          target,
          readiness: getLineTargetDeliveryReadiness({
            channels: lineChannels,
            reportKeys: form.reportKeys,
            target,
          }),
        })),
    [form.reportKeys, form.targetIds, lineChannels, lineTargets],
  );
  const blockedTarget = selectedTargetReadiness.find(
    (
      item,
    ): item is {
      readiness: Extract<LineTargetDeliveryReadiness, { ok: false }>;
      target: LineTargetRecord;
    } => !item.readiness.ok,
  );
  const selectedTargetBlockedReason = blockedTarget?.readiness.message ?? null;
  const dirty = !sameForm(form, initialForm);
  const saveBlockedReason = getSaveBlockedReason({
    enabled: form.enabled,
    form,
    selectedTargetBlockedReason,
  });
  const actionBlockedReason = getActionBlockedReason({
    dirty,
    form,
    selectedRuleId,
    selectedTargetBlockedReason,
  });
  const saveDisabled =
    busy !== null || state.status !== "success" || saveBlockedReason !== null;
  const dryRunDisabled =
    busy !== null || state.status !== "success" || actionBlockedReason !== null;
  const sendDisabled =
    busy !== null || state.status !== "success" || actionBlockedReason !== null;

  function applyRule(rule: OwnerNotificationRule) {
    const nextForm = formFromRule(rule);
    setSelectedRuleId(rule.id);
    setForm(nextForm);
    setInitialForm(nextForm);
    setRunResult(null);
    setSendConfirmRuleId(null);
    setMessage(null);
  }

  function startNewRule() {
    const nextForm = defaultForm({
      channels: lineChannels,
      targets: lineTargets,
    });
    setSelectedRuleId(null);
    setForm(nextForm);
    setInitialForm(nextForm);
    setRunResult(null);
    setSendConfirmRuleId(null);
    setMessage({
      tone: "success",
      text: "เริ่มแผนใหม่แล้ว เลือกเวลา รายงาน และผู้รับก่อนบันทึก",
    });
  }

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveDisabled) {
      setMessage({
        tone: "warning",
        text: saveBlockedReason ?? "ยังบันทึกแผนไม่ได้ กรุณาตรวจข้อมูลในฟอร์ม",
      });
      return;
    }

    setBusy("save-rule");
    setMessage(null);
    try {
      const payload = buildRulePayload({ form, tenantId });
      const saved = await ownerV2Fetch<OwnerNotificationRule>(
        selectedRuleId
          ? `/api/owner/notification-rules/${encodeURIComponent(selectedRuleId)}`
          : "/api/owner/notification-rules",
        {
          method: selectedRuleId ? "PATCH" : "POST",
          body: selectedRuleId
            ? {
                digest_mode: payload.digest_mode,
                enabled: payload.enabled,
                name: payload.name,
                period_preset: payload.period_preset,
                period_strategy: payload.period_strategy,
                report_keys: payload.report_keys,
                schedule: payload.schedule,
                target_ids: payload.target_ids,
                timezone: payload.timezone,
              }
            : payload,
        },
      );
      const nextForm = formFromRule(saved);
      setSelectedRuleId(saved.id);
      setForm(nextForm);
      setInitialForm(nextForm);
      setSendConfirmRuleId(null);
      setMessage({
        tone: "success",
        text: `${saved.name}: บันทึกแผนแจ้งเตือนแล้ว`,
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "บันทึกแผนแจ้งเตือนไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  async function executeRule(mode: "dry_run" | "send") {
    // Guard against double-invocation before busy flips the buttons disabled.
    if (busy !== null) {
      return;
    }
    if (mode === "send" && sendConfirmRuleId !== selectedRuleId) {
      setSendConfirmRuleId(selectedRuleId);
      setMessage({
        tone: "warning",
        text: "ตรวจแผนและผู้รับอีกครั้ง แล้วกดปุ่มอีกครั้งเพื่อยืนยัน ระบบจะส่ง LINE ไปยังผู้รับที่เลือกทันที",
      });
      return;
    }
    if (mode === "dry_run" && dryRunDisabled) {
      setMessage({
        tone: "warning",
        text: actionBlockedReason ?? "ยังทดสอบแผนไม่ได้",
      });
      return;
    }
    if (mode === "send" && sendDisabled) {
      setMessage({
        tone: "warning",
        text: actionBlockedReason ?? "ยังส่งจริงไม่ได้",
      });
      return;
    }
    if (!selectedRuleId) {
      return;
    }

    setBusy(`${mode}-${selectedRuleId}`);
    setMessage(null);
    try {
      const body: {
        client_request_id: string;
        mode: "dry_run" | "send";
        scheduled_local_date?: string;
        scheduled_local_time?: string;
      } = {
        client_request_id: createClientRequestId(),
        mode,
      };
      if (form.manualDate && form.manualTime) {
        body.scheduled_local_date = form.manualDate;
        body.scheduled_local_time = form.manualTime;
      }
      const result = await ownerV2Fetch<NotificationRuleRunResult>(
        `/api/owner/notification-rules/${encodeURIComponent(selectedRuleId)}/${
          mode === "send" ? "run-now" : "test-run"
        }`,
        {
          method: "POST",
          body,
        },
      );
      setRunResult(result);
      setSendConfirmRuleId(null);
      setMessage({
        tone: "success",
        text:
          mode === "send"
            ? "รับงานส่งจริงแล้ว ระบบกำลังรันรายงานและส่ง LINE"
            : "รับงานทดสอบแล้ว ระบบกำลังรันรายงานโดยไม่ส่ง LINE จริง",
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "รันแผนแจ้งเตือนไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "loading") {
    return <NotificationSkeleton />;
  }

  if (state.status === "error") {
    return (
      <Panel>
        <PanelBody>
          <Notice
            text={`${state.message} ลองรีเฟรชหน้านี้ หรือตรวจ session ผู้ดูแล`}
            title="โหลดแผนแจ้งเตือนไม่สำเร็จ"
            tone="error"
          />
          <Button
            className="mt-4"
            onClick={() => void load()}
            size="sm"
            type="button"
          >
            รีเฟรชแผนแจ้งเตือน
          </Button>
        </PanelBody>
      </Panel>
    );
  }

  const enabledRules = rules.filter((rule) => rule.enabled);
  const activeRuns = recentRuns.filter(isNotificationRunActive);
  const failedRuns = recentRuns.filter((run) => run.status === "failed");
  const defaultTargetIds = state.line.targets
    .filter((target) => target.approved && target.enabled)
    .slice(0, 1)
    .map((target) => target.id);
  const canOpenPreset = state.line.targets.some(
    (target) => target.approved,
  );

  function applyPreset(preset: {
    name: string;
    digestMode: NotificationDigestMode;
    enabled: boolean;
    reportKeys: ReportKey[];
    targetIds: string[];
    times: string[];
    weekdays: number[];
  }) {
    setSelectedRuleId(null);
    setForm({
      name: preset.name,
      enabled: preset.enabled,
      digestMode: preset.digestMode,
      periodPreset: "yesterday",
      reportKeys: preset.reportKeys,
      targetIds: preset.targetIds,
      times: preset.times,
      weekdays: preset.weekdays,
      timeInput: "",
      manualDate: "",
      manualTime: "",
    });
    setMessage({
      tone: "warning",
      text: `กรอก preset “${preset.name}” ให้แล้ว ตรวจรายละเอียดก่อนบันทึก`,
    });
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {message ? (
        <Notice
          text={message.text}
          title="สถานะแผนแจ้งเตือน"
          tone={message.tone}
        />
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NotificationStat label="แผนทั้งหมด" value={rules.length} />
        <NotificationStat label="เปิดใช้งาน" tone="success" value={enabledRules.length} />
        <NotificationStat label="รอบล้มเหลว" tone={failedRuns.length ? "error" : "success"} value={failedRuns.length} />
        <NotificationStat label="ผู้รับพร้อมส่ง" tone={canOpenPreset ? "success" : "warning"} value={state.notifications.enabled_target_count} />
      </section>

      <Panel>
        <PanelHeader
          description="คลิกเพื่อกรอกแผนให้พร้อมก่อนบันทึก"
          title="เริ่มจากแผนแนะนำ"
        />
        <PanelBody>
          <div className="grid gap-3 lg:grid-cols-3">
            <PresetCard
              badge="แนะนำ"
              description="ส่งเรื่องสำคัญตอนเช้าให้ผู้บริหารก่อนเปิดร้าน"
              disabled={!canOpenPreset}
              onClick={() =>
                applyPreset({
                  name: "Owner Daily Brief 08:00",
                  digestMode: "action_only",
                  enabled: canOpenPreset,
                  reportKeys: ["sales_goods_services", "purchase_goods_payables"],
                  targetIds: defaultTargetIds,
                  times: ["08:00"],
                  weekdays: [1, 2, 3, 4, 5, 6, 7],
                })
              }
              title="Owner Daily Brief 08:00"
            />
            <PresetCard
              badge="รอบเย็น"
              description="ดูยอดระหว่างวันหลังปิดรอบงาน"
              disabled={!canOpenPreset}
              onClick={() =>
                applyPreset({
                  name: "Evening Sales Check 18:30",
                  digestMode: "action_only",
                  enabled: canOpenPreset,
                  reportKeys: ["sales_goods_services", "purchase_goods_payables"],
                  targetIds: defaultTargetIds,
                  times: ["18:30"],
                  weekdays: [1, 2, 3, 4, 5, 6, 7],
                })
              }
              title="Evening Sales Check 18:30"
            />
            <PresetCard
              badge="Proof"
              description="เก็บหลักฐาน production proof แบบครบชุด"
              disabled={!canOpenPreset}
              onClick={() =>
                applyPreset({
                  name: "7-Day Proof Full Reports",
                  digestMode: "all_reports",
                  enabled: false,
                  reportKeys: [
                    "sales_goods_services",
                    "purchase_goods_payables",
                    "gross_profit_by_product",
                    "gross_profit_by_ar_customer",
                    "stock_balance",
                    "ar_customer_movement",
                  ],
                  targetIds: defaultTargetIds,
                  times: ["08:00"],
                  weekdays: [1, 2, 3, 4, 5, 6, 7],
                })
              }
              title="7-Day Proof Full Reports"
            />
          </div>
          {!canOpenPreset ? (
            <p className="mt-3 text-theme-xs text-warning-600">
              ต้องอนุมัติผู้รับอย่างน้อย 1 รายก่อน จึงจะใช้ preset ได้
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-5 sm:space-y-6">
          <Panel>
            <PanelHeader
              action={
                <Button
                  className="w-full sm:w-auto"
                  onClick={startNewRule}
                  size="sm"
                  startIcon={<PlusIcon className="size-4" />}
                  type="button"
                  variant="outline"
                >
                  แผนใหม่
                </Button>
              }
              description="เลือกแผนรอบเช้า/เย็น หรือสร้างแผนใหม่ให้ร้านนี้"
              title="แผนของร้านนี้"
            />
            <PanelBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Fact
                  label="แผนเปิดอยู่"
                  tone={enabledRules.length ? "success" : "warning"}
                  value={`${enabledRules.length}/${rules.length}`}
                />
                <Fact
                  label="ผู้รับพร้อมส่ง"
                  tone={
                    state.notifications.enabled_target_count ? "success" : "warning"
                  }
                  value={`${state.notifications.enabled_target_count}/${state.notifications.target_count}`}
                />
              </div>
              <RuleList
                onSelectRule={applyRule}
                rules={rules}
                selectedRuleId={selectedRuleId}
              />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              description="ผลรันล่าสุดช่วยบอกว่ารอบไหนส่งสำเร็จหรือควรตรวจต่อ"
              title="งานล่าสุด"
            />
            <PanelBody>
              <RunList runs={recentRuns.slice(0, 6)} />
            </PanelBody>
          </Panel>
        </div>

        <div className="space-y-5 sm:space-y-6">
          <Panel>
            <PanelHeader
              action={
                selectedRule ? (
                  <Badge color={selectedRule.enabled ? "success" : "warning"}>
                    {selectedRule.enabled ? "เปิดใช้งาน" : "ปิดอยู่"}
                  </Badge>
                ) : (
                  <Badge color="info">แผนใหม่</Badge>
                )
              }
              description="ตั้งเวลา เลือกรายงาน และเลือกผู้รับ LINE ก่อนบันทึกหรือทดสอบ"
              title={selectedRule ? selectedRule.name : "สร้างแผนแจ้งเตือน"}
            />
            <PanelBody>
              <form className="space-y-6" onSubmit={saveRule}>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <Field label="ชื่อแผน">
                    <input
                      className="owner-v2-input"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="เช่น Executive Brief 08:00"
                      value={form.name}
                    />
                  </Field>
                  <Field label="สถานะ">
                    <select
                      className="owner-v2-input"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          enabled: event.target.value === "true",
                        }))
                      }
                      value={form.enabled ? "true" : "false"}
                    >
                      <option value="true">เปิดใช้งาน</option>
                      <option value="false">ปิดไว้ก่อน</option>
                    </select>
                  </Field>
                  <Field label="รูปแบบสรุป">
                    <select
                      className="owner-v2-input"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          digestMode: event.target.value as NotificationDigestMode,
                        }))
                      }
                      value={form.digestMode}
                    >
                      {digestModes.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="ช่วงข้อมูล">
                    <select
                      className="owner-v2-input"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          periodPreset: event.target.value as NotificationPeriodPreset,
                        }))
                      }
                      value={form.periodPreset}
                    >
                      {periodPresets.map((preset) => (
                        <option key={preset.value} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <Field label="เวลาแจ้งเตือน">
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <input
                        className="owner-v2-input"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            timeInput: event.target.value,
                          }))
                        }
                        type="time"
                        value={form.timeInput}
                      />
                      <Button
                        className="w-full shrink-0 sm:w-auto"
                        onClick={() =>
                          setForm((current) => addNotificationTime(current))
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        เพิ่มเวลา
                      </Button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {form.times.map((time) => (
                        <button
                          className="rounded-full bg-brand-50 px-3 py-1 text-theme-xs font-medium text-brand-600 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300"
                          key={time}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              times: current.times.filter((item) => item !== time),
                            }))
                          }
                          aria-label={`ลบเวลา ${time}`}
                          type="button"
                        >
                          {time} ลบ
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label="วันที่ส่ง">
                    <div className="grid grid-cols-7 gap-1">
                      {weekdays.map((weekday) => {
                        const checked = form.weekdays.includes(weekday.value);
                        return (
                          <button
                            className={`h-10 rounded-lg text-sm font-medium ${
                              checked
                                ? "bg-brand-500 text-white"
                                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
                            }`}
                            key={weekday.value}
                            onClick={() =>
                              setForm((current) => toggleWeekday(current, weekday.value))
                            }
                            type="button"
                          >
                            {weekday.label}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </div>

                <ReportSelector
                  onApplyPreset={(presetKey) =>
                    setForm((current) => ({
                      ...current,
                      reportKeys: [...getReportPresetEntry(presetKey).reportKeys],
                    }))
                  }
                  onToggleReport={(reportKey) =>
                    setForm((current) => toggleReport(current, reportKey))
                  }
                  selectedReportKeys={form.reportKeys}
                />

                <div className="mt-5">
                  <PeriodPreviewTable
                    periodPreset={form.periodPreset}
                    times={form.times}
                    weekdays={form.weekdays}
                  />
                </div>

                <TargetSelector
                  channels={lineChannels}
                  onToggleTarget={(targetId) =>
                    setForm((current) => toggleTarget(current, targetId))
                  }
                  reportKeys={form.reportKeys}
                  selectedTargetIds={form.targetIds}
                  targets={lineTargets}
                />

                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <Field label="จำลองวันที่รอบส่ง">
                    <input
                      className="owner-v2-input"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          manualDate: event.target.value,
                        }))
                      }
                      type="date"
                      value={form.manualDate}
                    />
                  </Field>
                  <Field label="จำลองเวลารอบส่ง">
                    <select
                      className="owner-v2-input"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          manualTime: event.target.value,
                        }))
                      }
                      value={form.manualTime}
                    >
                      <option value="">ใช้เวลาปัจจุบัน</option>
                      {form.times.map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="flex flex-col gap-3 border-t border-gray-100 pt-5 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm leading-6 text-gray-500 dark:text-gray-400">
                    {saveBlockedReason ??
                      actionBlockedReason ??
                      "บันทึกแผนก่อนทดสอบหรือส่งจริง เพื่อกันค่าฟอร์มไม่ตรงกับเวลาแจ้งเตือน"}
                  </div>
                  <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
                    <Button
                      disabled={saveDisabled}
                      className="w-full sm:w-auto"
                      size="sm"
                      type="submit"
                    >
                      บันทึกแผน
                    </Button>
                    <Button
                      className="w-full sm:w-auto"
                      disabled={dryRunDisabled}
                      onClick={() => void executeRule("dry_run")}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      ทดสอบไม่ส่งจริง
                    </Button>
                    <Button
                      className="w-full sm:w-auto"
                      disabled={sendDisabled}
                      onClick={() => void executeRule("send")}
                      size="sm"
                      type="button"
                      variant={sendConfirmRuleId === selectedRuleId ? "primary" : "outline"}
                    >
                      {sendConfirmRuleId === selectedRuleId
                        ? "กดอีกครั้งเพื่อส่งจริง"
                        : "ส่งจริงตอนนี้"}
                    </Button>
                  </div>
                </div>
              </form>
            </PanelBody>
          </Panel>

          {runResult ? (
            <Notice
              text={`รหัสงาน ${runResult.run_id ?? runResult.run?.id ?? "-"} · ${
                runResult.mode === "send" ? "ส่งจริง" : "ทดสอบไม่ส่งจริง"
              } · ${formatNotificationRunStatus(
                runResult.run?.status ?? (runResult.status as NotificationRuleRunRecord["status"]) ?? "queued",
              )}`}
              title="รับงานรันแผนแล้ว"
              tone="success"
            />
          ) : null}

          {activeRuns.length ? (
            <Panel>
              <PanelHeader
                description="ระบบรันต่อได้แม้ปิดหน้านี้ กลับมาดูสถานะได้ภายหลัง"
                title="งานที่กำลังทำ"
              />
              <PanelBody>
                <RunList runs={activeRuns} />
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RuleList({
  onSelectRule,
  rules,
  selectedRuleId,
}: {
  onSelectRule: (rule: OwnerNotificationRule) => void;
  rules: OwnerNotificationRule[];
  selectedRuleId: string | null;
}) {
  if (!rules.length) {
    return (
      <EmptyState
        detail="เริ่มจากสร้างแผน 08:00 หรือ 18:30 แล้วเลือกผู้รับ LINE"
        title="ยังไม่มีแผนแจ้งเตือน"
      />
    );
  }
  return (
    <div className="space-y-2">
      {rules.map((rule) => (
        <button
          className={`w-full rounded-lg p-3 text-left transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-500/10 ${
            selectedRuleId === rule.id
              ? "bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:ring-brand-500/30"
              : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
          }`}
          key={rule.id}
          onClick={() => onSelectRule(rule)}
          type="button"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                {rule.name}
              </p>
              <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                {formatSchedule(rule)}
              </p>
            </div>
            <Badge color={rule.enabled ? "success" : "warning"}>
              {rule.enabled ? "เปิด" : "ปิด"}
            </Badge>
          </div>
          <p className="mt-2 text-theme-xs text-gray-500 dark:text-gray-400">
            {rule.report_keys
              .map((reportKey) => getReportCatalogEntry(reportKey).shortLabel)
              .join(", ")}
          </p>
        </button>
      ))}
    </div>
  );
}

function ReportSelector({
  onApplyPreset,
  onToggleReport,
  selectedReportKeys,
}: {
  onApplyPreset: (presetKey: ReportPresetKey) => void;
  onToggleReport: (reportKey: ReportKey) => void;
  selectedReportKeys: ReportKey[];
}) {
  const grouped = reportKeyValues.reduce<Record<string, ReportKey[]>>(
    (result, reportKey) => {
      const category = getReportCatalogEntry(reportKey).category;
      result[category] = [...(result[category] ?? []), reportKey];
      return result;
    },
    {},
  );
  return (
    <div className="rounded-lg bg-gray-50 p-4 dark:bg-white/[0.02] sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            รายงานที่จะส่ง
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            เลือกเฉพาะรายงานที่ผู้รับมีสิทธิ์อ่าน เพื่อไม่ให้รอบส่งติดเงื่อนไข
          </p>
        </div>
        <Badge color={selectedReportKeys.length ? "success" : "warning"}>
          {selectedReportKeys.length} รายงาน
        </Badge>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {reportPresetKeyValues.map((presetKey) => {
          const preset = getReportPresetEntry(presetKey);
          return (
            <button
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-theme-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.03]"
              key={preset.key}
              onClick={() => onApplyPreset(preset.key)}
              type="button"
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="mt-5 space-y-4">
        {Object.entries(grouped).map(([category, reportKeys]) => (
          <div
            className="rounded-lg bg-white p-3 dark:bg-gray-900"
            key={category}
          >
            <p className="mb-2 text-theme-xs font-medium text-gray-500 dark:text-gray-400">
              {categoryLabels[category] ?? category}
            </p>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {reportKeys.map((reportKey) => {
                const report = getReportCatalogEntry(reportKey);
                const checked = selectedReportKeys.includes(reportKey);
                return (
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                      checked
                        ? "border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10"
                        : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-white/[0.03]"
                    }`}
                    key={reportKey}
                  >
                    <input
                      checked={checked}
                      className="mt-1 size-4"
                      onChange={() => onToggleReport(reportKey)}
                      type="checkbox"
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
                        {report.shortLabel}
                      </span>
                      <span className="mt-1 block text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
                        {report.permissionDescription}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TargetSelector({
  channels,
  onToggleTarget,
  reportKeys,
  selectedTargetIds,
  targets,
}: {
  channels: LineChannelRecord[];
  onToggleTarget: (targetId: string) => void;
  reportKeys: ReportKey[];
  selectedTargetIds: string[];
  targets: LineTargetRecord[];
}) {
  if (!targets.length) {
    return (
      <EmptyState
        action={
          <Link
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200"
            href="../line"
          >
            ไปตั้งค่า LINE
          </Link>
        }
        detail="ต้องมีผู้รับ LINE ก่อนจึงเปิดแผนแจ้งเตือนได้"
        title="ยังไม่มีผู้รับ LINE"
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-lg bg-gray-50 px-4 pb-3 pt-4 dark:bg-white/[0.02] sm:px-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            ผู้รับ LINE
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            เลือกผู้รับที่พร้อมรับรายงานตามสิทธิ์
          </p>
        </div>
        <Badge color={selectedTargetIds.length ? "success" : "warning"}>
          {selectedTargetIds.length}/{targets.length}
        </Badge>
      </div>
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-y border-gray-100 dark:border-gray-800">
              {["เลือก", "ผู้รับ", "พร้อมส่ง", "เหตุผล"].map((label) => (
                <th className="py-3 pr-5 text-left last:pr-0 sm:pr-6" key={label}>
                  <p className="font-medium text-gray-500 text-theme-xs dark:text-gray-400">
                    {label}
                  </p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {targets.map((target) => {
              const readiness = getLineTargetDeliveryReadiness({
                channels,
                reportKeys,
                target,
              });
              return (
                <tr key={target.id}>
                  <td className="py-4 pr-5 last:pr-0 sm:pr-6">
                    <input
                      checked={selectedTargetIds.includes(target.id)}
                      className="size-4"
                      onChange={() => onToggleTarget(target.id)}
                      type="checkbox"
                    />
                  </td>
                  <td className="py-4 pr-5 last:pr-0 sm:pr-6">
                    <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                      {target.display_name}
                    </p>
                    <p className="mt-1 font-mono text-theme-xs text-gray-500 dark:text-gray-400">
                      {target.target_id_masked}
                    </p>
                  </td>
                  <td className="py-4 pr-5 last:pr-0 sm:pr-6">
                    <Badge color={readiness.ok ? "success" : "warning"}>
                      {readiness.ok ? "พร้อม" : "ติดเงื่อนไข"}
                    </Badge>
                  </td>
                  <td className="py-4 pr-5 last:pr-0 sm:pr-6">
                    <p className="max-w-md text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
                      {readiness.ok ? "ส่งได้ตามรายงานที่เลือก" : readiness.message}
                    </p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunList({ runs }: { runs: NotificationRuleRunRecord[] }) {
  if (!runs.length) {
    return (
      <EmptyState
        detail="หลังทดสอบหรือรอบ worker ทำงาน ผลล่าสุดจะแสดงตรงนี้"
        title="ยังไม่มีประวัติรัน"
      />
    );
  }
  return (
    <div className="space-y-3">
      {runs.map((run) => {
        const progress = getProgressPercent(run);
        return (
          <div
            className="rounded-lg bg-gray-50 p-4 dark:bg-white/[0.02]"
            key={run.id}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                  {run.scheduled_local_date} {run.scheduled_local_time}
                </p>
                <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                  {run.mode === "send" ? "ส่งจริง" : "ทดสอบไม่ส่งจริง"} · ครั้งที่{" "}
                  {run.attempt} · {formatElapsed(run)}
                </p>
              </div>
              <Badge color={notificationRunTone(run.status)}>
                {formatNotificationRunStatus(run.status)}
              </Badge>
            </div>
            {progress !== null ? (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-2 text-theme-xs text-gray-500 dark:text-gray-400">
                  {formatProgressLabel(run) ?? `${progress}%`}
                </p>
              </div>
            ) : null}
            {run.safe_error_message ? (
              <p className="mt-3 rounded-lg bg-warning-50 p-3 text-theme-xs leading-5 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300">
                {run.safe_error_message}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 ${className}`}
    >
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
      <div className="min-w-0">
        <h3 className="break-words text-lg font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h3>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function PanelBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`space-y-5 ${className}`}>{children}</div>;
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
        {label}
      </span>
      {children}
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
  const toneLabel = {
    error: "ผิดพลาด",
    light: null,
    success: "ปกติ",
    warning: "ต้องดู",
  }[tone];
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
        {toneLabel ? (
          <Badge color={tone} size="sm">
            {toneLabel}
          </Badge>
        ) : null}
      </div>
      <p className="mt-2 break-words text-theme-xl font-semibold text-gray-800 dark:text-white/90">
        {value}
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
    error: {
      className:
        "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15",
      icon: <AlertIcon className="size-6 fill-current" />,
      iconClassName: "text-error-500",
    },
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
      iconClassName: "text-warning-500 dark:text-orange-400",
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

function EmptyState({
  action,
  detail,
  title,
}: {
  action?: ReactNode;
  detail: string;
  title: string;
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-5 text-center dark:bg-white/[0.02] sm:p-6">
      <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
        {detail}
      </p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

function NotificationSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Panel>
        <PanelHeader title="กำลังโหลดแผน" />
        <PanelBody>
          <MiniSkeleton />
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="กำลังโหลดฟอร์ม" />
        <PanelBody>
          <MiniSkeleton />
        </PanelBody>
      </Panel>
    </div>
  );
}

function MiniSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 w-2/3 rounded bg-gray-100 dark:bg-gray-800" />
      <div className="h-11 rounded-lg bg-gray-100 dark:bg-gray-800" />
      <div className="h-11 rounded-lg bg-gray-100 dark:bg-gray-800" />
    </div>
  );
}

function NotificationStat({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "success" | "warning" | "error";
  value: number;
}) {
  const color =
    tone === "error"
      ? "text-error-600"
      : tone === "warning"
        ? "text-warning-600"
        : tone === "success"
          ? "text-success-600"
          : "text-gray-800 dark:text-white/90";
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${color}`}>
        {value.toLocaleString("th-TH")}
      </p>
    </div>
  );
}

function PresetCard({
  badge,
  description,
  disabled,
  onClick,
  title,
}: {
  badge: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      className={`flex min-h-[120px] flex-col rounded-xl border p-4 text-left transition ${
        disabled
          ? "cursor-not-allowed border-gray-100 bg-gray-50 opacity-60 dark:border-gray-800 dark:bg-white/[0.02]"
          : "border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:bg-brand-500/10"
      }`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-800 dark:text-white/90">{title}</span>
        {badge ? (
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-theme-xs font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
        {description}
      </p>
    </button>
  );
}

const PERIOD_PRESET_LABELS: Record<string, string> = {
  yesterday: "เมื่อวาน (เต็มวัน)",
  yesterday_until_now: "เมื่อวาน จนถึงตอนนี้",
  last_7_days: "7 วันล่าสุด",
  last_30_days: "30 วันล่าสุด",
  month_to_date: "เดือนนี้ถึงปัจจุบัน",
  last_month: "เดือนก่อน",
};

const WEEKDAY_LABELS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function PeriodPreviewTable({
  periodPreset,
  times,
  weekdays,
}: {
  periodPreset: string;
  times: string[];
  weekdays: number[];
}) {
  if (!times.length || !weekdays.length) {
    return null;
  }
  const periodLabel = PERIOD_PRESET_LABELS[periodPreset] ?? periodPreset;
  const weekdayText = weekdays
    .slice()
    .sort((a, b) => a - b)
    .map((day) => WEEKDAY_LABELS[day - 1] ?? String(day))
    .join(" ");
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <p className="text-theme-xs font-medium text-gray-700 dark:text-gray-300">
        พรีวิวรอบถัดไป
      </p>
      <p className="mt-1 text-theme-sm text-gray-800 dark:text-white/90">
        ช่วงข้อมูล: {periodLabel}
      </p>
      <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
        ส่ง {times.join(", ")} · {weekdayText}
      </p>
    </div>
  );
}

function emptyForm(): NotificationFormState {
  return {
    digestMode: "action_only",
    enabled: true,
    manualDate: "",
    manualTime: "",
    name: "Executive Brief",
    periodPreset: "yesterday",
    reportKeys: ["sales_goods_services", "purchase_goods_payables"],
    targetIds: [],
    timeInput: "08:00",
    times: ["08:00"],
    weekdays: weekdays.map((weekday) => weekday.value),
  };
}

function defaultForm({
  channels,
  targets,
}: {
  channels: LineChannelRecord[];
  targets: LineTargetRecord[];
}): NotificationFormState {
  const base = emptyForm();
  const readyTargets = targets
    .filter(
      (target) =>
        getLineTargetDeliveryReadiness({
          channels,
          reportKeys: base.reportKeys,
          target,
        }).ok,
    )
    .map((target) => target.id);
  return {
    ...base,
    manualDate: nextDateForWeekday(base.weekdays[0] ?? 1),
    manualTime: base.times[0] ?? "",
    targetIds: readyTargets,
  };
}

function formFromRule(rule: OwnerNotificationRule): NotificationFormState {
  const schedule = rule.schedule[0] ?? {
    times: ["08:00"],
    weekdays: weekdays.map((weekday) => weekday.value),
  };
  return {
    digestMode: rule.digest_mode ?? "action_only",
    enabled: rule.enabled,
    manualDate: nextDateForWeekday(schedule.weekdays[0] ?? 1),
    manualTime: schedule.times[0] ?? "",
    name: rule.name,
    periodPreset: rule.period_preset,
    reportKeys: [...rule.report_keys],
    targetIds: [...rule.target_ids],
    timeInput: schedule.times[0] ?? "08:00",
    times: [...schedule.times],
    weekdays: [...schedule.weekdays],
  };
}

function buildRulePayload({
  form,
  tenantId,
}: {
  form: NotificationFormState;
  tenantId: string;
}) {
  return {
    digest_mode: form.digestMode,
    enabled: form.enabled,
    name: form.name.trim(),
    period_preset: form.periodPreset,
    period_strategy: ownerPeriodStrategy,
    report_keys: sortReportKeys(form.reportKeys),
    schedule: [
      {
        times: [...new Set(form.times)].sort(),
        weekdays: [...new Set(form.weekdays)].sort((left, right) => left - right),
      },
    ],
    target_ids: [...new Set(form.targetIds)].sort(),
    tenant_id: tenantId,
    timezone: BANGKOK_TIME_ZONE,
  };
}

function sameForm(left: NotificationFormState, right: NotificationFormState) {
  return JSON.stringify(normalizeForm(left)) === JSON.stringify(normalizeForm(right));
}

function normalizeForm(form: NotificationFormState) {
  return {
    ...form,
    name: form.name.trim(),
    reportKeys: sortReportKeys(form.reportKeys),
    targetIds: [...new Set(form.targetIds)].sort(),
    times: [...new Set(form.times)].sort(),
    weekdays: [...new Set(form.weekdays)].sort((left, right) => left - right),
  };
}

function sortReportKeys(reportKeys: ReportKey[]) {
  const order = new Map<ReportKey, number>(
    reportKeyValues.map((reportKey, index) => [reportKey, index]),
  );
  return [...new Set(reportKeys)].sort(
    (left, right) => (order.get(left) ?? 999) - (order.get(right) ?? 999),
  );
}

function addNotificationTime(form: NotificationFormState) {
  if (!isValidTime(form.timeInput) || form.times.includes(form.timeInput)) {
    return form;
  }
  const times = [...form.times, form.timeInput].sort();
  return {
    ...form,
    manualTime: form.manualTime || form.timeInput,
    times,
  };
}

function toggleWeekday(form: NotificationFormState, weekday: number) {
  const weekdaysNext = form.weekdays.includes(weekday)
    ? form.weekdays.filter((item) => item !== weekday)
    : [...form.weekdays, weekday].sort((left, right) => left - right);
  return {
    ...form,
    manualDate: weekdaysNext.length ? nextDateForWeekday(weekdaysNext[0]!) : "",
    weekdays: weekdaysNext,
  };
}

function toggleReport(form: NotificationFormState, reportKey: ReportKey) {
  const reportKeys = form.reportKeys.includes(reportKey)
    ? form.reportKeys.filter((item) => item !== reportKey)
    : sortReportKeys([...form.reportKeys, reportKey]);
  return { ...form, reportKeys };
}

function toggleTarget(form: NotificationFormState, targetId: string) {
  const targetIds = form.targetIds.includes(targetId)
    ? form.targetIds.filter((item) => item !== targetId)
    : [...form.targetIds, targetId];
  return { ...form, targetIds };
}

function getSaveBlockedReason(input: {
  enabled: boolean;
  form: NotificationFormState;
  selectedTargetBlockedReason: string | null;
}) {
  if (input.form.name.trim().length < 2) {
    return "ตั้งชื่อแผนอย่างน้อย 2 ตัวอักษร";
  }
  if (!input.form.times.length) {
    return "เพิ่มเวลาแจ้งเตือนอย่างน้อย 1 รอบ";
  }
  if (input.form.times.some((time) => !isValidTime(time))) {
    return "รูปแบบเวลาไม่ถูกต้อง";
  }
  if (!input.form.weekdays.length) {
    return "เลือกวันที่ต้องการแจ้งเตือนอย่างน้อย 1 วัน";
  }
  if (!input.form.reportKeys.length) {
    return "เลือกรายงานอย่างน้อย 1 รายงาน";
  }
  if (input.enabled && !input.form.targetIds.length) {
    return "เลือกผู้รับ LINE อย่างน้อย 1 รายก่อนเปิดแผน";
  }
  if (input.selectedTargetBlockedReason) {
    return input.selectedTargetBlockedReason;
  }
  return null;
}

function getActionBlockedReason(input: {
  dirty: boolean;
  form: NotificationFormState;
  selectedRuleId: string | null;
  selectedTargetBlockedReason: string | null;
}) {
  if (!input.selectedRuleId) {
    return "บันทึกแผนก่อนทดสอบหรือส่งจริง";
  }
  if (input.dirty) {
    return "มีการแก้ไขยังไม่บันทึก กรุณาบันทึกก่อนรัน";
  }
  if (Boolean(input.form.manualDate) !== Boolean(input.form.manualTime)) {
    return "เลือกวันที่และเวลารอบส่งให้ครบคู่ หรือเว้นทั้งคู่ไว้เพื่อใช้เวลาปัจจุบัน";
  }
  if (input.selectedTargetBlockedReason) {
    return input.selectedTargetBlockedReason;
  }
  return null;
}

type LineTargetDeliveryReadiness =
  | { ok: true }
  | { ok: false; message: string; reason: string };

function getLineTargetDeliveryReadiness({
  channels,
  reportKeys,
  target,
}: {
  channels: LineChannelRecord[];
  reportKeys: ReportKey[];
  target: LineTargetRecord;
}): LineTargetDeliveryReadiness {
  if (!target.approved) {
    return { ok: false, reason: "target_not_approved", message: "ยังไม่ได้อนุมัติผู้รับ LINE" };
  }
  if (!target.enabled) {
    return { ok: false, reason: "target_disabled", message: "ผู้รับ LINE ถูกปิดใช้งาน" };
  }
  if (!target.allowed_actions.includes("receive_morning_brief")) {
    return {
      ok: false,
      reason: "action_not_allowed",
      message: "ผู้รับนี้ยังไม่มีสิทธิ์รับรายงานผู้บริหาร",
    };
  }
  const blockedReport = reportKeys.find(
    (reportKey) => !target.allowed_report_keys.includes(reportKey),
  );
  if (blockedReport) {
    return {
      ok: false,
      reason: "report_not_allowed",
      message: `${getReportCatalogEntry(blockedReport).shortLabel} ยังไม่ได้เปิดสิทธิ์ให้ผู้รับนี้`,
    };
  }
  const channel = target.line_channel_id
    ? channels.find((item) => item.id === target.line_channel_id)
    : channels.find((item) => item.enabled && item.channel_access_token_configured);
  if (!channel) {
    return {
      ok: false,
      reason: "line_channel_missing",
      message: "ยังไม่มี LINE OA ที่พร้อมส่งให้ผู้รับนี้",
    };
  }
  if (!channel.enabled) {
    return {
      ok: false,
      reason: "line_channel_disabled",
      message: "LINE OA ที่ผูกกับผู้รับนี้ถูกปิดใช้งาน",
    };
  }
  if (!channel.channel_access_token_configured) {
    return {
      ok: false,
      reason: "line_channel_token_missing",
      message: "LINE OA ยังไม่มี access token สำหรับส่งจริง",
    };
  }
  return { ok: true };
}

function formatSchedule(rule: OwnerNotificationRule) {
  const schedule = rule.schedule[0];
  if (!schedule) {
    return "ยังไม่ตั้งเวลา";
  }
  const days =
    schedule.weekdays.length === 7
      ? "ทุกวัน"
      : schedule.weekdays
          .map((weekday) => weekdays.find((item) => item.value === weekday)?.label ?? weekday)
          .join(", ");
  return `${days} · ${schedule.times.join(", ")} · รอบผู้บริหาร`;
}

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isNotificationRunActive(run: NotificationRuleRunRecord) {
  return run.status === "queued" || run.status === "running";
}

function notificationRunTone(status: NotificationRuleRunRecord["status"]) {
  if (status === "success") {
    return "success" as const;
  }
  if (
    status === "queued" ||
    status === "running" ||
    status === "success_with_warnings"
  ) {
    return "warning" as const;
  }
  if (status === "failed") {
    return "error" as const;
  }
  return "light" as const;
}

function formatNotificationRunStatus(
  status: NotificationRuleRunRecord["status"],
) {
  if (status === "queued") {
    return "รอคิว";
  }
  if (status === "running") {
    return "กำลังรัน";
  }
  if (status === "success") {
    return "สำเร็จ";
  }
  if (status === "success_with_warnings") {
    return "สำเร็จพร้อมข้อสังเกต";
  }
  if (status === "failed") {
    return "ไม่สำเร็จ";
  }
  return "ข้าม";
}

function getProgressPercent(run: NotificationRuleRunRecord) {
  if (typeof run.progress_percent !== "number") {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(run.progress_percent)));
}

function formatProgressLabel(run: NotificationRuleRunRecord) {
  if (!run.progress_stage) {
    return null;
  }
  if (run.progress_stage === "queued") {
    return "รอคิว";
  }
  if (run.progress_stage === "claimed") {
    return "เริ่มงานแล้ว";
  }
  if (run.progress_stage === "waiting_chunked_report") {
    const totalReports = run.progress_total_reports ?? 0;
    const doneReports = run.progress_done_reports ?? 0;
    const reportLabel = run.progress_current_report_key
      ? getReportCatalogEntry(run.progress_current_report_key).shortLabel
      : "รายงานหนัก";
    return totalReports > 0
      ? `รอรายงานหนักประมวลผล: ${reportLabel} (${Math.min(doneReports + 1, totalReports)}/${totalReports})`
      : `รอรายงานหนักประมวลผล: ${reportLabel}`;
  }
  if (run.progress_stage === "preparing_line") {
    return "กำลังเตรียมข้อความ LINE";
  }
  if (run.progress_stage === "sending_line") {
    return "กำลังส่ง LINE";
  }
  if (run.progress_stage === "completed") {
    return "เสร็จแล้ว";
  }
  if (run.progress_stage === "failed") {
    return "ไม่สำเร็จ";
  }
  const totalReports = run.progress_total_reports ?? 0;
  const doneReports = run.progress_done_reports ?? 0;
  const reportLabel = run.progress_current_report_key
    ? getReportCatalogEntry(run.progress_current_report_key).shortLabel
    : "รายงาน";
  return totalReports > 0
    ? `กำลังสร้างรายงาน: ${reportLabel} (${Math.min(doneReports + 1, totalReports)}/${totalReports})`
    : `กำลังสร้างรายงาน: ${reportLabel}`;
}

function formatElapsed(run: NotificationRuleRunRecord) {
  const startedAt =
    run.started_at ?? run.claimed_at ?? run.queued_at ?? run.created_at;
  const finishedAt = run.finished_at ?? new Date().toISOString();
  const elapsedMs = Math.max(
    0,
    new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  );
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) {
    return `${seconds} วินาที`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes} นาที ${seconds % 60} วินาที`;
}

function nextDateForWeekday(isoWeekday: number) {
  const today = new Date();
  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = new Date(today);
    candidate.setDate(today.getDate() + offset);
    if (toIsoWeekday(candidate) === isoWeekday) {
      return candidate.toISOString().slice(0, 10);
    }
  }
  return today.toISOString().slice(0, 10);
}

function toIsoWeekday(date: Date) {
  const weekday = date.getDay();
  return weekday === 0 ? 7 : weekday;
}

function createClientRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
