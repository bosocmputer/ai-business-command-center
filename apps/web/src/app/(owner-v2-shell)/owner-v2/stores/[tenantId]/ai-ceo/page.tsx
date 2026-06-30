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
  return (
    <OwnerV2Shell
      subtitle="ตั้งค่า prompt, model, OpenRouter key และ dry-run ของ AI CEO ต่อร้าน"
      title="AI CEO / Business Advisor"
    >
      <OwnerV2AiCeoSetup tenantId={tenantId} />
    </OwnerV2Shell>
  );
}
