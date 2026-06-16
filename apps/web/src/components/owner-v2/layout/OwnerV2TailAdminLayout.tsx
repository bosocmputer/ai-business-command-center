"use client";

import type React from "react";
import Backdrop from "@/layout/Backdrop";
import OwnerV2Header from "./OwnerV2Header";
import OwnerV2Sidebar from "./OwnerV2Sidebar";

export default function OwnerV2TailAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      <OwnerV2Sidebar />
      <Backdrop />
      <div className="relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
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
