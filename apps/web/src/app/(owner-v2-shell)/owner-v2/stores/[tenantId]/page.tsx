import type { Metadata } from "next";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2StoreDetail from "@/components/owner-v2/OwnerV2StoreDetail";

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
      subtitle="ข้อมูลร้านและสถานะ readiness ของ tenant นี้"
      title="ข้อมูลร้าน"
    >
      <OwnerV2StoreDetail tenantId={tenantId} />
    </OwnerV2Shell>
  );
}
