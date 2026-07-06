import type { Metadata } from "next";
import { Suspense } from "react";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2StoreDetail from "@/components/owner-v2/OwnerV2StoreDetail";
import { OwnerV2StoreDetailFallback } from "@/components/owner-v2/OwnerV2StoreDetailFallback";

export const metadata: Metadata = {
  title: "ข้อมูลร้าน | Owner Admin v2",
};

type OwnerV2StorePageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function OwnerV2StorePage({
  params,
}: OwnerV2StorePageProps) {
  const { tenantId } = await params;
  return (
    <OwnerV2Shell
      subtitle="ข้อมูลร้าน สถานะความพร้อม และขั้นตอนที่ควรทำต่อของร้านนี้"
      title="ข้อมูลร้าน"
    >
      {/* OwnerV2StoreDetail reads useSearchParams (?step=) so it must sit inside
          a Suspense boundary, otherwise Next.js cannot statically prerender the
          page and some clients render a blank page after hydration. */}
      <Suspense fallback={<OwnerV2StoreDetailFallback />}>
        <OwnerV2StoreDetail tenantId={tenantId} />
      </Suspense>
    </OwnerV2Shell>
  );
}
