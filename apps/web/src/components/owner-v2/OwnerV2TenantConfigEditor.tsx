"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/button/Button";
import { AlertIcon } from "@/icons";
import { ownerV2Fetch } from "./api";
import { Fact, Notice } from "./ui";
import type { OwnerV2TenantDeleteImpact } from "./types";

/**
 * Product behavior flags and business signal thresholds are fixed system policy.
 * Keep only the tenant cancellation controls in this advanced internal section.
 */
export default function OwnerV2TenantConfigEditor({
  tenantId,
  tenantName,
  onCancelled,
}: {
  tenantId: string;
  tenantName: string;
  onCancelled: () => void;
}) {
  return (
    <DangerZone
      onCancelled={onCancelled}
      tenantId={tenantId}
      tenantName={tenantName}
    />
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
            text="ระบบจะตั้งสถานะเป็นยกเลิก ปิดแผนแจ้งเตือนที่เปิดอยู่ และเก็บประวัติ ผู้รับ LINE และข้อมูลรายงานไว้ตรวจย้อนหลัง หลังยกเลิกจะไม่ส่ง LINE และไม่เปิดหน้าลูกค้า"
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
                  label="ข้อมูลล่าสุด"
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
