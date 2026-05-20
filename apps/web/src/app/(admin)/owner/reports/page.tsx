import type { Metadata } from "next";
import OwnerPortal from "@/components/owner/OwnerPortal";

export const metadata: Metadata = {
  title: "รายงาน | AI Business Owner",
  description: "ติดตามรายงานและ snapshot ล่าสุดของแต่ละร้าน",
};

export default function OwnerReportsPage() {
  return <OwnerPortal section="reports" />;
}
