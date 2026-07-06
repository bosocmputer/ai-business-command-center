"use client";

import Link from "next/link";
import { secondaryActionClass } from "./ui";

type StoreSetupNavKey =
  | "ai-ceo"
  | "line"
  | "notifications"
  | "reports"
  | "store"
  | "system";

const activeActionClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-50 px-4 py-2.5 text-theme-sm font-medium text-brand-600 shadow-theme-xs transition dark:bg-brand-500/15 dark:text-brand-400";

export default function OwnerV2StoreSetupNav({
  current,
  tenantId,
}: {
  current: StoreSetupNavKey;
  tenantId: string;
}) {
  const encodedTenantId = encodeURIComponent(tenantId);
  const items: Array<{
    key: StoreSetupNavKey;
    href: string;
    label: string;
  }> = [
    {
      key: "store",
      href: `/owner-v2/stores/${encodedTenantId}`,
      label: "หน้าร้าน",
    },
    {
      key: "system",
      href: `/owner-v2/stores/${encodedTenantId}?tab=system`,
      label: "ตรวจระบบร้าน",
    },
    {
      key: "reports",
      href: `/owner-v2/stores/${encodedTenantId}/reports`,
      label: "รายงาน",
    },
    {
      key: "notifications",
      href: `/owner-v2/stores/${encodedTenantId}/notifications`,
      label: "แผนแจ้งเตือน",
    },
    {
      key: "line",
      href: `/owner-v2/stores/${encodedTenantId}/line`,
      label: "LINE",
    },
    {
      key: "ai-ceo",
      href: `/owner-v2/stores/${encodedTenantId}/ai-ceo`,
      label: "AI CEO",
    },
  ];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03] sm:p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <p className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
            งานร้านนี้
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-800 dark:text-white/90">
            สลับหน้าตั้งค่าหลักโดยไม่ต้องกลับไปค้นหาร้านใหม่
          </p>
        </div>
        <nav className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:flex-wrap xl:justify-end">
          {items.map((item) => {
            const active = item.key === current;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`${
                  active ? activeActionClass : secondaryActionClass
                } sm:w-full xl:w-auto`}
                href={item.href}
                key={item.key}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </section>
  );
}
