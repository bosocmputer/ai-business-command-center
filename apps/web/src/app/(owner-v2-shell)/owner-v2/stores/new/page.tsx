import { Metadata } from "next";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2NewTenant from "@/components/owner-v2/OwnerV2NewTenant";

export const metadata: Metadata = {
  title: "เพิ่มร้าน | Owner Admin v2",
};

export default function OwnerV2NewStorePage() {
  return (
    <OwnerV2Shell
      subtitle="สร้างร้านด้วย dry-run ก่อนเสมอ เพื่อเห็น tenant id, dashboard path และ viewer ก่อนบันทึกจริง"
      title="เพิ่มร้านใหม่"
    >
      <OwnerV2NewTenant />
    </OwnerV2Shell>
  );
}
