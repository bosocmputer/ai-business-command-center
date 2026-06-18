import { Metadata } from "next";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2Ops from "@/components/owner-v2/OwnerV2Ops";

export const metadata: Metadata = {
  title: "ตรวจระบบ | Owner Admin v2",
};

export default function OwnerV2OpsPage() {
  return (
    <OwnerV2Shell
      subtitle="รวมงานที่ต้องดูจริง เช่น JavaWS, worker, Telegram และรายงานหนัก โดยแยกออกจากขั้นตอนเพิ่มร้าน"
      title="ตรวจระบบ"
    >
      <OwnerV2Ops />
    </OwnerV2Shell>
  );
}
