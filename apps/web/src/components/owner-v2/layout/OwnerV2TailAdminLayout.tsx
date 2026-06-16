"use client";

import type React from "react";
import Backdrop from "@/layout/Backdrop";
import { useSidebar } from "@/context/SidebarContext";
import OwnerV2Header from "./OwnerV2Header";
import OwnerV2Sidebar from "./OwnerV2Sidebar";

export default function OwnerV2TailAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();
  const mainContentMargin = isMobileOpen
    ? "ml-0"
    : isExpanded || isHovered
      ? "lg:ml-[290px]"
      : "lg:ml-[90px]";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <OwnerV2Sidebar />
      <Backdrop />
      <div
        className={`flex min-h-screen flex-1 flex-col transition-all duration-300 ease-in-out ${mainContentMargin}`}
      >
        <OwnerV2Header />
        <main>
          <div className="mx-auto max-w-(--breakpoint-2xl) p-4 md:p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
