"use client";

import { useMemo, useState } from "react";
import type {
  LineAccessProfileKey,
  LineChannelRecord,
  LineRecipientRecord,
  LineTargetRecord,
} from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";

export function OwnerLineTargetsPanel({
  busy,
  lineChannels,
  onApprove,
  onSetProfile,
  onTestSend,
  onToggleEnabled,
  onUpdateRecipientEstimate,
  targets,
  tenantName,
}: {
  busy: string | null;
  lineChannels: LineChannelRecord[];
  onApprove: (
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) => Promise<void>;
  onSetProfile: (
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) => Promise<void>;
  onTestSend: (target: LineTargetRecord) => Promise<void>;
  onToggleEnabled: (target: LineTargetRecord) => Promise<void>;
  onUpdateRecipientEstimate: (
    target: LineTargetRecord,
    recipientCountEstimate: number | null,
  ) => Promise<void>;
  targets: LineTargetRecord[];
  tenantName: string;
}) {
  const readyTargets = targets.filter(
    (target) =>
      canReceiveMorningBrief(target) && hasLineSendToken(target, lineChannels),
  );
  const personalTargets = targets.filter(
    (target) => target.target_type === "user" && target.approved,
  );
  const teamTargets = targets.filter(
    (target) => target.target_type !== "user" && target.approved,
  );
  const pendingTargets = targets.filter((target) => !target.approved);
  const quotaSummary = useMemo(
    () => calculateQuotaSummary(readyTargets),
    [readyTargets],
  );

  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            ผู้รับ LINE ของ {tenantName}
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            ค่าเริ่มต้นของ pilot คือส่งแผนแจ้งเตือนส่วนตัวให้ผู้บริหาร ส่วนกลุ่มใช้เฉพาะข้อมูลที่ทีมควรเห็นร่วมกัน
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge color="light">{targets.length} ปลายทาง</Badge>
          <Badge color={readyTargets.length ? "success" : "warning"}>
            พร้อมส่ง {readyTargets.length}
          </Badge>
          <Badge color="info">
            Quota: {formatEstimatedMonthlyMessages(quotaSummary)}
          </Badge>
        </div>
      </div>

      <div className="border-t border-gray-100 p-4 dark:border-gray-800">
        <LineOnboardingSteps />

        {targets.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-gray-200 p-4 text-sm leading-6 text-gray-500 dark:border-gray-800 dark:text-gray-400">
            ยังไม่มีผู้รับ LINE ของร้านนี้ เลือกผู้รับจากคลัง LINE กลางด้านบน
            หรือให้ลูกค้า add LINE OA ของร้านแล้วพิมพ์ `test` เพื่อรออนุมัติ
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <LineTargetSection
              busy={busy}
              lineChannels={lineChannels}
              emptyMessage="ยังไม่มีผู้บริหารรายคนที่อนุมัติแล้ว"
              onApprove={onApprove}
              onSetProfile={onSetProfile}
              onTestSend={onTestSend}
              onToggleEnabled={onToggleEnabled}
              onUpdateRecipientEstimate={onUpdateRecipientEstimate}
              targets={personalTargets}
              title="ผู้บริหารรายคน"
            />
            <LineTargetSection
              busy={busy}
              lineChannels={lineChannels}
              emptyMessage="ยังไม่มีกลุ่มทีมงานที่อนุมัติแล้ว"
              onApprove={onApprove}
              onSetProfile={onSetProfile}
              onTestSend={onTestSend}
              onToggleEnabled={onToggleEnabled}
              onUpdateRecipientEstimate={onUpdateRecipientEstimate}
              targets={teamTargets}
              title="กลุ่มทีมงาน"
            />
            <LineTargetSection
              busy={busy}
              lineChannels={lineChannels}
              emptyMessage="ไม่มีปลายทางรออนุมัติ"
              onApprove={onApprove}
              onSetProfile={onSetProfile}
              onTestSend={onTestSend}
              onToggleEnabled={onToggleEnabled}
              onUpdateRecipientEstimate={onUpdateRecipientEstimate}
              targets={pendingTargets}
              title="รออนุมัติ"
            />
          </div>
        )}
      </div>
    </section>
  );
}

export function OwnerLineRecipientLibraryPanel({
  busy,
  lineChannels,
  onAssign,
  recipients,
  selectedTenantId,
  selectedTenantName,
  selectedTenantTargets,
}: {
  busy: string | null;
  lineChannels: LineChannelRecord[];
  onAssign: (input: {
    recipient: LineRecipientRecord;
    lineChannelId: string;
    profileKey: LineAccessProfileKey;
  }) => Promise<void>;
  recipients: LineRecipientRecord[];
  selectedTenantId: string;
  selectedTenantName: string;
  selectedTenantTargets: LineTargetRecord[];
}) {
  const assignedHashes = useMemo(
    () => new Set(selectedTenantTargets.map((target) => target.target_id_hash)),
    [selectedTenantTargets],
  );
  const availableCount = recipients.filter(
    (recipient) => !assignedHashes.has(recipient.target_id_hash),
  ).length;

  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            คลังผู้รับ LINE
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            เลือกผู้รับจาก OA กลางหรือ OA ร้าน แล้วเพิ่มเข้าร้าน {selectedTenantName} โดยสิทธิ์จะแยกจากร้านอื่น
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge color="light">{recipients.length} ผู้รับทั้งหมด</Badge>
          <Badge color={availableCount ? "info" : "light"}>
            เพิ่มได้ {availableCount}
          </Badge>
        </div>
      </div>

      <div className="border-t border-gray-100 p-4 dark:border-gray-800">
        {!recipients.length ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-4 text-sm leading-6 text-gray-500 dark:border-gray-800 dark:text-gray-400">
            ยังไม่มีผู้รับในคลัง ให้ผู้รับ add LINE OA แล้วพิมพ์ test เพื่อให้ระบบบันทึกเป็นรายการรออนุมัติก่อน
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {recipients.map((recipient) => (
              <LineRecipientLibraryCard
                assigned={assignedHashes.has(recipient.target_id_hash)}
                busy={busy}
                key={recipient.id}
                lineChannels={lineChannels}
                onAssign={onAssign}
                recipient={recipient}
                selectedTenantId={selectedTenantId}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function LineRecipientLibraryCard({
  assigned,
  busy,
  lineChannels,
  onAssign,
  recipient,
  selectedTenantId,
}: {
  assigned: boolean;
  busy: string | null;
  lineChannels: LineChannelRecord[];
  onAssign: (input: {
    recipient: LineRecipientRecord;
    lineChannelId: string;
    profileKey: LineAccessProfileKey;
  }) => Promise<void>;
  recipient: LineRecipientRecord;
  selectedTenantId: string;
}) {
  const [profileKey, setProfileKey] =
    useState<LineAccessProfileKey>("executive");
  const channelOptions = useMemo(() => {
    const enabledChannels = lineChannels.filter((channel) => channel.enabled);
    if (recipient.line_channel_id) {
      return enabledChannels.filter(
        (channel) => channel.id === recipient.line_channel_id,
      );
    }
    return enabledChannels.filter(
      (channel) =>
        channel.scope === "owner_shared" || channel.tenant_id === selectedTenantId,
    );
  }, [lineChannels, recipient.line_channel_id, selectedTenantId]);
  const defaultChannelId =
    channelOptions.find((channel) => channel.scope === "owner_shared")?.id ??
    channelOptions[0]?.id ??
    "";
  const [selectedChannelId, setSelectedChannelId] = useState(defaultChannelId);
  const effectiveChannelId = channelOptions.some(
    (channel) => channel.id === selectedChannelId,
  )
    ? selectedChannelId
    : defaultChannelId;
  const selectedChannel =
    channelOptions.find((channel) => channel.id === effectiveChannelId) ?? null;
  const canAssign = Boolean(selectedTenantId && effectiveChannelId && !assigned);

  return (
    <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-white">
              {recipient.display_name}
            </h3>
            <Badge color={recipient.target_type === "user" ? "info" : "light"}>
              {formatLineTargetType(recipient.target_type)}
            </Badge>
            <Badge color={assigned ? "success" : "light"}>
              {assigned ? "ใช้กับร้านนี้แล้ว" : "ยังไม่ได้เพิ่มเข้าร้านนี้"}
            </Badge>
            {recipient.line_channel_scope === "owner_shared" ? (
              <Badge color="info">OA กลาง</Badge>
            ) : recipient.line_channel_scope === "tenant" ? (
              <Badge color="light">OA ร้าน</Badge>
            ) : (
              <Badge color="warning">ต้องเลือก OA</Badge>
            )}
            {selectedChannel?.channel_access_token_configured ? (
              <Badge color="success">พร้อมส่ง</Badge>
            ) : (
              <Badge color="warning">ขาด token</Badge>
            )}
          </div>
          <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400 sm:grid-cols-2">
            <CompactFact label="รหัสปลายทาง" value={recipient.target_id_masked} />
            <CompactFact label="เจอจากร้าน" value={recipient.source_tenant_name} />
            <CompactFact
              label="LINE OA ต้นทาง"
              value={recipient.line_channel_display_name ?? "ยังไม่ระบุ"}
            />
            <CompactFact
              label="ใช้อยู่"
              value={`${recipient.assignment_count.toLocaleString("th-TH")} ร้าน`}
            />
          </dl>
        </div>

        {!assigned ? (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
              LINE OA ที่ใช้ส่ง
              <select
                className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-300 dark:border-gray-800 dark:bg-gray-900 dark:text-white/90"
                disabled={Boolean(busy) || !channelOptions.length}
                onChange={(event) => setSelectedChannelId(event.target.value)}
                value={effectiveChannelId}
              >
                {channelOptions.length ? (
                  channelOptions.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.display_name}
                      {channel.scope === "owner_shared" ? " · OA กลาง" : ""}
                    </option>
                  ))
                ) : (
                  <option value="">ยังไม่มี OA ที่ใช้ได้</option>
                )}
              </select>
            </label>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
              สิทธิ์ในร้านนี้
              <select
                className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-300 dark:border-gray-800 dark:bg-gray-900 dark:text-white/90"
                disabled={Boolean(busy)}
                onChange={(event) =>
                  setProfileKey(event.target.value as LineAccessProfileKey)
                }
                value={profileKey}
              >
                <option value="executive">ผู้บริหาร</option>
                <option value="sales_manager">ฝ่ายขาย</option>
                <option value="operations">ปฏิบัติการ</option>
                <option value="staff">พนักงาน</option>
              </select>
            </label>
          </div>
        ) : null}

        {!channelOptions.length && !assigned ? (
          <p className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs leading-5 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
            ผู้รับนี้ยังไม่มี LINE OA ที่ร้านนี้ใช้ส่งได้ ถ้าจะใช้ข้ามร้านให้ตั้ง LINE OA กลางก่อน
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            disabled={Boolean(busy) || !canAssign}
            size="sm"
            onClick={() =>
              void onAssign({
                recipient,
                lineChannelId: effectiveChannelId,
                profileKey,
              })
            }
            variant={assigned ? "outline" : "primary"}
          >
            {assigned ? "เพิ่มแล้ว" : "เพิ่มเข้าร้านนี้"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function formatLineAccessProfile(profileKey: LineAccessProfileKey) {
  if (profileKey === "executive") {
    return "ผู้บริหาร";
  }
  if (profileKey === "sales_manager") {
    return "ฝ่ายขาย";
  }
  if (profileKey === "operations") {
    return "ปฏิบัติการ";
  }
  return "พนักงานทั่วไป";
}

function LineOnboardingSteps() {
  const steps = [
    ["1", "ผู้บริหาร add OA เป็นเพื่อน", "เหมาะกับแผนแจ้งเตือนยอดขาย"],
    ["2", "พิมพ์ test ส่วนตัว", "ระบบจะเห็น userId แบบ masked/hash"],
    ["3", "owner อนุมัติสิทธิ์", "เลือกผู้บริหาร ฝ่ายขาย หรือทีมงาน"],
    ["4", "ส่งทดสอบ", "ยืนยันว่า Flex Message และปุ่มเปิดรายงานใช้ได้"],
  ];

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-2 text-sm text-gray-600 dark:text-gray-300 sm:grid-cols-2">
        {steps.map(([step, label, description]) => (
          <div
            className="flex min-w-0 gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
            key={step}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
              {step}
            </span>
            <div className="min-w-0">
              <p className="font-semibold leading-5 text-gray-800 dark:text-white/90">
                {label}
              </p>
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {description}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm leading-6 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
        กลุ่ม LINE ยังใช้ได้ แต่ควรใช้เฉพาะรายงานที่ทุกคนในกลุ่มเห็นได้จริง
        และถ้ากลุ่มมี 10 คน การส่ง 1 ครั้งจะประมาณ 10 messages.
        `webhook.site` ใช้ debug payload ชั่วคราวเท่านั้น เพราะอาจเห็น userId,
        groupId และข้อความจริง
      </div>
    </div>
  );
}

function LineTargetSection({
  busy,
  lineChannels,
  emptyMessage,
  onApprove,
  onSetProfile,
  onTestSend,
  onToggleEnabled,
  onUpdateRecipientEstimate,
  targets,
  title,
}: {
  busy: string | null;
  lineChannels: LineChannelRecord[];
  emptyMessage: string;
  onApprove: (
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) => Promise<void>;
  onSetProfile: (
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) => Promise<void>;
  onTestSend: (target: LineTargetRecord) => Promise<void>;
  onToggleEnabled: (target: LineTargetRecord) => Promise<void>;
  onUpdateRecipientEstimate: (
    target: LineTargetRecord,
    recipientCountEstimate: number | null,
  ) => Promise<void>;
  targets: LineTargetRecord[];
  title: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {title}
        </h3>
        <Badge color="light">{targets.length} รายการ</Badge>
      </div>
      {targets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-3">
          {targets.map((target) => (
            <LineTargetCard
              busy={busy}
              key={target.id}
              lineChannels={lineChannels}
              onApprove={onApprove}
              onSetProfile={onSetProfile}
              onTestSend={onTestSend}
              onToggleEnabled={onToggleEnabled}
              onUpdateRecipientEstimate={onUpdateRecipientEstimate}
              target={target}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LineTargetCard({
  busy,
  lineChannels,
  onApprove,
  onSetProfile,
  onTestSend,
  onToggleEnabled,
  onUpdateRecipientEstimate,
  target,
}: {
  busy: string | null;
  lineChannels: LineChannelRecord[];
  onApprove: (
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) => Promise<void>;
  onSetProfile: (
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) => Promise<void>;
  onTestSend: (target: LineTargetRecord) => Promise<void>;
  onToggleEnabled: (target: LineTargetRecord) => Promise<void>;
  onUpdateRecipientEstimate: (
    target: LineTargetRecord,
    recipientCountEstimate: number | null,
  ) => Promise<void>;
  target: LineTargetRecord;
}) {
  const [recipientEstimate, setRecipientEstimate] = useState(
    target.recipient_count_estimate?.toString() ?? "",
  );
  const isEnvFallback = target.source === "env_fallback";
  const isOwnerShared = isOwnerSharedLineTarget(target);
  const isReadOnly = isEnvFallback || isOwnerShared;
  const lineChannel = findLineChannelForTarget(target, lineChannels);
  const hasSendToken = hasLineSendToken(target, lineChannels);
  const ready = canReceiveMorningBrief(target) && hasSendToken;
  const profileKeys: LineAccessProfileKey[] = [
    "executive",
    "sales_manager",
    "operations",
    "staff",
  ];
  const showsSensitiveReportToGroup =
    target.target_type !== "user" &&
    target.allowed_report_keys.some((reportKey) =>
      [
        "sales_goods_services",
        "purchase_goods_payables",
        "gross_profit_by_product",
        "gross_profit_by_ar_customer",
      ].includes(reportKey),
    ) &&
    target.allowed_actions.includes("receive_morning_brief");

  return (
    <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-white">
              {target.display_name}
            </h3>
            <Badge color={target.target_type === "user" ? "info" : "light"}>
              {formatLineTargetType(target.target_type)}
            </Badge>
            <Badge color={ready ? "success" : "warning"}>
              {ready ? "พร้อมส่งจริง" : "ยังไม่พร้อมส่ง"}
            </Badge>
            <Badge color={target.approved ? "success" : "warning"}>
              {target.approved ? "อนุมัติแล้ว" : "รออนุมัติ"}
            </Badge>
            <Badge color={target.enabled ? "success" : "light"}>
              {target.enabled ? "เปิดรับ" : "ปิดรับ"}
            </Badge>
            {isOwnerShared ? <Badge color="info">Owner LINE OA</Badge> : null}
            {lineChannel?.scope === "owner_shared" ? (
              <Badge color="info">OA กลาง</Badge>
            ) : lineChannel ? (
              <Badge color="light">OA ร้าน</Badge>
            ) : (
              <Badge color="warning">ยังไม่ผูก OA</Badge>
            )}
            {!hasSendToken ? <Badge color="warning">ขาด token</Badge> : null}
          </div>

          <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400 sm:grid-cols-2 2xl:grid-cols-5">
            <CompactFact label="รหัสปลายทาง" value={target.target_id_masked} />
            <CompactFact
              label="สิทธิ์"
              value={formatLineAccessProfile(target.access_profile_key)}
            />
            <CompactFact
              label="Quota"
              value={formatRecipientEstimate(target)}
            />
            <CompactFact
              label="ล่าสุด"
              value={
                target.last_delivery_at
                  ? formatDateTime(target.last_delivery_at)
                  : "-"
              }
            />
            <CompactFact
              label="ที่มา"
              value={formatLineTargetSource(target.source)}
            />
            <CompactFact
              label="LINE OA"
              value={lineChannel?.display_name ?? "ยังไม่ระบุ"}
            />
          </dl>

          <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
            รายงานที่เห็นได้: {formatAllowedReports(target)} · สิทธิ์การใช้งาน:{" "}
            {formatAllowedActions(target)}
          </p>

          {showsSensitiveReportToGroup ? (
            <p className="mt-3 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs leading-5 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
              ปลายทางนี้เป็นกลุ่ม/ห้องแชท: ข้อมูลยอดขายหรือยอดซื้อที่ส่งไปทุกคนในปลายทางนี้จะเห็นได้
            </p>
          ) : null}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="min-w-[180px] text-xs font-medium text-gray-600 dark:text-gray-300">
              จำนวนผู้รับโดยประมาณ
              <input
                className="mt-1 h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-300 dark:border-gray-800 dark:bg-gray-900 dark:text-white/90"
                disabled={Boolean(busy) || isReadOnly}
                inputMode="numeric"
                min={1}
                onChange={(event) => setRecipientEstimate(event.target.value)}
                placeholder={target.target_type === "user" ? "1" : "เช่น 10"}
                type="number"
                value={recipientEstimate}
              />
            </label>
            <Button
              disabled={Boolean(busy) || isReadOnly}
              size="sm"
              variant="outline"
              onClick={() =>
                void onUpdateRecipientEstimate(
                  target,
                  parseRecipientEstimate(recipientEstimate),
                )
              }
            >
              บันทึก quota
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 xl:max-w-[420px] xl:justify-end">
          {!target.approved && !isReadOnly ? (
            target.target_type === "user" ? (
              <Button
                disabled={Boolean(busy)}
                size="sm"
                onClick={() => void onApprove(target, "executive")}
              >
                อนุมัติเป็นผู้บริหาร
              </Button>
            ) : (
              <>
                <Button
                  disabled={Boolean(busy)}
                  size="sm"
                  onClick={() => void onApprove(target, "sales_manager")}
                >
                  อนุมัติกลุ่มฝ่ายขาย
                </Button>
                <Button
                  disabled={Boolean(busy)}
                  size="sm"
                  variant="outline"
                  onClick={() => void onApprove(target, "staff")}
                >
                  ตั้งเป็นทีมงาน
                </Button>
              </>
            )
          ) : null}

          {profileKeys.map((profileKey) => (
            <Button
              disabled={Boolean(busy) || isReadOnly}
              key={profileKey}
              size="sm"
              variant={
                target.access_profile_key === profileKey
                  ? "primary"
                  : "outline"
              }
              onClick={() => void onSetProfile(target, profileKey)}
            >
              {formatAccessProfileShort(profileKey)}
            </Button>
          ))}

          <Button
            disabled={Boolean(busy) || isReadOnly}
            size="sm"
            variant="outline"
            onClick={() => void onToggleEnabled(target)}
          >
            {target.enabled ? "ปิดรับ" : "เปิดรับ"}
          </Button>
          <Button
            disabled={Boolean(busy) || !hasSendToken}
            size="sm"
            variant="outline"
            onClick={() => void onTestSend(target)}
          >
            {hasSendToken ? "ส่งทดสอบ" : "ต้องตั้ง token"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function canReceiveMorningBrief(target: LineTargetRecord) {
  return (
    target.approved &&
    target.enabled &&
    target.allowed_actions.includes("receive_morning_brief") &&
    target.allowed_report_keys.length > 0
  );
}

function hasLineSendToken(
  target: LineTargetRecord,
  lineChannels: LineChannelRecord[],
) {
  return Boolean(
    findLineChannelForTarget(target, lineChannels)?.channel_access_token_configured,
  );
}

function findLineChannelForTarget(
  target: LineTargetRecord,
  lineChannels: LineChannelRecord[],
) {
  return target.line_channel_id
    ? lineChannels.find((channel) => channel.id === target.line_channel_id) ?? null
    : null;
}

function isOwnerSharedLineTarget(target: LineTargetRecord) {
  return target.id.startsWith("line_target_shared__");
}

function calculateQuotaSummary(targets: LineTargetRecord[]) {
  return targets.reduce(
    (summary, target) => {
      const estimate = getRecipientEstimate(target);
      if (estimate === null) {
        return {
          knownRecipients: summary.knownRecipients,
          unknownTargets: summary.unknownTargets + 1,
        };
      }
      return {
        knownRecipients: summary.knownRecipients + estimate,
        unknownTargets: summary.unknownTargets,
      };
    },
    { knownRecipients: 0, unknownTargets: 0 },
  );
}

function getRecipientEstimate(target: LineTargetRecord) {
  if (typeof target.recipient_count_estimate === "number") {
    return target.recipient_count_estimate;
  }
  return target.target_type === "user" ? 1 : null;
}

function formatEstimatedMonthlyMessages(summary: {
  knownRecipients: number;
  unknownTargets: number;
}) {
  const knownMessages = summary.knownRecipients * 30;
  if (summary.unknownTargets) {
    if (knownMessages === 0) {
      return "รอระบุจำนวนผู้รับ";
    }
    return `${knownMessages.toLocaleString("th-TH")}+ messages/เดือน`;
  }
  return `${knownMessages.toLocaleString("th-TH")} messages/เดือน`;
}

function formatRecipientEstimate(target: LineTargetRecord) {
  const estimate = getRecipientEstimate(target);
  if (estimate === null) {
    return "ยังไม่ระบุ";
  }
  return `${estimate.toLocaleString("th-TH")} คน/ครั้ง`;
}

function parseRecipientEstimate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatAccessProfileShort(profileKey: LineAccessProfileKey) {
  if (profileKey === "executive") {
    return "ผู้บริหาร";
  }
  if (profileKey === "sales_manager") {
    return "ฝ่ายขาย";
  }
  if (profileKey === "operations") {
    return "ปฏิบัติการ";
  }
  return "พนักงาน";
}

function formatLineTargetType(targetType: LineTargetRecord["target_type"]) {
  if (targetType === "group") {
    return "กลุ่ม";
  }
  if (targetType === "room") {
    return "ห้องแชท";
  }
  return "รายคน";
}

function formatLineTargetSource(source: LineTargetRecord["source"]) {
  if (source === "env_fallback") {
    return "pilot env";
  }
  if (source === "webhook") {
    return "webhook";
  }
  return "manual";
}

function formatAllowedReports(target: LineTargetRecord) {
  if (!target.allowed_report_keys.length) {
    return "ยังไม่มี";
  }

  return target.allowed_report_keys.map(formatReportKeyLabel).join(", ");
}

function formatReportKeyLabel(reportKey: LineTargetRecord["allowed_report_keys"][number]) {
  if (reportKey === "sales_goods_services") {
    return "รายงานขายสินค้าและบริการ";
  }
  if (reportKey === "purchase_goods_payables") {
    return "รายงานซื้อสินค้า/ตั้งหนี้";
  }
  if (reportKey === "gross_profit_by_product") {
    return "รายงานกำไรขั้นต้นสินค้า";
  }
  if (reportKey === "gross_profit_by_ar_customer") {
    return "รายงานกำไรขั้นต้นลูกหนี้";
  }
  return reportKey;
}

function formatAllowedActions(target: LineTargetRecord) {
  if (!target.allowed_actions.length) {
    return "ยังไม่มี";
  }

  const labels = target.allowed_actions.map((action) => {
    if (action === "receive_morning_brief") {
      return "รับแผนแจ้งเตือน";
    }
    if (action === "ask_report") {
      return "ถามรายงาน";
    }
    return "เปิดรายงาน";
  });

  return labels.join(", ");
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}
