import type { Metadata } from "next";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2FlowAccountSetup from "@/components/owner-v2/OwnerV2FlowAccountSetup";

export const metadata: Metadata = {
  title: "FlowAccount Sandbox | Owner Admin v2",
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
  return (
    <OwnerV2Shell
      subtitle="บันทึก Client Credentials และทดสอบ FlowAccount OpenAPI sandbox แบบไม่แสดงค่าลับ"
      title="FlowAccount Sandbox"
    >
      <OwnerV2FlowAccountSetup tenantId={tenantId} />
    </OwnerV2Shell>
  );
}
