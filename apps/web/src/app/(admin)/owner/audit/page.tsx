import type { Metadata } from "next";
import OwnerPortal from "@/components/owner/OwnerPortal";

export const metadata: Metadata = {
  title: "ประวัติระบบ | AI Business Owner",
  description: "ตรวจรอบรายงาน การส่ง LINE และ audit ล่าสุด",
};

export default function OwnerAuditPage() {
  return <OwnerPortal section="audit" />;
}
