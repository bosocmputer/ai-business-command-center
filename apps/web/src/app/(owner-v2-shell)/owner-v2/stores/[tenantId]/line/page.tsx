import type { Metadata } from "next";
import OwnerV2LineSetup from "@/components/owner-v2/OwnerV2LineSetup";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";

export const metadata: Metadata = {
  title: "LINE OA | Owner Admin v2",
};

type OwnerV2StoreLinePageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function OwnerV2StoreLinePage({
  params,
}: OwnerV2StoreLinePageProps) {
  const { tenantId } = await params;
  const storeHref = `/owner-v2/stores/${encodeURIComponent(tenantId)}`;
  return (
    <OwnerV2Shell
      breadcrumbs={[
        { href: "/owner-v2/stores", label: "ร้านค้า" },
        { href: storeHref, label: "ร้านนี้" },
        { label: "LINE OA" },
      ]}
      subtitle="ตรวจสถานะ LINE OA และ target ของร้านนี้"
      title="LINE OA"
    >
      <OwnerV2LineSetup tenantId={tenantId} />
    </OwnerV2Shell>
  );
}
