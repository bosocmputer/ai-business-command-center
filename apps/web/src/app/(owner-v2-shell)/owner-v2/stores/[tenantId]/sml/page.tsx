import type { Metadata } from "next";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2SmlSetup from "@/components/owner-v2/OwnerV2SmlSetup";

export const metadata: Metadata = {
  title: "SML JavaWS | Owner Admin v2",
};

type OwnerV2StoreSmlPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function OwnerV2StoreSmlPage({
  params,
}: OwnerV2StoreSmlPageProps) {
  const { tenantId } = await params;
  return (
    <OwnerV2Shell
      subtitle="ตั้งค่า SML JavaWS, ค้นหา database และทดสอบก่อนเปิดรายงานหรือแผนแจ้งเตือน"
      title="SML JavaWS"
    >
      <OwnerV2SmlSetup tenantId={tenantId} />
    </OwnerV2Shell>
  );
}
