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
  const storeHref = `/owner-v2/stores/${encodeURIComponent(tenantId)}`;
  return (
    <OwnerV2Shell
      breadcrumbs={[
        { href: "/owner-v2/stores", label: "ร้านค้า" },
        { href: storeHref, label: "ร้านนี้" },
        { label: "SML JavaWS" },
      ]}
      subtitle="ตั้งค่า SML JavaWS, ค้นหาฐานข้อมูล และทดสอบก่อนเปิดรายงานหรือแผนแจ้งเตือน"
      title="SML JavaWS"
    >
      <OwnerV2SmlSetup tenantId={tenantId} />
    </OwnerV2Shell>
  );
}
