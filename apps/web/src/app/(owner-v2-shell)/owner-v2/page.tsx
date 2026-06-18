import { Metadata } from "next";
import { Suspense } from "react";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2Workbench from "@/components/owner-v2/OwnerV2Workbench";

export const metadata: Metadata = {
  title: "เริ่มงานร้านค้า | AI Business",
};

export default function OwnerV2Page() {
  return (
    <OwnerV2Shell
      subtitle="เลือกหรือเพิ่มร้าน แล้วทำขั้นตอนถัดไปให้พร้อมส่งรายงานจริงโดยไม่ต้องเปิดข้อมูลทั้งระบบพร้อมกัน"
      title="เริ่มงานร้านค้า"
    >
      <Suspense fallback={<OwnerV2WorkbenchFallback />}>
        <OwnerV2Workbench />
      </Suspense>
    </OwnerV2Shell>
  );
}

function OwnerV2WorkbenchFallback() {
  return (
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="h-[560px] animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      <div className="space-y-4">
        <div className="h-56 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
        <div className="h-80 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      </div>
    </div>
  );
}
