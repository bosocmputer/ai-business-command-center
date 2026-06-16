"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ThemeToggleButton } from "@/components/common/ThemeToggleButton";
import { forgetAdminToken } from "@/components/command-center/adminAuth";
import { useSidebar } from "@/context/SidebarContext";
import {
  AlertIcon,
  BellIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  InfoIcon,
} from "@/icons";
import { isAbortError, ownerV2Fetch } from "../api";
import type { OwnerV2Tenant, OwnerV2WorkbenchPayload } from "../types";

type HeaderWorkbenchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: OwnerV2WorkbenchPayload };

const quickActions = [
  {
    detail: "เลือกร้าน ดู readiness และ next action",
    href: "/owner-v2",
    keywords: "workbench dashboard readiness next action",
    label: "Workbench",
  },
  {
    detail: "ดูร้านทั้งหมดและเปิดหน้าตั้งค่าต่อร้าน",
    href: "/owner-v2/stores",
    keywords: "stores tenants shop ร้านค้า",
    label: "ร้านทั้งหมด",
  },
  {
    detail: "เพิ่มร้านใหม่พร้อม dry-run preview",
    href: "/owner-v2/stores/new",
    keywords: "new tenant add store เพิ่มร้าน",
    label: "เพิ่มร้าน",
  },
  {
    detail: "เลือกร้านก่อนเปิด report runner และ snapshot ล่าสุด",
    href: "/owner-v2/stores",
    keywords: "reports report runner snapshot รายงาน ทดสอบรายงาน",
    label: "รายงาน",
  },
  {
    detail: "เลือกร้านก่อนตั้งค่า SML JavaWS",
    href: "/owner-v2/stores",
    keywords: "sml javaws datasource connection เชื่อม sml",
    label: "SML JavaWS",
  },
  {
    detail: "เลือกร้านก่อนจัดการ LINE OA และผู้รับ",
    href: "/owner-v2/stores",
    keywords: "line oa recipients targets ผู้รับ",
    label: "LINE OA",
  },
  {
    detail: "เลือกร้านก่อนตรวจ role และ report permissions",
    href: "/owner-v2/stores",
    keywords: "permissions access role สิทธิ์ รายงาน",
    label: "สิทธิ์รายงาน",
  },
  {
    detail: "เลือกร้านก่อนตั้งแผนแจ้งเตือน",
    href: "/owner-v2/stores",
    keywords: "notification schedule rules แจ้งเตือน แผน",
    label: "แผนแจ้งเตือน",
  },
  {
    detail: "ดู incidents, worker, LINE, Telegram",
    href: "/owner-v2/ops",
    keywords: "ops operations worker incident telegram line",
    label: "Operations",
  },
  {
    detail: "ตั้งค่า runtime ที่จำเป็น",
    href: "/owner-v2/system",
    keywords: "system runtime settings config",
    label: "System",
  },
];

export default function OwnerV2Header() {
  const [isApplicationMenuOpen, setApplicationMenuOpen] = useState(false);
  const [isNotificationOpen, setNotificationOpen] = useState(false);
  const [isUserMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [workbenchState, setWorkbenchState] = useState<HeaderWorkbenchState>({
    status: "idle",
  });
  const { isMobileOpen, toggleMobileSidebar, toggleSidebar } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const actionAreaRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const scopedQuickActions = useMemo(() => {
    const tenantId = getTenantIdFromPathname(pathname);
    if (!tenantId) {
      return quickActions;
    }
    const tenantPath = `/owner-v2/stores/${encodeURIComponent(tenantId)}`;
    return [
      ...quickActions,
      {
        detail: "เปิดข้อมูลร้านและ readiness ของร้านนี้",
        href: tenantPath,
        keywords: "store tenant readiness detail ข้อมูลร้าน",
        label: "ร้านนี้",
      },
      {
        detail: "ตั้งค่า SML JavaWS ของร้านนี้",
        href: `${tenantPath}/sml`,
        keywords: "sml javaws datasource connection เชื่อม sml",
        label: "SML ร้านนี้",
      },
      {
        detail: "รัน approved report runner ของร้านนี้",
        href: `${tenantPath}/reports`,
        keywords: "reports report runner snapshot รายงาน ทดสอบรายงาน",
        label: "รายงานร้านนี้",
      },
      {
        detail: "จัดการ LINE OA และผู้รับของร้านนี้",
        href: `${tenantPath}/line`,
        keywords: "line oa recipients targets ผู้รับ",
        label: "LINE ร้านนี้",
      },
      {
        detail: "ตรวจ role และ report permissions ของร้านนี้",
        href: `${tenantPath}/permissions`,
        keywords: "permissions access role สิทธิ์ รายงาน",
        label: "สิทธิ์ร้านนี้",
      },
      {
        detail: "ตั้งแผนแจ้งเตือนของร้านนี้",
        href: `${tenantPath}/notifications`,
        keywords: "notification schedule rules แจ้งเตือน แผน",
        label: "แจ้งเตือนร้านนี้",
      },
    ];
  }, [pathname]);

  const filteredActions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return scopedQuickActions;
    }
    return scopedQuickActions.filter((item) =>
      `${item.label} ${item.detail} ${item.keywords}`
        .toLowerCase()
        .includes(query),
    );
  }, [scopedQuickActions, searchQuery]);

  const opsCount =
    workbenchState.status === "success"
      ? workbenchState.data.ops.warning_count + workbenchState.data.ops.critical_count
      : 0;

  useEffect(() => {
    setApplicationMenuOpen(false);
    setNotificationOpen(false);
    setUserMenuOpen(false);
    setSearchFocused(false);
  }, [pathname]);

  useEffect(() => {
    function closeFloatingMenus(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        actionAreaRef.current?.contains(target) ||
        searchRef.current?.contains(target)
      ) {
        return;
      }
      setNotificationOpen(false);
      setUserMenuOpen(false);
      setSearchFocused(false);
    }

    document.addEventListener("mousedown", closeFloatingMenus);
    return () => document.removeEventListener("mousedown", closeFloatingMenus);
  }, []);

  useEffect(() => {
    if (!isNotificationOpen || workbenchState.status === "success") {
      return;
    }

    const controller = new AbortController();
    setWorkbenchState({ status: "loading" });
    void ownerV2Fetch<OwnerV2WorkbenchPayload>("/api/owner/workbench", {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setWorkbenchState({ status: "success", data });
        }
      })
      .catch((error) => {
        if (isAbortError(error)) {
          return;
        }
        setWorkbenchState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดสถานะ operations ไม่สำเร็จ",
        });
      });

    return () => controller.abort();
  }, [isNotificationOpen, workbenchState.status]);

  const handleToggle = () => {
    if (window.innerWidth >= 1024) {
      toggleSidebar();
    } else {
      toggleMobileSidebar();
    }
  };

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const first = filteredActions[0];
    if (!first) {
      return;
    }
    router.push(first.href);
    setSearchQuery("");
    setSearchFocused(false);
  }

  async function logout() {
    setUserMenuOpen(false);
    forgetAdminToken();
    await fetch("/auth/logout", { method: "POST" }).catch(() => null);
    window.location.assign("/signin");
  }

  return (
    <header className="sticky top-0 z-99999 flex w-full border-gray-200 bg-white lg:border-b dark:border-gray-800 dark:bg-gray-900">
      <div className="flex grow flex-col items-center justify-between lg:flex-row lg:px-6">
        <div className="flex w-full items-center justify-between gap-2 border-b border-gray-200 px-3 py-3 sm:gap-4 lg:justify-normal lg:border-b-0 lg:px-0 lg:py-4 dark:border-gray-800">
          <button
            aria-label="Toggle sidebar"
            className={`z-99999 flex h-10 w-10 items-center justify-center rounded-lg border-gray-200 text-gray-500 lg:h-11 lg:w-11 lg:border dark:border-gray-800 dark:text-gray-400 ${
              isMobileOpen ? "bg-gray-100 dark:bg-gray-800" : ""
            }`}
            onClick={handleToggle}
            type="button"
          >
            {isMobileOpen ? <CloseMenuIcon /> : <HamburgerIcon />}
          </button>

          <Link className="lg:hidden" href="/owner-v2">
            <span className="block text-sm font-semibold text-gray-900 dark:text-white">
              AI Business
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              Owner Admin v2
            </span>
          </Link>

          <button
            aria-label="Toggle owner actions"
            className={`z-99999 flex h-10 w-10 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 lg:hidden dark:text-gray-400 dark:hover:bg-gray-800 ${
              isApplicationMenuOpen ? "bg-gray-100 dark:bg-gray-800" : ""
            }`}
            onClick={() => setApplicationMenuOpen((value) => !value)}
            type="button"
          >
            <DotsIcon />
          </button>

          <div className="relative hidden lg:block" ref={searchRef}>
            <form onSubmit={submitSearch}>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2">
                  <SearchIcon />
                </span>
                <input
                  className="shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10 h-11 w-full rounded-lg border border-gray-200 bg-transparent py-2.5 pl-12 pr-14 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-hidden focus:ring-3 xl:w-[430px] dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  placeholder="Search or type command..."
                  type="text"
                  value={searchQuery}
                />
                <button
                  className="absolute right-2.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 px-[7px] py-[4.5px] text-xs text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400"
                  type="submit"
                >
                  <span>⌘</span>
                  <span>K</span>
                </button>
              </div>
            </form>

            {searchFocused ? (
              <div className="shadow-theme-lg absolute left-0 mt-3 w-[430px] rounded-2xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-dark">
                {filteredActions.length ? (
                  <ul className="max-h-[320px] overflow-y-auto custom-scrollbar">
                    {filteredActions.map((item) => (
                      <li key={item.href}>
                        <Link
                          className="flex rounded-lg px-3 py-3 hover:bg-gray-100 dark:hover:bg-white/5"
                          href={item.href}
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
                              {item.label}
                            </span>
                            <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                              {item.detail}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                    ไม่พบเมนูที่ตรงกับคำค้นหา
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={`${
            isApplicationMenuOpen ? "flex" : "hidden"
          } shadow-theme-md w-full items-center justify-between gap-4 px-5 py-4 lg:flex lg:justify-end lg:px-0 lg:shadow-none`}
          ref={actionAreaRef}
        >
          <div className="flex w-full items-center gap-2 lg:w-auto">
            <OwnerV2MobileAction href="/owner-v2">Workbench</OwnerV2MobileAction>
            <OwnerV2MobileAction href="/owner-v2/stores">ร้านค้า</OwnerV2MobileAction>
            <OwnerV2MobileAction href="/owner-v2/ops">Ops</OwnerV2MobileAction>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggleButton />
            <div className="relative">
              <button
                aria-label="Open operational notifications"
                className="hover:text-dark-900 relative flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                onClick={() => {
                  setNotificationOpen((value) => !value);
                  setUserMenuOpen(false);
                }}
                type="button"
              >
                {opsCount > 0 ? (
                  <span className="absolute right-0 top-0.5 z-1 flex h-2 w-2 rounded-full bg-orange-400">
                    <span className="absolute -z-1 inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                  </span>
                ) : null}
                <BellIcon className="h-5 w-5" />
              </button>

              {isNotificationOpen ? (
                <OperationalNotificationDropdown
                  onClose={() => setNotificationOpen(false)}
                  state={workbenchState}
                />
              ) : null}
            </div>

            <div className="relative">
              <button
                className="flex items-center text-gray-700 dark:text-gray-400"
                onClick={(event) => {
                  event.stopPropagation();
                  setUserMenuOpen((value) => !value);
                  setNotificationOpen(false);
                }}
                type="button"
              >
                <span className="mr-3 flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-sm font-semibold text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                  AD
                </span>
                <span className="mr-1 hidden font-medium text-theme-sm sm:block">
                  ผู้ดูแล
                </span>
                <ChevronDownIcon
                  className={`h-5 w-5 stroke-gray-500 transition-transform duration-200 dark:stroke-gray-400 ${
                    isUserMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isUserMenuOpen ? (
                <div className="shadow-theme-lg absolute right-0 mt-[17px] flex w-[260px] flex-col rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-dark">
                  <div>
                    <span className="block font-medium text-gray-700 text-theme-sm dark:text-gray-400">
                      ผู้ดูแล AI Business
                    </span>
                    <span className="mt-0.5 block text-theme-xs text-gray-500 dark:text-gray-400">
                      Owner Admin v2
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1 border-b border-gray-200 pb-3 pt-4 dark:border-gray-800">
                    <li>
                      <OwnerV2UserMenuLink href="/owner-v2">
                        Workbench
                      </OwnerV2UserMenuLink>
                    </li>
                    <li>
                      <OwnerV2UserMenuLink href="/owner-v2/stores">
                        ร้านค้า
                      </OwnerV2UserMenuLink>
                    </li>
                    <li>
                      <OwnerV2UserMenuLink href="/owner-v2/ops">
                        Operations
                      </OwnerV2UserMenuLink>
                    </li>
                  </ul>
                  <button
                    className="mt-3 flex items-center gap-3 rounded-lg px-3 py-2 font-medium text-gray-700 text-theme-sm hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
                    onClick={() => void logout()}
                    type="button"
                  >
                    ออกจากระบบ
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function OperationalNotificationDropdown({
  onClose,
  state,
}: {
  onClose: () => void;
  state: HeaderWorkbenchState;
}) {
  return (
    <div className="shadow-theme-lg absolute -right-[240px] mt-[17px] flex h-[480px] w-[350px] flex-col rounded-2xl border border-gray-200 bg-white p-3 sm:w-[361px] lg:right-0 dark:border-gray-800 dark:bg-gray-dark">
      <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-3 dark:border-gray-800">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Operations
        </h2>
        <div className="flex items-center gap-2">
          {state.status === "success" ? (
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-white/5 dark:text-gray-300">
              {state.data.ops.warning_count + state.data.ops.critical_count} alerts
            </span>
          ) : null}
          <button
            aria-label="Close operational notifications"
            className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            onClick={onClose}
            type="button"
          >
            <CloseMenuIcon />
          </button>
        </div>
      </div>

      <div className="custom-scrollbar flex h-auto flex-col overflow-y-auto">
        {state.status === "loading" || state.status === "idle" ? (
          <MiniSkeleton />
        ) : null}

        {state.status === "error" ? (
          <NotificationMessage
            detail={`${state.message} กรุณาเปิดหน้า Operations เพื่อตรวจสถานะเต็ม`}
            icon={<AlertIcon className="h-5 w-5" />}
            tone="error"
            title="โหลดสถานะไม่สำเร็จ"
          />
        ) : null}

        {state.status === "success" ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <NotificationMetric
                label="Warnings"
                value={state.data.ops.warning_count.toString()}
              />
              <NotificationMetric
                label="Critical"
                value={state.data.ops.critical_count.toString()}
              />
            </div>

            <div className="mt-3 space-y-2">
              {state.data.tenants
                .filter((tenant) => needsAttention(tenant))
                .slice(0, 5)
                .map((tenant) => (
                  <TenantNoticeItem key={tenant.id} tenant={tenant} />
                ))}

              {state.data.tenants.every((tenant) => !needsAttention(tenant)) ? (
                <NotificationMessage
                  detail="ร้านที่โหลดใน workbench ไม่มี critical signal หรือ setup blocker เด่นตอนนี้"
                  icon={<CheckCircleIcon className="h-5 w-5" />}
                  tone="success"
                  title="สถานะรวมดูปกติ"
                />
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
        <Link
          className="flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
          href="/owner-v2/ops"
        >
          เปิด Operations
        </Link>
      </div>
    </div>
  );
}

function TenantNoticeItem({ tenant }: { tenant: OwnerV2Tenant }) {
  const tone = tenant.health.critical_business_signals
    ? "error"
    : tenant.ready
      ? "warning"
      : "info";
  const toneClass = {
    error: "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-400",
    info: "bg-blue-light-50 text-blue-light-600 dark:bg-blue-light-500/15 dark:text-blue-light-400",
    warning:
      "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400",
  }[tone];

  return (
    <Link
      className="flex gap-3 rounded-lg border-b border-gray-100 p-3 hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-white/5"
      href={`/owner-v2/stores/${encodeURIComponent(tenant.id)}`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${toneClass}`}
      >
        {tone === "error" ? (
          <AlertIcon className="h-5 w-5" />
        ) : (
          <InfoIcon className="h-5 w-5" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-gray-800 dark:text-white/90">
          {tenant.name}
        </span>
        <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
          {tenant.next_action?.detail ??
            `${tenant.completed_steps}/${tenant.total_steps} setup steps`}
        </span>
      </span>
    </Link>
  );
}

function NotificationMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function NotificationMessage({
  detail,
  icon,
  title,
  tone,
}: {
  detail: string;
  icon: ReactNode;
  title: string;
  tone: "success" | "error";
}) {
  const toneClass =
    tone === "success"
      ? "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400"
      : "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-400";
  return (
    <div className="flex gap-3 rounded-lg p-3">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${toneClass}`}
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
          {title}
        </span>
        <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
          {detail}
        </span>
      </span>
    </div>
  );
}

function MiniSkeleton() {
  return (
    <div className="animate-pulse space-y-3 p-2">
      <div className="h-12 rounded-lg bg-gray-100 dark:bg-gray-800" />
      <div className="h-12 rounded-lg bg-gray-100 dark:bg-gray-800" />
      <div className="h-12 rounded-lg bg-gray-100 dark:bg-gray-800" />
    </div>
  );
}

function OwnerV2MobileAction({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) {
  return (
    <Link
      className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5 lg:hidden"
      href={href}
    >
      {children}
    </Link>
  );
}

function OwnerV2UserMenuLink({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) {
  return (
    <Link
      className="flex items-center gap-3 rounded-lg px-3 py-2 font-medium text-gray-700 text-theme-sm hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
      href={href}
    >
      {children}
    </Link>
  );
}

function needsAttention(tenant: OwnerV2Tenant) {
  return (
    !tenant.ready ||
    tenant.health.critical_business_signals > 0 ||
    tenant.health.latest_report_status === "failed" ||
    tenant.health.latest_notification_run_status === "failed"
  );
}

function getTenantIdFromPathname(pathname: string) {
  const match = pathname.match(/^\/owner-v2\/stores\/([^/]+)/);
  if (!match || match[1] === "new") {
    return null;
  }
  return decodeURIComponent(match[1]);
}

function HamburgerIcon() {
  return (
    <svg
      className="fill-current"
      fill="none"
      height="12"
      viewBox="0 0 16 12"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        clipRule="evenodd"
        d="M0.583252 1C0.583252 0.585788 0.919038 0.25 1.33325 0.25H14.6666C15.0808 0.25 15.4166 0.585786 15.4166 1C15.4166 1.41421 15.0808 1.75 14.6666 1.75L1.33325 1.75C0.919038 1.75 0.583252 1.41422 0.583252 1ZM0.583252 11C0.583252 10.5858 0.919038 10.25 1.33325 10.25L14.6666 10.25C15.0808 10.25 15.4166 10.5858 15.4166 11C15.4166 11.4142 15.0808 11.75 14.6666 11.75L1.33325 11.75C0.919038 11.75 0.583252 11.4142 0.583252 11ZM1.33325 5.25C0.919038 5.25 0.583252 5.58579 0.583252 6C0.583252 6.41421 0.919038 6.75 1.33325 6.75L7.99992 6.75C8.41413 6.75 8.74992 6.41421 8.74992 6C8.74992 5.58579 8.41413 5.25 7.99992 5.25L1.33325 5.25Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

function CloseMenuIcon() {
  return (
    <svg
      className="fill-current"
      fill="none"
      height="24"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        clipRule="evenodd"
        d="M6.21967 7.28131C5.92678 6.98841 5.92678 6.51354 6.21967 6.22065C6.51256 5.92775 6.98744 5.92775 7.28033 6.22065L11.999 10.9393L16.7176 6.22078C17.0105 5.92789 17.4854 5.92788 17.7782 6.22078C18.0711 6.51367 18.0711 6.98855 17.7782 7.28144L13.0597 12L17.7782 16.7186C18.0711 17.0115 18.0711 17.4863 17.7782 17.7792C17.4854 18.0721 17.0105 18.0721 16.7176 17.7792L11.999 13.0607L7.28033 17.7794C6.98744 18.0722 6.51256 18.0722 6.21967 17.7794C5.92678 17.4865 5.92678 17.0116 6.21967 16.7187L10.9384 12L6.21967 7.28131Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg
      className="fill-current"
      fill="none"
      height="24"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        clipRule="evenodd"
        d="M5.99902 10.4951C6.82745 10.4951 7.49902 11.1667 7.49902 11.9951V12.0051C7.49902 12.8335 6.82745 13.5051 5.99902 13.5051C5.1706 13.5051 4.49902 12.8335 4.49902 12.0051V11.9951C4.49902 11.1667 5.1706 10.4951 5.99902 10.4951ZM17.999 10.4951C18.8275 10.4951 19.499 11.1667 19.499 11.9951V12.0051C19.499 12.8335 18.8275 13.5051 17.999 13.5051C17.1706 13.5051 16.499 12.8335 16.499 12.0051V11.9951C16.499 11.1667 17.1706 10.4951 17.999 10.4951ZM13.499 11.9951C13.499 11.1667 12.8275 10.4951 11.999 10.4951C11.1706 10.4951 10.499 11.1667 10.499 11.9951V12.0051C10.499 12.8335 11.1706 13.5051 11.999 13.5051C12.8275 13.5051 13.499 12.8335 13.499 12.0051V11.9951Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className="fill-gray-500 dark:fill-gray-400"
      fill="none"
      height="20"
      viewBox="0 0 20 20"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        clipRule="evenodd"
        d="M3.04175 9.37363C3.04175 5.87693 5.87711 3.04199 9.37508 3.04199C12.8731 3.04199 15.7084 5.87693 15.7084 9.37363C15.7084 12.8703 12.8731 15.7053 9.37508 15.7053C5.87711 15.7053 3.04175 12.8703 3.04175 9.37363ZM9.37508 1.54199C5.04902 1.54199 1.54175 5.04817 1.54175 9.37363C1.54175 13.6991 5.04902 17.2053 9.37508 17.2053C11.2674 17.2053 13.003 16.5344 14.357 15.4176L17.177 18.238C17.4699 18.5309 17.9448 18.5309 18.2377 18.238C18.5306 17.9451 18.5306 17.4703 18.2377 17.1774L15.418 14.3573C16.5365 13.0033 17.2084 11.2669 17.2084 9.37363C17.2084 5.04817 13.7011 1.54199 9.37508 1.54199Z"
        fill=""
        fillRule="evenodd"
      />
    </svg>
  );
}
