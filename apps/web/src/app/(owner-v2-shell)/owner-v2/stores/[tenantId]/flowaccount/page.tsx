import type { Metadata } from "next";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2FlowAccountSetup from "@/components/owner-v2/OwnerV2FlowAccountSetup";

export const metadata: Metadata = {
  title: "ทดสอบเชื่อมต่อ FlowAccount | Owner Admin v2",
};

type OwnerV2StoreFlowAccountPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function OwnerV2StoreFlowAccountPage({
  params,
}: OwnerV2StoreFlowAccountPageProps) {
  const { tenantId } = await params;
  const storeHref = `/owner-v2/stores/${encodeURIComponent(tenantId)}`;
  return (
    <OwnerV2Shell
      breadcrumbs={[
        { href: "/owner-v2/stores", label: "ร้านค้า" },
        { href: storeHref, label: "ร้านนี้" },
        { label: "FlowAccount" },
      ]}
      subtitle="ตั้งค่าข้อมูลเชื่อมต่อแบบทดสอบโดยไม่แสดงค่าลับที่บันทึกไว้"
      title="ทดสอบเชื่อมต่อ FlowAccount"
    >
      <OwnerV2FlowAccountSetup tenantId={tenantId} />
    </OwnerV2Shell>
  );
}
