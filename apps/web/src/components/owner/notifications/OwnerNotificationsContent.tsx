"use client";

import { useMemo } from "react";
import {
  deriveNotificationPeriodRange,
  getReportCatalogEntry,
  getReportPresetEntry,
  matchReportPreset,
  reportKeyValues,
  reportPresetKeyValues,
  type LineTargetRecord,
  type NotificationDigestMode,
  type NotificationPeriodPreset,
  type NotificationPeriodStrategy,
  type NotificationRuleRecord,
  type NotificationRuleRunRecord,
  type ReportPresetKey,
  type ReportKey,
  type Tenant,
} from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { formatLineAccessProfile } from "../OwnerLineTargetsPanel";

type TenantSummary = {
  tenant: Tenant;
  health: {
    line_targets_total: number;
    line_targets_enabled: number;
    latest_notification_run_status: string | null;
  };
};

type OwnerNotificationRule = NotificationRuleRecord & {
  next_run: {
    date: string;
    time: string;
    timezone: string;
  } | null;
};

type NotificationRuleRunResult = {
  ok: boolean;
  mode?: "dry_run" | "send";
};

export type OwnerNotificationsContentProps = {
  busy: string | null;
  editingNotificationRuleId: string | null;
  lastNotificationRunResult: NotificationRuleRunResult | null;
  notificationDigestMode: NotificationDigestMode;
  notificationEnabled: boolean;
  notificationManualScheduledDate: string;
  notificationManualScheduledTime: string;
  notificationName: string;
  notificationPeriodPreset: NotificationPeriodPreset;
  notificationPeriodStrategy: NotificationPeriodStrategy;
  notificationReportKeys: ReportKey[];
  notificationRuleRuns: NotificationRuleRunRecord[];
  notificationRules: OwnerNotificationRule[];
  notificationTargetIds: string[];
  notificationTimeInput: string;
  notificationTimes: string[];
  notificationWeekdays: number[];
  onAddNotificationTime: () => void;
  onExecuteNotificationRule: (mode: "dry_run" | "send") => Promise<void>;
  onNewNotificationRule: () => void;
  onRemoveNotificationTime: (time: string) => void;
  onSaveNotificationRule: () => Promise<void>;
  onSelectNotificationRule: (rule: OwnerNotificationRule) => void;
  onSetNotificationReportKeys: (reportKeys: ReportKey[]) => void;
  onToggleNotificationReportKey: (reportKey: ReportKey) => void;
  onToggleNotificationTarget: (targetId: string) => void;
  onToggleNotificationWeekday: (weekday: number) => void;
  selectedTenantId: string;
  selectedTenantLineTargets: LineTargetRecord[];
  selectedTenantSummary?: TenantSummary;
  setNotificationDigestMode: (value: NotificationDigestMode) => void;
  setNotificationEnabled: (value: boolean) => void;
  setNotificationManualScheduledDate: (value: string) => void;
  setNotificationManualScheduledTime: (value: string) => void;
  setNotificationName: (value: string) => void;
  setNotificationTimeInput: (value: string) => void;
  setSelectedTenantId: (value: string) => void;
  tenants: TenantSummary[];
};

const NOTIFICATION_WEEKDAYS = [
  { label: "จ", value: 1 },
  { label: "อ", value: 2 },
  { label: "พ", value: 3 },
  { label: "พฤ", value: 4 },
  { label: "ศ", value: 5 },
  { label: "ส", value: 6 },
  { label: "อา", value: 7 },
] as const;

const OWNER_NOTIFICATION_PERIOD_STRATEGY: NotificationPeriodStrategy =
  "executive_checkpoints";

const OWNER_NOTIFICATION_PERIOD_STRATEGY_LABEL = "รอบผู้บริหาร";
const OWNER_NOTIFICATION_PERIOD_STRATEGY_DESCRIPTION =
  "เช้าอ่านเมื่อวานเต็มวัน เย็นอ่านวันนี้ถึงเวลาแจ้งเตือน";

const NOTIFICATION_DIGEST_MODE_OPTIONS: Array<{
  value: NotificationDigestMode;
  label: string;
  description: string;
}> = [
  {
    value: "action_only",
    label: "ส่งเรื่องที่ต้องดูเป็นหลัก",
    description:
      "ใช้ Action Digest เมื่อเปิด rollout gate ของร้าน ถ้าไม่มีเรื่องต้องดูจะ fallback เป็นรายงานเดิม",
  },
  {
    value: "all_reports",
    label: "ส่งครบทุก report",
    description:
      "ส่งรายงานที่เลือกทุกใบ เหมาะกับช่วงตรวจระบบหรือร้านที่อยากอ่านตัวเลขครบ",
  },
];

const REPORT_CATEGORY_LABELS: Record<string, string> = {
  sales: "ขาย",
  purchase: "ซื้อ",
  gross_profit: "กำไร",
  inventory: "สต็อก",
  ar: "ลูกหนี้",
};

type ComparableNotificationRule = {
  digest_mode: NotificationDigestMode;
  enabled: boolean;
  name: string;
  period_preset: NotificationPeriodPreset;
  period_strategy: NotificationPeriodStrategy;
  report_keys: ReportKey[];
  schedule: Array<{
    times: string[];
    weekdays: number[];
  }>;
  target_ids: string[];
  tenant_id: string;
  timezone: string;
};

type ManualScheduleValidation =
  | { ok: true }
  | { ok: false; error: string };

export function OwnerNotificationsContent({
  busy,
  editingNotificationRuleId,
  lastNotificationRunResult,
  notificationDigestMode,
  notificationEnabled,
  notificationManualScheduledDate,
  notificationManualScheduledTime,
  notificationName,
  notificationPeriodPreset,
  notificationReportKeys,
  notificationRuleRuns,
  notificationRules,
  notificationTargetIds,
  notificationTimeInput,
  notificationTimes,
  notificationWeekdays,
  onAddNotificationTime,
  onExecuteNotificationRule,
  onNewNotificationRule,
  onRemoveNotificationTime,
  onSaveNotificationRule,
  onSelectNotificationRule,
  onSetNotificationReportKeys,
  onToggleNotificationReportKey,
  onToggleNotificationTarget,
  onToggleNotificationWeekday,
  selectedTenantId,
  selectedTenantLineTargets,
  selectedTenantSummary,
  setNotificationDigestMode,
  setNotificationEnabled,
  setNotificationManualScheduledDate,
  setNotificationManualScheduledTime,
  setNotificationName,
  setNotificationTimeInput,
  setSelectedTenantId,
  tenants,
}: OwnerNotificationsContentProps) {
  const selectedTenantName =
    selectedTenantSummary?.tenant.name ?? "เลือกร้านค้า";
  const selectedRule = useMemo(
    () =>
      editingNotificationRuleId
        ? notificationRules.find((rule) => rule.id === editingNotificationRuleId) ??
          null
        : null,
    [editingNotificationRuleId, notificationRules],
  );
  const rulesByTenant = useMemo(() => {
    const result = new Map<string, OwnerNotificationRule[]>();
    for (const rule of notificationRules) {
      const current = result.get(rule.tenant_id) ?? [];
      current.push(rule);
      result.set(rule.tenant_id, current);
    }
    return result;
  }, [notificationRules]);
  const runsByTenant = useMemo(() => {
    const result = new Map<string, NotificationRuleRunRecord[]>();
    for (const run of notificationRuleRuns) {
      const current = result.get(run.tenant_id) ?? [];
      current.push(run);
      result.set(run.tenant_id, current);
    }
    return result;
  }, [notificationRuleRuns]);
  const selectedRules = rulesByTenant.get(selectedTenantId) ?? [];
  const selectedRuns = useMemo(
    () =>
      (runsByTenant.get(selectedTenantId) ?? []).filter(
        (run) =>
          !editingNotificationRuleId ||
          run.rule_id === editingNotificationRuleId,
      ),
    [editingNotificationRuleId, runsByTenant, selectedTenantId],
  );
  const failedRuns = useMemo(
    () => notificationRuleRuns.filter((run) => run.status === "failed"),
    [notificationRuleRuns],
  );

  const draftRule = useMemo(
    () =>
      normalizeNotificationRuleDraft({
        digestMode: notificationDigestMode,
        enabled: notificationEnabled,
        name: notificationName,
        periodPreset: notificationPeriodPreset,
        periodStrategy: OWNER_NOTIFICATION_PERIOD_STRATEGY,
        reportKeys: notificationReportKeys,
        targetIds: notificationTargetIds,
        tenantId: selectedTenantId,
        times: notificationTimes,
        weekdays: notificationWeekdays,
      }),
    [
      notificationDigestMode,
      notificationEnabled,
      notificationName,
      notificationPeriodPreset,
      notificationReportKeys,
      notificationTargetIds,
      notificationTimes,
      notificationWeekdays,
      selectedTenantId,
    ],
  );
  const savedRuleForCompare = useMemo(
    () => (selectedRule ? normalizeNotificationRuleRecord(selectedRule) : null),
    [selectedRule],
  );
  const isDirty =
    Boolean(savedRuleForCompare) &&
    JSON.stringify(draftRule) !== JSON.stringify(savedRuleForCompare);
  const isNewDraft = !editingNotificationRuleId;

  const saveBusy =
    busy === `notification-save-${editingNotificationRuleId}` ||
    (selectedTenantId
      ? busy === `notification-create-${selectedTenantId}`
      : false);
  const dryRunBusy = editingNotificationRuleId
    ? busy === `notification-run-${editingNotificationRuleId}-dry_run`
    : false;
  const sendBusy = editingNotificationRuleId
    ? busy === `notification-run-${editingNotificationRuleId}-send`
    : false;
  const approvedTargets = selectedTenantLineTargets.filter(
    (target) => target.approved && target.enabled,
  );
  const targetsWithPermission = approvedTargets.filter((target) =>
    notificationReportKeys.every((reportKey) =>
      canLineTargetReceiveReport(target, reportKey),
    ),
  );
  const periodPreviewRows = useMemo(
    () =>
      buildNotificationPeriodPreviewRows({
        periodPreset: notificationPeriodPreset,
        periodStrategy: OWNER_NOTIFICATION_PERIOD_STRATEGY,
        times: notificationTimes,
        weekdays: notificationWeekdays,
      }),
    [
      notificationPeriodPreset,
      notificationTimes,
      notificationWeekdays,
    ],
  );
  const savedSchedule = selectedRule?.schedule[0] ?? null;
  const savedTimes = savedSchedule?.times ?? [];
  const savedWeekdays = savedSchedule?.weekdays ?? [];
  const manualScheduleValidation = selectedRule
    ? validateManualNotificationRunSelection({
        scheduledDate: notificationManualScheduledDate,
        scheduledTime: notificationManualScheduledTime,
        times: savedTimes,
        weekdays: savedWeekdays,
      })
    : { ok: false, error: "บันทึกแผนก่อนทดสอบหรือส่งจริง" };
  const manualPeriodParams = manualScheduleValidation.ok
    ? deriveNotificationPeriodRange({
        periodPreset: selectedRule!.period_preset,
        periodStrategy: OWNER_NOTIFICATION_PERIOD_STRATEGY,
        scheduledLocalDate: notificationManualScheduledDate,
        scheduledLocalTime: notificationManualScheduledTime,
        timeZone: selectedRule!.timezone || "Asia/Bangkok",
      })
    : null;
  const manualPeriodLabel = manualScheduleValidation.ok
    ? formatNotificationPeriodWithTime(
        manualPeriodParams!.date_from,
        manualPeriodParams!.date_to,
        manualPeriodParams!.time_from,
        manualPeriodParams!.time_to,
      )
    : manualScheduleValidation.error;
  const latestBasisReports = notificationReportKeys.filter(
    (reportKey) => reportKey === "stock_reorder",
  );
  const selectedReportPreset = matchReportPreset(notificationReportKeys);
  const actionBlockedReason = getNotificationActionBlockedReason({
    editingNotificationRuleId,
    isDirty,
    manualScheduleValidation,
  });
  const canExecuteManualRun =
    !actionBlockedReason && !dryRunBusy && !sendBusy;

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-4">
        <NotificationStatCard
          label="แผนทั้งหมด"
          value={notificationRules.length.toLocaleString("th-TH")}
        />
        <NotificationStatCard
          label="เปิดใช้งาน"
          value={notificationRules
            .filter((rule) => rule.enabled)
            .length.toLocaleString("th-TH")}
        />
        <NotificationStatCard
          label="ร้านที่มีแผน"
          value={rulesByTenant.size.toLocaleString("th-TH")}
        />
        <NotificationStatCard
          label="Failed run"
          value={failedRuns.length.toLocaleString("th-TH")}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.42fr)]">
        <div className="space-y-4">
          <NotificationTenantList
            notificationRuleRuns={notificationRuleRuns}
            rulesByTenant={rulesByTenant}
            selectedTenantId={selectedTenantId}
            setSelectedTenantId={setSelectedTenantId}
            tenants={tenants}
          />

          <NotificationRuleList
            editingNotificationRuleId={editingNotificationRuleId}
            onNewNotificationRule={onNewNotificationRule}
            onSelectNotificationRule={onSelectNotificationRule}
            selectedRules={selectedRules}
          />
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
            <div className="border-b border-gray-100 p-5 dark:border-gray-800">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color={isDirty || isNewDraft ? "warning" : "success"}>
                      {isNewDraft
                        ? "draft ใหม่"
                        : isDirty
                          ? "แก้ไขยังไม่บันทึก"
                          : "ตรงกับแผนที่บันทึก"}
                    </Badge>
                    <Badge color={notificationEnabled ? "success" : "light"}>
                      {notificationEnabled ? "เปิดใช้งาน" : "ปิดอยู่"}
                    </Badge>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">
                    ตั้งค่าแผนแจ้งเตือน
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                    {selectedTenantName} · แก้ draft ได้ก่อนบันทึก แต่การทดสอบและส่งจริงจะใช้แผนที่บันทึกแล้วเท่านั้น
                  </p>
                </div>
                {selectedRule?.next_run ? (
                  <div className="rounded-lg border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      รอบถัดไป
                    </p>
                    <p className="mt-1 font-semibold text-gray-900 dark:text-white">
                      {selectedRule.next_run.date} {selectedRule.next_run.time}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-6 p-5">
              <PlanBasicsSection
                notificationDigestMode={notificationDigestMode}
                notificationEnabled={notificationEnabled}
                notificationName={notificationName}
                setNotificationDigestMode={setNotificationDigestMode}
                setNotificationEnabled={setNotificationEnabled}
                setNotificationName={setNotificationName}
              />

              <ReportPickerSection
                notificationReportKeys={notificationReportKeys}
                onSetNotificationReportKeys={onSetNotificationReportKeys}
                onToggleNotificationReportKey={onToggleNotificationReportKey}
                selectedReportPreset={selectedReportPreset}
              />

              <SchedulePeriodSection
                isDirty={isDirty || isNewDraft}
                latestBasisReports={latestBasisReports}
                notificationTimeInput={notificationTimeInput}
                notificationTimes={notificationTimes}
                notificationWeekdays={notificationWeekdays}
                onAddNotificationTime={onAddNotificationTime}
                onRemoveNotificationTime={onRemoveNotificationTime}
                onToggleNotificationWeekday={onToggleNotificationWeekday}
                periodPreviewRows={periodPreviewRows}
                setNotificationTimeInput={setNotificationTimeInput}
              />

              <LineTargetSection
                approvedTargets={approvedTargets}
                notificationReportKeys={notificationReportKeys}
                notificationTargetIds={notificationTargetIds}
                onToggleNotificationTarget={onToggleNotificationTarget}
                selectedTenantLineTargets={selectedTenantLineTargets}
                targetsWithPermission={targetsWithPermission}
              />

              <div className="flex flex-col gap-3 border-t border-gray-100 pt-5 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm leading-6 text-gray-600 dark:text-gray-300">
                  {isDirty ? (
                    <span>
                      มีการแก้ไขค้างอยู่ ต้องบันทึกก่อนจึงจะทดสอบหรือส่งจริงได้
                    </span>
                  ) : (
                    <span>
                      บันทึกแล้วสามารถใช้แผนนี้ในรอบ worker หรือส่งทดสอบได้ทันที
                    </span>
                  )}
                </div>
                <Button
                  disabled={saveBusy}
                  onClick={() => void onSaveNotificationRule()}
                  size="sm"
                >
                  {saveBusy ? "กำลังบันทึก..." : "บันทึกแผน"}
                </Button>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
            <ManualRunPanel
              actionBlockedReason={actionBlockedReason}
              canExecuteManualRun={canExecuteManualRun}
              dryRunBusy={dryRunBusy}
              isDirty={isDirty}
              lastNotificationRunResult={lastNotificationRunResult}
              manualPeriodLabel={manualPeriodLabel}
              manualScheduleValidation={manualScheduleValidation}
              notificationManualScheduledDate={notificationManualScheduledDate}
              notificationManualScheduledTime={notificationManualScheduledTime}
              onExecuteNotificationRule={onExecuteNotificationRule}
              savedRule={selectedRule}
              savedTimes={savedTimes}
              sendBusy={sendBusy}
              setNotificationManualScheduledDate={
                setNotificationManualScheduledDate
              }
              setNotificationManualScheduledTime={
                setNotificationManualScheduledTime
              }
            />

            <RunHistoryPanel
              lastNotificationRunResult={lastNotificationRunResult}
              selectedRuns={selectedRuns}
            />
          </section>
        </div>
      </section>
    </div>
  );
}

function NotificationTenantList({
  notificationRuleRuns,
  rulesByTenant,
  selectedTenantId,
  setSelectedTenantId,
  tenants,
}: {
  notificationRuleRuns: NotificationRuleRunRecord[];
  rulesByTenant: Map<string, OwnerNotificationRule[]>;
  selectedTenantId: string;
  setSelectedTenantId: (tenantId: string) => void;
  tenants: TenantSummary[];
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <NotificationPanelHeader
        description="เลือกร้านเพื่อดูแผนและสถานะรอบส่งล่าสุด"
        title="ร้านค้า"
      />
      <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
        {tenants.map((item) => {
          const rules = rulesByTenant.get(item.tenant.id) ?? [];
          const failed = notificationRuleRuns.some(
            (run) => run.tenant_id === item.tenant.id && run.status === "failed",
          );
          return (
            <button
              className={`w-full p-4 text-left transition ${
                selectedTenantId === item.tenant.id
                  ? "bg-brand-50/70 dark:bg-brand-500/10"
                  : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
              }`}
              key={item.tenant.id}
              onClick={() => setSelectedTenantId(item.tenant.id)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {item.tenant.name}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    {rules.length} แผน · {item.health.line_targets_enabled}/
                    {item.health.line_targets_total} ผู้รับ LINE
                  </p>
                </div>
                <Badge color={failed ? "warning" : rules.length ? "success" : "light"}>
                  {failed ? "มีปัญหา" : rules.length ? "มีแผนแล้ว" : "ยังไม่ตั้ง"}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function NotificationRuleList({
  editingNotificationRuleId,
  onNewNotificationRule,
  onSelectNotificationRule,
  selectedRules,
}: {
  editingNotificationRuleId: string | null;
  onNewNotificationRule: () => void;
  onSelectNotificationRule: (rule: OwnerNotificationRule) => void;
  selectedRules: OwnerNotificationRule[];
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <NotificationPanelHeader
        description="แยกแผนเมื่อปลายทางหรือชุดรายงานไม่เหมือนกัน"
        title="แผนของร้านนี้"
      />
      <div className="space-y-2 border-t border-gray-100 p-4 dark:border-gray-800">
        <Button size="sm" variant="outline" onClick={onNewNotificationRule}>
          สร้างแผนใหม่
        </Button>
        {selectedRules.length ? (
          selectedRules.map((rule) => (
            <button
              className={`w-full rounded-lg border p-3 text-left transition ${
                editingNotificationRuleId === rule.id
                  ? "border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-white"
                  : "border-gray-100 bg-gray-50 hover:bg-gray-100 dark:border-gray-800 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]"
              }`}
              key={rule.id}
              onClick={() => onSelectNotificationRule(rule)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{rule.name}</p>
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    {formatNotificationSchedule(rule)} · {rule.target_ids.length} ปลายทาง
                  </p>
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    {formatNotificationDigestMode(rule.digest_mode)}
                  </p>
                </div>
                <Badge color={rule.enabled ? "success" : "light"}>
                  {rule.enabled ? "เปิด" : "ปิด"}
                </Badge>
              </div>
            </button>
          ))
        ) : (
          <p className="rounded-lg border border-dashed border-gray-200 p-3 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            ร้านนี้ยังไม่มีแผนแจ้งเตือน
          </p>
        )}
      </div>
    </section>
  );
}

function PlanBasicsSection({
  notificationDigestMode,
  notificationEnabled,
  notificationName,
  setNotificationDigestMode,
  setNotificationEnabled,
  setNotificationName,
}: {
  notificationDigestMode: NotificationDigestMode;
  notificationEnabled: boolean;
  notificationName: string;
  setNotificationDigestMode: (value: NotificationDigestMode) => void;
  setNotificationEnabled: (value: boolean) => void;
  setNotificationName: (value: string) => void;
}) {
  return (
    <NotificationEditorSection
      description="ชื่อแผนและรูปแบบข้อความที่ LINE จะได้รับ"
      title="ข้อมูลแผน"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <label className="block">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            ชื่อแผน
          </span>
          <input
            className="mt-2 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            onChange={(event) => setNotificationName(event.target.value)}
            value={notificationName}
          />
        </label>
        <label className="flex h-11 items-center gap-3 self-end rounded-lg border border-gray-200 bg-gray-50 px-3 dark:border-gray-800 dark:bg-white/[0.02]">
          <input
            checked={notificationEnabled}
            className="h-4 w-4 rounded border-gray-300 text-brand-600"
            onChange={(event) => setNotificationEnabled(event.target.checked)}
            type="checkbox"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            เปิดใช้งานแผนนี้
          </span>
        </label>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {NOTIFICATION_DIGEST_MODE_OPTIONS.map((option) => (
          <button
            className={`min-h-11 rounded-lg border p-3 text-left text-sm transition ${
              notificationDigestMode === option.value
                ? "border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
            }`}
            key={option.value}
            onClick={() => setNotificationDigestMode(option.value)}
            type="button"
          >
            <span className="block font-semibold">{option.label}</span>
            <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
              {option.description}
            </span>
          </button>
        ))}
      </div>
    </NotificationEditorSection>
  );
}

function ReportPickerSection({
  notificationReportKeys,
  onSetNotificationReportKeys,
  onToggleNotificationReportKey,
  selectedReportPreset,
}: {
  notificationReportKeys: ReportKey[];
  onSetNotificationReportKeys: (reportKeys: ReportKey[]) => void;
  onToggleNotificationReportKey: (reportKey: ReportKey) => void;
  selectedReportPreset: ReportPresetKey | null;
}) {
  const reportsByCategory = reportKeyValues.reduce(
    (acc, reportKey) => {
      const entry = getReportCatalogEntry(reportKey);
      const current = acc[entry.category] ?? [];
      current.push(reportKey);
      acc[entry.category] = current;
      return acc;
    },
    {} as Record<string, ReportKey[]>,
  );

  return (
    <NotificationEditorSection
      description="เลือกเฉพาะรายงานที่แผนนี้จะส่งเข้า LINE"
      title="รายงาน"
    >
      <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-white">
              ชุดรายงานด่วน
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              ตอนนี้เลือก{" "}
              {selectedReportPreset
                ? getReportPresetEntry(selectedReportPreset).label
                : "กำหนดเอง"}{" "}
              · {notificationReportKeys.length} รายงาน
            </p>
          </div>
          {selectedReportPreset === "executive_full" ? (
            <Badge color="success">ครบ 8 ใบ</Badge>
          ) : selectedReportPreset ? (
            <Badge color="success">Preset</Badge>
          ) : (
            <Badge color="light">กำหนดเอง</Badge>
          )}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {reportPresetKeyValues.map((presetKey) => {
            const preset = getReportPresetEntry(presetKey);
            const active = selectedReportPreset === presetKey;
            return (
              <button
                className={`min-h-11 rounded-lg border p-3 text-left transition ${
                  active
                    ? "border-brand-200 bg-white text-brand-800 shadow-sm dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
                }`}
                key={preset.key}
                onClick={() => onSetNotificationReportKeys([...preset.reportKeys])}
                type="button"
              >
                <span className="block text-sm font-semibold">{preset.label}</span>
                <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {preset.description} · {preset.reportKeys.length} รายงาน
                </span>
              </button>
            );
          })}
        </div>
        {selectedReportPreset === "executive_full" ? (
          <p className="mt-3 rounded-lg border border-success-200 bg-success-50 px-3 py-2 text-xs leading-5 text-success-800 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-100">
            ชุดนี้ส่งครบ 8 ใบ เหมาะกับผู้บริหารที่ต้องการเห็นตัวเลขครบทุกเช้า
            สต็อกคงเหลือจะลองดึงสดก่อน ถ้าช้าเกินไป LINE จะส่งรายงานอื่นและแจ้งสถานะสต็อกแทน
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {Object.entries(reportsByCategory).map(([category, reportKeys]) => (
          <div
            className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
            key={category}
          >
            <p className="text-sm font-semibold text-gray-800 dark:text-white">
              {REPORT_CATEGORY_LABELS[category] ?? category}
            </p>
            <div className="mt-2 space-y-2">
              {reportKeys.map((reportKey) => {
                const entry = getReportCatalogEntry(reportKey);
                return (
                  <label
                    className="flex min-h-11 items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
                    key={reportKey}
                  >
                    <input
                      checked={notificationReportKeys.includes(reportKey)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600"
                      onChange={() => onToggleNotificationReportKey(reportKey)}
                      type="checkbox"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-800 dark:text-white">
                        <span>{entry.permissionLabel}</span>
                        {reportKey === "stock_balance" ? (
                          <Badge color="warning">รายงานหนัก</Badge>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                        {entry.sensitive ? "มีข้อมูลต้นทุน · " : ""}
                        {entry.permissionDescription}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </NotificationEditorSection>
  );
}

function SchedulePeriodSection({
  isDirty,
  latestBasisReports,
  notificationTimeInput,
  notificationTimes,
  notificationWeekdays,
  onAddNotificationTime,
  onRemoveNotificationTime,
  onToggleNotificationWeekday,
  periodPreviewRows,
  setNotificationTimeInput,
}: {
  isDirty: boolean;
  latestBasisReports: ReportKey[];
  notificationTimeInput: string;
  notificationTimes: string[];
  notificationWeekdays: number[];
  onAddNotificationTime: () => void;
  onRemoveNotificationTime: (time: string) => void;
  onToggleNotificationWeekday: (weekday: number) => void;
  periodPreviewRows: Array<{
    periodLabel: string;
    scheduledDate: string;
    scheduledLabel: string;
    scheduledTime: string;
  }>;
  setNotificationTimeInput: (value: string) => void;
}) {
  return (
    <NotificationEditorSection
      description="เวลาแจ้งเตือนคือเวลาส่ง LINE ระบบใช้รอบผู้บริหารเพื่อคำนวณช่วงข้อมูลอัตโนมัติ"
      title="รอบเวลาและนโยบายช่วงข้อมูล"
    >
      <div className="rounded-lg border border-brand-100 bg-brand-50 p-4 text-sm leading-6 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
        <div className="flex flex-wrap items-center gap-2">
          <Badge color="primary">{OWNER_NOTIFICATION_PERIOD_STRATEGY_LABEL}</Badge>
          <span>{OWNER_NOTIFICATION_PERIOD_STRATEGY_DESCRIPTION}</span>
        </div>
        <div className="mt-3 grid gap-2 text-xs text-brand-700 dark:text-brand-200 sm:grid-cols-2">
          <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-white/[0.06]">
            รอบก่อน 12:00 ใช้ข้อมูลเมื่อวาน 00:00-23:59
          </div>
          <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-white/[0.06]">
            รอบตั้งแต่ 12:00 ใช้ข้อมูลวันนี้ 00:00 ถึงเวลาแจ้งเตือน
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            วันที่ส่ง
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {NOTIFICATION_WEEKDAYS.map((weekday) => (
              <button
                className={`h-10 min-w-10 rounded-lg border px-3 text-sm font-semibold ${
                  notificationWeekdays.includes(weekday.value)
                    ? "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
                    : "border-gray-200 bg-white text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
                }`}
                key={weekday.value}
                onClick={() => onToggleNotificationWeekday(weekday.value)}
                type="button"
              >
                {weekday.label}
              </button>
            ))}
          </div>

          <p className="mt-5 text-sm font-medium text-gray-700 dark:text-gray-300">
            เวลาแจ้งเตือน
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              className="h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              onChange={(event) => setNotificationTimeInput(event.target.value)}
              type="time"
              value={notificationTimeInput}
            />
            <Button size="sm" variant="outline" onClick={onAddNotificationTime}>
              เพิ่มเวลา
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {notificationTimes.map((time) => (
              <button
                className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
                key={time}
                onClick={() => onRemoveNotificationTime(time)}
                type="button"
              >
                {time} x
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              รอบถัดไปจะใช้ช่วงข้อมูลอะไร
            </p>
            <Badge color={isDirty ? "warning" : "success"}>
              {isDirty ? "ตัวอย่างจาก draft" : "ตรงกับแผนที่บันทึก"}
            </Badge>
          </div>
          {periodPreviewRows.length ? (
            <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              {periodPreviewRows.map((row) => (
                <div
                  className="grid gap-1 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 dark:border-gray-800 md:grid-cols-[150px_minmax(0,1fr)]"
                  key={`${row.scheduledDate}-${row.scheduledTime}`}
                >
                  <span className="font-semibold text-gray-800 dark:text-white">
                    {row.scheduledLabel}
                  </span>
                  <span className="text-gray-600 dark:text-gray-300">
                    {row.periodLabel}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-warning-200 p-3 text-sm text-warning-700 dark:border-warning-500/30 dark:text-warning-300">
              เลือกวันที่ส่งและเวลาอย่างน้อย 1 รอบเพื่อดูตัวอย่างช่วงข้อมูล
            </p>
          )}
          {latestBasisReports.length ? (
            <p className="mt-2 text-xs leading-5 text-warning-700 dark:text-warning-300">
              {latestBasisReports
                .map((reportKey) => getReportCatalogEntry(reportKey).shortLabel)
                .join(", ")}{" "}
              ใช้ข้อมูลล่าสุดจาก SML ไม่ได้อิงช่วงเวลาในตารางนี้
            </p>
          ) : null}
        </div>
      </div>
    </NotificationEditorSection>
  );
}

function LineTargetSection({
  approvedTargets,
  notificationReportKeys,
  notificationTargetIds,
  onToggleNotificationTarget,
  selectedTenantLineTargets,
  targetsWithPermission,
}: {
  approvedTargets: LineTargetRecord[];
  notificationReportKeys: ReportKey[];
  notificationTargetIds: string[];
  onToggleNotificationTarget: (targetId: string) => void;
  selectedTenantLineTargets: LineTargetRecord[];
  targetsWithPermission: LineTargetRecord[];
}) {
  return (
    <NotificationEditorSection
      description="เลือกเฉพาะผู้รับที่อนุมัติแล้วและมีสิทธิ์ครบตามรายงานที่เลือก"
      title="ปลายทาง LINE"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          ผู้รับที่เลือกจะได้รับรายงานตามแผนนี้เมื่อ worker ถึงรอบเวลา
        </p>
        <Badge color={targetsWithPermission.length ? "success" : "warning"}>
          {targetsWithPermission.length}/{approvedTargets.length} พร้อมรับรายงาน
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {selectedTenantLineTargets.length ? (
          selectedTenantLineTargets.map((target) => {
            const allowed = notificationReportKeys.every((reportKey) =>
              canLineTargetReceiveReport(target, reportKey),
            );
            return (
              <label
                className={`rounded-lg border p-3 ${
                  allowed
                    ? "border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.02]"
                    : "border-warning-200 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/10"
                }`}
                key={target.id}
              >
                <div className="flex items-start gap-3">
                  <input
                    checked={notificationTargetIds.includes(target.id)}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600"
                    disabled={!allowed}
                    onChange={() => onToggleNotificationTarget(target.id)}
                    type="checkbox"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                      {target.display_name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
                      <span>
                        {formatLineAccessProfile(target.access_profile_key)} · {target.target_type}
                      </span>
                      {isOwnerSharedLineTarget(target) ? (
                        <Badge color="info">Owner LINE OA</Badge>
                      ) : null}
                    </div>
                    {!allowed ? (
                      <p className="mt-1 text-xs text-warning-700 dark:text-warning-300">
                        ยังไม่มีสิทธิ์รับรายงานที่เลือก
                      </p>
                    ) : null}
                  </div>
                </div>
              </label>
            );
          })
        ) : (
          <p className="rounded-lg border border-dashed border-gray-200 p-3 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            ยังไม่มีผู้รับ LINE ของร้านนี้ กลับไปหน้า LINE OA เพื่ออนุมัติผู้รับก่อน
          </p>
        )}
      </div>
    </NotificationEditorSection>
  );
}

function ManualRunPanel({
  actionBlockedReason,
  canExecuteManualRun,
  dryRunBusy,
  isDirty,
  lastNotificationRunResult,
  manualPeriodLabel,
  manualScheduleValidation,
  notificationManualScheduledDate,
  notificationManualScheduledTime,
  onExecuteNotificationRule,
  savedRule,
  savedTimes,
  sendBusy,
  setNotificationManualScheduledDate,
  setNotificationManualScheduledTime,
}: {
  actionBlockedReason: string | null;
  canExecuteManualRun: boolean;
  dryRunBusy: boolean;
  isDirty: boolean;
  lastNotificationRunResult: NotificationRuleRunResult | null;
  manualPeriodLabel: string;
  manualScheduleValidation: ManualScheduleValidation;
  notificationManualScheduledDate: string;
  notificationManualScheduledTime: string;
  onExecuteNotificationRule: (mode: "dry_run" | "send") => Promise<void>;
  savedRule: OwnerNotificationRule | null;
  savedTimes: string[];
  sendBusy: boolean;
  setNotificationManualScheduledDate: (value: string) => void;
  setNotificationManualScheduledTime: (value: string) => void;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            ทดสอบและส่งจริง
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            เลือกรอบที่จะจำลองจากแผนที่บันทึกแล้ว
          </p>
        </div>
        <Badge color={manualScheduleValidation.ok && !isDirty ? "success" : "warning"}>
          {manualScheduleValidation.ok && !isDirty ? "พร้อมรัน" : "ตรวจรอบ"}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
            วันที่รอบแจ้งเตือน
          </span>
          <input
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            disabled={!savedRule}
            onChange={(event) =>
              setNotificationManualScheduledDate(event.target.value)
            }
            type="date"
            value={notificationManualScheduledDate}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
            เวลาแจ้งเตือน
          </span>
          <select
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            disabled={!savedRule || !savedTimes.length}
            onChange={(event) =>
              setNotificationManualScheduledTime(event.target.value)
            }
            value={notificationManualScheduledTime}
          >
            {savedTimes.length ? (
              savedTimes.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))
            ) : (
              <option value="">ยังไม่มีเวลาในแผนที่บันทึก</option>
            )}
          </select>
        </label>
      </div>

      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            ช่วงข้อมูลที่จะใช้เมื่อรันจริง
          </p>
          {savedRule ? (
            <Badge color="light">
              {formatNotificationPeriodStrategy()}
            </Badge>
          ) : null}
        </div>
        <p
          className={`mt-2 text-lg font-semibold leading-7 ${
            manualScheduleValidation.ok
              ? "text-gray-900 dark:text-white"
              : "text-warning-700 dark:text-warning-300"
          }`}
        >
          {manualPeriodLabel}
        </p>
        {actionBlockedReason ? (
          <p className="mt-2 text-xs leading-5 text-warning-700 dark:text-warning-300">
            {actionBlockedReason}
          </p>
        ) : null}
        {savedRule?.report_keys.includes("stock_balance") ? (
          <p className="mt-2 text-xs leading-5 text-warning-700 dark:text-warning-300">
            แผนนี้มีสต็อกคงเหลือซึ่งเป็นรายงานหนัก ระบบจะลองดึงสดก่อน ถ้าช้าเกินไปจะส่งพร้อมข้อสังเกตและข้อมูลอ้างอิงล่าสุดถ้ามี
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={!canExecuteManualRun || dryRunBusy}
          onClick={() => void onExecuteNotificationRule("dry_run")}
          size="sm"
          variant="outline"
        >
          {dryRunBusy ? "กำลังทดสอบ..." : "ทดสอบแบบไม่ส่งจริง"}
        </Button>
        <Button
          disabled={!canExecuteManualRun || sendBusy}
          onClick={() => void onExecuteNotificationRule("send")}
          size="sm"
          variant="outline"
        >
          {sendBusy ? "กำลังส่ง..." : "ส่งจริงตอนนี้"}
        </Button>
        {lastNotificationRunResult ? (
          <Badge color={lastNotificationRunResult.ok ? "success" : "warning"}>
            {lastNotificationRunResult.mode ?? "dry_run"}
          </Badge>
        ) : null}
      </div>
    </section>
  );
}

function RunHistoryPanel({
  lastNotificationRunResult,
  selectedRuns,
}: {
  lastNotificationRunResult: NotificationRuleRunResult | null;
  selectedRuns: NotificationRuleRunRecord[];
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            Run ล่าสุด
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            แสดงสถานะ retry และ delivery โดยไม่แสดง LINE id จริง
          </p>
        </div>
        {lastNotificationRunResult ? (
          <Badge color={lastNotificationRunResult.ok ? "success" : "warning"}>
            {lastNotificationRunResult.mode ?? "dry_run"}
          </Badge>
        ) : null}
      </div>

      <div className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
        {selectedRuns.length ? (
          selectedRuns.slice(0, 6).map((run) => (
            <div className="grid gap-3 p-3 text-sm lg:grid-cols-[minmax(0,1fr)_100px_90px_110px]" key={run.id}>
              <div className="min-w-0">
                <p className="truncate font-semibold text-gray-900 dark:text-white">
                  {formatNotificationPeriodWithTime(
                    run.period_from,
                    run.period_to,
                    run.period_from_time,
                    run.period_to_time,
                  )}
                </p>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {run.scheduled_local_date} {run.scheduled_local_time} ·{" "}
                  {formatNotificationPeriodStrategy()} · attempt{" "}
                  {run.attempt}
                  {run.unknown_doc_time_count
                    ? ` · เวลาเอกสารว่าง ${run.unknown_doc_time_count} รายการ`
                    : ""}
                </p>
              </div>
              <Badge color={notificationRunTone(run.status)}>
                {formatNotificationRunStatus(run.status)}
              </Badge>
              <CompactFact
                label="Reports"
                value={run.report_run_ids.length.toLocaleString("th-TH")}
              />
              <CompactFact
                label="Deliveries"
                value={run.delivery_ids.length.toLocaleString("th-TH")}
              />
              {run.safe_error_message ? (
                <p className="text-xs leading-5 text-warning-700 dark:text-warning-300 lg:col-span-4">
                  {run.safe_error_message}
                </p>
              ) : null}
            </div>
          ))
        ) : (
          <p className="p-3 text-sm text-gray-500 dark:text-gray-400">
            ยังไม่มีประวัติรันของแผนนี้
          </p>
        )}
      </div>
    </section>
  );
}

function NotificationEditorSection({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {title}
        </h3>
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function NotificationPanelHeader({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="p-5">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white">
        {title}
      </h2>
      <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
        {description}
      </p>
    </div>
  );
}

function NotificationStatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-xs font-medium uppercase text-gray-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function CompactFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 truncate font-semibold text-gray-900 dark:text-white">
        {value}
      </dd>
    </div>
  );
}

function normalizeNotificationRuleDraft(input: {
  digestMode: NotificationDigestMode;
  enabled: boolean;
  name: string;
  periodPreset: NotificationPeriodPreset;
  periodStrategy: NotificationPeriodStrategy;
  reportKeys: ReportKey[];
  targetIds: string[];
  tenantId: string;
  times: string[];
  weekdays: number[];
}): ComparableNotificationRule {
  return {
    digest_mode: input.digestMode,
    enabled: input.enabled,
    name: input.name.trim(),
    period_preset: input.periodPreset,
    period_strategy: input.periodStrategy,
    report_keys: sortReportKeys(input.reportKeys),
    schedule: [
      {
        times: [...new Set(input.times)].sort(),
        weekdays: [...new Set(input.weekdays)].sort((a, b) => a - b),
      },
    ],
    target_ids: [...new Set(input.targetIds)].sort(),
    tenant_id: input.tenantId,
    timezone: "Asia/Bangkok",
  };
}

function normalizeNotificationRuleRecord(
  rule: OwnerNotificationRule,
): ComparableNotificationRule {
  const schedule = rule.schedule[0] ?? { times: [], weekdays: [] };
  return normalizeNotificationRuleDraft({
    digestMode: rule.digest_mode ?? "action_only",
    enabled: rule.enabled,
    name: rule.name,
    periodPreset: rule.period_preset,
    periodStrategy: rule.period_strategy ?? "same_period_all_runs",
    reportKeys: rule.report_keys,
    targetIds: rule.target_ids,
    tenantId: rule.tenant_id,
    times: schedule.times,
    weekdays: schedule.weekdays,
  });
}

function sortReportKeys(reportKeys: ReportKey[]) {
  const order = new Map<ReportKey, number>(
    reportKeyValues.map((reportKey, index) => [reportKey, index]),
  );
  return [...new Set(reportKeys)].sort(
    (left, right) => (order.get(left) ?? 999) - (order.get(right) ?? 999),
  );
}

function getNotificationActionBlockedReason(input: {
  editingNotificationRuleId: string | null;
  isDirty: boolean;
  manualScheduleValidation: ManualScheduleValidation;
}) {
  if (!input.editingNotificationRuleId) {
    return "บันทึกแผนก่อนทดสอบหรือส่งจริง";
  }
  if (input.isDirty) {
    return "มีการแก้ไขยังไม่บันทึก กรุณาบันทึกก่อนเพื่อให้ช่วงข้อมูลตรงกับรอบส่งจริง";
  }
  if (!input.manualScheduleValidation.ok) {
    return input.manualScheduleValidation.error;
  }
  return null;
}

function canLineTargetReceiveReport(
  target: LineTargetRecord,
  reportKey: ReportKey,
) {
  return (
    target.approved &&
    target.enabled &&
    target.allowed_actions.includes("receive_morning_brief") &&
    target.allowed_report_keys.includes(reportKey)
  );
}

function isOwnerSharedLineTarget(target: LineTargetRecord) {
  return target.id.startsWith("line_target_shared__");
}

function formatNotificationSchedule(rule: OwnerNotificationRule) {
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
              NOTIFICATION_WEEKDAYS.find((item) => item.value === weekday)
                ?.label ?? weekday,
          )
          .join(", ");
  return `${days} · ${schedule.times.join(", ")} · ${formatNotificationPeriodStrategy()}`;
}

function formatNotificationPeriodStrategy() {
  return OWNER_NOTIFICATION_PERIOD_STRATEGY_LABEL;
}

function formatNotificationDigestMode(value: NotificationDigestMode) {
  return (
    NOTIFICATION_DIGEST_MODE_OPTIONS.find((item) => item.value === value)
      ?.label ?? value
  );
}

export function formatNotificationPeriodWithTime(
  dateFrom: string,
  dateTo: string,
  timeFrom?: string | null,
  timeTo?: string | null,
) {
  const startTime = timeFrom ?? "00:00";
  const endTime = timeTo ?? "23:59";
  return `${dateFrom} ${startTime} ถึง ${dateTo} ${endTime}`;
}

export function isValidNotificationTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidNotificationDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateManualNotificationRunSelection(input: {
  scheduledDate: string;
  scheduledTime: string;
  times: string[];
  weekdays: number[];
}): ManualScheduleValidation {
  if (!isValidNotificationDate(input.scheduledDate)) {
    return { ok: false, error: "กรุณาเลือกวันที่รอบแจ้งเตือน" };
  }
  if (!isValidNotificationTime(input.scheduledTime)) {
    return { ok: false, error: "กรุณาเลือกเวลาแจ้งเตือน" };
  }
  if (!input.times.includes(input.scheduledTime)) {
    return {
      ok: false,
      error: "เวลานี้ไม่ได้อยู่ในรอบเวลาแจ้งเตือนของแผนที่บันทึกไว้",
    };
  }
  if (!input.weekdays.includes(isoWeekdayFromYmd(input.scheduledDate))) {
    return {
      ok: false,
      error: "วันที่นี้ไม่ได้อยู่ในวันที่ส่งของแผนที่บันทึกไว้",
    };
  }
  return { ok: true };
}

function buildNotificationPeriodPreviewRows(input: {
  periodPreset: NotificationPeriodPreset;
  periodStrategy: NotificationPeriodStrategy;
  times: string[];
  weekdays: number[];
}) {
  const validTimes = [...new Set(input.times.filter(isValidNotificationTime))].sort();
  const weekdays = new Set(input.weekdays);
  if (!validTimes.length || !weekdays.size) {
    return [];
  }

  const now = new Date();
  const rows: Array<{
    scheduledDate: string;
    scheduledTime: string;
    scheduledLabel: string;
    periodLabel: string;
  }> = [];

  for (let offset = 0; offset <= 14 && rows.length < 4; offset += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    const scheduledDate = toLocalYmd(date);
    const isoWeekday = toIsoWeekday(date);
    if (!weekdays.has(isoWeekday)) {
      continue;
    }

    for (const scheduledTime of validTimes) {
      const scheduledAt = localDateTime(scheduledDate, scheduledTime);
      if (scheduledAt.getTime() <= now.getTime()) {
        continue;
      }
      const params = deriveNotificationPeriodRange({
        periodPreset: input.periodPreset,
        periodStrategy: input.periodStrategy,
        scheduledLocalDate: scheduledDate,
        scheduledLocalTime: scheduledTime,
        timeZone: "Asia/Bangkok",
      });
      rows.push({
        scheduledDate,
        scheduledTime,
        scheduledLabel: `${scheduledDate} ${scheduledTime}`,
        periodLabel: formatNotificationPeriodWithTime(
          params.date_from,
          params.date_to,
          params.time_from,
          params.time_to,
        ),
      });
      if (rows.length >= 4) {
        break;
      }
    }
  }

  return rows;
}

function localDateTime(ymd: string, hhmm: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

export function toBangkokYmd(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function toLocalYmd(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoWeekdayFromYmd(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function toIsoWeekday(date: Date) {
  const weekday = date.getDay();
  return weekday === 0 ? 7 : weekday;
}

function notificationRunTone(status: NotificationRuleRunRecord["status"]) {
  if (status === "success") {
    return "success" as const;
  }
  if (status === "success_with_warnings") {
    return "warning" as const;
  }
  if (status === "failed") {
    return "warning" as const;
  }
  return "light" as const;
}

function formatNotificationRunStatus(
  status: NotificationRuleRunRecord["status"],
) {
  if (status === "success") {
    return "สำเร็จ";
  }
  if (status === "success_with_warnings") {
    return "ส่งสำเร็จพร้อมข้อสังเกต";
  }
  if (status === "failed") {
    return "ไม่สำเร็จ";
  }
  if (status === "running") {
    return "กำลังรัน";
  }
  return "ข้าม";
}
