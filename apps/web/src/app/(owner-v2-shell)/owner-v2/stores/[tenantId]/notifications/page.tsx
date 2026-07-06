import type { Metadata } from "next";
import OwnerV2NotificationSetup from "@/components/owner-v2/OwnerV2NotificationSetup";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";

export const metadata: Metadata = {
  title: "แผนแจ้งเตือน | Owner Admin v2",
};

type OwnerV2StoreNotificationsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function OwnerV2StoreNotificationsPage({
  params,
}: OwnerV2StoreNotificationsPageProps) {
  const { tenantId } = await params;
  const storeHref = `/owner-v2/stores/${encodeURIComponent(tenantId)}`;
  return (
    <OwnerV2Shell
      breadcrumbs={[
        { href: "/owner-v2/stores", label: "ร้านค้า" },
        { href: storeHref, label: "ร้านนี้" },
        { label: "แผนแจ้งเตือน" },
      ]}
      subtitle="ตรวจแผนแจ้งเตือนและรอบถัดไปของร้านนี้"
      title="แผนแจ้งเตือน"
    >
      <OwnerV2NotificationSetup tenantId={tenantId} />
    </OwnerV2Shell>
  );
}
