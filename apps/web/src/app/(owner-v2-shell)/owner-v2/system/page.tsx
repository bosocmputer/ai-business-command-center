import { Metadata } from "next";
import { OwnerV2Shell } from "@/components/owner-v2/OwnerV2Shell";
import OwnerV2System from "@/components/owner-v2/OwnerV2System";

export const metadata: Metadata = {
  title: "ตั้งค่าระบบ | Owner Admin v2",
};

export default function OwnerV2SystemPage() {
  return (
    <OwnerV2Shell
      subtitle="ตรวจเฉพาะสถานะระบบกลางที่ผู้ดูแลต้องรู้ โดยไม่แสดงค่าลับ, รหัสตรวจ, URL เต็ม หรือตำแหน่งไฟล์บนเครื่องแม่ข่าย"
      title="ตั้งค่าระบบ"
    >
      <OwnerV2System />
    </OwnerV2Shell>
  );
}
