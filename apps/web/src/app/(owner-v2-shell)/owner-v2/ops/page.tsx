import { Metadata } from "next";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2Ops from "@/components/owner-v2/OwnerV2Ops";

export const metadata: Metadata = {
  title: "Ops | Owner Admin v2",
};

export default function OwnerV2OpsPage() {
  return (
    <OwnerV2Shell
      subtitle="รวมงานที่ต้องดูจริง เช่น JavaWS failure, worker, Telegram ops และ heavy report โดยแยกออกจาก workflow เพิ่มร้าน"
      title="Operations"
    >
      <OwnerV2Ops />
    </OwnerV2Shell>
  );
}
