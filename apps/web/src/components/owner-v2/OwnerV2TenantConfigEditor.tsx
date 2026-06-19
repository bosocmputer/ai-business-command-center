"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/button/Button";
import { AlertIcon } from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import { Fact, Notice, Panel, PanelBody, PanelHeader } from "./ui";
import type {
  BusinessSignalThresholdsConfig,
  OwnerV2TenantDeleteImpact,
  TenantFeatureFlags,
} from "./types";

const FLAG_FIELDS: Array<{
  key: keyof TenantFeatureFlags;
  title: string;
  description: string;
  requiresSignals?: boolean;
}> = [
  {
    key: "business_signals_enabled",
    title: "เปิด Business Signals",
    description:
      "ใช้ rule จากรายงานเพื่อจับยอดตก กำไรรั่ว และคุณภาพข้อมูลของร้านนี้",
  },
  {
    key: "line_action_digest_v2_enabled",
    title: "ส่ง LINE แบบเรื่องที่ต้องทำ",
    description:
      "ถ้าเปิด แผนแจ้งเตือนจะส่งเฉพาะ signal สำคัญสูงสุด 3 เรื่องต่อรอบ และ fallback เป็นรายงานเดิมเมื่อไม่มีเรื่องต้องดู",
    requiresSignals: true,
  },
  {
    key: "line_heavy_report_fallback_enabled",
    title: "กันรายงานใหญ่ล้มทั้ง LINE",
    description:
      "ถ้าสต็อกคงเหลือช้าเกินไป จะส่งรายงานอื่นต่อพร้อมการ์ดแจ้งสถานะ",
  },
  {
    key: "line_report_failure_incident_enabled",
    title: "แจ้ง SML ล้มแทนรายงาน",
    description: "ถ้าดึงรายงานจาก SML ไม่ได้ จะส่ง incident แทนการเงียบ",
  },
  {
    key: "sml_chunked_heavy_reports_enabled",
    title: "รายงานใหญ่แบบแบ่งส่วน",
    description:
      "อนุญาตให้รายงาน stock_balance และ ar_customer_movement รันแบบ async แบ่ง chunk เพื่อกัน timeout",
  },
  {
    key: "demo_mode_enabled",
    title: "Demo Mode",
    description:
      "ใช้ติดป้ายข้อมูลตัวอย่างสำหรับงานขายหรือทดสอบ ห้ามใช้แทนข้อมูลร้านจริง",
  },
  {
    key: "telegram_operational_alerts_enabled",
    title: "รับ Telegram ops alert",
    description:
      "ส่ง incident, JavaWS diagnostic และสรุปรอบแจ้งเตือนของร้านนี้ไปยัง Telegram ops ของระบบ",
  },
];

const THRESHOLD_FIELDS: Array<{
  key: keyof BusinessSignalThresholdsConfig;
  label: string;
  help: string;
  suffix?: string;
}> = [
  {
    key: "low_gross_margin_percent",
    label: "กำไรขั้นต้นต่ำเกินไป",
    help: "เปอร์เซ็นต์กำไรขั้นต้นที่ต่ำกว่านี้จะถูกตั้งเป็น signal",
    suffix: "%",
  },
  {
    key: "sales_drop_percent",
    label: "ยอดขายตก (%)",
    help: "ยอดขายตกเมื่อเทียบก่อนหน้าเกินเปอร์เซ็นต์นี้จะเป็น signal",
    suffix: "%",
  },
  {
    key: "sales_drop_amount",
    label: "ยอดขายตก (บาท)",
    help: "ยอดขายตกเมื่อเทียบก่อนหน้าเกินจำนวนนี้จะเป็น signal",
    suffix: "฿",
  },
  {
    key: "purchase_concentration_percent",
    label: "ซื้อรวมจาก supplier เดียว",
    help: "สัดส่วนการซื้อจาก supplier เดียวเกินเปอร์เซ็นต์นี้จะเป็น signal",
    suffix: "%",
  },
  {
    key: "missing_branch_amount",
    label: "ขาดข้อมูลสาขาตั้งแต่",
    help: "ยอดที่ไม่ระบุสาขาเกินจำนวนนี้จะเป็น signal",
    suffix: "฿",
  },
  {
    key: "negative_gross_profit_amount",
    label: "กำไรขั้นต้นติดลบตั้งแต่",
    help: "กำไรขั้นต้นติดลบเกินจำนวนนี้ (ตามขนาด) จะเป็น signal",
    suffix: "฿",
  },
];

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Combined editor for tenant-level business config: feature flags, business
 * signal thresholds, and the cancel-tenant danger zone. Ported from v1
 * TenantDetailPanel so v2 can fully manage a tenant without falling back to
 * /owner.
 */
export default function OwnerV2TenantConfigEditor({
  tenantId,
  tenantName,
  initialFlags,
  initialThresholds,
  onCancelled,
}: {
  tenantId: string;
  tenantName: string;
  initialFlags: TenantFeatureFlags;
  initialThresholds: BusinessSignalThresholdsConfig;
  onCancelled: () => void;
}) {
  const [flags, setFlags] = useState<TenantFeatureFlags>(initialFlags);
  const [thresholds, setThresholds] = useState<BusinessSignalThresholdsConfig>(
    initialThresholds,
  );
  const [thresholdsEnabled, setThresholdsEnabled] = useState<boolean>(
    initialThresholds.no_sales_enabled ?? true,
  );
  const [flagsState, setFlagsState] = useState<SaveState>("idle");
  const [thresholdsState, setThresholdsState] = useState<SaveState>("idle");
  const [flagsMessage, setFlagsMessage] = useState("");
  const [thresholdsMessage, setThresholdsMessage] = useState("");

  useEffect(() => {
    setFlags(initialFlags);
  }, [initialFlags]);
  useEffect(() => {
    setThresholds(initialThresholds);
    setThresholdsEnabled(initialThresholds.no_sales_enabled ?? true);
  }, [initialThresholds]);

  const flagsDirty =
    JSON.stringify(flags) !== JSON.stringify(initialFlags);

  const thresholdsDirty =
    JSON.stringify(thresholds) !== JSON.stringify(initialThresholds) ||
    thresholds.no_sales_enabled !== initialThresholds.no_sales_enabled;

  async function saveFlags() {
    setFlagsState("saving");
    setFlagsMessage("");
    try {
      await ownerV2Fetch(`/api/owner/tenants/${encodeURIComponent(tenantId)}`, {
        method: "PATCH",
        body: { feature_flags: flags },
      });
      setFlagsState("saved");
      setFlagsMessage("บันทึก feature flags แล้ว");
    } catch (error) {
      setFlagsState("error");
      setFlagsMessage(
        error instanceof Error ? error.message : "บันทึก feature flags ไม่สำเร็จ",
      );
    }
  }

  async function saveThresholds() {
    setThresholdsState("saving");
    setThresholdsMessage("");
    try {
      await ownerV2Fetch(`/api/owner/tenants/${encodeURIComponent(tenantId)}`, {
        method: "PATCH",
        body: {
          business_signal_thresholds: {
            ...thresholds,
            no_sales_enabled: thresholdsEnabled,
          },
        },
      });
      setThresholdsState("saved");
      setThresholdsMessage("บันทึกค่า threshold แล้ว");
    } catch (error) {
      setThresholdsState("error");
      setThresholdsMessage(
        error instanceof Error ? error.message : "บันทึกค่า threshold ไม่สำเร็จ",
      );
    }
  }

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader description="คุมพฤติกรรมร้านและค่าเตือนธุรกิจ" title="การตั้งค่าธุรกิจของร้าน" />
        <PanelBody spaced>
          <FeatureFlagsEditor
            flags={flags}
            onChange={(key, value) => setFlags((prev) => ({ ...prev, [key]: value }))}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={!flagsDirty || flagsState === "saving"}
              onClick={() => void saveFlags()}
              size="sm"
              type="button"
            >
              {flagsState === "saving" ? "กำลังบันทึก..." : "บันทึก feature flags"}
            </Button>
            {flagsMessage ? (
              <span
                className={`text-theme-xs ${
                  flagsState === "error" ? "text-error-600" : "text-success-600"
                }`}
              >
                {flagsMessage}
              </span>
            ) : null}
          </div>

          <ThresholdsEditor
            thresholds={thresholds}
            thresholdsEnabled={thresholdsEnabled}
            onChange={(key, value) =>
              setThresholds((prev) => ({ ...prev, [key]: value }))
            }
            onToggleEnabled={() => setThresholdsEnabled((prev) => !prev)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={!thresholdsDirty || thresholdsState === "saving"}
              onClick={() => void saveThresholds()}
              size="sm"
              type="button"
            >
              {thresholdsState === "saving"
                ? "กำลังบันทึก..."
                : "บันทึกค่า threshold"}
            </Button>
            {thresholdsMessage ? (
              <span
                className={`text-theme-xs ${
                  thresholdsState === "error"
                    ? "text-error-600"
                    : "text-success-600"
                }`}
              >
                {thresholdsMessage}
              </span>
            ) : null}
          </div>
        </PanelBody>
      </Panel>

      <DangerZone
        onCancelled={onCancelled}
        tenantId={tenantId}
        tenantName={tenantName}
      />
    </div>
  );
}

function FeatureFlagsEditor({
  flags,
  onChange,
}: {
  flags: TenantFeatureFlags;
  onChange: (key: keyof TenantFeatureFlags, value: boolean) => void;
}) {
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {FLAG_FIELDS.map((field) => {
        const disabled =
          field.requiresSignals && !flags.business_signals_enabled;
        return (
          <label
            className={`flex min-w-0 gap-3 rounded-lg border border-gray-100 p-3 text-sm dark:border-gray-800 ${
              disabled ? "opacity-60" : ""
            }`}
            key={String(field.key)}
          >
            <input
              checked={Boolean(flags[field.key])}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
              disabled={disabled}
              onChange={(event) => onChange(field.key, event.target.checked)}
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block font-medium text-gray-800 dark:text-gray-200">
                {field.title}
              </span>
              <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                {field.description}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function ThresholdsEditor({
  onChange,
  onToggleEnabled,
  thresholds,
  thresholdsEnabled,
}: {
  onChange: <K extends keyof BusinessSignalThresholdsConfig>(
    key: K,
    value: number,
  ) => void;
  onToggleEnabled: () => void;
  thresholds: BusinessSignalThresholdsConfig;
  thresholdsEnabled: boolean;
}) {
  return (
    <div>
      <label className="mb-3 flex min-w-0 gap-3 rounded-lg border border-gray-100 p-3 text-sm dark:border-gray-800">
        <input
          checked={thresholdsEnabled}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
          onChange={onToggleEnabled}
          type="checkbox"
        />
        <span className="min-w-0">
          <span className="block font-medium text-gray-800 dark:text-gray-200">
            เปิดการแจ้งเตือนยอดขายเป็นศูนย์
          </span>
          <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
            ถ้ายอดขายรอบนั้นเป็น 0 จะตั้งเป็น signal ให้ตรวจสอบ
          </span>
        </span>
      </label>
      <div className="grid gap-3 lg:grid-cols-3">
        {THRESHOLD_FIELDS.map((field) => (
          <div key={String(field.key)}>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                {field.label}
                {field.suffix ? ` (${field.suffix})` : ""}
              </span>
              <input
                className="owner-v2-input"
                inputMode="decimal"
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (!Number.isNaN(parsed)) {
                    onChange(field.key, parsed);
                  }
                }}
                type="number"
                value={String(thresholds[field.key] ?? 0)}
              />
            </label>
            <span className="mt-1.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">
              {field.help}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DangerZone({
  onCancelled,
  tenantId,
  tenantName,
}: {
  onCancelled: () => void;
  tenantId: string;
  tenantName: string;
}) {
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<OwnerV2TenantDeleteImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  async function loadImpact() {
    setImpactLoading(true);
    setImpactError("");
    try {
      const data = await ownerV2Fetch<OwnerV2TenantDeleteImpact>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/delete-impact`,
      );
      setImpact(data);
    } catch (error) {
      setImpactError(
        error instanceof Error
          ? error.message
          : "โหลดผลกระทบก่อนยกเลิกร้านไม่สำเร็จ",
      );
    } finally {
      setImpactLoading(false);
    }
  }

  useEffect(() => {
    if (!open) {
      setImpact(null);
      setImpactError("");
      setConfirmName("");
      setReason("");
      setCancelError("");
    }
  }, [open]);

  const canCancel =
    impact?.can_cancel !== false &&
    confirmName.trim() === tenantName &&
    reason.trim().length > 0 &&
    !cancelling;

  async function cancelTenant() {
    if (!canCancel) {
      return;
    }
    setCancelling(true);
    setCancelError("");
    try {
      await ownerV2Fetch(`/api/owner/tenants/${encodeURIComponent(tenantId)}`, {
        method: "DELETE",
        body: { confirm_name: confirmName.trim(), reason: reason.trim() },
      });
      onCancelled();
    } catch (error) {
      setCancelError(
        error instanceof Error ? error.message : "ยกเลิกร้านไม่สำเร็จ",
      );
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-error-500/40 dark:border-error-500/30">
      <button
        className="flex w-full items-center justify-between px-4 py-3 text-left sm:px-6"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-error-700 dark:text-error-400">
          <AlertIcon className="h-4 w-4" />
          Danger Zone — ยกเลิกร้าน
        </span>
        <span className="text-theme-xs text-gray-400 transition group-open:rotate-180">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <div className="space-y-4 border-t border-error-500/30 p-4 sm:p-6">
          <Notice
            tone="error"
            title="การยกเลิกร้านเป็น soft delete"
            text="ระบบจะตั้งสถานะเป็นยกเลิก ปิดแผนแจ้งเตือนที่เปิดอยู่ และเก็บ logs, LINE targets, snapshots ไว้ตรวจย้อนหลัง หลังยกเลิกจะไม่ส่ง LINE และไม่เปิด dashboard ลูกค้า"
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={impactLoading}
              onClick={() => void loadImpact()}
              size="sm"
              type="button"
              variant="outline"
            >
              {impactLoading ? "กำลังตรวจ..." : "ดูผลกระทบก่อนยกเลิก"}
            </Button>
          </div>

          {impactError ? (
            <Notice tone="error" title="ตรวจผลกระทบไม่สำเร็จ" text={impactError} />
          ) : null}

          {impact ? (
            <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact
                  label="แผนแจ้งเตือน"
                  value={`${impact.notification_rules_enabled}/${impact.notification_rules_total} เปิดอยู่`}
                />
                <Fact
                  label="ผู้รับ LINE"
                  value={`${impact.line_targets_enabled}/${impact.line_targets_total} พร้อม`}
                />
                <Fact
                  label="snapshot ล่าสุด"
                  value={
                    impact.latest_snapshot_at
                      ? new Intl.DateTimeFormat("th-TH", {
                          dateStyle: "medium",
                          timeZone: "Asia/Bangkok",
                        }).format(new Date(impact.latest_snapshot_at))
                      : "ยังไม่มี"
                  }
                />
                <Fact
                  label="dashboard ลูกค้า"
                  value={impact.dashboard_path ?? "ยังไม่มี"}
                />
              </div>

              {impact.blockers.length ? (
                <div className="mt-4 space-y-2">
                  {impact.blockers.map((blocker) => (
                    <div
                      className="rounded-lg border border-warning-500/40 bg-warning-50 p-3 text-sm dark:bg-warning-500/10"
                      key={blocker.reason}
                    >
                      <p className="font-medium text-warning-800 dark:text-warning-300">
                        {blocker.message}
                      </p>
                      {blocker.count > 0 ? (
                        <p className="mt-1 text-xs text-warning-700 dark:text-warning-400">
                          {blocker.count} รายการ
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                พิมพ์ชื่อร้านเพื่อยืนยัน ({tenantName})
              </span>
              <input
                className="owner-v2-input"
                onChange={(event) => setConfirmName(event.target.value)}
                placeholder={tenantName}
                value={confirmName}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                เหตุผลที่ยกเลิก
              </span>
              <input
                className="owner-v2-input"
                onChange={(event) => setReason(event.target.value)}
                placeholder="เช่น ย้ายออก, ทดลองจบแล้ว"
                value={reason}
              />
            </label>
          </div>

          {cancelError ? (
            <Notice tone="error" title="ยกเลิกร้านไม่สำเร็จ" text={cancelError} />
          ) : null}

          <button
            className="inline-flex w-full items-center justify-center rounded-lg bg-error-500 px-4 py-2.5 text-theme-sm font-medium text-white shadow-theme-xs transition hover:bg-error-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            disabled={!canCancel}
            onClick={() => void cancelTenant()}
            type="button"
          >
            {cancelling ? "กำลังยกเลิก..." : "ยืนยันยกเลิกร้าน"}
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            ปุ่มเปิดเมื่อพิมพ์ชื่อร้านตรง ระบุเหตุผล และไม่มี blocker ที่กันยกเลิก
          </p>
        </div>
      ) : null}
    </div>
  );
}
