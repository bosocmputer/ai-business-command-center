import type { Metadata } from "next";
import OwnerPortal from "@/components/owner/OwnerPortal";

export const metadata: Metadata = {
  title: "ทดสอบรายงาน | AI Business Owner",
  description: "เครื่องมือ diagnostic สำหรับรันรายงานเมื่อมาจาก readiness checklist",
};

export default function OwnerReportsPage() {
  return <OwnerPortal section="reports" />;
}
