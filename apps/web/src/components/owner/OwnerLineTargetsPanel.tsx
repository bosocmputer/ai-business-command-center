"use client";

import type {
  LineAccessProfileKey,
  LineTargetRecord,
} from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";

export function OwnerLineTargetsPanel({
  busy,
  onApprove,
  onSetProfile,
  onTestSend,
  onToggleEnabled,
  targets,
  tenantName,
}: {
  busy: string | null;
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
  targets: LineTargetRecord[];
  tenantName: string;
}) {
  const readyTargets = targets.filter(canReceiveSalesMorningBrief);

  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            กลุ่ม LINE ของ {tenantName}
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            กลุ่มใหม่จาก webhook จะยังไม่รับรายงานจนกว่า owner จะอนุมัติและเลือกสิทธิ์
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge color="light">{targets.length} กลุ่ม/ปลายทาง</Badge>
          <Badge color={readyTargets.length ? "success" : "warning"}>
            พร้อมส่ง {readyTargets.length}
          </Badge>
        </div>
      </div>

      <div className="border-t border-gray-100 p-4 dark:border-gray-800">
        <div className="mb-4 grid gap-2 text-sm text-gray-600 dark:text-gray-300 md:grid-cols-5">
          {[
            ["1", "ลูกค้าดึง OA เข้ากลุ่ม"],
            ["2", "พิมพ์ test"],
            ["3", "รายการขึ้นรออนุมัติ"],
            ["4", "เลือกสิทธิ์กลุ่ม"],
            ["5", "ส่งทดสอบ"],
          ].map(([step, label]) => (
            <div
              className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
              key={step}
            >
              <p className="text-xs font-semibold text-brand-600 dark:text-brand-400">
                Step {step}
              </p>
              <p className="mt-1 leading-5">{label}</p>
            </div>
          ))}
        </div>

        {targets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            ยังไม่พบกลุ่ม LINE ของร้านนี้ ให้เพิ่ม OA เข้ากลุ่มแล้วพิมพ์
            `test` ในกลุ่มก่อน ระบบจะบันทึกเป็นรายการรออนุมัติ
          </div>
        ) : (
          <div className="space-y-3">
            {targets.map((target) => (
              <LineTargetCard
                busy={busy}
                key={target.id}
                onApprove={onApprove}
                onSetProfile={onSetProfile}
                onTestSend={onTestSend}
                onToggleEnabled={onToggleEnabled}
                target={target}
              />
            ))}
          </div>
        )}
      </div>
    </section>
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

function LineTargetCard({
  busy,
  onApprove,
  onSetProfile,
  onTestSend,
  onToggleEnabled,
  target,
}: {
  busy: string | null;
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
  target: LineTargetRecord;
}) {
  const isEnvFallback = target.source === "env_fallback";
  const ready = canReceiveSalesMorningBrief(target);
  const profileKeys: LineAccessProfileKey[] = [
    "executive",
    "sales_manager",
    "operations",
    "staff",
  ];

  return (
    <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-white">
              {target.display_name}
            </h3>
            <Badge color={ready ? "success" : "warning"}>
              {ready ? "รับรายงานขายได้" : "ยังไม่พร้อมรับ"}
            </Badge>
            <Badge color={target.approved ? "success" : "warning"}>
              {target.approved ? "อนุมัติแล้ว" : "รออนุมัติ"}
            </Badge>
            <Badge color={target.enabled ? "success" : "light"}>
              {target.enabled ? "เปิดรับ" : "ปิดรับ"}
            </Badge>
          </div>

          <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400 sm:grid-cols-2 2xl:grid-cols-4">
            <CompactFact
              label="ประเภท"
              value={formatLineTargetType(target.target_type)}
            />
            <CompactFact
              label="รหัสปลายทาง"
              value={target.target_id_masked}
            />
            <CompactFact
              label="สิทธิ์"
              value={formatLineAccessProfile(target.access_profile_key)}
            />
            <CompactFact
              label="ล่าสุด"
              value={
                target.last_delivery_at
                  ? formatDateTime(target.last_delivery_at)
                  : "-"
              }
            />
          </dl>

          <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
            รายงานที่เห็นได้: {formatAllowedReports(target)} · สิทธิ์การใช้งาน:{" "}
            {formatAllowedActions(target)} · ที่มา:{" "}
            {formatLineTargetSource(target.source)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 xl:max-w-[360px] xl:justify-end">
          {!target.approved && !isEnvFallback ? (
            <Button
              disabled={Boolean(busy)}
              size="sm"
              onClick={() => void onApprove(target, "executive")}
            >
              อนุมัติผู้บริหาร
            </Button>
          ) : null}

          {profileKeys.map((profileKey) => (
            <Button
              disabled={Boolean(busy) || isEnvFallback}
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
            disabled={Boolean(busy) || isEnvFallback}
            size="sm"
            variant="outline"
            onClick={() => void onToggleEnabled(target)}
          >
            {target.enabled ? "ปิดรับ" : "เปิดรับ"}
          </Button>
          <Button
            disabled={Boolean(busy)}
            size="sm"
            variant="outline"
            onClick={() => void onTestSend(target)}
          >
            ส่งทดสอบ
          </Button>
        </div>
      </div>
    </div>
  );
}

function canReceiveSalesMorningBrief(target: LineTargetRecord) {
  return (
    target.approved &&
    target.enabled &&
    target.allowed_actions.includes("receive_morning_brief") &&
    target.allowed_report_keys.includes("sales_goods_services")
  );
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

  return target.allowed_report_keys
    .map((reportKey) =>
      reportKey === "sales_goods_services"
        ? "รายงานขายสินค้าและบริการ"
        : reportKey,
    )
    .join(", ");
}

function formatAllowedActions(target: LineTargetRecord) {
  if (!target.allowed_actions.length) {
    return "ยังไม่มี";
  }

  const labels = target.allowed_actions.map((action) => {
    if (action === "receive_morning_brief") {
      return "รับ Morning Brief";
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
