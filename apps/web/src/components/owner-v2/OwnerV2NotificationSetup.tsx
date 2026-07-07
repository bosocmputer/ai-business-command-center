"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BANGKOK_TIME_ZONE,
  getReportCatalogEntry,
  getReportPresetEntry,
  reportKeyValues,
  reportPresetKeyValues,
  uniqueReportKeysInOrder,
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
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BellIcon,
  InfoIcon,
  PlusIcon,
  TimeIcon,
} from "@/icons";
import { isAbortError, ownerV2Fetch, type OwnerV2FetchError } from "./api";
import type {
  OwnerV2AiCeoSetupStatus,
  OwnerV2LineSetupPayload,
  OwnerV2NotificationSetupPayload,
} from "./types";
import {
  Fact,
  Field,
  FormPanel,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  TechnicalDetails,
  secondaryActionClass,
} from "./ui";

type OwnerNotificationRule = OwnerV2NotificationSetupPayload["rules"][number];
type NotificationAiCeoStatus = OwnerV2NotificationSetupPayload["ai_ceo"];
type LineTargetWithSiblings = LineTargetRecord & {
  sibling_tenant_names: string[];
};

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
  status?:
    NotificationRuleRunRecord["status"] | "sent" | "processed" | "skipped";
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
    value: "all_reports",
    label: "ส่งรายงานครบทุกใบ",
    description: "แสดงรายงานเหมือนรอบ 08:00 และยังแนบ AI CEO เมื่อพร้อม",
  },
  {
    value: "action_only",
    label: "ส่งเฉพาะเรื่องที่ต้องดู",
    description: "ใช้เฉพาะกรณีอยากลดจำนวนการ์ด LINE ในรอบพิเศษ",
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
  cash_bank: "เงินสด/ธนาคาร",
  gross_profit: "กำไร",
  inventory: "สต็อก",
  purchase: "ซื้อ",
  sales: "ขาย",
};

const emptyNotificationRuns: NotificationRuleRunRecord[] = [];
const emptyNotificationRules: OwnerNotificationRule[] = [];
const emptyChannels: LineChannelRecord[] = [];
const emptyTargets: Array<
  LineTargetRecord & { sibling_tenant_names: string[] }
> = [];
const emptyAiCeoStatus: NotificationAiCeoStatus = {
  advisor_name: "AI CEO",
  ai_enabled: false,
  encryption_configured: false,
  key_configured: false,
  key_source: "missing",
  plan_eligible: false,
  selected_model_id: "qwen/qwen3.7-max",
  shadow_mode_enabled: true,
};

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
  const [technicalMessage, setTechnicalMessage] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<NotificationRuleRunResult | null>(
    null,
  );
  const [sendConfirmRuleId, setSendConfirmRuleId] = useState<string | null>(
    null,
  );
  const [manualRunTargetId, setManualRunTargetId] = useState("");

  const load = useCallback(
    async (
      options: {
        preserveMessage?: boolean;
        signal?: AbortSignal;
        silent?: boolean;
      } = {},
    ) => {
      if (!options.silent) {
        setState({ status: "loading" });
      }
      if (!options.preserveMessage) {
        setMessage(null);
        setTechnicalMessage(null);
      }
      try {
        const [notifications, line] = await Promise.all([
          ownerV2Fetch<OwnerV2NotificationSetupPayload>(
            `/api/owner/tenants/${encodeURIComponent(
              tenantId,
            )}/notification-setup`,
            { signal: options.signal },
          ),
          ownerV2Fetch<OwnerV2LineSetupPayload>(
            `/api/owner/tenants/${encodeURIComponent(tenantId)}/line-setup`,
            { signal: options.signal },
          ),
        ]);
        if (options.signal?.aborted) {
          return;
        }
        setState({ status: "success", notifications, line });
        setSelectedRuleId((current) => {
          if (
            current &&
            notifications.rules.some((rule) => rule.id === current)
          ) {
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
        if (options.silent) {
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
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  // The success-branch reads below only check state.status, not whether the
  // nested slices are non-null. The API can return explicit null for
  // rules/recent_runs/targets on unconfigured tenants, which then crashes the
  // .filter/.some/.slice calls below. Guard each slice with ?? empty* so the
  // derived arrays are always real arrays.
  const rules =
    state.status === "success"
      ? (state.notifications.rules ?? emptyNotificationRules)
      : emptyNotificationRules;
  const recentRuns =
    state.status === "success"
      ? (state.notifications.recent_runs ?? emptyNotificationRuns)
      : emptyNotificationRuns;
  const lineTargets =
    state.status === "success"
      ? (state.line.targets ?? emptyTargets)
      : emptyTargets;
  const lineChannels =
    state.status === "success"
      ? (state.line.channels ?? emptyChannels)
      : emptyChannels;
  const aiCeoStatus =
    state.status === "success"
      ? (state.notifications.ai_ceo ?? emptyAiCeoStatus)
      : emptyAiCeoStatus;
  const manualRunTargetOptions = useMemo(
    () =>
      lineTargets.filter(
        (target) =>
          getLineTargetDeliveryReadiness({
            channels: lineChannels,
            reportKeys: form.reportKeys,
            target,
          }).ok,
      ),
    [form.reportKeys, lineChannels, lineTargets],
  );
  const manualRunTarget =
    manualRunTargetId && manualRunTargetOptions.length
      ? (manualRunTargetOptions.find(
          (target) => target.id === manualRunTargetId,
        ) ?? null)
      : null;
  const selectedRule = selectedRuleId
    ? (rules.find((rule) => rule.id === selectedRuleId) ?? null)
    : null;
  const activeRuns = recentRuns.filter(isNotificationRunActive);
  const latestRunResultRun = runResult
    ? (recentRuns.find(
        (run) => run.id === (runResult.run_id ?? runResult.run?.id ?? ""),
      ) ?? null)
    : null;

  useEffect(() => {
    if (state.status !== "success" || activeRuns.length === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void load({ preserveMessage: true, silent: true });
    }, 2500);

    return () => window.clearInterval(intervalId);
  }, [activeRuns.length, load, state.status]);

  const selectedTargetReadiness = useMemo(
    () =>
      form.targetIds
        .map((targetId) => lineTargets.find((target) => target.id === targetId))
        .filter((target): target is LineTargetWithSiblings => Boolean(target))
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
  useEffect(() => {
    if (state.status !== "success") {
      return;
    }
    setManualRunTargetId((current) => {
      if (
        current &&
        manualRunTargetOptions.some((target) => target.id === current)
      ) {
        return current;
      }
      return getDefaultManualRunTargetId(manualRunTargetOptions);
    });
  }, [manualRunTargetOptions, state.status]);
  const blockedTarget = selectedTargetReadiness.find(
    (
      item,
    ): item is {
      readiness: Extract<LineTargetDeliveryReadiness, { ok: false }>;
      target: LineTargetWithSiblings;
    } => !item.readiness.ok,
  );
  const selectedTargetBlockedReason = blockedTarget
    ? !blockedTarget.readiness.ok
      ? blockedTarget.readiness.message
      : null
    : null;
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
  const activeScheduledSendRun = useMemo(
    () =>
      selectedRuleId && form.manualDate && form.manualTime
        ? (recentRuns.find(
            (run) =>
              isNotificationRunActive(run) &&
              run.rule_id === selectedRuleId &&
              run.mode === "send" &&
              run.scheduled_local_date === form.manualDate &&
              run.scheduled_local_time === form.manualTime,
          ) ?? null)
        : null,
    [form.manualDate, form.manualTime, recentRuns, selectedRuleId],
  );
  const activeRunBlockedReason = activeScheduledSendRun
    ? `มีงานส่งจริงของรอบ ${activeScheduledSendRun.scheduled_local_date} ${activeScheduledSendRun.scheduled_local_time} กำลังทำงานอยู่ กรุณารอผลก่อนกดซ้ำ`
    : null;
  const effectiveSendBlockedReason =
    activeRunBlockedReason ?? actionBlockedReason;
  const formFooterHint = getNotificationFormFooterHint({
    actionBlockedReason,
    dirty,
    effectiveSendBlockedReason,
    saveBlockedReason,
    selectedRuleId,
  });
  const saveDisabled =
    busy !== null || state.status !== "success" || saveBlockedReason !== null;
  const dryRunDisabled =
    busy !== null || state.status !== "success" || actionBlockedReason !== null;
  const sendDisabled =
    busy !== null ||
    state.status !== "success" ||
    effectiveSendBlockedReason !== null;

  function applyRule(rule: OwnerNotificationRule) {
    const nextForm = formFromRule(rule);
    setSelectedRuleId(rule.id);
    setForm(nextForm);
    setInitialForm(nextForm);
    setRunResult(null);
    setSendConfirmRuleId(null);
    setMessage(null);
    setTechnicalMessage(null);
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
    setTechnicalMessage(null);
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
    setTechnicalMessage(null);
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
      const nextForm = mergeManualRunFields({
        currentForm: form,
        nextForm: formFromRule(saved),
      });
      setSelectedRuleId(saved.id);
      setForm(nextForm);
      setInitialForm(nextForm);
      setSendConfirmRuleId(null);
      setMessage({
        tone: "success",
        text: `${formatNotificationRuleName(saved.name)}: บันทึกแผนแจ้งเตือนแล้ว`,
      });
      await load({ preserveMessage: true, silent: true });
    } catch (error) {
      setMessage({
        tone: "error",
        text: "บันทึกแผนแจ้งเตือนไม่สำเร็จ ตรวจเวลา ผู้รับ LINE และรายงานที่เลือกก่อนลองใหม่",
      });
      setTechnicalMessage(toNotificationTechnicalMessage(error));
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
        text: `ตรวจแผนและผู้รับอีกครั้ง แล้วกดปุ่มอีกครั้งเพื่อยืนยัน ระบบจะส่ง LINE ${
          manualRunTarget
            ? `เฉพาะ ${manualRunTarget.display_name}`
            : "ไปยังผู้รับในแผน"
        } ทันที`,
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
        text: effectiveSendBlockedReason ?? "ยังส่งจริงไม่ได้",
      });
      return;
    }
    if (!selectedRuleId) {
      return;
    }

    setBusy(`${mode}-${selectedRuleId}`);
    setMessage(null);
    setTechnicalMessage(null);
    try {
      const body: {
        client_request_id: string;
        mode: "dry_run" | "send";
        scheduled_local_date?: string;
        scheduled_local_time?: string;
        target_ids?: string[];
      } = {
        client_request_id: createClientRequestId(),
        mode,
      };
      if (form.manualDate && form.manualTime) {
        body.scheduled_local_date = form.manualDate;
        body.scheduled_local_time = form.manualTime;
      }
      if (manualRunTargetId) {
        body.target_ids = [manualRunTargetId];
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
            ? `รับงานส่งจริงแล้ว ระบบกำลังรันรายงานและส่ง LINE ${
                manualRunTarget
                  ? `เฉพาะ ${manualRunTarget.display_name}`
                  : "ตามผู้รับในแผน"
              }`
            : "รับงานทดสอบแล้ว ระบบกำลังรันรายงานโดยไม่ส่ง LINE จริง",
      });
      await load({ preserveMessage: true, silent: true });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          mode === "send"
            ? "ส่งจริงไม่สำเร็จ ตรวจผู้รับ LINE โควต้า และสถานะระบบก่อนลองใหม่"
            : "ทดสอบแผนไม่สำเร็จ ตรวจรายงาน ผู้รับ LINE และสถานะระบบก่อนลองใหม่",
      });
      setTechnicalMessage(toNotificationTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function toggleAiCeoEnabled(nextEnabled: boolean) {
    if (busy !== null || state.status !== "success") {
      return;
    }
    if (nextEnabled) {
      const blockedReason = getNotificationAiCeoBlockedReason(aiCeoStatus);
      if (blockedReason) {
        setMessage({ tone: "warning", text: blockedReason });
        setTechnicalMessage(null);
        return;
      }
    }

    setBusy("toggle-ai-ceo");
    setMessage(null);
    setTechnicalMessage(null);
    try {
      const next = await ownerV2Fetch<OwnerV2AiCeoSetupStatus>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/ai-ceo/enabled`,
        {
          method: "PATCH",
          body: { ai_enabled: nextEnabled },
        },
      );
      const nextAiCeo = notificationAiCeoFromSetupStatus(next);
      setState((current) =>
        current.status === "success"
          ? {
              ...current,
              notifications: {
                ...current.notifications,
                ai_ceo: nextAiCeo,
              },
            }
          : current,
      );
      setMessage({
        tone: "success",
        text: nextAiCeo.ai_enabled
          ? nextAiCeo.shadow_mode_enabled
            ? "เปิด AI CEO แบบทดลองเงียบแล้ว รายงาน LINE ยังส่งตามแผนเดิม แต่ข้อความ AI CEO ยังไม่ขึ้น LINE จนกว่าจะปิดโหมดทดลองในหน้าตั้งค่า AI CEO"
            : "เปิด AI CEO แล้ว รอบ LINE ถัดไปจะมีข้อความ AI CEO ก่อนการ์ดรายงาน"
          : "ปิด AI CEO แล้ว รอบ LINE ถัดไปจะส่งเฉพาะการ์ดรายงานตามแผนเดิม",
      });
      await load({ preserveMessage: true, silent: true });
    } catch (error) {
      setMessage({
        tone: "error",
        text: nextEnabled
          ? "เปิด AI CEO ไม่สำเร็จ ตรวจแพ็กเกจ รหัส OpenRouter และระบบเข้ารหัสก่อนลองใหม่"
          : "ปิด AI CEO ไม่สำเร็จ ลองรีเฟรชหน้าแล้วทำรายการอีกครั้ง",
      });
      setTechnicalMessage(toNotificationTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "loading") {
    return (
      <div className="space-y-5 sm:space-y-6">
        <NotificationSkeleton />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-5 sm:space-y-6">
        <Panel>
          <PanelBody spaced>
            <Notice
              text="ลองโหลดใหม่อีกครั้ง ถ้ายังไม่สำเร็จ ให้เปิดศูนย์ตรวจระบบหรือเข้าสู่ระบบผู้ดูแลใหม่"
              title="โหลดแผนแจ้งเตือนไม่สำเร็จ"
              tone="error"
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
              รีเฟรชแผนแจ้งเตือน
            </Button>
          </PanelBody>
        </Panel>
      </div>
    );
  }

  const enabledRules = rules.filter((rule) => rule.enabled);
  const failedRuns = recentRuns.filter((run) => run.status === "failed");
  const defaultTargetIds = lineTargets
    .filter((target) => target.approved && target.enabled)
    .slice(0, 1)
    .map((target) => target.id);
  const canOpenPreset = lineTargets.some((target) => target.approved);

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
    setTechnicalMessage(null);
    setMessage({
      tone: "warning",
      text: `กรอกแผนแนะนำ “${preset.name}” ให้แล้ว ตรวจรายละเอียดก่อนบันทึก`,
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
      {technicalMessage ? (
        <TechnicalDetails embedded title="รายละเอียดการทำรายการ">
          <Fact label="ข้อความระบบ" value={technicalMessage} />
        </TechnicalDetails>
      ) : null}
      <Notice
        text="รอบปกติควรใช้ “ส่งรายงานครบทุกใบ” เพื่อให้ลูกค้าเห็น AI CEO ตามด้วยการ์ดรายงานเหมือนรอบ 08:00 ถ้าจะกดส่งจริงเพื่อทดสอบ ให้เลือกปลายทางเป็นผู้รับของทีมก่อนเสมอ"
        title="การแจ้งเตือน LINE อ้างจากแผนที่บันทึกไว้"
        tone="info"
      />
      <AiCeoLineToggleCard
        aiCeo={aiCeoStatus}
        busy={busy}
        onToggle={(enabled) => void toggleAiCeoEnabled(enabled)}
        tenantId={tenantId}
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NotificationStat label="แผนทั้งหมด" value={rules.length} />
        <NotificationStat
          label="เปิดใช้งาน"
          tone="success"
          value={enabledRules.length}
        />
        <NotificationStat
          label="รอบล้มเหลว"
          tone={failedRuns.length ? "error" : "success"}
          value={failedRuns.length}
        />
        <NotificationStat
          label="ผู้รับพร้อมส่ง"
          tone={canOpenPreset ? "success" : "warning"}
          value={state.notifications.enabled_target_count}
        />
      </section>

      <Panel>
        <PanelHeader
          description="คลิกเพื่อกรอกแผนให้พร้อมก่อนบันทึก"
          title="เริ่มจากแผนแนะนำ"
        />
        <PanelBody spaced>
          <div className="grid gap-3 lg:grid-cols-3">
            <PresetCard
              badge="แนะนำ"
              description="ส่งเรื่องสำคัญตอนเช้าให้ผู้บริหารก่อนเปิดร้าน"
              disabled={!canOpenPreset}
              onClick={() =>
                applyPreset({
                  name: "สรุปผู้บริหาร 08:00",
                  digestMode: "all_reports",
                  enabled: canOpenPreset,
                  reportKeys: [
                    "sales_goods_services",
                    "purchase_goods_payables",
                  ],
                  targetIds: defaultTargetIds,
                  times: ["08:00"],
                  weekdays: [1, 2, 3, 4, 5, 6, 7],
                })
              }
              title="สรุปผู้บริหาร 08:00"
            />
            <PresetCard
              badge="รอบเย็น"
              description="ดูยอดระหว่างวันหลังปิดรอบงาน"
              disabled={!canOpenPreset}
              onClick={() =>
                applyPreset({
                  name: "เช็กยอดเย็น 18:30",
                  digestMode: "all_reports",
                  enabled: canOpenPreset,
                  reportKeys: [
                    "sales_goods_services",
                    "purchase_goods_payables",
                  ],
                  targetIds: defaultTargetIds,
                  times: ["18:30"],
                  weekdays: [1, 2, 3, 4, 5, 6, 7],
                })
              }
              title="เช็กยอดเย็น 18:30"
            />
            <PresetCard
              badge="หลักฐาน"
              description="เก็บหลักฐานรอบส่งจริงแบบครบชุด"
              disabled={!canOpenPreset}
              onClick={() =>
                applyPreset({
                  name: "หลักฐานครบ 7 วัน",
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
              title="หลักฐานครบ 7 วัน"
            />
          </div>
          {!canOpenPreset ? (
            <p className="mt-3 text-theme-xs text-warning-600">
              ต้องอนุมัติผู้รับอย่างน้อย 1 รายก่อน จึงจะใช้แผนแนะนำได้
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
            <PanelBody spaced>
              <div className="grid grid-cols-2 gap-3">
                <Fact
                  label="แผนเปิดอยู่"
                  tone={enabledRules.length ? "success" : "warning"}
                  value={`${enabledRules.length}/${rules.length}`}
                />
                <Fact
                  label="ผู้รับพร้อมส่ง"
                  tone={
                    state.notifications.enabled_target_count
                      ? "success"
                      : "warning"
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
            <PanelBody spaced>
              <RunList runs={recentRuns.slice(0, 6)} />
            </PanelBody>
          </Panel>
        </div>

        <div className="space-y-5 sm:space-y-6">
          <FormPanel
            action={
              selectedRule ? (
                <Badge color={selectedRule.enabled ? "success" : "warning"}>
                  {selectedRule.enabled ? "เปิดใช้งาน" : "ปิดอยู่"}
                </Badge>
              ) : (
                <Badge color="info">แผนใหม่</Badge>
              )
            }
            as="form"
            description="ตั้งเวลา เลือกรายงาน และเลือกผู้รับ LINE ก่อนบันทึกหรือทดสอบ"
            onSubmit={saveRule}
            title={
              selectedRule
                ? formatNotificationRuleName(selectedRule.name)
                : "สร้างแผนแจ้งเตือน"
            }
          >
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Field
                help="ใช้ชื่อที่ทีมอ่านแล้วรู้รอบทันที เช่น สรุปผู้บริหาร 08:00"
                label="ชื่อแผน"
              >
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
              <Field
                help="ปิดไว้ก่อนได้เมื่อยังตั้งค่า LINE หรือสิทธิ์รายงานไม่ครบ"
                label="สถานะ"
              >
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
              <Field
                help="รอบปกติของลูกค้าให้ใช้ “ส่งรายงานครบทุกใบ” เพื่อคงรูปแบบเดิม"
                label="รูปแบบข้อความใน LINE"
              >
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
              <Field
                help="รอบ 08:00 ใช้เมื่อวาน ส่วนรอบเย็นมักใช้วันนี้ถึงตอนนี้"
                label="ช่วงข้อมูลของรายงาน"
              >
                <select
                  className="owner-v2-input"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      periodPreset: event.target
                        .value as NotificationPeriodPreset,
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

            {form.digestMode === "action_only" ? (
              <Notice
                text="โหมดนี้จะส่งเฉพาะเรื่องที่ระบบคิดว่าต้องดู และอาจไม่แนบการ์ดรายงานครบทุกใบ เหมาะกับรอบพิเศษเท่านั้น"
                title="กำลังใช้โหมดส่งเฉพาะเรื่องที่ต้องดู"
                tone="warning"
              />
            ) : null}

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
              <Field
                help="เวลาทั้งหมดเป็นเวลาไทย Asia/Bangkok"
                label="เวลาแจ้งเตือน"
              >
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
                      className="min-h-11 rounded-full bg-brand-50 px-3 py-2 text-theme-xs font-medium text-brand-600 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300"
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

              <Field
                help="เลือกวันที่ระบบต้องส่งอัตโนมัติในแต่ละสัปดาห์"
                label="วันที่ส่ง"
              >
                <div className="flex flex-wrap gap-2">
                  {weekdays.map((weekday) => {
                    const checked = form.weekdays.includes(weekday.value);
                    return (
                      <button
                        className={`min-h-11 min-w-11 rounded-lg px-3 text-sm font-medium ${
                          checked
                            ? "bg-brand-500 text-white"
                            : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
                        }`}
                        key={weekday.value}
                        onClick={() =>
                          setForm((current) =>
                            toggleWeekday(current, weekday.value),
                          )
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
              disabled={busy !== null}
              onApplyPreset={(presetKey) => {
                setSendConfirmRuleId(null);
                setForm((current) => ({
                  ...current,
                  reportKeys: uniqueReportKeysInOrder(
                    getReportPresetEntry(presetKey).reportKeys,
                  ),
                }));
              }}
              onMoveReport={(reportKey, direction) => {
                setSendConfirmRuleId(null);
                setForm((current) =>
                  moveReportKey(current, reportKey, direction),
                );
              }}
              onToggleReport={(reportKey) => {
                setSendConfirmRuleId(null);
                setForm((current) => toggleReport(current, reportKey));
              }}
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
              tenantId={tenantId}
            />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Field
                help="ใช้เฉพาะปุ่มทดสอบหรือส่งตอนนี้ ไม่เปลี่ยนตารางแจ้งเตือนจริง"
                label="จำลองวันที่รอบส่ง"
              >
                <input
                  className="owner-v2-input"
                  onChange={(event) => {
                    setSendConfirmRuleId(null);
                    setForm((current) => ({
                      ...current,
                      manualDate: event.target.value,
                    }));
                  }}
                  type="date"
                  value={form.manualDate}
                />
              </Field>
              <Field
                help="ถ้าเลือกเวลา ต้องเป็นเวลาที่อยู่ในแผนนี้เพื่อกันส่งผิดรอบ"
                label="จำลองเวลารอบส่ง"
              >
                <select
                  className="owner-v2-input"
                  onChange={(event) => {
                    setSendConfirmRuleId(null);
                    setForm((current) => ({
                      ...current,
                      manualTime: event.target.value,
                    }));
                  }}
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

            <Field label="ปลายทางสำหรับรันทดสอบ/ส่งตอนนี้">
              <select
                className="owner-v2-input"
                disabled={busy !== null}
                onChange={(event) => {
                  setSendConfirmRuleId(null);
                  setManualRunTargetId(event.target.value);
                }}
                value={manualRunTargetId}
              >
                <option value="">ผู้รับทั้งหมดในแผน</option>
                {manualRunTargetOptions.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.display_name} · {target.target_id_masked}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
                ใช้เฉพาะการกดปุ่มทดสอบหรือส่งตอนนี้ ไม่เปลี่ยนผู้รับ LINE
                ที่บันทึกในแผน
              </p>
            </Field>

            <div className="flex flex-col gap-3 border-t border-gray-100 pt-5 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm leading-6 text-gray-500 dark:text-gray-400">
                {formFooterHint}
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
                  variant={
                    sendConfirmRuleId === selectedRuleId ? "primary" : "outline"
                  }
                >
                  {sendConfirmRuleId === selectedRuleId
                    ? "กดอีกครั้งเพื่อส่งจริง"
                    : "ส่งจริงตอนนี้"}
                </Button>
              </div>
            </div>
          </FormPanel>

          {runResult ? (
            <>
              <Notice
                text={`${runResult.mode === "send" ? "ส่งจริง" : "ทดสอบไม่ส่งจริง"} · ${formatNotificationRunStatus(
                  latestRunResultRun?.status ??
                    runResult.run?.status ??
                    (runResult.status as NotificationRuleRunRecord["status"]) ??
                    "queued",
                )}`}
                title="รับงานรันแผนแล้ว"
                tone="success"
              />
              <TechnicalDetails title="รายละเอียดงานรันล่าสุด">
                <Fact
                  label="รหัสงาน"
                  tone="light"
                  value={runResult.run_id ?? runResult.run?.id ?? "-"}
                />
              </TechnicalDetails>
            </>
          ) : null}

          {activeRuns.length ? (
            <Panel>
              <PanelHeader
                description="ระบบรันต่อได้แม้ปิดหน้านี้ กลับมาดูสถานะได้ภายหลัง"
                title="งานที่กำลังทำ"
              />
              <PanelBody spaced>
                <RunList runs={activeRuns} />
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AiCeoLineToggleCard({
  aiCeo,
  busy,
  onToggle,
  tenantId,
}: {
  aiCeo: NotificationAiCeoStatus;
  busy: string | null;
  onToggle: (enabled: boolean) => void;
  tenantId: string;
}) {
  const enabled = aiCeo.ai_enabled;
  const blockedReason = enabled
    ? null
    : getNotificationAiCeoBlockedReason(aiCeo);
  const liveInLine = enabled && !aiCeo.shadow_mode_enabled;
  const statusLabel = enabled
    ? liveInLine
      ? "เปิดส่งเข้า LINE"
      : "เปิดแบบทดลองเงียบ"
    : "ปิดอยู่";
  const statusTone = enabled ? (liveInLine ? "success" : "info") : "light";
  return (
    <Panel>
      <PanelHeader
        action={<Badge color={statusTone}>{statusLabel}</Badge>}
        description="ควบคุมเฉพาะข้อความ AI CEO ที่ส่งก่อนการ์ดรายงาน การปิดส่วนนี้ไม่ปิดแผนแจ้งเตือนและไม่ปิด report cards"
        title="AI CEO ใน LINE"
      />
      <PanelBody spaced>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Fact
            label="แพ็กเกจ"
            tone={aiCeo.plan_eligible ? "success" : "warning"}
            value={aiCeo.plan_eligible ? "รองรับ AI CEO" : "ยังไม่รองรับ"}
          />
          <Fact
            label="รหัส OpenRouter"
            tone={aiCeo.key_configured ? "success" : "warning"}
            value={formatAiCeoKeySource(aiCeo)}
          />
          <Fact
            label="โหมดส่ง LINE"
            tone={liveInLine ? "success" : enabled ? "warning" : "light"}
            value={
              liveInLine
                ? "ส่งข้อความ AI CEO"
                : enabled
                  ? "ทดลองเงียบ"
                  : "ไม่ส่ง AI CEO"
            }
          />
        </div>

        {blockedReason ? (
          <Notice
            text="ยังตั้งค่า AI CEO ไม่ครบ เปิดจากหน้านี้ไม่ได้จนกว่าจะแก้เงื่อนไขด้านล่าง"
            title={blockedReason}
            tone="warning"
          />
        ) : null}

        <div className="flex flex-col gap-3 border-t border-gray-100 pt-5 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">
            {enabled
              ? "ถ้าปิด AI CEO ระบบจะไม่เรียก OpenRouter สำหรับรอบแจ้งเตือนถัดไป แต่ยังส่งรายงาน LINE ตามแผนเดิม"
              : "ถ้าเปิด AI CEO ระบบจะใช้ prompt/model ที่บันทึกไว้ของร้านนี้ในรอบแจ้งเตือนถัดไป"}
          </p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link
              className={secondaryActionClass}
              href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/ai-ceo`}
            >
              ตั้งค่า AI CEO
            </Link>
            <Button
              className="w-full sm:w-auto"
              disabled={busy !== null || Boolean(blockedReason)}
              onClick={() => onToggle(!enabled)}
              size="sm"
              type="button"
              variant={enabled ? "outline" : "primary"}
            >
              {busy === "toggle-ai-ceo"
                ? "กำลังบันทึก..."
                : enabled
                  ? "ปิด AI CEO"
                  : "เปิด AI CEO"}
            </Button>
          </div>
        </div>
      </PanelBody>
    </Panel>
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
      <div className="flex flex-col items-center gap-3 rounded-lg bg-gray-50 p-5 text-center dark:bg-white/[0.02] sm:p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          <BellIcon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            ยังไม่มีแผนแจ้งเตือน
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
            เริ่มจากสร้างแผน 08:00 หรือ 18:30 แล้วเลือกผู้รับ LINE
          </p>
        </div>
      </div>
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
                {formatNotificationRuleName(rule.name)}
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
  disabled,
  onApplyPreset,
  onMoveReport,
  onToggleReport,
  selectedReportKeys,
}: {
  disabled: boolean;
  onApplyPreset: (presetKey: ReportPresetKey) => void;
  onMoveReport: (reportKey: ReportKey, direction: "up" | "down") => void;
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
              disabled={disabled}
              key={preset.key}
              onClick={() => onApplyPreset(preset.key)}
              type="button"
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="mt-4 rounded-lg bg-white p-3 dark:bg-gray-900">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
              ลำดับที่จะแสดงใน LINE
            </p>
            <p className="mt-1 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
              ระบบใช้ลำดับนี้กับรอบที่ส่งรายงานครบ
              และรอบพิเศษที่ต้องกลับมาส่งรายงานปกติ
            </p>
          </div>
          <Badge color={selectedReportKeys.length > 1 ? "info" : "light"}>
            {selectedReportKeys.length > 1 ? "เรียงได้" : "ยังเรียงไม่ได้"}
          </Badge>
        </div>
        {selectedReportKeys.length > 1 ? (
          <div className="mt-3 space-y-2">
            {selectedReportKeys.map((reportKey, index) => {
              const report = getReportCatalogEntry(reportKey);
              const category =
                categoryLabels[report.category] ?? report.category;
              return (
                <div
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
                  key={reportKey}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-theme-xs font-semibold text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-800 dark:text-white/90">
                      {report.shortLabel}
                    </span>
                    <span className="mt-0.5 block text-theme-xs text-gray-500 dark:text-gray-400">
                      {category}
                    </span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      aria-label={`เลื่อน ${report.shortLabel} ขึ้น`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200"
                      disabled={disabled || index === 0}
                      onClick={() => onMoveReport(reportKey, "up")}
                      title={`เลื่อน ${report.shortLabel} ขึ้น`}
                      type="button"
                    >
                      <ArrowUpIcon className="h-4 w-4" />
                    </button>
                    <button
                      aria-label={`เลื่อน ${report.shortLabel} ลง`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200"
                      disabled={
                        disabled || index === selectedReportKeys.length - 1
                      }
                      onClick={() => onMoveReport(reportKey, "down")}
                      title={`เลื่อน ${report.shortLabel} ลง`}
                      type="button"
                    >
                      <ArrowDownIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-theme-xs leading-5 text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
            {selectedReportKeys.length
              ? "เลือกเพิ่มอีก 1 รายงานเพื่อเปิดการจัดลำดับ"
              : "เลือกอย่างน้อย 2 รายงานเพื่อจัดลำดับการแสดงใน LINE"}
          </p>
        )}
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
                      className="mt-1 size-5"
                      disabled={disabled}
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
  tenantId,
}: {
  channels: LineChannelRecord[];
  onToggleTarget: (targetId: string) => void;
  reportKeys: ReportKey[];
  selectedTargetIds: string[];
  targets: Array<LineTargetRecord & { sibling_tenant_names?: string[] }>;
  tenantId: string;
}) {
  if (!targets.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg bg-gray-50 p-5 text-center dark:bg-white/[0.02] sm:p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          <InfoIcon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            ยังไม่มีผู้รับ LINE
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
            ต้องมีผู้รับ LINE ก่อนจึงเปิดแผนแจ้งเตือนได้
          </p>
        </div>
        <Link
          className={secondaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/line`}
        >
          ไปตั้งค่า LINE
        </Link>
      </div>
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
      <div className="hidden w-full overflow-x-auto lg:block">
        <table className="w-full min-w-full">
          <thead>
            <tr className="border-y border-gray-100 dark:border-gray-800">
              {[
                "เลือก",
                "ผู้รับ",
                "แชร์ช่อง LINE กับ",
                "พร้อมส่ง",
                "เหตุผล",
              ].map((label) => (
                <th
                  className="py-3 pr-5 text-left last:pr-0 sm:pr-6"
                  key={label}
                >
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
              const siblings = target.sibling_tenant_names ?? [];
              return (
                <tr key={target.id}>
                  <td className="py-4 pr-5 last:pr-0 sm:pr-6">
                    <input
                      checked={selectedTargetIds.includes(target.id)}
                      className="size-5"
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
                    {siblings.length > 0 ? (
                      <div>
                        {siblings.map((name) => (
                          <span
                            className="mr-1 inline-block rounded-full bg-warning-50 px-2 py-0.5 text-theme-xs font-medium text-warning-700 dark:bg-warning-500/10 dark:text-warning-300"
                            key={name}
                          >
                            {name}
                          </span>
                        ))}
                        <p className="mt-1 text-theme-xs text-gray-400 dark:text-gray-500">
                          โควต้า LINE OA ถูกใช้ร่วมกัน
                        </p>
                      </div>
                    ) : (
                      <span className="text-theme-xs text-gray-400 dark:text-gray-500">
                        —
                      </span>
                    )}
                  </td>
                  <td className="py-4 pr-5 last:pr-0 sm:pr-6">
                    <Badge color={readiness.ok ? "success" : "warning"}>
                      {readiness.ok ? "พร้อม" : "ติดเงื่อนไข"}
                    </Badge>
                  </td>
                  <td className="py-4 pr-5 last:pr-0 sm:pr-6">
                    <p className="max-w-md text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
                      {readiness.ok
                        ? "ส่งได้ตามรายงานที่เลือก"
                        : readiness.message}
                    </p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 lg:hidden">
        {targets.map((target) => {
          const readiness = getLineTargetDeliveryReadiness({
            channels,
            reportKeys,
            target,
          });
          return (
            <TargetMobileCard
              checked={selectedTargetIds.includes(target.id)}
              key={target.id}
              onToggle={() => onToggleTarget(target.id)}
              readiness={readiness}
              target={target}
            />
          );
        })}
      </div>
    </div>
  );
}

function TargetMobileCard({
  checked,
  onToggle,
  readiness,
  target,
}: {
  checked: boolean;
  onToggle: () => void;
  readiness: LineTargetDeliveryReadiness;
  target: LineTargetRecord & { sibling_tenant_names?: string[] };
}) {
  const siblings = target.sibling_tenant_names ?? [];
  return (
    <label
      className={`block cursor-pointer rounded-xl border p-4 transition ${
        checked
          ? "border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10"
          : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          checked={checked}
          className="mt-1 size-5"
          onChange={onToggle}
          type="checkbox"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-words text-sm font-semibold text-gray-800 dark:text-white/90">
              {target.display_name}
            </p>
            <Badge color={readiness.ok ? "success" : "warning"}>
              {readiness.ok ? "พร้อมส่ง" : "ติดเงื่อนไข"}
            </Badge>
          </div>
          <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
            รหัสผู้รับแบบย่อ: {target.target_id_masked}
          </p>
          {siblings.length > 0 ? (
            <div className="mt-3">
              <p className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                ใช้ LINE OA ร่วมกับ
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {siblings.map((name) => (
                  <span
                    className="inline-block rounded-full bg-warning-50 px-2 py-0.5 text-theme-xs font-medium text-warning-700 dark:bg-warning-500/10 dark:text-warning-300"
                    key={name}
                  >
                    {name}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-theme-xs text-gray-400 dark:text-gray-500">
                โควต้า LINE OA ถูกใช้ร่วมกัน
              </p>
            </div>
          ) : null}
          <p className="mt-3 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
            {readiness.ok ? "ส่งได้ตามรายงานที่เลือก" : readiness.message}
          </p>
        </div>
      </div>
    </label>
  );
}

function RunList({ runs }: { runs: NotificationRuleRunRecord[] }) {
  if (!runs.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg bg-gray-50 p-5 text-center dark:bg-white/[0.02] sm:p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          <TimeIcon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            ยังไม่มีประวัติรัน
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
            หลังทดสอบหรือรอบอัตโนมัติทำงาน ผลล่าสุดจะแสดงตรงนี้
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {runs.map((run) => {
        const progress = getProgressPercent(run);
        const runBadges = getNotificationRunBadges(run);
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
                  {run.mode === "send" ? "ส่งจริง" : "ทดสอบไม่ส่งจริง"} ·
                  ครั้งที่ {run.attempt} · {formatElapsed(run)}
                </p>
                {runBadges.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {runBadges.map((badge) => (
                      <Badge color={badge.tone} key={badge.label} size="sm">
                        {badge.label}
                      </Badge>
                    ))}
                  </div>
                ) : null}
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
        <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
          {title}
        </span>
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
    digestMode: "all_reports",
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
    digestMode: rule.digest_mode ?? "all_reports",
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

function getDefaultManualRunTargetId(targets: LineTargetWithSiblings[]) {
  return (
    targets.find((target) => isPreferredManualRunTarget(target))?.id ??
    targets.find(
      (target) =>
        target.target_type === "user" &&
        target.access_profile_key === "executive",
    )?.id ??
    targets.find((target) => target.target_type === "user")?.id ??
    targets[0]?.id ??
    ""
  );
}

function isPreferredManualRunTarget(target: LineTargetRecord) {
  const displayName = target.display_name.toLowerCase();
  const maskedId = target.target_id_masked;
  return (
    displayName.includes("บอส") ||
    (maskedId.startsWith("Uc486") && maskedId.endsWith("2d3f9"))
  );
}

function notificationAiCeoFromSetupStatus(
  status: OwnerV2AiCeoSetupStatus,
): NotificationAiCeoStatus {
  return {
    advisor_name: status.profile.advisor_name,
    ai_enabled: status.profile.ai_enabled,
    encryption_configured: status.encryption_configured,
    key_configured: status.key_configured,
    key_source: status.key_source,
    plan_eligible: status.plan_eligible,
    selected_model_id: status.profile.selected_model_id,
    shadow_mode_enabled: status.profile.shadow_mode_enabled,
  };
}

function getNotificationAiCeoBlockedReason(aiCeo: NotificationAiCeoStatus) {
  if (!aiCeo.plan_eligible) {
    return "แพ็กเกจร้านนี้ยังไม่รองรับ AI CEO";
  }
  if (!aiCeo.encryption_configured) {
    return "ระบบเข้ารหัสยังไม่พร้อมสำหรับ AI CEO";
  }
  if (!aiCeo.key_configured) {
    return "ยังไม่มีรหัส OpenRouter สำหรับ AI CEO";
  }
  return null;
}

function formatAiCeoKeySource(aiCeo: NotificationAiCeoStatus) {
  if (!aiCeo.key_configured) {
    return "ยังไม่มีรหัส";
  }
  const labels: Record<NotificationAiCeoStatus["key_source"], string> = {
    env: "รหัสจากระบบแม่ข่าย",
    missing: "ยังไม่มีรหัส",
    system_default: "รหัสกลางของระบบ",
    tenant_override: "รหัสเฉพาะร้าน",
  };
  return labels[aiCeo.key_source] ?? "ตั้งค่าแล้ว";
}

function mergeManualRunFields({
  currentForm,
  nextForm,
}: {
  currentForm: NotificationFormState;
  nextForm: NotificationFormState;
}) {
  const manualTime =
    currentForm.manualTime === "" ||
    nextForm.times.includes(currentForm.manualTime)
      ? currentForm.manualTime
      : nextForm.manualTime;
  return {
    ...nextForm,
    manualDate: currentForm.manualDate,
    manualTime,
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
    report_keys: uniqueReportKeysInOrder(form.reportKeys),
    schedule: [
      {
        times: [...new Set(form.times)].sort(),
        weekdays: [...new Set(form.weekdays)].sort(
          (left, right) => left - right,
        ),
      },
    ],
    target_ids: [...new Set(form.targetIds)].sort(),
    tenant_id: tenantId,
    timezone: BANGKOK_TIME_ZONE,
  };
}

function sameForm(left: NotificationFormState, right: NotificationFormState) {
  return (
    JSON.stringify(normalizeForm(left)) === JSON.stringify(normalizeForm(right))
  );
}

function normalizeForm(form: NotificationFormState) {
  return {
    digestMode: form.digestMode,
    enabled: form.enabled,
    name: form.name.trim(),
    periodPreset: form.periodPreset,
    reportKeys: uniqueReportKeysInOrder(form.reportKeys),
    targetIds: [...new Set(form.targetIds)].sort(),
    times: [...new Set(form.times)].sort(),
    weekdays: [...new Set(form.weekdays)].sort((left, right) => left - right),
  };
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
    : uniqueReportKeysInOrder([...form.reportKeys, reportKey]);
  return { ...form, reportKeys };
}

function moveReportKey(
  form: NotificationFormState,
  reportKey: ReportKey,
  direction: "up" | "down",
) {
  const reportKeys = uniqueReportKeysInOrder(form.reportKeys);
  const index = reportKeys.indexOf(reportKey);
  if (index < 0) {
    return form;
  }
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= reportKeys.length) {
    return form;
  }
  const nextReportKeys = [...reportKeys];
  [nextReportKeys[index], nextReportKeys[nextIndex]] = [
    nextReportKeys[nextIndex]!,
    nextReportKeys[index]!,
  ];
  return { ...form, reportKeys: nextReportKeys };
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
  if (
    input.form.manualDate &&
    input.form.manualTime &&
    !isManualScheduleAllowed(input.form)
  ) {
    return "รอบจำลองที่เลือกไม่อยู่ในตารางแจ้งเตือนของแผนนี้";
  }
  if (input.selectedTargetBlockedReason) {
    return input.selectedTargetBlockedReason;
  }
  return null;
}

function getNotificationFormFooterHint(input: {
  actionBlockedReason: string | null;
  dirty: boolean;
  effectiveSendBlockedReason: string | null;
  saveBlockedReason: string | null;
  selectedRuleId: string | null;
}) {
  if (input.saveBlockedReason) {
    return input.saveBlockedReason;
  }
  if (!input.selectedRuleId) {
    return "บันทึกแผนก่อนทดสอบหรือส่งจริง เพื่อให้รอบส่งใช้ค่าที่ถูกต้อง";
  }
  if (input.dirty) {
    return "มีการแก้ไขที่ยังไม่บันทึก กรุณาบันทึกก่อนทดสอบหรือส่งจริง";
  }
  if (input.effectiveSendBlockedReason) {
    return input.effectiveSendBlockedReason;
  }
  if (input.actionBlockedReason) {
    return input.actionBlockedReason;
  }
  return "พร้อมทดสอบแล้ว ถ้าจะส่งจริงเพื่อดูหน้าตา LINE ให้เลือกปลายทางเฉพาะผู้รับของทีมก่อน";
}

function isManualScheduleAllowed(form: NotificationFormState) {
  return (
    form.weekdays.includes(isoWeekdayFromYmd(form.manualDate)) &&
    form.times.includes(form.manualTime)
  );
}

type LineTargetDeliveryReadiness =
  { ok: true } | { ok: false; message: string; reason: string };

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
    return {
      ok: false,
      reason: "target_not_approved",
      message: "ยังไม่ได้อนุมัติผู้รับ LINE",
    };
  }
  if (!target.enabled) {
    return {
      ok: false,
      reason: "target_disabled",
      message: "ผู้รับ LINE ถูกปิดใช้งาน",
    };
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
    : channels.find(
        (item) => item.enabled && item.channel_access_token_configured,
      );
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
      message: "LINE OA ยังไม่มีรหัสส่งข้อความสำหรับส่งจริง",
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
          .map(
            (weekday) =>
              weekdays.find((item) => item.value === weekday)?.label ?? weekday,
          )
          .join(", ");
  return `${days} · ${schedule.times.join(", ")} · รอบผู้บริหาร`;
}

function formatNotificationRuleName(name: string) {
  const legacyNames: Record<string, string> = {
    "Daily SML digest": "สรุปรายวันจาก SML",
    "Owner Daily Brief 08:00": "สรุปผู้บริหาร 08:00",
    "Evening Sales Check 18:30": "เช็กยอดเย็น 18:30",
    "7-Day Proof Full Reports": "หลักฐานครบ 7 วัน",
  };
  return legacyNames[name] ?? name;
}

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isNotificationRunActive(run: NotificationRuleRunRecord) {
  return run.status === "queued" || run.status === "running";
}

function getNotificationRunBadges(run: NotificationRuleRunRecord) {
  const badges: Array<{
    label: string;
    tone: "success" | "warning" | "light";
  }> = [];
  if (isNotificationRunActive(run)) {
    if (
      !run.progress_stage ||
      run.progress_stage === "queued" ||
      run.progress_stage === "claimed" ||
      run.progress_stage === "running_report" ||
      run.progress_stage === "waiting_chunked_report"
    ) {
      badges.push({ label: "กำลังดึงรายงาน", tone: "warning" });
    }
    if (getNotificationRunElapsedMs(run) >= 15 * 60 * 1000) {
      badges.push({ label: "รอนานกว่าปกติ", tone: "warning" });
    }
  }
  if (run.status === "failed" && run.next_retry_at && run.delivery_ids.length) {
    badges.push({ label: "รอส่ง LINE ซ้ำ", tone: "warning" });
  }
  return badges;
}

function getNotificationRunElapsedMs(run: NotificationRuleRunRecord) {
  const startedAt =
    run.started_at ?? run.claimed_at ?? run.queued_at ?? run.created_at;
  const finishedAt = run.finished_at ?? new Date().toISOString();
  const elapsedMs =
    new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
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

function isoWeekdayFromYmd(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  const weekday = date.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function createClientRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toNotificationTechnicalMessage(error: unknown) {
  const payload = (error as OwnerV2FetchError | undefined)?.payload;
  const safeMessage =
    typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : null;
  if (safeMessage) {
    return safeMessage;
  }
  return error instanceof Error ? error.message : "ไม่พบรายละเอียด";
}

function NotificationSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      <div className="h-96 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
    </div>
  );
}
