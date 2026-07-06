import { Metadata } from "next";
import { Suspense } from "react";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2StoreList from "@/components/owner-v2/OwnerV2StoreList";

export const metadata: Metadata = {
  title: "ร้านค้า | Owner Admin v2",
};

export default function OwnerV2StoresPage() {
  return (
    <OwnerV2Shell
      breadcrumbs={[{ label: "ร้านค้า" }]}
      subtitle="ค้นหาร้าน ดูความพร้อม และเปิดงานถัดไปของแต่ละร้านโดยไม่ต้องกลับหน้าแรกก่อน"
      title="ร้านค้า"
    >
      <Suspense fallback={<OwnerV2StoresFallback />}>
        <OwnerV2StoreList />
      </Suspense>
    </OwnerV2Shell>
  );
}

function OwnerV2StoresFallback() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            className="h-32 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
            key={index}
          />
        ))}
      </div>
      <div className="h-[560px] animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
    </div>
  );
}
