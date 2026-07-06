import type { Metadata } from "next";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2ReportPermissions from "@/components/owner-v2/OwnerV2ReportPermissions";

export const metadata: Metadata = {
  title: "สิทธิ์รายงาน | Owner Admin v2",
};

type OwnerV2StorePermissionsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function OwnerV2StorePermissionsPage({
  params,
}: OwnerV2StorePermissionsPageProps) {
  const { tenantId } = await params;
  const storeHref = `/owner-v2/stores/${encodeURIComponent(tenantId)}`;
  return (
    <OwnerV2Shell
      breadcrumbs={[
        { href: "/owner-v2/stores", label: "ร้านค้า" },
        { href: storeHref, label: "ร้านนี้" },
        { label: "สิทธิ์รายงาน" },
      ]}
      subtitle="ตรวจบทบาทและสิทธิ์รายงานของผู้รับแจ้งเตือน"
      title="สิทธิ์รายงาน"
    >
      <OwnerV2ReportPermissions tenantId={tenantId} />
    </OwnerV2Shell>
  );
}
