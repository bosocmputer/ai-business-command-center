import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2AiCeoSetup from "@/components/owner-v2/OwnerV2AiCeoSetup";

export const metadata = {
  title: "AI CEO | Owner Admin v2",
};

type OwnerV2StoreAiCeoPageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function OwnerV2StoreAiCeoPage({
  params,
}: OwnerV2StoreAiCeoPageProps) {
  const { tenantId } = await params;
  const storeHref = `/owner-v2/stores/${encodeURIComponent(tenantId)}`;
  return (
    <OwnerV2Shell
      breadcrumbs={[
        { href: "/owner-v2/stores", label: "ร้านค้า" },
        { href: storeHref, label: "ร้านนี้" },
        { label: "AI CEO" },
      ]}
      subtitle="ตั้งค่าบทบาท โมเดล รหัส OpenRouter และทดสอบ AI CEO ก่อนเปิดส่งจริงของร้านนี้"
      title="AI CEO / Business Advisor"
    >
      <OwnerV2AiCeoSetup tenantId={tenantId} />
    </OwnerV2Shell>
  );
}
