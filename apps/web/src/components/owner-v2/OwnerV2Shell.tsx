"use client";

import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon, BoxCubeIcon, PlugInIcon, PlusIcon } from "@/icons";

const navItems = [
  {
    href: "/owner-v2",
    label: "Workbench",
    description: "จัดการร้าน",
    icon: BoxCubeIcon,
  },
  {
    href: "/owner-v2/new",
    label: "เพิ่มร้าน",
    description: "สร้างร้านใหม่",
    icon: PlusIcon,
  },
  {
    href: "/owner-v2/ops",
    label: "Ops",
    description: "งานที่ต้องดู",
    icon: BellIcon,
  },
  {
    href: "/owner-v2/system",
    label: "System",
    description: "ตั้งค่าระบบ",
    icon: PlugInIcon,
  },
];

export function OwnerV2Shell({
  children,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  subtitle: string;
  title: string;
}) {
  const pathname = usePathname();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            Owner Admin v2
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
            {title}
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-400">
            {subtitle}
          </p>
        </div>
        <Link
          className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]"
          href="/owner"
        >
          เปิด Owner v1
        </Link>
      </div>

      <nav className="mb-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {navItems.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/owner-v2" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${
                active
                  ? "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]"
              }`}
              href={item.href}
              key={item.href}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  active
                    ? "bg-white text-brand-600 dark:bg-brand-500/10 dark:text-brand-200"
                    : "bg-gray-50 text-gray-500 dark:bg-white/[0.04] dark:text-gray-400"
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">
                  {item.label}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {item.description}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
