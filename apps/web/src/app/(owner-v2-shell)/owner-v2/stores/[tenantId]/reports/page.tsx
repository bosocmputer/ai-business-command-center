import type { Metadata } from "next";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2Reports from "@/components/owner-v2/OwnerV2Reports";

export const metadata: Metadata = {
  title: "ทดสอบรายงาน | Owner Admin v2",
};

type OwnerV2StoreReportsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function OwnerV2StoreReportsPage({
  params,
}: OwnerV2StoreReportsPageProps) {
  const { tenantId } = await params;
  return (
    <OwnerV2Shell
      subtitle="ตรวจ report run ล่าสุดและหลักฐานก่อนเปิดแจ้งเตือน"
      title="ทดสอบรายงาน"
    >
      <OwnerV2Reports tenantId={tenantId} />
    </OwnerV2Shell>
  );
}
