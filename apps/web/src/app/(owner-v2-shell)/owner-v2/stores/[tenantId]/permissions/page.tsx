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
  return (
    <OwnerV2Shell
      subtitle="ตรวจ role และสิทธิ์รายงานของผู้รับแจ้งเตือน"
      title="สิทธิ์รายงาน"
    >
      <OwnerV2ReportPermissions tenantId={tenantId} />
    </OwnerV2Shell>
  );
}
