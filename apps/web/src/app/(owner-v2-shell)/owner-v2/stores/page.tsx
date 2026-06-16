import { Metadata } from "next";
import { Suspense } from "react";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2Workbench from "@/components/owner-v2/OwnerV2Workbench";

export const metadata: Metadata = {
  title: "ร้านค้า | Owner Admin v2",
};

export default function OwnerV2StoresPage() {
  return (
    <OwnerV2Shell
      subtitle="เลือกร้าน ดู readiness และเปิดขั้นตอนที่ต้องทำต่อ"
      title="ร้านค้า"
    >
      <Suspense fallback={<OwnerV2StoresFallback />}>
        <OwnerV2Workbench />
      </Suspense>
    </OwnerV2Shell>
  );
}

function OwnerV2StoresFallback() {
  return (
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="h-[560px] animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      <div className="space-y-4">
        <div className="h-56 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
        <div className="h-80 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      </div>
    </div>
  );
}
