"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSidebar } from "@/context/SidebarContext";
import {
  BellIcon,
  ChevronDownIcon,
  GridIcon,
  GroupIcon,
  HorizontaLDots,
  PlugInIcon,
} from "@/icons";

type OwnerV2NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  subItems?: Array<{ name: string; path: string }>;
};

type OwnerV2NavSection = {
  label: string;
  items: OwnerV2NavItem[];
};

const baseNavSections: OwnerV2NavSection[] = [
  {
    label: "เริ่มงาน",
    items: [
      {
        icon: <GridIcon />,
        name: "ภาพรวมวันนี้",
        path: "/owner-v2",
      },
      {
        icon: <BellIcon />,
        name: "ศูนย์ตรวจระบบ",
        path: "/owner-v2/ops",
      },
    ],
  },
  {
    label: "ร้านค้า",
    items: [
      {
        icon: <GroupIcon />,
        name: "จัดการร้านค้า",
        subItems: [
          { name: "ร้านทั้งหมด", path: "/owner-v2/stores" },
          { name: "เพิ่มร้านใหม่", path: "/owner-v2/stores/new" },
        ],
      },
    ],
  },
  {
    label: "ระบบกลาง",
    items: [
      {
        icon: <PlugInIcon />,
        name: "ตั้งค่าระบบ",
        path: "/owner-v2/system",
      },
    ],
  },
];

export default function OwnerV2Sidebar() {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const pathname = usePathname();
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>(
    {},
  );
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const navSections = baseNavSections;

  const isActive = useCallback(
    (path: string) => {
      if (path === "/owner-v2") {
        return pathname === path;
      }
      return pathname === path || pathname.startsWith(`${path}/`);
    },
    [pathname],
  );

  const isStoreListActive = useCallback(() => {
    return pathname === "/owner-v2/stores";
  }, [pathname]);

  const isSubItemActive = useCallback(
    (path: string) => {
      if (path === "/owner-v2/stores") {
        return isStoreListActive();
      }
      return pathname === path;
    },
    [isStoreListActive, pathname],
  );

  useEffect(() => {
    const matchedSubmenu = navSections
      .flatMap((section, sectionIndex) =>
        section.items.map((nav, itemIndex) => ({
          key: menuKey(sectionIndex, itemIndex),
          nav,
        })),
      )
      .find(({ nav }) =>
        nav.subItems?.some((item) => isSubItemActive(item.path)),
      );
    setOpenSubmenu(matchedSubmenu?.key ?? null);
  }, [isSubItemActive]);

  useEffect(() => {
    if (openSubmenu === null) {
      return;
    }
    const element = subMenuRefs.current[openSubmenu];
    if (element) {
      setSubMenuHeight((current) => ({
        ...current,
        [openSubmenu]: element.scrollHeight,
      }));
    }
  }, [openSubmenu]);

  const sidebarExpanded = isExpanded || isHovered || isMobileOpen;

  return (
    <aside
      className={`sidebar fixed left-0 top-0 z-9999 flex h-screen flex-col overflow-y-hidden border-r border-gray-200 bg-white px-5 text-gray-900 transition-all duration-300 ease-in-out dark:border-gray-800 dark:bg-black lg:static ${
        sidebarExpanded ? "w-[290px]" : "w-[90px]"
      } ${isMobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`flex items-center gap-2 pb-7 pt-8 ${
          sidebarExpanded ? "justify-between" : "justify-center"
        }`}
      >
        <Link href="/owner-v2" className="min-w-0">
          {sidebarExpanded ? (
            <span>
              <span className="block text-lg font-semibold text-gray-900 dark:text-white">
                AI Business
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                ศูนย์จัดการร้าน
              </span>
            </span>
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-semibold text-white">
              AI
            </span>
          )}
        </Link>
      </div>

      <div className="flex flex-col overflow-y-auto duration-300 ease-linear no-scrollbar">
        <nav className="mb-6">
          <div>
            {navSections.map((section, sectionIndex) => (
              <div
                className={sectionIndex === 0 ? undefined : "mt-6"}
                key={section.label}
              >
                <h2
                  className={`mb-4 flex text-xs uppercase leading-[20px] text-gray-400 ${
                    sidebarExpanded ? "justify-start" : "justify-center"
                  }`}
                >
                  {sidebarExpanded ? section.label : <HorizontaLDots />}
                </h2>
                <ul className="flex flex-col gap-4">
                  {section.items.map((nav, itemIndex) => {
                    const key = menuKey(sectionIndex, itemIndex);
                    const hasActiveSubItem = Boolean(
                      nav.subItems?.some((item) => isSubItemActive(item.path)),
                    );
                    const active = nav.path
                      ? isActive(nav.path)
                      : hasActiveSubItem;
                    return (
                      <li key={nav.name}>
                        {nav.subItems ? (
                          <button
                            aria-expanded={openSubmenu === key}
                            aria-label={sidebarExpanded ? undefined : nav.name}
                            className={`menu-item group cursor-pointer ${
                              active ? "menu-item-active" : "menu-item-inactive"
                            } ${
                              sidebarExpanded
                                ? "lg:justify-start"
                                : "lg:justify-center"
                            }`}
                            onClick={() =>
                              setOpenSubmenu((current) =>
                                current === key ? null : key,
                              )
                            }
                            title={sidebarExpanded ? undefined : nav.name}
                            type="button"
                          >
                            <span
                              className={
                                active
                                  ? "menu-item-icon-active"
                                  : "menu-item-icon-inactive"
                              }
                            >
                              {nav.icon}
                            </span>
                            {sidebarExpanded ? (
                              <span className="menu-item-text">{nav.name}</span>
                            ) : null}
                            {sidebarExpanded ? (
                              <ChevronDownIcon
                                className={`menu-item-arrow h-5 w-5 transition-transform duration-200 ${
                                  openSubmenu === key
                                    ? "menu-item-arrow-active"
                                    : "menu-item-arrow-inactive"
                                }`}
                              />
                            ) : null}
                          </button>
                        ) : nav.path ? (
                          <Link
                            aria-current={active ? "page" : undefined}
                            aria-label={sidebarExpanded ? undefined : nav.name}
                            className={`menu-item group ${
                              active ? "menu-item-active" : "menu-item-inactive"
                            } ${
                              sidebarExpanded
                                ? "lg:justify-start"
                                : "lg:justify-center"
                            }`}
                            href={nav.path}
                            title={sidebarExpanded ? undefined : nav.name}
                          >
                            <span
                              className={
                                active
                                  ? "menu-item-icon-active"
                                  : "menu-item-icon-inactive"
                              }
                            >
                              {nav.icon}
                            </span>
                            {sidebarExpanded ? (
                              <span className="menu-item-text">{nav.name}</span>
                            ) : null}
                          </Link>
                        ) : null}

                        {nav.subItems && sidebarExpanded ? (
                          <div
                            className="overflow-hidden transition-all duration-300"
                            ref={(element) => {
                              subMenuRefs.current[key] = element;
                            }}
                            style={{
                              height:
                                openSubmenu === key
                                  ? `${subMenuHeight[key] ?? 0}px`
                                  : "0px",
                            }}
                          >
                            <ul className="ml-9 mt-2 space-y-1">
                              {nav.subItems.map((item) => {
                                const activeSubItem = isSubItemActive(
                                  item.path,
                                );
                                return (
                                  <li key={item.path}>
                                    <Link
                                      aria-current={
                                        activeSubItem ? "page" : undefined
                                      }
                                      className={`menu-dropdown-item ${
                                        activeSubItem
                                          ? "menu-dropdown-item-active"
                                          : "menu-dropdown-item-inactive"
                                      }`}
                                      href={item.path}
                                    >
                                      {item.name}
                                    </Link>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
      </div>
    </aside>
  );
}

function menuKey(sectionIndex: number, itemIndex: number) {
  return `${sectionIndex}:${itemIndex}`;
}
