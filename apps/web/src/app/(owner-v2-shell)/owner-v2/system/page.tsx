import { Metadata } from "next";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2System from "@/components/owner-v2/OwnerV2System";

export const metadata: Metadata = {
  title: "System | Owner Admin v2",
};

export default function OwnerV2SystemPage() {
  return (
    <OwnerV2Shell
      subtitle="ดูสถานะ runtime, encrypted store, report signing, worker token และ bootstrap โดยไม่แสดง secret value"
      title="System Readiness"
    >
      <OwnerV2System />
    </OwnerV2Shell>
  );
}
