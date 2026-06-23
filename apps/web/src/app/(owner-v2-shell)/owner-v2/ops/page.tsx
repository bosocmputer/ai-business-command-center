import { Metadata } from "next";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2Ops from "@/components/owner-v2/OwnerV2Ops";

export const metadata: Metadata = {
  title: "ตรวจระบบและ Audit | Owner Admin v2",
};

export default function OwnerV2OpsPage() {
  return (
    <OwnerV2Shell
      subtitle="รวม JavaWS, worker, Telegram, รายงานหนัก และ audit log สำหรับตรวจสถานะก่อนรอบแจ้งเตือน"
      title="ตรวจระบบและ Audit"
    >
      <OwnerV2Ops />
    </OwnerV2Shell>
  );
}
