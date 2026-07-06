"use client";

import Link from "next/link";

type StoreSetupNavKey =
  | "ai-ceo"
  | "flowaccount"
  | "line"
  | "notifications"
  | "permissions"
  | "reports"
  | "sml"
  | "store"
  | "system";

type StoreSetupNavItem = {
  description: string;
  href: string;
  key: StoreSetupNavKey;
  label: string;
};

type StoreSetupNavGroup = {
  helper: string;
  items: StoreSetupNavItem[];
  title: string;
};

export default function OwnerV2StoreSetupNav({
  current,
  tenantId,
}: {
  current: StoreSetupNavKey;
  tenantId: string;
}) {
  const encodedTenantId = encodeURIComponent(tenantId);
  const groups: StoreSetupNavGroup[] = [
    {
      title: "งานหลัก",
      helper: "ใช้บ่อยตอนเปิดร้านและดูแลรอบแจ้งเตือน",
      items: [
        {
          key: "store",
          href: `/owner-v2/stores/${encodedTenantId}`,
          label: "ภาพรวมร้าน",
          description: "ดูความพร้อมและสิ่งที่ควรทำต่อ",
        },
        {
          key: "line",
          href: `/owner-v2/stores/${encodedTenantId}/line`,
          label: "LINE",
          description: "ตรวจช่องทางและผู้รับแจ้งเตือน",
        },
        {
          key: "notifications",
          href: `/owner-v2/stores/${encodedTenantId}/notifications`,
          label: "แผนแจ้งเตือน",
          description: "จัดรอบส่งและลำดับรายงานใน LINE",
        },
        {
          key: "reports",
          href: `/owner-v2/stores/${encodedTenantId}/reports`,
          label: "รายงาน",
          description: "ทดสอบรายงานและดูผลรันล่าสุด",
        },
        {
          key: "ai-ceo",
          href: `/owner-v2/stores/${encodedTenantId}/ai-ceo`,
          label: "AI CEO",
          description: "ตั้ง prompt, model และทดสอบคำแนะนำ",
        },
        {
          key: "permissions",
          href: `/owner-v2/stores/${encodedTenantId}/permissions`,
          label: "สิทธิ์รายงาน",
          description: "กำหนดว่าใครเห็นรายงานอะไร",
        },
      ],
    },
    {
      title: "ระบบและช่องทางเสริม",
      helper: "ใช้เมื่อตั้งแหล่งข้อมูลหรือตรวจปัญหาเชิงระบบ",
      items: [
        {
          key: "system",
          href: `/owner-v2/stores/${encodedTenantId}?tab=system`,
          label: "ตรวจระบบร้าน",
          description: "ดูสถานะล่าสุดและหลักฐานรอบส่ง",
        },
        {
          key: "sml",
          href: `/owner-v2/stores/${encodedTenantId}/sml`,
          label: "SML",
          description: "ตั้งฐานข้อมูลและทดสอบการเชื่อมต่อ",
        },
        {
          key: "flowaccount",
          href: `/owner-v2/stores/${encodedTenantId}/flowaccount`,
          label: "FlowAccount",
          description: "ช่องทางบัญชีสำหรับแผนต่อไป",
        },
      ],
    },
  ];

  const currentItem =
    groups.flatMap((group) => group.items).find((item) => item.key === current) ??
    null;
  const allItems = groups.flatMap((group) => group.items);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03] sm:p-5">
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-lg font-semibold text-gray-800 dark:text-white/90">
            ทางลัดตั้งค่าร้าน
          </p>
          <p className="max-w-3xl text-sm leading-6 text-gray-500 dark:text-gray-400">
            ไปหน้าที่ต้องแก้ได้ทันที โดยไม่ต้องกลับไปค้นหาร้านใหม่
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/[0.02]">
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">
            ตอนนี้อยู่ที่
          </p>
          <p className="mt-0.5 text-sm font-semibold text-gray-800 dark:text-white/90">
            {currentItem?.label ?? "หน้าร้าน"}
          </p>
        </div>
      </div>
      <details className="lg:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800 marker:hidden dark:border-gray-800 dark:bg-white/[0.02] dark:text-white/90">
          เลือกหน้างานของร้านนี้
          <span className="text-theme-xs font-normal text-gray-500 dark:text-gray-400">
            แตะเพื่อเปิดเมนู
          </span>
        </summary>
        <nav className="mt-3 grid grid-cols-1 gap-2">
          {allItems.map((item) => (
            <StoreSetupNavLink
              active={item.key === current}
              compact
              item={item}
              key={item.key}
            />
          ))}
        </nav>
      </details>
      <div className="hidden grid-cols-1 gap-4 lg:grid xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        {groups.map((group) => (
          <div className="min-w-0" key={group.title}>
            <div className="mb-2">
              <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                {group.title}
              </p>
              <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                {group.helper}
              </p>
            </div>
            <nav className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.items.map((item) => (
                <StoreSetupNavLink
                  active={item.key === current}
                  item={item}
                  key={item.key}
                />
              ))}
            </nav>
          </div>
        ))}
      </div>
    </section>
  );
}

function StoreSetupNavLink({
  active,
  compact = false,
  item,
}: {
  active: boolean;
  compact?: boolean;
  item: StoreSetupNavItem;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={
        active
          ? `group block rounded-xl border border-brand-500 bg-brand-50 px-3 ${compact ? "py-2.5" : "py-3"} shadow-theme-xs transition dark:border-brand-500/40 dark:bg-brand-500/15`
          : `group block rounded-xl border border-gray-200 bg-white px-3 ${compact ? "py-2.5" : "py-3"} shadow-theme-xs transition hover:border-brand-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-500/40 dark:hover:bg-white/[0.05]`
      }
      href={item.href}
    >
      <span
        className={
          active
            ? "block text-sm font-semibold text-brand-600 dark:text-brand-400"
            : "block text-sm font-semibold text-gray-800 group-hover:text-brand-600 dark:text-white/90 dark:group-hover:text-brand-400"
        }
      >
        {item.label}
      </span>
      <span className="mt-1 block text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
        {item.description}
      </span>
    </Link>
  );
}
