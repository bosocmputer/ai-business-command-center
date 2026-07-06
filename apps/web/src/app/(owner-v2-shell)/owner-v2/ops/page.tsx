import { Metadata } from "next";
import { Suspense } from "react";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2Ops from "@/components/owner-v2/OwnerV2Ops";

export const metadata: Metadata = {
  title: "ศูนย์ตรวจระบบ | Owner Admin v2",
};

export default function OwnerV2OpsPage() {
  return (
    <OwnerV2Shell
      breadcrumbs={[{ label: "ศูนย์ตรวจระบบ" }]}
      subtitle="ดูสถานะส่ง LINE, AI CEO, รายงาน และงานระบบ พร้อมคำแนะนำว่าควรแก้อะไรก่อน"
      title="ศูนย์ตรวจระบบ"
    >
      <Suspense fallback={<OwnerV2OpsFallback />}>
        <OwnerV2Ops />
      </Suspense>
    </OwnerV2Shell>
  );
}

function OwnerV2OpsFallback() {
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <div className="h-10 w-48 animate-pulse rounded-lg bg-gray-100 dark:bg-white/[0.03]" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            className="h-44 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
            key={index}
          />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
    </div>
  );
}
